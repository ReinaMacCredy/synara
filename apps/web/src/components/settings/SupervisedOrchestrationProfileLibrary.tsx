import type { ProfilePreset, ProfilePresetId } from "@synara/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { ComposerPickerMenuPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Menu, MenuItem, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "~/components/ui/preview-card";
import { SearchInput } from "~/components/ui/search-input";
import {
  ArchiveIcon,
  CircleCheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  FileIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  readProfileImportFile,
  type ImportedProfilePreset,
} from "./supervisedOrchestrationProfileImport";

type ProfileLibraryProps = {
  readonly profiles: readonly ProfilePreset[];
  readonly activeProfileCount: number;
  readonly archivedProfiles: readonly ProfilePreset[];
  readonly searchQuery: string;
  readonly busy: boolean;
  readonly onSearchQueryChange: (value: string) => void;
  readonly onNewProfile: () => void;
  readonly onEdit: (profile: ProfilePreset) => void;
  readonly onDuplicate: (profile: ProfilePreset) => void;
  readonly onExport: (profile: ProfilePreset) => void;
  readonly onArchive: (profile: ProfilePreset) => Promise<void>;
  readonly onRestoreProfiles: (profiles: readonly ProfilePreset[]) => Promise<void>;
  readonly onClearProfiles: (profiles: readonly ProfilePreset[]) => Promise<void>;
  readonly onRestoreDefaults: () => Promise<void>;
  readonly onImportProfile: (profile: ImportedProfilePreset) => void;
  readonly onImportError: (message: string) => void;
};

const delay = (duration: number) => new Promise<void>((resolve) => window.setTimeout(resolve, duration));

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });

export function formatProfileModelLabel(model: string): string {
  const parts = model.split("-").filter(Boolean);
  if (parts[0]?.toLowerCase() === "gpt" && parts[1]) {
    const variant = parts
      .slice(2)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    return `GPT-${parts[1]}${variant ? ` ${variant}` : ""}`;
  }
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function RuntimeSummary(props: { readonly profile: ProfilePreset; readonly compact?: boolean }) {
  const effort = props.profile.runtime.reasoningEffort;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", props.compact ? "mt-2" : "mt-5")}>
      <span className="inline-flex min-w-0 items-center gap-2 rounded-lg border bg-background/45 px-2.5 py-1.5 text-xs font-medium text-foreground">
        <ProviderIcon provider={props.profile.runtime.provider} className="size-4 shrink-0" />
        <span className="truncate">{formatProfileModelLabel(props.profile.runtime.model)}</span>
      </span>
      {effort ? (
        <span className="rounded-lg border bg-background/35 px-2.5 py-1.5 text-xs capitalize text-muted-foreground">
          {effort}
        </span>
      ) : null}
    </div>
  );
}

function ProfileActions(props: {
  readonly profile: ProfilePreset;
  readonly busy: boolean;
  readonly onEdit: (profile: ProfilePreset) => void;
  readonly onDuplicate: (profile: ProfilePreset) => void;
  readonly onExport: (profile: ProfilePreset) => void;
  readonly onArchive: (profile: ProfilePreset) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Options for ${props.profile.name}`}
            className="text-muted-foreground"
          >
            <span className="hidden @min-[540px]:inline">Options</span>
            <EllipsisIcon className="@min-[540px]:hidden" aria-hidden="true" />
          </Button>
        }
      />
      <ComposerPickerMenuPopup align="end" side="bottom" sideOffset={6}>
        <MenuItem onClick={() => props.onEdit(props.profile)}>
          <PencilIcon className="size-3.5" />
          Edit
        </MenuItem>
        <MenuItem onClick={() => props.onDuplicate(props.profile)}>
          <CopyIcon className="size-3.5" />
          Duplicate
        </MenuItem>
        <MenuItem onClick={() => props.onExport(props.profile)}>
          <DownloadIcon className="size-3.5" />
          Export
        </MenuItem>
        <MenuItem
          disabled={props.busy}
          variant="destructive"
          onClick={() => props.onArchive(props.profile)}
        >
          <ArchiveIcon className="size-3.5" />
          Archive
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

function ProfileCard(props: {
  readonly profile: ProfilePreset;
  readonly layoutSlot: number;
  readonly threeLayout: boolean;
  readonly busy: boolean;
  readonly archiving: boolean;
  readonly previewDisabled: boolean;
  readonly onEdit: (profile: ProfilePreset) => void;
  readonly onDuplicate: (profile: ProfilePreset) => void;
  readonly onExport: (profile: ProfilePreset) => void;
  readonly onArchive: (profile: ProfilePreset) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const developerInstructions = props.profile.runtime.developerInstructions.trim();
  const slotClassName =
    props.threeLayout && props.layoutSlot === 1
      ? "col-start-1 row-start-1"
      : props.threeLayout && props.layoutSlot === 2
        ? "col-start-1 row-start-2"
        : props.threeLayout && props.layoutSlot === 3
          ? "col-start-2 row-start-1 row-span-2 self-center"
          : "";

  useEffect(() => {
    if (props.previewDisabled) setPreviewOpen(false);
  }, [props.previewDisabled]);

  return (
    <div
      className={cn(
        "relative z-[1] min-w-0 flex-[0_1_calc(50%-6px)]",
        "@max-[620px]:w-full @max-[620px]:max-w-full @max-[620px]:flex-basis-full",
        props.threeLayout ? "w-auto max-w-none" : "w-[calc(50%-6px)] max-w-[calc(50%-6px)]",
        slotClassName,
        props.archiving && "pointer-events-none",
      )}
      data-layout-slot={props.layoutSlot}
      data-profile-card="true"
      data-profile-id={props.profile.id}
      data-testid={`profile-node-${props.profile.id}`}
    >
      <PreviewCard
        open={previewOpen && !props.previewDisabled}
        onOpenChange={(open) => {
          if (!props.previewDisabled) setPreviewOpen(open);
        }}
      >
        <PreviewCardTrigger
          delay={260}
          closeDelay={130}
          render={
            <article
              className={cn(
                "group relative min-h-[166px] w-full min-w-0 overflow-hidden rounded-2xl border bg-background",
                "transition-[border-color,background-color,transform] duration-200 ease-out hover:-translate-y-px hover:border-foreground/30 hover:bg-muted/20",
                props.archiving && "border-foreground/35 bg-muted/30 hover:translate-y-0",
              )}
            />
          }
        >
          <button
            type="button"
            className={cn(
              "flex min-h-[166px] w-full flex-col items-start justify-center rounded-2xl px-5 py-5 pr-14 text-left outline-none transition-opacity duration-150 focus-visible:ring-1 focus-visible:ring-ring/60 motion-reduce:transition-none",
              props.archiving && "opacity-10",
            )}
            onClick={() => props.onEdit(props.profile)}
          >
            <span className="max-w-[16ch] text-[17px] font-medium leading-tight tracking-[-0.02em] text-foreground @min-[540px]:text-lg">
              {props.profile.name}
            </span>
            <RuntimeSummary profile={props.profile} />
          </button>
          <div className={cn("absolute right-3 top-3", props.archiving && "opacity-0")}>
            <ProfileActions {...props} />
          </div>
          {props.archiving ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none">
              <div className="flex items-center gap-2 rounded-full border bg-background/85 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
                <ArchiveIcon className="size-3.5" />
                Moving to Archived
              </div>
            </div>
          ) : null}
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
          <RuntimeSummary compact profile={props.profile} />
          <p className="mt-3 border-t pt-3 text-[11px] leading-4 text-muted-foreground">
            Click the role card to open the full editor.
          </p>
        </PreviewCardPopup>
      </PreviewCard>
    </div>
  );
}

function ArchivedPopover(props: {
  readonly profiles: readonly ProfilePreset[];
  readonly busy: boolean;
  readonly onRestore: (profiles: readonly ProfilePreset[]) => Promise<void>;
  readonly onClear: (profiles: readonly ProfilePreset[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<ProfilePresetId>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousCountRef = useRef(props.profiles.length);
  const selectedProfiles = props.profiles.filter((profile) => selectedIds.has(profile.id));

  useEffect(() => {
    setSelectedIds((current) => {
      const live = new Set(props.profiles.map((profile) => profile.id));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
    if (props.profiles.length > previousCountRef.current) {
      triggerRef.current?.animate(
        [
          { transform: "scale(1)", borderColor: "currentColor" },
          { transform: "scale(1.045)", borderColor: "color-mix(in srgb, currentColor 70%, transparent)" },
          { transform: "scale(1)", borderColor: "" },
        ],
        { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    }
    previousCountRef.current = props.profiles.length;
  }, [props.profiles]);

  const runSelectionAction = async (action: "restore" | "clear") => {
    if (selectedProfiles.length === 0) return;
    await (action === "restore"
      ? props.onRestore(selectedProfiles)
      : props.onClear(selectedProfiles));
    setSelectedIds(new Set());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            size="sm"
            variant="outline"
            disabled={props.busy}
            className="shrink-0 whitespace-nowrap"
            data-archive-trigger="true"
          >
            <ArchiveIcon className="size-3.5" />
            Archived
            <span className="grid min-w-5 place-items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              {props.profiles.length}
            </span>
          </Button>
        }
      />
      <PopoverPopup align="end" sideOffset={8} className="w-[min(360px,calc(100vw-2rem))] p-0">
        <div className="flex items-start justify-between gap-4 border-b px-4 pb-3">
          <div>
            <p className="text-sm font-medium text-foreground">Archived profiles</p>
            <p className="mt-1 text-xs text-muted-foreground">Restore or clear saved presets.</p>
          </div>
          <Button
            size="xs"
            variant="ghost"
            disabled={props.busy || props.profiles.length === 0}
            onClick={() => void props.onClear(props.profiles)}
          >
            Clear all
          </Button>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {props.profiles.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No archived profiles.
            </p>
          ) : (
            props.profiles.map((profile) => (
              <label
                key={profile.id}
                className="flex cursor-pointer items-start gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/20"
              >
                <Checkbox
                  checked={selectedIds.has(profile.id)}
                  onCheckedChange={(checked) => {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(profile.id);
                      else next.delete(profile.id);
                      return next;
                    });
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {profile.name}
                  </span>
                  <RuntimeSummary compact profile={profile} />
                </span>
              </label>
            ))
          )}
        </div>
        <DisclosureRegion open={selectedProfiles.length > 0}>
          <div className="flex items-center gap-2 border-t px-4 pt-3">
            <span className="mr-auto text-xs text-muted-foreground">
              {selectedProfiles.length} selected
            </span>
            <Button
              size="xs"
              variant="outline"
              disabled={props.busy}
              onClick={() => void runSelectionAction("restore")}
            >
              <RotateCcwIcon className="size-3.5" />
              Restore
            </Button>
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={props.busy}
              onClick={() => void runSelectionAction("clear")}
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          </div>
        </DisclosureRegion>
      </PopoverPopup>
    </Popover>
  );
}

function downloadDemo(format: "json" | "toml") {
  const json = {
    name: "Demo Specialist",
    roleHints: ["specialist"],
    runtime: {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      developerInstructions: "Review the assigned outcome and report material findings with evidence.",
      providerOptions: { features: { multi_agent: false } },
    },
  };
  const toml = `name = "Demo Specialist"
roleHints = ["specialist"]

[runtime]
provider = "codex"
model = "gpt-5.6-sol"
reasoningEffort = "medium"
sandboxMode = "workspace-write"
approvalPolicy = "on-request"
developerInstructions = "Review the assigned outcome and report material findings with evidence."

[runtime.providerOptions.features]
multi_agent = false
`;
  const content = format === "json" ? JSON.stringify(json, null, 2) : toml;
  const url = URL.createObjectURL(
    new Blob([content], { type: format === "json" ? "application/json" : "application/toml" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `demo-specialist-profile.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SupervisedOrchestrationProfileLibrary(props: ProfileLibraryProps) {
  const [archivingId, setArchivingId] = useState<ProfilePresetId | null>(null);
  const [previewSuppressed, setPreviewSuppressed] = useState(false);
  const [importState, setImportState] = useState<
    "idle" | "reading" | "complete" | "handoff"
  >("idle");
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const [droppedFileName, setDroppedFileName] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const profileGridRef = useRef<HTMLDivElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const previousCardRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const dragDepthRef = useRef(0);
  const threeLayout = props.activeProfileCount === 3 && props.profiles.length === 3;
  const layoutKey = useMemo(
    () => `${props.activeProfileCount}:${props.profiles.map((profile) => profile.id).join(":")}`,
    [props.activeProfileCount, props.profiles],
  );

  const updateConnector = useCallback((animate = true, targetRects?: readonly DOMRect[]) => {
    const workspace = workspaceRef.current;
    const profileGrid = profileGridRef.current;
    const dropzone = dropzoneRef.current;
    const line = connectorRef.current;
    if (!workspace || !profileGrid || !dropzone || !line) return;

    const workspaceRect = workspace.getBoundingClientRect();
    const dropRect = dropzone.getBoundingClientRect();
    const sourceElements = [
      ...profileGrid.querySelectorAll<HTMLElement>("[data-profile-card='true']"),
    ];
    if (sourceElements.length === 0) sourceElements.push(profileGrid);
    const sourceRects =
      targetRects && targetRects.length > 0
        ? targetRects
        : sourceElements.map((element) => element.getBoundingClientRect());
    const bounds = sourceRects.reduce(
      (current, rect) => ({
        top: Math.min(current.top, rect.top),
        right: Math.max(current.right, rect.right),
        bottom: Math.max(current.bottom, rect.bottom),
      }),
      { top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const stacked = workspace.clientWidth < 920;
    const duration = animate ? "380ms" : "0ms";
    line.style.transitionDuration = duration;
    if (stacked) {
      const startY = bounds.bottom - workspaceRect.top;
      const endY = dropRect.top - workspaceRect.top;
      const x = dropRect.left + dropRect.width / 2 - workspaceRect.left;
      line.dataset.orientation = "vertical";
      line.style.width = "1px";
      line.style.height = `${Math.max(18, endY - startY)}px`;
      line.style.transform = `translate3d(${x}px, ${startY}px, 0)`;
      line.style.background =
        "repeating-linear-gradient(180deg, color-mix(in srgb, var(--color-text-foreground-secondary) 72%, transparent) 0 6px, transparent 6px 11px)";
    } else {
      const gridRect = profileGrid.getBoundingClientRect();
      const startX =
        sourceRects.length === 1
          ? bounds.right - workspaceRect.left
          : gridRect.right - workspaceRect.left;
      const endX = dropRect.left - workspaceRect.left;
      const y = dropRect.top + dropRect.height / 2 - workspaceRect.top;
      line.dataset.orientation = "horizontal";
      line.style.width = `${Math.max(18, endX - startX)}px`;
      line.style.height = "1px";
      line.style.transform = `translate3d(${startX}px, ${y}px, 0)`;
      line.style.background =
        "repeating-linear-gradient(90deg, color-mix(in srgb, var(--color-text-foreground-secondary) 72%, transparent) 0 6px, transparent 6px 11px)";
    }

    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      line.getAnimations().forEach((animation) => animation.cancel());
      const vertical = line.dataset.orientation === "vertical";
      line.animate(
        [
          { backgroundPosition: "0 0" },
          { backgroundPosition: vertical ? "0 22px" : "22px 0" },
        ],
        { duration: 560, easing: "linear" },
      );
    }
  }, []);

  useLayoutEffect(() => {
    const grid = profileGridRef.current;
    if (!grid) return;
    const nextRects = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>("[data-profile-card='true']").forEach((element) => {
      const id = element.dataset.profileId;
      if (!id) return;
      const next = element.getBoundingClientRect();
      nextRects.set(id, next);
      const previous = previousCardRectsRef.current.get(id);
      if (!previous) {
        element.animate(
          [
            { opacity: 0, transform: "translate3d(0,12px,0) scale(.97)" },
            { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
          ],
          { duration: 360, easing: "cubic-bezier(.16,1,.3,1)" },
        );
        return;
      }
      const x = previous.left - next.left;
      const y = previous.top - next.top;
      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
        element.animate(
          [
            { transform: `translate3d(${x}px,${y}px,0)` },
            { transform: "translate3d(0,0,0)" },
          ],
          { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      }
    });
    previousCardRectsRef.current = nextRects;
    updateConnector(previousCardRectsRef.current.size > 0, [...nextRects.values()]);
  }, [layoutKey, updateConnector]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const grid = profileGridRef.current;
    const dropzone = dropzoneRef.current;
    if (!workspace || !grid || !dropzone) return;
    const observer = new ResizeObserver(() => updateConnector(false));
    observer.observe(workspace);
    observer.observe(grid);
    observer.observe(dropzone);
    return () => observer.disconnect();
  }, [updateConnector]);

  const handleImportFile = useCallback(
    async (file: File) => {
      setGlobalDragActive(false);
      setDroppedFileName(file.name);
      setImportState("reading");
      try {
        const imported = await readProfileImportFile(file);
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        setImportState("complete");
        await delay(reducedMotion ? 80 : 420);
        setImportState("handoff");
        if (!reducedMotion) await delay(120);
        props.onImportProfile(imported);
        if (!reducedMotion) await delay(100);
        setImportState("idle");
        setDroppedFileName("");
      } catch (cause) {
        setImportState("idle");
        setDroppedFileName("");
        props.onImportError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [props.onImportError, props.onImportProfile],
  );

  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setGlobalDragActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setGlobalDragActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setGlobalDragActive(false);
      const file = event.dataTransfer?.files[0];
      if (file) void handleImportFile(file);
    };
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [handleImportFile]);

  const archive = async (profile: ProfilePreset) => {
    if (archivingId !== null || props.busy) return;
    setPreviewSuppressed(true);
    setArchivingId(profile.id);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let exitAnimation: Animation | null = null;
    try {
      if (!reducedMotion) {
        await waitForPaint();
        const card = [
          ...(profileGridRef.current?.querySelectorAll<HTMLElement>("[data-profile-card='true']") ?? []),
        ].find((element) => element.dataset.profileId === profile.id);
        const archiveTrigger = workspaceRef.current?.querySelector<HTMLElement>(
          "[data-archive-trigger='true']",
        );
        if (card) {
          card.getAnimations().forEach((animation) => animation.cancel());
          const cardRect = card.getBoundingClientRect();
          const targetRect = archiveTrigger?.getBoundingClientRect();
          const dx = targetRect
            ? Math.max(
                -180,
                Math.min(
                  180,
                  targetRect.left +
                    targetRect.width / 2 -
                    (cardRect.left + cardRect.width / 2),
                ),
              )
            : 72;
          const dy = targetRect
            ? Math.max(
                -120,
                Math.min(
                  120,
                  targetRect.top +
                    targetRect.height / 2 -
                    (cardRect.top + cardRect.height / 2),
                ),
              )
            : -48;
          exitAnimation = card.animate(
            [
              {
                offset: 0,
                opacity: 1,
                transform: "translate3d(0,0,0) scale(1)",
                filter: "blur(0px)",
              },
              {
                offset: 0.34,
                opacity: 1,
                transform: `translate3d(${dx * 0.12}px,${dy * 0.12}px,0) scale(.99)`,
                filter: "blur(0px)",
              },
              {
                offset: 1,
                opacity: 0,
                transform: `translate3d(${dx}px,${dy}px,0) scale(.72)`,
                filter: "blur(1.5px)",
              },
            ],
            { duration: 380, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" },
          );
          await exitAnimation.finished.catch(() => undefined);
        }
      }
      await props.onArchive(profile);
    } finally {
      exitAnimation?.cancel();
      setArchivingId(null);
      if (!reducedMotion) await delay(300);
      setPreviewSuppressed(false);
    }
  };

  const trueEmpty = props.activeProfileCount === 0;
  const gridClassName = cn(
    "relative flex min-h-[clamp(430px,56vh,600px)] flex-wrap content-center items-center justify-center gap-3",
    threeLayout &&
      "grid grid-cols-2 grid-rows-[166px_166px] content-center items-stretch @max-[620px]:flex",
  );
  const importSuccessVisible = importState === "complete" || importState === "handoff";
  const overlayActive = globalDragActive || importState === "complete";

  return (
    <>
      <div
        ref={workspaceRef}
        className={cn(
          "relative grid min-w-0 grid-cols-1 pt-2 transition-[filter,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          "@min-[920px]:grid-cols-[minmax(0,1.65fr)_clamp(46px,4cqw,66px)_minmax(280px,.9fr)]",
          overlayActive && "pointer-events-none scale-[.995] select-none blur-[7px] opacity-55",
        )}
      >
        <section className="min-w-0">
          <div className="mb-5 flex items-start justify-between gap-4 @max-[620px]:flex-col">
            <div className="shrink-0">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
                Profile presets
              </h2>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {props.activeProfileCount} available
              </p>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 @min-[540px]:flex-nowrap @max-[620px]:w-full @max-[620px]:justify-start">
              <div className="w-full min-w-0 @min-[540px]:w-60 @min-[540px]:shrink">
                <SearchInput
                  aria-label="Search profiles"
                  placeholder="Search profiles..."
                  value={props.searchQuery}
                  onChange={(event) => props.onSearchQueryChange(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={props.busy}
                className="shrink-0 whitespace-nowrap"
                onClick={() => void props.onRestoreDefaults()}
              >
                <RotateCcwIcon className="size-3.5" />
                Restore defaults
              </Button>
              <ArchivedPopover
                profiles={props.archivedProfiles}
                busy={props.busy}
                onRestore={props.onRestoreProfiles}
                onClear={props.onClearProfiles}
              />
            </div>
          </div>
          <div ref={profileGridRef} className={gridClassName} data-testid="profile-preset-grid">
            {props.profiles.length > 0 ? (
              props.profiles.map((profile, index) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  layoutSlot={index + 1}
                  threeLayout={threeLayout}
                  busy={props.busy}
                  archiving={archivingId === profile.id}
                  previewDisabled={
                    globalDragActive || importSuccessVisible || previewSuppressed
                  }
                  onEdit={props.onEdit}
                  onDuplicate={props.onDuplicate}
                  onExport={props.onExport}
                  onArchive={(candidate) => void archive(candidate)}
                />
              ))
            ) : (
              <div className="flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border border-dashed bg-background/20 px-6 text-center">
                <FileIcon className="size-9 text-muted-foreground/75" />
                <p className="mt-4 text-sm font-medium text-foreground">
                  {trueEmpty ? "Drag a profile here, or create one" : "No matching profiles"}
                </p>
                <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
                  {trueEmpty
                    ? "Import a JSON or TOML export, or create your first reusable launch profile."
                    : "Try another profile name or clear your search."}
                </p>
                {trueEmpty ? (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button size="sm" onClick={props.onNewProfile}>
                      Create profile
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => importInputRef.current?.click()}>
                      Choose JSON or TOML
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <div className="min-h-14 @min-[920px]:min-h-0" aria-hidden="true" />

        <section className="min-w-0">
          <div className="mb-5">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              Import profile
            </h2>
            <p className="mt-1.5 text-xs text-muted-foreground">Review before saving</p>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,application/toml,text/x-toml,.json,.toml"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void handleImportFile(file);
              event.currentTarget.value = "";
            }}
          />
          <div
            ref={dropzoneRef}
            className={cn(
              "flex min-h-[clamp(430px,56vh,600px)] flex-col items-center justify-center rounded-2xl border border-dashed bg-background/20 px-6 text-center",
              "transition-[border-color,background-color,transform] duration-200 ease-out motion-reduce:transition-none @max-[919px]:min-h-72",
              globalDragActive && "border-foreground/55 bg-muted/25 scale-[1.01]",
            )}
            data-testid="profile-import-dropzone"
          >
            {importSuccessVisible ? (
              <div
                className={cn(
                  "animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none motion-reduce:transition-none",
                  "transition-[opacity,transform,filter] duration-200 [transition-timing-function:cubic-bezier(.22,1,.36,1)]",
                  importState === "handoff" &&
                    "-translate-y-1 scale-95 opacity-0 blur-[2px]",
                )}
              >
                <CircleCheckIcon className="mx-auto size-11 text-emerald-500" />
                <p className="mt-4 text-lg font-medium text-foreground">Done</p>
                <p className="mt-1.5 max-w-xs truncate text-xs text-muted-foreground">
                  {droppedFileName}
                </p>
              </div>
            ) : importState === "reading" ? (
              <div>
                <FileIcon className="mx-auto size-10 animate-pulse text-muted-foreground" />
                <p className="mt-4 text-sm font-medium text-foreground">Checking profile…</p>
                <p className="mt-1.5 max-w-xs truncate text-xs text-muted-foreground">
                  {droppedFileName}
                </p>
              </div>
            ) : (
              <>
                <FileIcon className="size-10 text-muted-foreground/80" />
                <p className="mt-5 text-base font-medium text-foreground">Drop file to import</p>
                <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                  Drag a profile export here, or choose a file. Nothing is saved until you review it.
                </p>
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => importInputRef.current?.click()}
                >
                  Choose JSON or TOML
                </Button>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  One .json or .toml profile export · max 1 MB
                </p>
                <div className="mt-4 flex items-center gap-4 text-xs">
                  <button
                    type="button"
                    className="underline underline-offset-4 text-muted-foreground hover:text-foreground"
                    onClick={() => downloadDemo("json")}
                  >
                    JSON demo
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-4 text-muted-foreground hover:text-foreground"
                    onClick={() => downloadDemo("toml")}
                  >
                    TOML demo
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <div
          ref={connectorRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 z-0 origin-left transition-[width,height,transform] [transition-timing-function:cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none"
          style={{ opacity: 0.88 } as CSSProperties}
        />
      </div>

      <div
        aria-hidden={!globalDragActive && !importSuccessVisible}
        className={cn(
          "pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-background/35 opacity-0 backdrop-blur-md",
          "transition-opacity duration-200 ease-out motion-reduce:transition-none",
          overlayActive && "opacity-100",
        )}
      >
        <div className="text-center">
          {importSuccessVisible ? (
            <div
              className={cn(
                "transition-[opacity,transform,filter] duration-200 [transition-timing-function:cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
                importState === "complete" &&
                  "animate-in fade-in zoom-in-75 slide-in-from-bottom-3 duration-500 motion-reduce:animate-none",
                importState === "handoff" &&
                  "-translate-y-2 scale-95 opacity-0 blur-[3px]",
              )}
            >
              <CircleCheckIcon className="mx-auto size-14 text-emerald-500" />
              <p className="mt-4 text-xl font-medium text-foreground">Done</p>
            </div>
          ) : (
            <>
              <p className="text-xl font-medium text-foreground">Drag to import</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Release your JSON or TOML profile anywhere
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
