import type {
  EffectiveAuthorityReceipt,
  SupervisedSettingsSnapshot,
  SupervisedToolInvocationReceipt,
  SupervisedToolPolicy,
} from "@synara/contracts";

import type { HostToolDefinition } from "../../orchestration/hostTools/runtime.ts";
import {
  supervisedIntentToolRegistry,
  type SupervisedIntentToolDescriptor,
} from "../tools/Registry.ts";

type ProjectedTool = SupervisedSettingsSnapshot["tools"][number];

const isActiveReceipt = (receipt: EffectiveAuthorityReceipt, at: string) =>
  receipt.revokedAt === null && (receipt.expiresAt === null || receipt.expiresAt > at);

const unique = <Value>(values: ReadonlyArray<Value>): Value[] => [...new Set(values)];

const latestReceipt = (
  receipts: ReadonlyArray<SupervisedToolInvocationReceipt>,
): SupervisedToolInvocationReceipt | null =>
  receipts.reduce<SupervisedToolInvocationReceipt | null>(
    (latest, receipt) =>
      latest === null || receipt.requestedAt > latest.requestedAt ? receipt : latest,
    null,
  );

export function projectSupervisedSystemTools(input: {
  readonly definitions: ReadonlyArray<HostToolDefinition>;
  readonly policies: ReadonlyArray<SupervisedToolPolicy>;
  readonly receipts: ReadonlyArray<SupervisedToolInvocationReceipt>;
  readonly authorityReceipts: ReadonlyArray<EffectiveAuthorityReceipt>;
  readonly defaultUpdatedAt: string;
  readonly at: string;
  readonly registry?: ReadonlyArray<SupervisedIntentToolDescriptor>;
}): ProjectedTool[] {
  const registry = input.registry ?? supervisedIntentToolRegistry;
  const policyByToolId = new Map(input.policies.map((policy) => [policy.toolId, policy]));
  const definitionsByToolId = new Map<string, HostToolDefinition[]>();
  for (const definition of input.definitions) {
    if (!definition.supervised) continue;
    const definitions = definitionsByToolId.get(definition.supervised.toolId) ?? [];
    definitions.push(definition);
    definitionsByToolId.set(definition.supervised.toolId, definitions);
  }

  return registry.map((descriptor) => {
    const definitions = definitionsByToolId.get(descriptor.id) ?? [];
    const soleDefinition = definitions.length === 1 ? definitions[0] : null;
    const invocations = input.receipts.filter((receipt) => receipt.toolId === descriptor.id);
    const policy: SupervisedToolPolicy = policyByToolId.get(descriptor.id) ?? {
      toolId: descriptor.id,
      state: "enabled",
      revision: 0,
      reason: null,
      updatedAt: input.defaultUpdatedAt,
      revokedAt: null,
    };
    const grants = input.authorityReceipts.filter(
      (receipt) =>
        isActiveReceipt(receipt, input.at) &&
        descriptor.roles.includes(receipt.effectiveRole) &&
        receipt.allowedTools.includes(descriptor.id) &&
        descriptor.internalCommands.every((command) => receipt.allowedCommands.includes(command)),
    );
    const health: ProjectedTool["health"] =
      policy.state === "revoked"
        ? "revoked"
        : policy.state === "disabled"
          ? "disabled"
          : definitions.length > 0
            ? "healthy"
            : "adapter_unavailable";

    return {
      id: descriptor.id,
      providerToolNames: definitions.map((definition) => definition.name),
      displayName: soleDefinition?.displayName ?? descriptor.id,
      description:
        soleDefinition?.description ??
        (definitions.length > 1
          ? `${definitions.length} provider-facing adapters share this canonical intent.`
          : "Canonical intent is registered but has no provider-facing adapter in this build."),
      schemaVersion: definitions[0]?.supervised?.schemaVersion ?? descriptor.schemaVersion,
      source: definitions.length > 0 ? "Synara host runtime" : "Canonical intent registry",
      readOnly: descriptor.readOnly,
      allowedRoles: [...descriptor.roles],
      internalCommands: [...descriptor.internalCommands],
      providerSupport: {
        codex: definitions.some((definition) => definition.providerSupport.codex === "native")
          ? "native"
          : "unsupported",
        claude: definitions.some((definition) => definition.providerSupport.claude === "native")
          ? "native"
          : "unsupported",
      },
      allowedScopes: {
        workspaceIds: unique(grants.flatMap((receipt) => receipt.workspaceScopes)),
        roomIds: unique(grants.flatMap((receipt) => receipt.roomScopes)),
        taskNodeIds: unique(grants.flatMap((receipt) => receipt.taskNodeScopes)),
      },
      policy,
      health,
      lastInvocation: latestReceipt(invocations),
      successCount: invocations.filter((receipt) =>
        ["accepted", "committed", "projected"].includes(receipt.state),
      ).length,
      failureCount: invocations.filter((receipt) =>
        ["rejected", "denied", "failed", "timed_out"].includes(receipt.state),
      ).length,
    };
  });
}
