import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  SpaceId,
  TrimmedNonEmptyString,
} from "../baseSchemas";
import { ProjectKind } from "../project";
import { ModelSelection } from "./provider";

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const SPACE_NAME_MAX_LENGTH = 32;
export const SPACES_MAX_COUNT = 50;
/** Reserved client-side identity for the virtual collection of unassigned projects. */
export const RESERVED_VOID_SPACE_ID = "void";
/** Per-command cap for bulk assignment; clients chunk larger selections. */
export const SPACE_PROJECTS_ASSIGN_MAX_COUNT = 200;
export const SPACE_ICON_NAMES = [
  "bag",
  "home",
  "code-brackets",
  "rocket",
  "light-bulb",
  "color-palette",
  "book",
  "lab",
  "heart",
  "star",
  "globe",
  "cloud",
  "hammer",
  "chart-2",
  "gamecontroller",
  "camera-1",
  "target",
  "tree",
  "school",
  "backpack",
] as const;
export const SpaceIconName = Schema.Literals(SPACE_ICON_NAMES);
export type SpaceIconName = typeof SpaceIconName.Type;
export const SpaceName = TrimmedNonEmptyString.check(Schema.isMaxLength(SPACE_NAME_MAX_LENGTH));
export type SpaceName = typeof SpaceName.Type;

export const OrchestrationSpace = Schema.Struct({
  id: SpaceId,
  name: SpaceName,
  icon: SpaceIconName,
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationSpace = typeof OrchestrationSpace.Type;

export const OrchestrationSpaceShell = Schema.Struct({
  id: SpaceId,
  name: SpaceName,
  icon: SpaceIconName,
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationSpaceShell = typeof OrchestrationSpaceShell.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  kind: Schema.optional(ProjectKind).pipe(Schema.withDecodingDefault(() => "project")),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  kind: Schema.optional(ProjectKind).pipe(Schema.withDecodingDefault(() => "project")),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;
