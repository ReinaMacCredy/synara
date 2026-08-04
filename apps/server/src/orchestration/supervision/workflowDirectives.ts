import type { WorkflowConflict, WorkflowDirective } from "@synara/contracts";

export function effectiveWorkflowDirectives(input: {
  readonly directives: readonly WorkflowDirective[];
  readonly conflicts: readonly WorkflowConflict[];
}): WorkflowDirective[] {
  const conflictedIds = new Set(
    input.conflicts
      .filter((conflict) => conflict.status === "open")
      .flatMap((conflict) => conflict.directiveIds),
  );
  const bySlot = new Map<string, WorkflowDirective>();
  for (const directive of input.directives) {
    if (directive.status !== "active" || conflictedIds.has(directive.id)) continue;
    const current = bySlot.get(directive.slot);
    if (!current || directive.revision > current.revision) bySlot.set(directive.slot, directive);
  }
  return [...bySlot.values()].toSorted((left, right) => left.slot.localeCompare(right.slot));
}

export function workflowDirectiveConflicts(input: {
  readonly existing: readonly WorkflowDirective[];
  readonly candidate: WorkflowDirective;
}): WorkflowDirective[] {
  return input.existing.filter(
    (directive) =>
      directive.leadSeatId === input.candidate.leadSeatId &&
      directive.slot === input.candidate.slot &&
      directive.status === "active" &&
      directive.instruction !== input.candidate.instruction,
  );
}
