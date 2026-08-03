import {
  ProjectTaskId,
  TaskProcessId,
  type ProjectTask,
  type TaskDependencyEdge,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { graphHasCycle, validateDependencySet } from "./dependencyGraph.ts";

const processId = TaskProcessId.makeUnsafe("process");
const task = (index: number): ProjectTask => ({
  id: ProjectTaskId.makeUnsafe(`task-${index}`),
  processId,
  parentTaskId: null,
  title: `Task ${index}`,
  description: null,
  acceptanceCriteria: [],
  priority: "normal",
  risk: "medium",
  lifecycle: "planned",
  orderKey: String(index),
  createdBy: { kind: "user", actorId: "owner" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});
const edge = (dependent: number, prerequisite: number): TaskDependencyEdge => ({
  id: `edge-${dependent}-${prerequisite}` as TaskDependencyEdge["id"],
  processId,
  dependentTaskId: ProjectTaskId.makeUnsafe(`task-${dependent}`),
  prerequisiteTaskId: ProjectTaskId.makeUnsafe(`task-${prerequisite}`),
  state: "active",
  createdBy: { kind: "user", actorId: "owner" },
  createdAt: "2026-08-01T00:00:00.000Z",
  waivedBy: null,
  waivedAt: null,
  waiverReason: null,
});

describe("TaskProcess dependency graph", () => {
  it("rejects self, duplicate, missing, and cyclic replacement sets", () => {
    const tasks = [task(0), task(1), task(2)];
    expect(
      validateDependencySet({
        processId,
        taskId: tasks[0]!.id,
        prerequisiteTaskIds: [tasks[0]!.id],
        tasks,
        existingDependencies: [],
      })?.code,
    ).toBe("self_dependency");
    expect(
      validateDependencySet({
        processId,
        taskId: tasks[1]!.id,
        prerequisiteTaskIds: [tasks[0]!.id, tasks[0]!.id],
        tasks,
        existingDependencies: [],
      })?.code,
    ).toBe("duplicate_dependency");
    expect(
      validateDependencySet({
        processId,
        taskId: tasks[0]!.id,
        prerequisiteTaskIds: [tasks[2]!.id],
        tasks,
        existingDependencies: [edge(1, 0), edge(2, 1)],
      })?.code,
    ).toBe("cycle");
  });

  it("accepts generated DAGs and detects a closing back-edge", () => {
    for (let size = 2; size <= 40; size += 1) {
      const tasks = Array.from({ length: size }, (_, index) => task(index));
      const dependencies = Array.from({ length: size - 1 }, (_, index) => edge(index + 1, index));
      expect(graphHasCycle({ tasks, dependencies })).toBe(false);
      expect(graphHasCycle({ tasks, dependencies: [...dependencies, edge(0, size - 1)] })).toBe(
        true,
      );
    }
  });

  it("preserves acyclicity across seeded randomized DAGs", () => {
    let seed = 0x51a7c0de;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let trial = 0; trial < 64; trial += 1) {
      const size = 4 + Math.floor(random() * 28);
      const tasks = Array.from({ length: size }, (_, index) => task(index));
      const dependencies: TaskDependencyEdge[] = [];
      for (let dependent = 1; dependent < size; dependent += 1) {
        for (let prerequisite = 0; prerequisite < dependent; prerequisite += 1) {
          if (random() < 0.16) dependencies.push(edge(dependent, prerequisite));
        }
      }
      dependencies.push(edge(size - 1, 0));

      expect(graphHasCycle({ tasks, dependencies })).toBe(false);
      expect(graphHasCycle({ tasks, dependencies: [...dependencies, edge(0, size - 1)] })).toBe(
        true,
      );
    }
  });
});
