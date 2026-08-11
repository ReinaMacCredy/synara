import { createHash } from "node:crypto";

import type { HandoffCapsuleItemV1 } from "@veylen/contracts";

interface HandoffSourceMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly createdAt: string;
}

export const handoffSourceDigest = (items: ReadonlyArray<HandoffCapsuleItemV1>): string =>
  createHash("sha256").update(JSON.stringify(items)).digest("hex");

export function canonicalHandoffSourceItems(
  messages: ReadonlyArray<HandoffSourceMessage>,
  sealedAt?: string,
): ReadonlyArray<HandoffCapsuleItemV1> {
  return messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.text.trim().length > 0 &&
        (sealedAt === undefined || message.createdAt <= sealedAt),
    )
    .map((message) => ({
      ref: `message:${message.id}`,
      role: message.role as "user" | "assistant",
      text: message.text.slice(0, 32_768),
      createdAt: message.createdAt,
    }));
}
