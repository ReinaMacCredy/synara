import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThreadActivityGlyph } from "./ThreadActivityGlyph";

describe("ThreadActivityGlyph", () => {
  it("centers the working dot grid inside its fixed trailing slot", () => {
    const markup = renderToStaticMarkup(<ThreadActivityGlyph state="working" />);

    expect(markup).toContain("inline-flex size-4 items-center justify-center");
    expect(markup).toContain("place-items-center");
    expect(markup.match(/thread-activity-grid-dot/g) ?? []).toHaveLength(6);
  });
});
