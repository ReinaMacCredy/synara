import type { ProfilePreset, ProfilePresetId } from "@synara/contracts";
import { useMemo, useState } from "react";

import { ComposerProfilePicker } from "~/components/chat/ComposerProfilePicker";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

export function CreatePeerDialog(props: {
  readonly open: boolean;
  readonly profiles: readonly ProfilePreset[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: {
    readonly title: string;
    readonly brief: string;
    readonly profilePresetId: ProfilePresetId;
  }) => Promise<void>;
}) {
  const defaultProfile = useMemo(
    () =>
      props.profiles.find(
        (profile) => profile.archivedAt === null && profile.roleHints.includes("peer"),
      ) ??
      props.profiles.find((profile) => profile.archivedAt === null) ??
      null,
    [props.profiles],
  );
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [profilePresetId, setProfilePresetId] = useState<ProfilePresetId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedProfileId = profilePresetId ?? defaultProfile?.id ?? null;

  const create = async () => {
    if (!selectedProfileId || !title.trim() || !brief.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onCreate({
        title: title.trim(),
        brief: brief.trim(),
        profilePresetId: selectedProfileId,
      });
      setTitle("");
      setBrief("");
      setProfilePresetId(null);
      props.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Peer</DialogTitle>
          <DialogDescription>
            Creates an independent Synara thread owned by this Lead. The profile is snapshotted; it
            does not grant authority.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Name</span>
            <Input
              aria-label="Peer name"
              value={title}
              placeholder="Release reviewer"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Scope and outcome</span>
            <Textarea
              aria-label="Peer scope and outcome"
              className="min-h-28"
              value={brief}
              placeholder="Review backward compatibility for today's release and report evidence to Lead."
              onChange={(event) => setBrief(event.target.value)}
            />
          </label>
          <div className="space-y-1 text-xs">
            <span className="text-muted-foreground">Profile</span>
            <ComposerProfilePicker
              profiles={props.profiles}
              selectedProfileId={selectedProfileId}
              disabled={busy}
              onSelect={setProfilePresetId}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !selectedProfileId || !title.trim() || !brief.trim()}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create Peer"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
