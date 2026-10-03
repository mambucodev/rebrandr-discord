import pkg from "../../package.json";

export interface VersionInfo {
  version: string;
  commitHash: string;
  shortCommitHash: string;
  repoUrl: string;
  commitUrl: string | null;
}

let cachedCommitHash: string | null = null;

export function getCommitHash(): string {
  if (cachedCommitHash !== null) {
    return cachedCommitHash;
  }

  // Check known environment variables
  const envCommit =
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.COOLIFY_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.HEROKU_SLUG_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA;

  if (envCommit && envCommit.trim().length > 0) {
    cachedCommitHash = envCommit.trim();
    return cachedCommitHash;
  }

  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
    if (result.exitCode === 0) {
      const sha = result.stdout.toString().trim();
      if (sha && sha.length > 0) {
        cachedCommitHash = sha;
        return cachedCommitHash;
      }
    }
  } catch {
    // Git command not available or not in a git repo
  }

  cachedCommitHash = "unknown";
  return cachedCommitHash;
}

export function setCachedCommitHashForTesting(hash: string | null): void {
  cachedCommitHash = hash;
}

export function getShortCommitHash(): string {
  const full = getCommitHash();
  if (full === "unknown") return "unknown";
  return full.slice(0, 7);
}

export function getRepoUrl(): string {
  return process.env.REPO_URL || process.env.PUBLIC_REPO_URL || "https://github.com/mambucodev/rebrandr-discord";
}

export function getCommitUrl(): string | null {
  const hash = getCommitHash();
  if (hash === "unknown") return null;
  const repo = getRepoUrl().replace(/\/+$/, "");
  return `${repo}/commit/${hash}`;
}

export function getVersion(): string {
  return pkg.version || "1.0.0";
}

export function getVersionInfo(): VersionInfo {
  return {
    version: getVersion(),
    commitHash: getCommitHash(),
    shortCommitHash: getShortCommitHash(),
    repoUrl: getRepoUrl(),
    commitUrl: getCommitUrl(),
  };
}
