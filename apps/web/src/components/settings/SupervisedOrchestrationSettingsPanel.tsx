import {
  ProfilePresetId,
  SupervisionAggregateId,
  type ProfileApprovalPolicy,
  type ProfilePreset,
  type ProfileProviderKind,
  type ProfileSandboxMode,
  type ProviderKind,
  type ProviderModelDescriptor,
  type SupervisionSnapshot,
} from "@synara/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppSettings } from "~/appSettings";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { getRuntimeAwareModelCapabilities } from "~/components/chat/runtimeModelCapabilities";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuTrigger } from "~/components/ui/menu";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "~/components/ui/preview-card";
import { SearchInput } from "~/components/ui/search-input";
import { SelectItem } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import {
  ArchiveIcon,
  ArrowRightIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FileIcon,
  InfoIcon,
  PencilIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "~/lib/icons";
import { cn, newCommandId, randomUUID } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { SettingsSelectControl } from "./SettingControls";
import { SupervisedOrchestrationProfileLibrary } from "./SupervisedOrchestrationProfileLibrary";
import type { ImportedProfilePreset } from "./supervisedOrchestrationProfileImport";

const SANDBOXES: readonly ProfileSandboxMode[] = [
  "read-only",
  "workspace-write",
  "danger-full-access",
];
const APPROVALS: readonly ProfileApprovalPolicy[] = [
  "untrusted",
  "on-failure",
  "on-request",
  "never",
];
const AGGREGATE_ID = SupervisionAggregateId.makeUnsafe("supervision");

export type ProfileDraft = {
  readonly id: ProfilePresetId | null;
  readonly name: string;
  readonly roleHints: string;
  readonly provider: ProfileProviderKind;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly sandboxMode: ProfileSandboxMode;
  readonly approvalPolicy: ProfileApprovalPolicy;
  readonly developerInstructions: string;
  readonly providerOptions: string;
};

type ProfileDraftErrors = Partial<Record<"name" | "model" | "providerOptions", string>>;

export const EMPTY_DRAFT: ProfileDraft = {
  id: null,
  name: "New profile",
  roleHints: "",
  provider: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  sandboxMode: "danger-full-access",
  approvalPolicy: "never",
  developerInstructions: "",
  providerOptions:
    '{\n  "features": {\n    "multi_agent": false,\n    "multi_agent_v2": false\n  }\n}',
};

function draftFromProfile(profile: ProfilePreset): ProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    roleHints: profile.roleHints.join(", "),
    provider: profile.runtime.provider,
    model: profile.runtime.model,
    reasoningEffort: profile.runtime.reasoningEffort ?? "",
    sandboxMode: profile.runtime.sandboxMode,
    approvalPolicy: profile.runtime.approvalPolicy,
    developerInstructions: profile.runtime.developerInstructions,
    providerOptions: JSON.stringify(profile.runtime.providerOptions ?? {}, null, 2),
  };
}

function redactedExport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactedExport);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /token|secret|password|api[_-]?key|credential/i.test(key)
        ? "[redacted]"
        : redactedExport(entry),
    ]),
  );
}

function roleHintsFromDraft(value: string): Array<"supervisor" | "lead" | "peer"> {
  const normalized = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(
      (entry): entry is "supervisor" | "lead" | "peer" =>
        entry === "supervisor" || entry === "lead" || entry === "peer",
    );
  return [...new Set(normalized)];
}

export function validateProfileDraft(
  draft: ProfileDraft,
  profiles: readonly ProfilePreset[],
): ProfileDraftErrors {
  const errors: ProfileDraftErrors = {};
  const name = draft.name.trim();
  if (!name) {
    errors.name = "Name is required.";
  } else if (
    profiles.some(
      (profile) =>
        profile.id !== draft.id && profile.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.name = "A profile with this name already exists.";
  }
  if (!draft.model.trim()) errors.model = "Model is required.";
  try {
    if (draft.providerOptions.trim()) JSON.parse(draft.providerOptions);
  } catch {
    errors.providerOptions = "Provider options must be valid JSON.";
  }
  return errors;
}

export function profileDraftIsDirty(
  draft: ProfileDraft | null,
  baseline: ProfileDraft | null,
): boolean {
  return Boolean(
    draft && (draft.id === null || JSON.stringify(draft) !== JSON.stringify(baseline)),
  );
}

function profileSummary(profile: ProfilePreset): string {
  return [
    profile.runtime.provider,
    profile.runtime.model,
    profile.runtime.reasoningEffort,
    profile.archivedAt ? "archived" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ProfileActions(props: {
  readonly profile: ProfilePreset;
  readonly busy: boolean;
  readonly onEdit: (profile: ProfilePreset) => void;
  readonly onDuplicate: (profile: ProfilePreset) => void;
  readonly onExport: (profile: ProfilePreset) => void;
  readonly onArchiveOrRestore: (profile: ProfilePreset) => void;
}) {
  const { profile } = props;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Actions for ${profile.name}`}
            className="[&_svg]:mx-0"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="end" side="bottom" sideOffset={6}>
        <MenuItem onClick={() => props.onEdit(profile)}>
          <PencilIcon className="size-3.5" />
          Edit
        </MenuItem>
        <MenuItem onClick={() => props.onDuplicate(profile)}>
          <CopyIcon className="size-3.5" />
          Duplicate
        </MenuItem>
        <MenuItem onClick={() => props.onExport(profile)}>
          <DownloadIcon className="size-3.5" />
          Export
        </MenuItem>
        <MenuItem
          disabled={props.busy}
          variant={profile.archivedAt ? "default" : "destructive"}
          onClick={() => props.onArchiveOrRestore(profile)}
        >
          {profile.archivedAt ? (
            <RotateCcwIcon className="size-3.5" />
          ) : (
            <ArchiveIcon className="size-3.5" />
          )}
          {profile.archivedAt ? "Restore" : "Archive"}
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

function ProfileNode(props: {
  readonly profile: ProfilePreset;
  readonly busy: boolean;
  readonly onEdit: (profile: ProfilePreset) => void;
  readonly onDuplicate: (profile: ProfilePreset) => void;
  readonly onExport: (profile: ProfilePreset) => void;
  readonly onArchiveOrRestore: (profile: ProfilePreset) => void;
}) {
  const developerInstructions = props.profile.runtime.developerInstructions.trim();
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={260}
        closeDelay={130}
        render={
          <div
            className={cn(
              "group relative min-h-32 rounded-xl border bg-background/35",
              "transition-colors hover:border-foreground/30 hover:bg-muted/20",
              props.profile.archivedAt && "opacity-60",
            )}
            data-testid={`profile-node-${props.profile.id}`}
          />
        }
      >
        <button
          type="button"
          className="flex min-h-32 w-full flex-col items-start justify-center rounded-xl px-4 py-5 pr-12 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
          onClick={() => props.onEdit(props.profile)}
        >
          <span className="font-medium text-foreground">{props.profile.name}</span>
          <span className="mt-2 text-xs leading-5 text-muted-foreground">
            {profileSummary(props.profile)}
          </span>
        </button>
        <div className="absolute right-2 top-2">
          <ProfileActions {...props} />
        </div>
      </PreviewCardTrigger>
      <PreviewCardPopup
        align="start"
        side="right"
        sideOffset={12}
        className="w-80 max-w-[calc(100vw-2rem)] p-4"
        positionerClassName="z-[60]"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background/50">
            <FileIcon className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Instruction preview
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {props.profile.name}
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-lg border bg-background/35 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Developer instructions
          </p>
          <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-foreground/90">
            {developerInstructions || "No developer instructions."}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            props.profile.runtime.provider,
            props.profile.runtime.model,
            props.profile.runtime.reasoningEffort,
          ]
            .filter((value): value is string => Boolean(value))
            .map((value) => (
              <span
                key={value}
                className="rounded-full border bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {value}
              </span>
            ))}
        </div>
        <p className="mt-3 border-t pt-3 text-[11px] leading-4 text-muted-foreground">
          Click the role card to open the full editor.
        </p>
      </PreviewCardPopup>
    </PreviewCard>
  );
}

function RegionLabel(props: { readonly title: string; readonly count: string }) {
  return (
    <div className="mb-4 text-center">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{props.count}</p>
    </div>
  );
}

function EmptyRegion(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex rounded-xl border border-dashed bg-background/20 text-center text-muted-foreground",
        props.compact
          ? "min-h-28 items-center justify-center gap-3 px-4 text-left"
          : "min-h-80 flex-col items-center justify-center px-5",
      )}
    >
      <div className="shrink-0 text-muted-foreground/80">{props.icon}</div>
      <div>
        <p className="text-sm text-muted-foreground">{props.title}</p>
        {props.description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
    </div>
  );
}

function reasoningEffortLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function ReasoningEffortSlider(props: {
  readonly provider: ProfileProviderKind;
  readonly model: string;
  readonly runtimeModel?: ProviderModelDescriptor | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const supportedOptions = getRuntimeAwareModelCapabilities({
    provider: props.provider,
    model: props.model,
    runtimeModel: props.runtimeModel,
  }).reasoningEffortLevels;
  const options =
    props.value && !supportedOptions.some((option) => option.value === props.value)
      ? [...supportedOptions, { value: props.value, label: reasoningEffortLabel(props.value) }]
      : supportedOptions;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === props.value),
  );
  const [visualIndex, setVisualIndex] = useState(selectedIndex);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setVisualIndex(selectedIndex);
  }, [selectedIndex]);

  const previewIndex = Math.max(0, Math.min(options.length - 1, Math.round(visualIndex)));
  const previewOption = options[previewIndex];
  const progress = options.length > 1 ? visualIndex / (options.length - 1) : 0;
  const selectVisualIndex = (index: number, snap: boolean) => {
    const boundedIndex = Math.max(0, Math.min(options.length - 1, index));
    const nextIndex = Math.round(boundedIndex);
    setVisualIndex(snap ? nextIndex : boundedIndex);
    const next = options[nextIndex];
    if (next && next.value !== props.value) props.onChange(next.value);
  };
  const pointerVisualIndex = (element: HTMLInputElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const trackWidth = Math.max(1, rect.width - 32);
    const progress = Math.max(0, Math.min(1, (clientX - rect.left - 16) / trackWidth));
    return progress * Math.max(0, options.length - 1);
  };

  return (
    <div className="grid gap-1.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Reasoning effort</span>
        <span className="truncate font-medium text-foreground">
          {previewOption?.label ?? "Unavailable"}
        </span>
      </div>
      {options.length > 0 ? (
        <div className="relative h-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-full border border-border bg-input/45"
          >
            <div
              className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--color-text-accent)_72%,transparent)] transition-[width] duration-100 ease-out motion-reduce:transition-none"
              style={{ width: `calc(16px + (100% - 32px) * ${progress})` }}
            />
            {options.map((option, index) => (
              <span
                key={option.value}
                className={cn(
                  "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  index <= previewIndex
                    ? "bg-[color:var(--color-background-surface)]/55"
                    : "bg-muted-foreground/65",
                )}
                style={{
                  left:
                    options.length === 1
                      ? "50%"
                      : `calc(16px + (100% - 32px) * ${index / (options.length - 1)})`,
                }}
              />
            ))}
          </div>
          <input
            aria-label="Profile reasoning effort"
            aria-valuetext={previewOption?.label ?? props.value}
            type="range"
            min={0}
            max={Math.max(0, options.length - 1)}
            step={0.01}
            value={visualIndex}
            disabled={options.length < 2}
            onPointerDown={(event) => {
              draggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              selectVisualIndex(pointerVisualIndex(event.currentTarget, event.clientX), false);
            }}
            onPointerMove={(event) => {
              if (!draggingRef.current) return;
              selectVisualIndex(pointerVisualIndex(event.currentTarget, event.clientX), false);
            }}
            onPointerUp={(event) => {
              const nextIndex = pointerVisualIndex(event.currentTarget, event.clientX);
              draggingRef.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              selectVisualIndex(nextIndex, true);
            }}
            onPointerCancel={(event) => {
              draggingRef.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              selectVisualIndex(Number(event.currentTarget.value), true);
            }}
            onInput={(event) => selectVisualIndex(Number(event.currentTarget.value), false)}
            onChange={(event) => {
              if (!draggingRef.current) {
                selectVisualIndex(Number(event.currentTarget.value), true);
              }
            }}
            onKeyDown={(event) => {
              const currentIndex = Math.round(visualIndex);
              const nextIndex =
                event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? currentIndex - 1
                  : event.key === "ArrowRight" || event.key === "ArrowUp"
                    ? currentIndex + 1
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? options.length - 1
                        : null;
              if (nextIndex === null) return;
              event.preventDefault();
              draggingRef.current = false;
              selectVisualIndex(nextIndex, true);
            }}
            onBlur={(event) => {
              if (!draggingRef.current) return;
              draggingRef.current = false;
              selectVisualIndex(Number(event.currentTarget.value), true);
            }}
            className="peer absolute inset-0 z-10 h-8 w-full cursor-grab appearance-none rounded-full bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing disabled:cursor-default [&::-moz-range-thumb]:size-8 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-none [&::-moz-range-track]:h-8 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-8 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-8 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-none"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 z-20 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm transition-[left,transform] duration-100 ease-out peer-active:scale-105 motion-reduce:transition-none"
            style={{ left: `calc(16px + (100% - 32px) * ${progress})` }}
          />
        </div>
      ) : (
        <div className="flex h-8 items-center rounded-lg border border-dashed px-3 text-muted-foreground">
          This model does not expose effort levels.
        </div>
      )}
    </div>
  );
}

function SupervisorRegion(props: {
  readonly snapshot: SupervisionSnapshot;
  readonly busy: boolean;
  readonly compact?: boolean;
  readonly onArchiveOrRestore: (seat: SupervisionSnapshot["supervisors"][number]) => Promise<void>;
  readonly run: (operation: () => Promise<void>) => void;
}) {
  if (props.snapshot.supervisors.length === 0) {
    return (
      <EmptyRegion
        {...(props.compact === undefined ? {} : { compact: props.compact })}
        icon={<UsersIcon className={props.compact ? "size-6" : "size-12"} />}
        title="No Supervisor seats yet."
        description="Create one from the Orchestrator sidebar."
      />
    );
  }
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-background/25">
      {props.snapshot.supervisors.map((seat) => {
        const missionCount = props.snapshot.missions.filter(
          (mission) => mission.supervisorSeatId === seat.id && mission.status === "active",
        ).length;
        return (
          <div key={seat.id} className="flex items-center justify-between gap-3 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{seat.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {seat.status} · {missionCount} active {missionCount === 1 ? "mission" : "missions"}
              </p>
            </div>
            <Button
              size="xs"
              variant="outline"
              disabled={props.busy}
              onClick={() => props.run(() => props.onArchiveOrRestore(seat))}
            >
              {seat.status === "archived" ? "Restore" : "Archive"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowRegion(props: {
  readonly snapshot: SupervisionSnapshot;
  readonly busy: boolean;
  readonly compact?: boolean;
  readonly onRevoke: (
    directive: SupervisionSnapshot["workflowDirectives"][number],
  ) => Promise<void>;
  readonly run: (operation: () => Promise<void>) => void;
}) {
  if (props.snapshot.workflowDirectives.length === 0) {
    return (
      <EmptyRegion
        {...(props.compact === undefined ? {} : { compact: props.compact })}
        icon={<FileIcon className={props.compact ? "size-6" : "size-12"} />}
        title="No workflow directives."
      />
    );
  }
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-background/25">
      {props.snapshot.workflowDirectives.map((directive) => (
        <div key={directive.id} className="space-y-2 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{directive.slot}</p>
            <p className="mt-0.5 line-clamp-3 text-xs leading-5 text-muted-foreground">
              {directive.status} · {directive.instruction}
            </p>
          </div>
          {directive.status === "active" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={props.busy}
              onClick={() => props.run(() => props.onRevoke(directive))}
            >
              Revoke
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ConflictRegion(props: {
  readonly snapshot: SupervisionSnapshot;
  readonly busy: boolean;
  readonly compact?: boolean;
  readonly onResolve: (
    conflict: SupervisionSnapshot["workflowConflicts"][number],
    directiveId: SupervisionSnapshot["workflowDirectives"][number]["id"],
  ) => Promise<void>;
  readonly run: (operation: () => Promise<void>) => void;
}) {
  const openCount = props.snapshot.workflowConflicts.filter(
    (conflict) => conflict.status === "open",
  ).length;
  return (
    <div className="rounded-xl border border-dashed bg-background/20 p-3">
      <div className="mb-3 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Conflicts
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{openCount} open</p>
      </div>
      {props.snapshot.workflowConflicts.length === 0 ? (
        <EmptyRegion
          compact
          icon={<TriangleAlertIcon className="size-6" />}
          title="No workflow conflicts."
        />
      ) : (
        <div className="space-y-2">
          {props.snapshot.workflowConflicts.map((conflict) => (
            <div key={conflict.id} className="rounded-lg border bg-background/30 p-3">
              <p className="text-sm font-medium text-foreground">{conflict.slot}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {conflict.status} · {conflict.directiveIds.length} directives
              </p>
              {conflict.status === "open" ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {conflict.directiveIds.map((directiveId) => (
                    <Button
                      key={directiveId}
                      size="xs"
                      variant="outline"
                      disabled={props.busy}
                      onClick={() => props.run(() => props.onResolve(conflict, directiveId))}
                    >
                      Use{" "}
                      {props.snapshot.workflowDirectives.find(
                        (directive) => directive.id === directiveId,
                      )?.supervisorSeatId ?? directiveId}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CausalGate(props: { readonly label: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center">
      <div className="w-full border-t border-dashed border-muted-foreground/65" />
      <div className="mx-2 shrink-0 rounded-lg border bg-background px-2 py-2 text-center text-[10px] leading-4 text-foreground">
        {props.label}
      </div>
      <div className="w-full border-t border-dashed border-muted-foreground/65" />
    </div>
  );
}

function ProfileEditor(props: {
  readonly draft: ProfileDraft;
  readonly errors: ProfileDraftErrors;
  readonly providerOptionsOpen: boolean;
  readonly onProviderOptionsOpenChange: (open: boolean) => void;
  readonly onChange: (draft: ProfileDraft) => void;
}) {
  const { draft } = props;
  const { settings } = useAppSettings();
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [draft.provider]: draft.model }),
    [draft.model, draft.provider],
  );
  const { modelOptionsByProvider, loadingModelProviders, selectedRuntimeModel } =
    useProviderModelCatalog({
      selectedProvider: draft.provider,
      discoveryEnabled: modelPickerOpen,
      modelHintByProvider,
    });
  const update = (values: Partial<ProfileDraft>) => props.onChange({ ...draft, ...values });
  return (
    <div data-testid="profile-editor">
      <div className="grid gap-4 @min-[620px]:grid-cols-2">
        <label className="grid gap-1.5 text-xs">
          <span className="text-muted-foreground">Name</span>
          <div>
            <Input
              aria-invalid={Boolean(props.errors.name)}
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
            />
            {props.errors.name ? (
              <p className="mt-1 text-[11px] text-destructive">{props.errors.name}</p>
            ) : null}
          </div>
        </label>
        <label className="grid gap-1.5 text-xs">
          <span className="text-muted-foreground">Role hints</span>
          <Input
            value={draft.roleHints}
            placeholder="supervisor, lead, peer"
            onChange={(event) => update({ roleHints: event.target.value })}
          />
        </label>
        <div className="grid gap-1.5 text-xs">
          <span className="text-muted-foreground">Provider &amp; model</span>
          <div>
            <ProviderModelPicker
              provider={draft.provider}
              model={draft.model}
              lockedProvider={null}
              providers={providerStatuses}
              modelOptionsByProvider={modelOptionsByProvider}
              loadingModelProviders={loadingModelProviders}
              hiddenProviders={settings.hiddenProviders}
              providerOrder={settings.providerOrder}
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
              triggerClassName={cn(
                "h-9 w-full max-w-none justify-start rounded-lg border border-border bg-background px-3 text-xs dark:bg-input/32 sm:h-8 sm:max-w-none",
                props.errors.model && "border-destructive/30",
              )}
              onProviderModelChange={(provider, model) => update({ provider, model })}
            />
            {props.errors.model ? (
              <p className="mt-1 text-[11px] text-destructive">{props.errors.model}</p>
            ) : null}
          </div>
        </div>
        <ReasoningEffortSlider
          provider={draft.provider}
          model={draft.model}
          runtimeModel={selectedRuntimeModel}
          value={draft.reasoningEffort}
          onChange={(reasoningEffort) => update({ reasoningEffort })}
        />
        <div className="grid gap-1.5 text-xs">
          <span className="text-muted-foreground">Sandbox</span>
          <SettingsSelectControl
            value={draft.sandboxMode}
            onValueChange={(sandboxMode) =>
              update({ sandboxMode: sandboxMode as ProfileSandboxMode })
            }
            ariaLabel="Profile sandbox"
            triggerClassName="w-full"
            valueContent={draft.sandboxMode}
          >
            {SANDBOXES.map((sandbox) => (
              <SelectItem key={sandbox} value={sandbox}>
                {sandbox}
              </SelectItem>
            ))}
          </SettingsSelectControl>
        </div>
        <div className="grid gap-1.5 text-xs">
          <span className="text-muted-foreground">Approval policy</span>
          <SettingsSelectControl
            value={draft.approvalPolicy}
            onValueChange={(approvalPolicy) =>
              update({ approvalPolicy: approvalPolicy as ProfileApprovalPolicy })
            }
            ariaLabel="Profile approval policy"
            triggerClassName="w-full"
            valueContent={draft.approvalPolicy}
          >
            {APPROVALS.map((approval) => (
              <SelectItem key={approval} value={approval}>
                {approval}
              </SelectItem>
            ))}
          </SettingsSelectControl>
        </div>
        <label className="grid gap-1.5 text-xs @min-[620px]:col-span-2">
          <span className="text-muted-foreground">Developer instructions</span>
          <Textarea
            className="min-h-28 text-xs [&_[data-slot=textarea]]:max-h-44 [&_[data-slot=textarea]]:overflow-y-auto"
            value={draft.developerInstructions}
            onChange={(event) => update({ developerInstructions: event.target.value })}
          />
        </label>

        <Collapsible
          className="@min-[620px]:col-span-2"
          open={props.providerOptionsOpen}
          onOpenChange={props.onProviderOptionsOpenChange}
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring/60">
            <span className="flex items-center gap-2">
              <DisclosureChevron open={props.providerOptionsOpen} className="size-3.5" />
              Provider options
            </span>
            <span className="text-muted-foreground">Configure JSON</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-2">
              <Textarea
                aria-label="Provider options JSON"
                aria-invalid={Boolean(props.errors.providerOptions)}
                className="min-h-36 font-mono text-xs [&_[data-slot=textarea]]:max-h-52 [&_[data-slot=textarea]]:overflow-y-auto"
                value={draft.providerOptions}
                onChange={(event) => update({ providerOptions: event.target.value })}
              />
              {props.errors.providerOptions ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
                  <TriangleAlertIcon className="size-3.5" />
                  {props.errors.providerOptions}
                </p>
              ) : null}
            </div>
          </CollapsiblePanel>
        </Collapsible>
        <div className="border-t pt-4 @min-[620px]:col-span-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Effective runtime</span>
            <span className="text-foreground">
              {draft.provider} · {draft.model || "No model"}
              {draft.reasoningEffort ? ` · ${draft.reasoningEffort}` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileEditorDialog(props: {
  readonly open: boolean;
  readonly draft: ProfileDraft | null;
  readonly errors: ProfileDraftErrors;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly providerOptionsOpen: boolean;
  readonly onProviderOptionsOpenChange: (open: boolean) => void;
  readonly onChange: (draft: ProfileDraft) => void;
  readonly onRequestClose: () => void;
  readonly onClosed: () => void;
  readonly onSave: () => void;
}) {
  const { draft } = props;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onRequestClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) props.onClosed();
      }}
    >
      {draft ? (
        <DialogPopup className="@container max-w-3xl" data-testid="profile-editor-dialog">
          <DialogHeader className="border-b pb-3 pr-12">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Profile preset
            </p>
            <DialogTitle>
              {draft.id ? `Edit ${draft.name || "profile"}` : "Create profile"}
            </DialogTitle>
            <DialogDescription>
              Configure the reusable runtime snapshot used for future launches.
            </DialogDescription>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  props.dirty ? "bg-muted-foreground" : "border border-muted-foreground",
                )}
              />
              {props.dirty ? "Unsaved changes" : "No unsaved changes"}
            </p>
          </DialogHeader>
          <DialogPanel className="in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-5">
            {props.error ? (
              <div
                role="alert"
                className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                {props.error}
              </div>
            ) : null}
            <ProfileEditor
              draft={draft}
              errors={props.errors}
              providerOptionsOpen={props.providerOptionsOpen}
              onProviderOptionsOpenChange={props.onProviderOptionsOpenChange}
              onChange={props.onChange}
            />
          </DialogPanel>
          <DialogFooter className="items-center justify-between border-t sm:justify-between">
            <p className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <InfoIcon className="size-4 shrink-0" />
              Changes affect future launches only.
            </p>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button variant="outline" onClick={props.onRequestClose}>
                Cancel
              </Button>
              <Button disabled={props.busy || !props.dirty || !props.valid} onClick={props.onSave}>
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}

export function SupervisedOrchestrationSettingsPanel(props: { readonly active: boolean }) {
  const shell = useStore((state) => state.supervision);
  const syncServerShellSnapshot = useStore((state) => state.syncServerShellSnapshot);
  const [snapshot, setSnapshot] = useState<SupervisionSnapshot>(shell);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [draftBaseline, setDraftBaseline] = useState<ProfileDraft | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSessionId, setEditorSessionId] = useState(0);
  const [providerOptionsOpen, setProviderOptionsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    const next = await api.orchestration.getSnapshot();
    setSnapshot(next.supervision ?? shell);
    syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
  };

  useEffect(() => {
    if (!props.active) return;
    let cancelled = false;
    void (async () => {
      const api = readNativeApi();
      if (!api) return;
      const next = await api.orchestration.getSnapshot();
      if (!cancelled) setSnapshot(next.supervision ?? shell);
    })().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [props.active]);

  const activeProfiles = useMemo(
    () => snapshot.profiles.filter((profile) => profile.archivedAt === null),
    [snapshot.profiles],
  );
  const archivedProfiles = useMemo(
    () =>
      snapshot.profiles.filter(
        (profile) => profile.archivedAt !== null && profile.clearedAt == null,
      ),
    [snapshot.profiles],
  );
  const filteredProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeProfiles;
    return activeProfiles.filter((profile) =>
      [profile.name, profile.runtime.provider, profile.runtime.model, ...profile.roleHints]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [activeProfiles, searchQuery]);

  const draftErrors = useMemo(
    () => (draft ? validateProfileDraft(draft, snapshot.profiles) : {}),
    [draft, snapshot.profiles],
  );
  const draftDirty = profileDraftIsDirty(draft, draftBaseline);
  const draftValid = !Object.values(draftErrors).some(Boolean);

  if (!props.active) return null;

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  };
  const run = (operation: () => Promise<void>) => void perform(operation).catch(() => undefined);

  const beginDraft = (nextDraft: ProfileDraft, baseline: ProfileDraft | null) => {
    setEditorSessionId((sessionId) => sessionId + 1);
    setDraft(nextDraft);
    setDraftBaseline(baseline);
    setProviderOptionsOpen(false);
    setError(null);
    setEditorOpen(true);
  };

  const beginEdit = (profile: ProfilePreset) => {
    const nextDraft = draftFromProfile(profile);
    beginDraft(nextDraft, nextDraft);
  };

  const beginDuplicate = (profile: ProfilePreset) => {
    beginDraft({ ...draftFromProfile(profile), id: null, name: `${profile.name} copy` }, null);
  };

  const requestCloseEditor = () => {
    setEditorOpen(false);
  };

  const finishCloseEditor = () => {
    setDraft(null);
    setDraftBaseline(null);
    setProviderOptionsOpen(false);
    setError(null);
  };

  const saveProfile = async () => {
    if (!draft) return;
    const currentErrors = validateProfileDraft(draft, snapshot.profiles);
    const validationError = Object.values(currentErrors).find(Boolean);
    if (validationError) throw new Error(validationError);
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    const name = draft.name.trim();
    const model = draft.model.trim();
    const providerOptions = draft.providerOptions.trim()
      ? (JSON.parse(draft.providerOptions) as unknown)
      : {};
    const now = new Date().toISOString();
    const id = draft.id ?? ProfilePresetId.makeUnsafe(randomUUID());
    const existing = snapshot.profiles.find((profile) => profile.id === id) ?? null;
    const profile: ProfilePreset = {
      id,
      name,
      roleHints: roleHintsFromDraft(draft.roleHints),
      runtime: {
        provider: draft.provider,
        model,
        reasoningEffort: draft.reasoningEffort.trim() || null,
        sandboxMode: draft.sandboxMode,
        approvalPolicy: draft.approvalPolicy,
        developerInstructions: draft.developerInstructions,
        providerOptions,
      },
      isDefault: existing?.isDefault ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: existing?.archivedAt ?? null,
      revision: existing?.revision ?? 0,
    };
    await api.orchestration.dispatchCommand({
      type: existing ? "supervision.profile.update" : "supervision.profile.create",
      commandId: newCommandId(),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "user", actorId: "owner" },
      expectedRevision: existing?.revision ?? 0,
      createdAt: now,
      profile,
    });
    requestCloseEditor();
  };

  const dispatchProfileLifecycle = async (
    profile: ProfilePreset,
    type:
      | "supervision.profile.archive"
      | "supervision.profile.restore"
      | "supervision.profile.clear",
  ) => {
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    await api.orchestration.dispatchCommand({
      type,
      commandId: newCommandId(),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "user", actorId: "owner" },
      expectedRevision: profile.revision,
      createdAt: new Date().toISOString(),
      profileId: profile.id,
    });
  };

  const restoreDefaultProfiles = async () => {
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    const archivedDefaults = snapshot.profiles.filter(
      (profile) => profile.isDefault && profile.archivedAt !== null,
    );
    for (const profile of archivedDefaults) {
      await api.orchestration.dispatchCommand({
        type: "supervision.profile.restore",
        commandId: newCommandId(),
        aggregateId: AGGREGATE_ID,
        actor: { kind: "user", actorId: "owner" },
        expectedRevision: profile.revision,
        createdAt: new Date().toISOString(),
        profileId: profile.id,
      });
    }
  };

  const archiveOrRestoreSupervisor = async (seat: SupervisionSnapshot["supervisors"][number]) => {
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    await api.orchestration.dispatchCommand({
      type:
        seat.status === "archived"
          ? "supervision.supervisor.restore"
          : "supervision.supervisor.archive",
      commandId: newCommandId(),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "user", actorId: "owner" },
      expectedRevision: seat.revision,
      createdAt: new Date().toISOString(),
      supervisorSeatId: seat.id,
    });
  };

  const resolveWorkflowConflict = async (
    conflict: SupervisionSnapshot["workflowConflicts"][number],
    resolvedDirectiveId: SupervisionSnapshot["workflowDirectives"][number]["id"],
  ) => {
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    await api.orchestration.dispatchCommand({
      type: "supervision.workflow.resolve",
      commandId: newCommandId(),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "user", actorId: "owner" },
      expectedRevision: 0,
      createdAt: new Date().toISOString(),
      conflictId: conflict.id,
      resolvedDirectiveId,
    });
  };

  const revokeWorkflowDirective = async (
    directive: SupervisionSnapshot["workflowDirectives"][number],
  ) => {
    const api = readNativeApi();
    if (!api) throw new Error("Synara server unavailable.");
    await api.orchestration.dispatchCommand({
      type: "supervision.workflow.revoke",
      commandId: newCommandId(),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "user", actorId: "owner" },
      expectedRevision: directive.revision,
      createdAt: new Date().toISOString(),
      directiveId: directive.id,
    });
  };

  const exportProfile = (profile: ProfilePreset) => {
    const blob = new Blob([JSON.stringify(redactedExport(profile), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "profile"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProfile = (parsed: ImportedProfilePreset) => {
    const now = new Date().toISOString();
    const imported = {
      ...parsed,
      id: ProfilePresetId.makeUnsafe(randomUUID()),
      name: `${parsed.name} (imported)`,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      clearedAt: null,
      revision: 0,
    } as ProfilePreset;
    beginDraft({ ...draftFromProfile(imported), id: null }, null);
  };
  const activeProfileCount = activeProfiles.length;

  return (
    <div className="@container space-y-6 pb-10" data-testid="supervised-orchestration-settings">
      <header className="border-b pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-medium tracking-tight text-foreground">
              Supervised orchestration
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Manage reusable profiles, Supervisor seats, and visible workflow directives.
            </p>
          </div>
          <Button size="sm" onClick={() => beginDraft({ ...EMPTY_DRAFT }, null)}>
            New profile
          </Button>
        </div>
      </header>

      {error && !draft ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      <SupervisedOrchestrationProfileLibrary
        profiles={filteredProfiles}
        activeProfileCount={activeProfileCount}
        archivedProfiles={archivedProfiles}
        searchQuery={searchQuery}
        busy={busy}
        onSearchQueryChange={setSearchQuery}
        onNewProfile={() => beginDraft({ ...EMPTY_DRAFT }, null)}
        onEdit={beginEdit}
        onDuplicate={beginDuplicate}
        onExport={exportProfile}
        onArchive={(profile) =>
          perform(() => dispatchProfileLifecycle(profile, "supervision.profile.archive"))
        }
        onRestoreProfiles={(profiles) =>
          perform(async () => {
            for (const profile of profiles) {
              await dispatchProfileLifecycle(profile, "supervision.profile.restore");
            }
          })
        }
        onClearProfiles={(profiles) =>
          perform(async () => {
            for (const profile of profiles) {
              await dispatchProfileLifecycle(profile, "supervision.profile.clear");
            }
          })
        }
        onRestoreDefaults={() => perform(restoreDefaultProfiles)}
        onImportProfile={importProfile}
        onImportError={setError}
      />

      <footer className="flex items-start gap-2 border-t pt-5 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        <p>Preset edits affect future launches only. Running seats retain their snapshots.</p>
      </footer>

      <ProfileEditorDialog
        key={editorSessionId}
        open={editorOpen}
        draft={draft}
        errors={draftErrors}
        dirty={draftDirty}
        valid={draftValid}
        busy={busy}
        error={error}
        providerOptionsOpen={providerOptionsOpen}
        onProviderOptionsOpenChange={setProviderOptionsOpen}
        onChange={setDraft}
        onRequestClose={requestCloseEditor}
        onClosed={finishCloseEditor}
        onSave={() => run(saveProfile)}
      />
    </div>
  );
}
