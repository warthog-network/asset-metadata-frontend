import { afterEach, describe, expect, mock, test } from "bun:test";
import { GitHub, GitHubError } from "../src/lib/github";

// We mock `fetch` globally and match on URL pattern. Each test sets up
// the responses for the calls it expects; unmatched URLs throw a clear
// "no mock registered" error so test setup mistakes are obvious.

interface MockResp {
  status?: number;
  body: unknown;
}

interface MockRoute {
  match: (url: string, method: string) => boolean;
  respond: MockResp | { throw: Error };
}

const originalFetch = globalThis.fetch;

function mockRoutes(routes: MockRoute[]) {
  let calls = 0;
  globalThis.fetch = mock(async (input: string | URL | Request, _init?: RequestInit) => {
    calls++;
    // Bun passes the first arg directly — which in our GitHub client is
    // always a URL string (e.g. "https://api.github.com/..."). Coerce to URL.
    const url = new URL(String(input));
    // Recover method from the init object (passed by GitHub client).
    const method = ((_init?.method as string | undefined) ?? "GET").toUpperCase();
    const pathAndQuery = url.pathname + url.search;
    const route = routes.find((r) => r.match(pathAndQuery, method));
    if (!route) {
      throw new Error(
        `mock fetch: no route registered for ${method} ${pathAndQuery} (call #${calls})`,
      );
    }
    const r = route.respond;
    if ("throw" in r) throw r.throw;
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

afterEach(() => {
  restoreFetch();
});

// Match helper: returns a route matcher for any GET/POST on `path`.
const any = (method: "GET" | "POST", path: string) => (url: string, m: string) =>
  url === path && m === method;

describe("GitHub flow", () => {
  test("openPr: happy path returns the PR URL on first try", async () => {
    mockRoutes([
      { match: any("POST", "/repos/warthog-network/public-data/pulls"),
        respond: { body: { html_url: "https://github.com/x/y/pull/1" } } },
    ]);
    const gh = new GitHub();
    const url = await gh.openPr(
      "asset-metadata/abc123",
      "Add token metadata: TMSIZ (1189...973d)",
      "body",
    );
    expect(url).toBe("https://github.com/x/y/pull/1");
  });

  test("openPr: re-submission — 422 on POST /pulls recovers via find_existing_pr (state=all)", async () => {
    mockRoutes([
      {
        match: (url) => url.startsWith("/repos/warthog-network/public-data/pulls") && !url.includes("?"),
        respond: {
          status: 422,
          body: {
            message: "Validation Failed",
            errors: [
              { message: "A pull request already exists for warthog-network:asset-metadata/abc." },
            ],
          },
        },
      },
      {
        // The recovery GET pulls?state=all&... — finds the existing PR.
        match: (url) => url.startsWith("/repos/warthog-network/public-data/pulls") && url.includes("state=all"),
        respond: {
          body: [{
            html_url: "https://github.com/x/y/pull/42",
            head: { ref: "asset-metadata/abc..." },
          }],
        },
      },
    ]);
    const gh = new GitHub();
    const url = await gh.openPr("asset-metadata/abc", "title", "body");
    expect(url).toBe("https://github.com/x/y/pull/42");
  });

  test("branchSha: 404 bubbles up as GitHubError(404)", async () => {
    mockRoutes([
      { match: any("GET", "/repos/warthog-network/public-data/git/ref/heads/master"),
        respond: { status: 404, body: { message: "Not Found" } } },
    ]);
    const gh = new GitHub();
    expect(gh.branchSha("master")).rejects.toBeInstanceOf(GitHubError);
  });

  test("branchSha: transport error (timeout) wraps as GitHubError(0)", async () => {
    mockRoutes([
      { match: any("GET", "/repos/warthog-network/public-data/git/ref/heads/master"),
        respond: { throw: new Error("aborted") } },
    ]);
    const gh = new GitHub();
    try {
      await gh.branchSha("master");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(0);
    }
  });

  test("branchSha: malformed JSON response wraps as GitHubError(200)", async () => {
    // Use a raw fetch override here because mockRoutes always wraps the
    // body in JSON.stringify(), which would mask the malformed-response
    // path. We need the actual `await res.json()` call to throw SyntaxError.
    globalThis.fetch = mock(async () => {
      return new Response("not json at all", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as typeof fetch;
    const gh = new GitHub();
    try {
      await gh.branchSha("master");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).status).toBe(200);
    }
  });
});
