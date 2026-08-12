import { MessageId } from "@veylen/contracts";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../types";
import { applyAttachmentPreviewHandoffs } from "./useAttachmentPreviewHandoff";

describe("applyAttachmentPreviewHandoffs", () => {
  it("replaces image previews by image order without changing non-image attachments", () => {
    const message: ChatMessage = {
      id: MessageId.makeUnsafe("message-1"),
      role: "user",
      text: "attachments",
      createdAt: "2026-08-12T00:00:00.000Z",
      streaming: false,
      source: "native",
      attachments: [
        {
          type: "image",
          id: "one",
          name: "one.png",
          mimeType: "image/png",
          sizeBytes: 1,
          previewUrl: "/persisted/one",
        },
        { type: "file", id: "notes", name: "notes.txt", mimeType: "text/plain", sizeBytes: 2 },
        {
          type: "image",
          id: "two",
          name: "two.png",
          mimeType: "image/png",
          sizeBytes: 3,
          previewUrl: "/persisted/two",
        },
      ],
    };

    const [result] = applyAttachmentPreviewHandoffs([message], {
      [message.id]: ["blob:one", "blob:two"],
    });

    expect(result?.attachments).toEqual([
      {
        type: "image",
        id: "one",
        name: "one.png",
        mimeType: "image/png",
        sizeBytes: 1,
        previewUrl: "blob:one",
      },
      { type: "file", id: "notes", name: "notes.txt", mimeType: "text/plain", sizeBytes: 2 },
      {
        type: "image",
        id: "two",
        name: "two.png",
        mimeType: "image/png",
        sizeBytes: 3,
        previewUrl: "blob:two",
      },
    ]);
  });

  it("preserves message identity when no preview changes", () => {
    const message: ChatMessage = {
      id: MessageId.makeUnsafe("message-2"),
      role: "assistant",
      text: "unchanged",
      createdAt: "2026-08-12T00:00:00.000Z",
      streaming: false,
      source: "native",
    };
    expect(applyAttachmentPreviewHandoffs([message], { [message.id]: ["blob:unused"] })[0]).toBe(
      message,
    );
  });
});
