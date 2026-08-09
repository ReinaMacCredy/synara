import { ProfilePresetId, type ProfilePreset, type ProfileSnapshot } from "@synara/contracts";
import { useNavigate } from "@tanstack/react-router";

import { ChevronDownIcon, EyeIcon, SettingsIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { PROVIDER_ICON_COMPONENT_BY_PROVIDER } from "../ProviderIcon";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME } from "./composerPickerStyles";

export function ComposerProfilePicker(props: {
  readonly profiles: readonly ProfilePreset[];
  readonly selectedProfileId: ProfilePresetId | null;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onSelect: (profileId: ProfilePresetId) => void;
  readonly onSelectionCommitted?: () => void;
}) {
  const navigate = useNavigate();
  const profiles = props.profiles.filter((profile) => profile.archivedAt === null);
  const selected =
    profiles.find((profile) => profile.id === props.selectedProfileId) ?? profiles[0] ?? null;
  const ProviderIcon = selected
    ? PROVIDER_ICON_COMPONENT_BY_PROVIDER[selected.runtime.provider]
    : EyeIcon;

  return (
    <Menu>
      <MenuTrigger
        disabled={props.disabled ?? false}
        render={
          <Button
            type="button"
            size="sm"
            variant="chrome"
            className={cn(
              "min-w-0 max-w-56 shrink-0 justify-start gap-1.5 px-2 sm:px-2.5 [&_svg]:mx-0",
              COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
            )}
            aria-label={
              selected
                ? `Supervision profile: ${selected.name}, ${selected.runtime.model}`
                : "Choose a supervision profile"
            }
            data-testid="composer-profile-picker"
          />
        }
      >
        <ProviderIcon className="size-3.5" />
        <span className="min-w-0 truncate">{selected ? selected.name : "Choose profile"}</span>
        {selected && !props.compact ? (
          <span className="truncate text-muted-foreground">
            {selected.runtime.model}
            {selected.runtime.reasoningEffort ? ` · ${selected.runtime.reasoningEffort}` : ""}
          </span>
        ) : null}
        <ChevronDownIcon className="ml-auto size-3 opacity-60" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="end" className="min-w-72">
        {profiles.length > 0 ? (
          <MenuRadioGroup
            value={selected?.id ?? ""}
            onValueChange={(value) => {
              props.onSelect(ProfilePresetId.makeUnsafe(value));
              props.onSelectionCommitted?.();
            }}
          >
            {profiles.map((profile) => {
              const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[profile.runtime.provider];
              return (
                <MenuRadioItem key={profile.id} value={profile.id} closeOnClick>
                  <Icon className="size-4" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-foreground">{profile.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {profile.runtime.provider} · {profile.runtime.model}
                      {profile.runtime.reasoningEffort
                        ? ` · ${profile.runtime.reasoningEffort}`
                        : ""}
                    </span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">No active profiles.</div>
        )}
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            void navigate({ to: "/settings", search: { section: "supervised-profiles" } });
          }}
        >
          <SettingsIcon className="size-4" />
          Manage profiles…
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}

export function ComposerResolvedProfileSummary(props: {
  readonly snapshot: ProfileSnapshot;
  readonly compact?: boolean;
}) {
  const navigate = useNavigate();
  const ProviderIcon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[props.snapshot.runtime.provider];
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="chrome"
            className={cn(
              "min-w-0 max-w-64 shrink-0 justify-start gap-1.5 px-2 sm:px-2.5 [&_svg]:mx-0",
              COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
            )}
            aria-label={`Resolved profile: ${props.snapshot.sourcePresetName}, ${props.snapshot.runtime.model}`}
            data-testid="composer-resolved-profile-summary"
          />
        }
      >
        <ProviderIcon className="size-3.5" />
        <span className="min-w-0 truncate">{props.snapshot.sourcePresetName}</span>
        {!props.compact ? (
          <span className="truncate text-muted-foreground">
            {props.snapshot.runtime.model}
            {props.snapshot.runtime.reasoningEffort
              ? ` · ${props.snapshot.runtime.reasoningEffort}`
              : ""}
          </span>
        ) : null}
        <ChevronDownIcon className="ml-auto size-3 opacity-60" />
      </MenuTrigger>
      <ComposerPickerMenuPopup align="end" className="min-w-72">
        <div className="space-y-1 px-3 py-2 text-xs">
          <div className="font-medium text-foreground">Immutable launch snapshot</div>
          <div className="text-muted-foreground">
            {props.snapshot.runtime.provider} · {props.snapshot.runtime.model}
          </div>
          <div className="text-muted-foreground">
            {props.snapshot.runtime.sandboxMode} · {props.snapshot.runtime.approvalPolicy}
          </div>
        </div>
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            void navigate({ to: "/settings", search: { section: "supervised-profiles" } });
          }}
        >
          <SettingsIcon className="size-4" />
          Manage profiles and rotations…
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
