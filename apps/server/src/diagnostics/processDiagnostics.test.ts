import { describe, expect, it } from "vitest";

import { collectDescendantProcesses, parseProcessTable } from "./processDiagnostics";

describe("process diagnostics", () => {
  it("parses byte sizes and redacts process arguments", () => {
    const [row] = parseProcessTable(
      "42 1 3 4 node node server.js --token super-secret-value-that-should-not-leak",
    );
    expect(row).toMatchObject({ pid: 42, ppid: 1, rssBytes: 3_072, virtualSizeBytes: 4_096 });
    expect(row?.args).not.toContain("super-secret-value-that-should-not-leak");
  });

  it("returns only descendants ordered by resident memory", () => {
    const rows = parseProcessTable(
      [
        "2 1 10 20 child child",
        "3 2 30 40 grandchild grandchild",
        "4 99 50 60 unrelated unrelated",
      ].join("\n"),
    );
    expect(collectDescendantProcesses(rows, 1).map(({ pid }) => pid)).toEqual([3, 2]);
  });
});
