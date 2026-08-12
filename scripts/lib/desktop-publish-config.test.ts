import { assert, describe, it } from "@effect/vitest";

import {
  DEFAULT_DESKTOP_UPDATE_REPOSITORY,
  resolveGitHubPublishConfig,
} from "./desktop-publish-config.ts";

describe("resolveGitHubPublishConfig", () => {
  it("uses the canonical Veylen repository and updater channel without CI metadata", () => {
    assert.equal(DEFAULT_DESKTOP_UPDATE_REPOSITORY, "ReinaMacCredy/Veylen");
    assert.deepStrictEqual(resolveGitHubPublishConfig({}), {
      provider: "github",
      owner: "ReinaMacCredy",
      repo: "Veylen",
      releaseType: "release",
      channel: "latest",
    });
  });

  it("prefers an explicit updater repository over GitHub Actions metadata", () => {
    assert.deepStrictEqual(
      resolveGitHubPublishConfig({
        VEYLEN_DESKTOP_UPDATE_REPOSITORY: "owner/updates",
        GITHUB_REPOSITORY: "owner/source",
      }),
      {
        provider: "github",
        owner: "owner",
        repo: "updates",
        releaseType: "release",
        channel: "latest",
      },
    );
  });

  it("rejects malformed repository coordinates", () => {
    assert.equal(
      resolveGitHubPublishConfig({ VEYLEN_DESKTOP_UPDATE_REPOSITORY: "owner/repo/extra" }),
      undefined,
    );
  });
});
