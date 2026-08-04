import { describe, expect, it } from "vitest";

import { parseProfileImport } from "./supervisedOrchestrationProfileImport";

describe("supervised orchestration profile imports", () => {
  it("parses JSON exports", () => {
    const profile = parseProfileImport(
      JSON.stringify({
        name: "JSON reviewer",
        roleHints: ["peer"],
        runtime: {
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          developerInstructions: "Review carefully.",
          providerOptions: { features: { multi_agent: false } },
        },
      }),
      "reviewer.json",
    );

    expect(profile.name).toBe("JSON reviewer");
    expect(profile.runtime.model).toBe("gpt-5.6-sol");
    expect(profile.roleHints).toEqual(["peer"]);
  });

  it("parses TOML exports", () => {
    const profile = parseProfileImport(
      `name = "TOML lead"
roleHints = ["lead"]

[runtime]
provider = "codex"
model = "gpt-5.6-luna"
reasoningEffort = "high"
sandboxMode = "danger-full-access"
approvalPolicy = "never"
developerInstructions = "Lead the project."

[runtime.providerOptions.features]
multi_agent = false
`,
      "lead.toml",
    );

    expect(profile.name).toBe("TOML lead");
    expect(profile.runtime.reasoningEffort).toBe("high");
    expect(profile.runtime.providerOptions).toEqual({ features: { multi_agent: false } });
  });

  it("maps native Codex TOML profiles into a supervision draft", () => {
    const profile = parseProfileImport(
      `model = "gpt-5.6-sol"
model_instructions_file = "~/.codex/model-instructions.md"
model_reasoning_effort = "medium"
personality = "pragmatic"
sandbox_mode = "danger-full-access"
approval_policy = "never"
service_tier = "default"
developer_instructions = """
Room role: Supervisor.

Observe the workspace and advise its Root.
"""
`,
      "test.toml",
    );

    expect(profile).toMatchObject({
      name: "Test",
      roleHints: ["supervisor"],
      runtime: {
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        developerInstructions: expect.stringContaining("Room role: Supervisor"),
        providerOptions: {
          model_instructions_file: "~/.codex/model-instructions.md",
          personality: "pragmatic",
          service_tier: "default",
        },
      },
    });
  });

  it("rejects unsupported files and invalid profile fields", () => {
    expect(() => parseProfileImport("name = 'x'", "profile.txt")).toThrow(/\.json or \.toml/);
    expect(() =>
      parseProfileImport(
        JSON.stringify({
          name: "Broken",
          runtime: {
            provider: "unknown",
            model: "model",
            sandboxMode: "workspace-write",
            approvalPolicy: "never",
          },
        }),
        "broken.json",
      ),
    ).toThrow(/Unsupported provider/);
  });
});
