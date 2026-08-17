// GitHub REST API client. Implements the same 11-call flow as the Elixir
// AssetMetadataService.GitHub module:
//   1. GET    /git/ref/heads/master                       (call 2)
//   2. GET    /git/refs                                   (call 3, paginated)
//   3. POST   /git/refs                                   (call 4)
//   4. GET    /git/ref/heads/<branch>                     (call 5)
//   5. POST   /git/blobs (base64)                         (call 6)
//   6. POST   /git/trees                                  (call 7)
//   7. POST   /git/commits                                (call 8)
//   8. POST   /git/refs/heads/<branch>                    (call 9)
//   9. GET    /pulls?head=...&base=...                    (call 10, paginated)
//  10. POST   /pulls                                       (call 11)
//
// All calls share a single helper that:
//   - sends GET / POST with the bearer token
//   - has a 10s AbortSignal.timeout
//   - logs the URL (info) before, and logs status + body excerpt (warn)
//     on non-2xx, and a stack trace (error) on transport / parse failures

import { env } from "../env";

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly url: string,
  ) {
    super(`GitHub ${status}`);
    this.name = "GitHubError";
  }
}

const TIMEOUT_MS = 10_000;

interface Ref { ref: string; object: { sha: string } }

export class GitHub {
  private headers = {
    Authorization: `Bearer ${env.githubToken}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  private async req<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${env.githubApi}${path}`;
    console.log(`github ${method} ${url}`);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(`github ${method} ${url} transport error:`, err);
      throw new GitHubError(0, { message: (err as Error).message ?? "transport" }, url);
    }

    if (!res.ok) {
      let respBody: unknown = null;
      try { respBody = await res.json(); } catch { /* may not be JSON */ }
      console.warn(
        `github ${method} ${url} failed: HTTP ${res.status} ${JSON.stringify(respBody).slice(0, 500)}`,
      );
      throw new GitHubError(res.status, respBody, url);
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      console.error(`github ${method} ${url} response not JSON:`, err);
      throw new GitHubError(res.status, { message: "non-JSON response" }, url);
    }
  }

  // ----- 1. GET master SHA ------------------------------------------------
  async branchSha(branch: string): Promise<string> {
    const res = await this.req<{ object: { sha: string } }>(
      "GET",
      `/repos/${env.githubRepo}/git/ref/heads/${branch}`,
    );
    return res.object.sha;
  }

  // ----- 2+3. find-or-create the per-asset branch (paginated find) --------
  async ensureBranch(branch: string, fromSha: string): Promise<void> {
    const existing = await this.findExistingBranch(branch);
    if (existing) return; // already exists, idempotent

    await this.req(
      "POST",
      `/repos/${env.githubRepo}/git/refs`,
      { ref: `refs/heads/${branch}`, sha: fromSha },
    );
  }

  // ----- 2a. paginated walk through /git/refs to find an existing branch --
  private async findExistingBranch(branch: string): Promise<boolean> {
    const target = `refs/heads/${branch}`;
    let page = 1;
    while (true) {
      const refs = await this.req<Ref[]>(
        "GET",
        `/repos/${env.githubRepo}/git/refs?per_page=100&page=${page}`,
      );
      if (!Array.isArray(refs) || refs.length === 0) return false;
      if (refs.some((r) => r.ref === target)) return true;
      if (refs.length < 100) return false;
      page += 1;
    }
  }

  // ----- 4. POST blob (base64-encoded) ------------------------------------
  async createBlob(content: Uint8Array): Promise<string> {
    const res = await this.req<{ sha: string }>(
      "POST",
      `/repos/${env.githubRepo}/git/blobs`,
      {
        content: bytesToBase64(content),
        encoding: "base64",
      },
    );
    return res.sha;
  }

  // ----- 5+6+7. create tree → commit → move branch forward ---------------
  async commitFiles(
    branch: string,
    message: string,
    files: Map<string, Uint8Array>,
    parentSha: string,
  ): Promise<string> {
    // Build tree spec: text content inline, binary content as blob refs.
    const entries: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      content?: string;
      sha?: string;
    }> = [];

    for (const [path, content] of files) {
      const base = { path, mode: "100644" as const, type: "blob" as const };
      if (isValidUtf8(content)) {
        entries.push({ ...base, content: new TextDecoder("utf-8").decode(content) });
      } else {
        const sha = await this.createBlob(content);
        entries.push({ ...base, sha });
      }
    }

    const treeRes = await this.req<{ sha: string }>(
      "POST",
      `/repos/${env.githubRepo}/git/trees`,
      { base_tree: parentSha, tree: entries },
    );

    const commitRes = await this.req<{ sha: string }>(
      "POST",
      `/repos/${env.githubRepo}/git/commits`,
      {
        message,
        tree: treeRes.sha,
        parents: [parentSha],
      },
    );

    await this.req(
      "POST",
      `/repos/${env.githubRepo}/git/refs/heads/${branch}`,
      { sha: commitRes.sha, force: false },
    );

    return commitRes.sha;
  }

  // ----- 8. paginated walk through /pulls to find an existing PR ---------
  // Strategy: GitHub's `head` query filter is unreliable for merged PRs
  // (it sometimes returns nothing even though the PR exists). So we
  // try three things in order:
  //   1. `state=all` with the head filter (fast, but may miss merged PRs)
  //   2. `state=open` with the head filter (open PRs only)
  //   3. Paginate without the head filter and match `head.ref` client-side.
  //      This is the slowest but most reliable — it always finds the PR
  //      if it exists. Limited to `state=all` to avoid scanning hundreds
  //      of open PRs on busy repos.
  // Returns the first match's URL.
  async findExistingPr(branch: string): Promise<string | null> {
    for (const state of ["all", "open"] as const) {
      const found = await this.findExistingPrWithState(branch, state);
      if (found) return found;
    }
    return this.findExistingPrByBranchOnly(branch);
  }

  private async findExistingPrWithState(
    branch: string,
    state: "open" | "closed" | "all",
  ): Promise<string | null> {
    const head = `${env.githubRepo}:${branch}`;
    let page = 1;
    while (true) {
      const list = await this.req<Array<{ html_url?: string; head?: { ref?: string } }>>(
        "GET",
        `/repos/${env.githubRepo}/pulls?state=${state}&per_page=100&page=${page}&head=${head}&base=${env.githubBaseBranch}`,
      );
      if (!Array.isArray(list) || list.length === 0) return null;
      const hit = list.find((p) => p.head?.ref === branch || p.html_url !== undefined);
      if (hit?.html_url) return hit.html_url;
      if (list.length < 100) return null;
      page += 1;
    }
  }

  // Fallback: paginate `state=all` without any head filter, match the
  // branch name on each PR's `head.ref`. This is robust against the
  // head filter's quirks but only iterates `all` PRs (open PRs would
  // be too many on busy repos). Caller already tried `state=open`
  // with the head filter, so we don't need to paginate open ones here.
  private async findExistingPrByBranchOnly(
    branch: string,
  ): Promise<string | null> {
    let page = 1;
    while (true) {
      const list = await this.req<Array<{ html_url?: string; head?: { ref?: string } }>>(
        "GET",
        `/repos/${env.githubRepo}/pulls?state=all&per_page=100&page=${page}&base=${env.githubBaseBranch}`,
      );
      if (!Array.isArray(list) || list.length === 0) return null;
      const hit = list.find((p) => p.head?.ref === branch && p.html_url !== undefined);
      if (hit?.html_url) return hit.html_url;
      if (list.length < 100) return null;
      page += 1;
    }
  }

  // ----- 9. POST /pulls — with 422 race-recovery -------------------------
  async openPr(headBranch: string, title: string, body: string): Promise<string> {
    try {
      const res = await this.req<{ html_url: string }>(
        "POST",
        `/repos/${env.githubRepo}/pulls`,
        {
          title,
          head: headBranch,
          base: env.githubBaseBranch,
          body,
        },
      );
      return res.html_url;
    } catch (err) {
      // 422 from POST /pulls almost always means "a pull request already
      // exists for this head branch" — could be a race or a re-submission.
      // Re-fetch the existing URL via findExistingPr; if it still misses,
      // re-throw the original error so the caller surfaces GitHub's actual
      // message.
      if (err instanceof GitHubError && err.status === 422) {
        const url = await this.findExistingPr(headBranch);
        if (url) return url;
      }
      throw err;
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Bun ships a fast base64 encoder.
  // @ts-expect-error — Bun's btoa / atob are on globalThis in Bun.
  return btoa(String.fromCharCode(...bytes));
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
