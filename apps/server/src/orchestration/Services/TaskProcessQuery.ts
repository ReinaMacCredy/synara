import type {
  GetSessionProgressInput,
  GetSessionProgressResult,
  GetTaskProcessGraphResult,
  GetTaskProcessInput,
  GetTaskProcessSummaryResult,
  ListTaskProcessesInput,
  ListTaskProcessesResult,
} from "@veylen/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface TaskProcessQueryShape {
  readonly listProcesses: (
    input: ListTaskProcessesInput,
  ) => Effect.Effect<ListTaskProcessesResult, Error>;
  readonly getSummary: (
    input: GetTaskProcessInput,
  ) => Effect.Effect<GetTaskProcessSummaryResult, Error>;
  readonly getGraph: (
    input: GetTaskProcessInput,
  ) => Effect.Effect<GetTaskProcessGraphResult, Error>;
  readonly getSessionProgress: (
    input: GetSessionProgressInput,
  ) => Effect.Effect<GetSessionProgressResult, Error>;
}

export class TaskProcessQuery extends ServiceMap.Service<TaskProcessQuery, TaskProcessQueryShape>()(
  "veylen/orchestration/Services/TaskProcessQuery",
) {}
