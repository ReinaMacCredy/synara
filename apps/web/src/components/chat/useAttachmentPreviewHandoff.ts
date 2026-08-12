// FILE: useAttachmentPreviewHandoff.ts
// Purpose: Owns the temporary blob-URL handoff from optimistic to persisted user attachments.
// Layer: Chat transcript hook

import { type MessageId } from "@veylen/contracts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { revokeBlobPreviewUrl } from "../ChatView.logic";
import type { ChatMessage } from "../../types";

const ATTACHMENT_PREVIEW_HANDOFF_TTL_MS = 5_000;

function revokeBlobPreviewUrlsAfterPaint(previewUrls: readonly string[]): void {
  if (previewUrls.length === 0 || typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      for (const previewUrl of previewUrls) revokeBlobPreviewUrl(previewUrl);
    }, 0);
  });
}

export function applyAttachmentPreviewHandoffs(
  messages: readonly ChatMessage[],
  previewUrlsByMessageId: Readonly<Record<string, readonly string[]>>,
): ChatMessage[] {
  if (Object.keys(previewUrlsByMessageId).length === 0) return [...messages];
  return messages.map((message) => {
    if (message.role !== "user" || !message.attachments || message.attachments.length === 0) {
      return message;
    }
    const previewUrls = previewUrlsByMessageId[message.id];
    if (!previewUrls || previewUrls.length === 0) return message;

    let changed = false;
    let imageIndex = 0;
    const attachments = message.attachments.map((attachment) => {
      if (attachment.type !== "image") return attachment;
      const previewUrl = previewUrls[imageIndex];
      imageIndex += 1;
      if (!previewUrl || attachment.previewUrl === previewUrl) return attachment;
      changed = true;
      return { ...attachment, previewUrl };
    });
    return changed ? { ...message, attachments } : message;
  });
}

export function useAttachmentPreviewHandoff() {
  const [previewUrlsByMessageId, setPreviewUrlsByMessageId] = useState<Record<string, string[]>>(
    {},
  );
  const previewUrlsRef = useRef<Record<string, string[]>>({});
  const timeoutByMessageIdRef = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    previewUrlsRef.current = previewUrlsByMessageId;
  }, [previewUrlsByMessageId]);

  const clear = useCallback(() => {
    for (const timeoutId of Object.values(timeoutByMessageIdRef.current)) {
      window.clearTimeout(timeoutId);
    }
    timeoutByMessageIdRef.current = {};
    for (const previewUrls of Object.values(previewUrlsRef.current)) {
      for (const previewUrl of previewUrls) revokeBlobPreviewUrl(previewUrl);
    }
    previewUrlsRef.current = {};
    setPreviewUrlsByMessageId({});
  }, []);

  useEffect(() => clear, [clear]);

  const handoff = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;
    const previousPreviewUrls = previewUrlsRef.current[messageId] ?? [];
    revokeBlobPreviewUrlsAfterPaint(
      previousPreviewUrls.filter((previewUrl) => !previewUrls.includes(previewUrl)),
    );
    setPreviewUrlsByMessageId((existing) => {
      const next = { ...existing, [messageId]: previewUrls };
      previewUrlsRef.current = next;
      return next;
    });

    const existingTimeout = timeoutByMessageIdRef.current[messageId];
    if (typeof existingTimeout === "number") window.clearTimeout(existingTimeout);
    timeoutByMessageIdRef.current[messageId] = window.setTimeout(() => {
      const currentPreviewUrls = previewUrlsRef.current[messageId];
      setPreviewUrlsByMessageId((existing) => {
        if (!(messageId in existing)) return existing;
        const next = { ...existing };
        delete next[messageId];
        previewUrlsRef.current = next;
        return next;
      });
      delete timeoutByMessageIdRef.current[messageId];
      if (currentPreviewUrls) revokeBlobPreviewUrlsAfterPaint(currentPreviewUrls);
    }, ATTACHMENT_PREVIEW_HANDOFF_TTL_MS);
  }, []);

  return { previewUrlsByMessageId, handoff } as const;
}
