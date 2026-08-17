// Single source of truth for environment variables. Every module imports
// `env` rather than re-reading `process.env` — same pattern as the Elixir
// `runtime.exs` does with `Application.get_env(:asset_metadata_service, ...)`.

const REQUIRED_IN_PROD = ["GITHUB_TOKEN"] as const;

function readOrThrow(env: typeof process.env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`environment variable ${key} is missing`);
  return v;
}

function readWithDefault(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  for (const key of REQUIRED_IN_PROD) {
    if (!process.env[key]) {
      throw new Error(
        `environment variable ${key} is required in production. ` +
          `Generate a Classic PAT at https://github.com/settings/tokens?type=beta with repo scope.`,
      );
    }
  }
}

export const env = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  testnetNodeUrl: readWithDefault(
    "TESTNET_NODE_URL",
    "https://warthog-defitestnet.duckdns.org/",
  ),
  githubApi: "https://api.github.com",
  githubToken: isProd ? readOrThrow(process.env, "GITHUB_TOKEN") : (process.env.GITHUB_TOKEN ?? ""),
  githubRepo: readWithDefault("GITHUB_REPO", "warthog-network/public-data"),
  githubBaseBranch: readWithDefault("GITHUB_BASE_BRANCH", "master"),
  endpointBaseUrl: process.env.ENDPOINT_BASE_URL ?? "",
  corsOrigin: process.env.CORS_ORIGIN ?? "",
} as const;

export const isProduction = isProd;
