import { describe, expect, it } from "vitest";

import {
  findLegacySupervisedWriterViolations,
  isProductionTypeScriptPath,
} from "./check-supervised-compatibility";

describe("Supervised compatibility writer guard", () => {
  it("rejects legacy event, aggregate, and role writers in production", () => {
    const violations = findLegacySupervisedWriterViolations([
      {
        path: "apps/server/src/newWriter.ts",
        contents: [
          'const event = { type: "supervision.profile-created" };',
          'const legacy = { type: "supervised.specialist-upserted" };',
          'const aggregate = { aggregateKind: "specialist" };',
          'const seat = { role: "specialist" };',
        ].join("\n"),
      },
    ]);
    expect(violations).toHaveLength(4);
  });

  it("allows compatibility fixtures while scanning production TypeScript", () => {
    expect(isProductionTypeScriptPath("apps/server/src/compatibility.test.ts")).toBe(false);
    expect(isProductionTypeScriptPath("apps/server/src/runtime.ts")).toBe(true);
    expect(
      findLegacySupervisedWriterViolations([
        {
          path: "apps/server/src/compatibility.test.ts",
          contents: 'const event = { type: "supervision.profile-created" };',
        },
      ]),
    ).toEqual([]);
  });
});
