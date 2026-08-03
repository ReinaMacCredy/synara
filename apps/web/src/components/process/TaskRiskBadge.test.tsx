import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskRiskBadge } from "./TaskRiskBadge";

describe("TaskRiskBadge", () => {
  it("renders the canonical Task risk levels with the shield-terminal glyph", () => {
    const markup = renderToStaticMarkup(
      <>
        <TaskRiskBadge risk="high" />
        <TaskRiskBadge risk="medium" />
        <TaskRiskBadge risk="low" />
      </>,
    );

    expect(markup).toContain('data-task-risk="high"');
    expect(markup).toContain('data-task-risk="medium"');
    expect(markup).toContain('data-task-risk="low"');
    expect(markup).toContain("High risk");
    expect(markup).toContain("Medium risk");
    expect(markup).toContain("Low risk");
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('d="M12 3 19 6v5c0 4.6-2.7 7.8-7 10-4.3-2.2-7-5.4-7-10V6l7-3Z"');
  });
});
