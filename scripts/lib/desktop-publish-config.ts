export interface GitHubPublishConfig {
  readonly provider: "github";
  readonly owner: string;
  readonly repo: string;
  readonly releaseType: "release";
  readonly channel: "latest";
}

export interface DesktopPublishEnvironment {
  readonly VEYLEN_DESKTOP_UPDATE_REPOSITORY?: string | undefined;
  readonly GITHUB_REPOSITORY?: string | undefined;
}

export const DEFAULT_DESKTOP_UPDATE_REPOSITORY = "ReinaMacCredy/Veylen";

export function resolveGitHubPublishConfig(
  environment: DesktopPublishEnvironment,
): GitHubPublishConfig | undefined {
  const rawRepo =
    environment.VEYLEN_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    environment.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_DESKTOP_UPDATE_REPOSITORY;

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) return undefined;

  return {
    provider: "github",
    owner,
    repo,
    releaseType: "release",
    channel: "latest",
  };
}
