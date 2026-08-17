import { describe, expect, test } from "bun:test";
import { env } from "../src/env";

describe("env", () => {
  test("port defaults to 4000 when PORT unset", () => {
    expect(env.port).toBe(parseInt(process.env.PORT ?? "4000", 10));
  });

  test("testnetNodeUrl has a sensible default", () => {
    expect(env.testnetNodeUrl).toMatch(/^https?:\/\//);
    expect(env.testnetNodeUrl).toContain("duckdns");
  });

  test("githubRepo defaults to warthog-network/public-data", () => {
    expect(env.githubRepo).toBe("warthog-network/public-data");
  });

  test("githubBaseBranch defaults to master", () => {
    expect(env.githubBaseBranch).toBe("master");
  });

  test("githubApi is the canonical GitHub API endpoint", () => {
    expect(env.githubApi).toBe("https://api.github.com");
  });

  test("githubToken is a string (possibly empty in dev)", () => {
    expect(typeof env.githubToken).toBe("string");
  });
});
