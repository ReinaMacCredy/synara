import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkLogEntry } from "../../session-logic";
import ChatMarkdown from "../ChatMarkdown";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

export const REASONING_ACTIVITY_MAX_HEIGHT_PX = 180;

export function reasoningActivityText(entries: ReadonlyArray<WorkLogEntry>): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const text = entry.detail?.trim() || entry.preview?.trim();
    if (!text || parts.at(-1) === text) continue;
    parts.push(text);
  }
  return parts.join("\n\n");
}

export function ReasoningActivityStream(props: {
  entries: ReadonlyArray<WorkLogEntry>;
  fontSize: CSSProperties["fontSize"];
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
}) {
  const text = useMemo(() => reasoningActivityText(props.entries), [props.entries]);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => setContentHeight(node.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const capped = contentHeight !== null && contentHeight > REASONING_ACTIVITY_MAX_HEIGHT_PX;
  const streamOffset = capped ? REASONING_ACTIVITY_MAX_HEIGHT_PX - contentHeight : 0;
  const viewportHeight =
    contentHeight === null ? undefined : Math.min(contentHeight, REASONING_ACTIVITY_MAX_HEIGHT_PX);
  const maskImage = capped ? "linear-gradient(to bottom, transparent, black 12px)" : undefined;

  return (
    <div
      data-reasoning-activity-stream="true"
      aria-busy="true"
      className="w-full pt-3 text-muted-foreground/70"
      style={{ fontSize: props.fontSize }}
    >
      <div
        role="status"
        aria-live="polite"
        className="h-7 min-w-0 shimmer motion-reduce:animate-none"
      >
        Thinking…
      </div>
      <div
        data-reasoning-activity-viewport="true"
        className="overflow-hidden pr-1 transition-[height] duration-220 ease-out motion-reduce:transition-none"
        style={{
          ...(viewportHeight === undefined ? {} : { height: viewportHeight }),
          maxHeight: REASONING_ACTIVITY_MAX_HEIGHT_PX,
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      >
        <div
          ref={contentRef}
          data-reasoning-activity-content="true"
          className="py-2 transition-transform duration-220 ease-out motion-reduce:transition-none"
          style={{ transform: `translateY(${streamOffset}px)` }}
        >
          <ChatMarkdown
            text={text}
            cwd={props.markdownCwd}
            isStreaming
            onImageExpand={props.onImageExpand}
            style={{ fontSize: props.fontSize }}
          />
        </div>
      </div>
    </div>
  );
}
