# Supervised orchestration redesign QA

Date: 2026-08-03

final result: passed

## Compared states

- Approved popup demo: `SPEC-supervised-orchestration-settings-redesign-assets/approved-popup-editor-demo.png` at 1280×720.
- Production popup editor: `SPEC-supervised-orchestration-settings-redesign-assets/implementation-popup-editor-wide.png` at 1280×720.
- Popup combined comparison: `SPEC-supervised-orchestration-settings-redesign-assets/popup-editor-comparison.png`.
- Production instruction preview: `SPEC-supervised-orchestration-settings-redesign-assets/implementation-instruction-preview-wide.png`.
- Responsive popup captures: `implementation-popup-editor-685.png` at 685×817 and `implementation-popup-editor-mobile.png` at 420×800.
- Effort-control reference/implementation comparison: `SPEC-supervised-orchestration-settings-redesign-assets/effort-slider-comparison.png`; production capture: `implementation-d6-effort-slider.png`.
- Isolated true-empty implementation: `SPEC-supervised-orchestration-settings-redesign-assets/implementation-d6-empty-wide.png` at 1600×1000.

- Wide reference: `SPEC-supervised-orchestration-settings-redesign-assets/interaction-2-node-bloom-editor.png` at 1440×1024.
- Wide implementation: `/Users/reinamaccredy/.codex/visualizations/2026/08/03/019fc745-648e-7c12-9ded-b0ea580f87bf/supervised-orchestration-wide-edit.png` at 1440×1024.
- Wide combined comparison: `/Users/reinamaccredy/.codex/visualizations/2026/08/03/019fc745-648e-7c12-9ded-b0ea580f87bf/supervised-orchestration-wide-comparison.png`.
- Narrow reference: `SPEC-supervised-orchestration-settings-redesign-assets/responsive-3-causal-header-grid.png` at 685×817.
- Narrow implementation: `/Users/reinamaccredy/.codex/visualizations/2026/08/03/019fc745-648e-7c12-9ded-b0ea580f87bf/supervised-orchestration-narrow-edit.png` at 685×817.
- Narrow combined comparison: `/Users/reinamaccredy/.codex/visualizations/2026/08/03/019fc745-648e-7c12-9ded-b0ea580f87bf/supervised-orchestration-narrow-comparison.png`.

## Visual review

- The approved popup structure is preserved in production: profile-preset header, paired desktop fields, full-width instructions, progressive Provider options, persistent footer actions, dimmed Snapshot Relay context, and responsive single-column mobile composition.
- Production intentionally adds truthful dirty/validation state and uses live profile instructions, so the instruction field scrolls within a bounded editor instead of expanding the modal beyond the viewport.
- The hover preview uses the same dark surface, border, typography, and metadata density as the approved editor; its instruction body is scrollable and the card remains open during pointer transfer.

- The live page uses one causal relay rather than three tabs and preserves the selected visual order: Profile presets, snapshot at launch, Supervisor seats, owner-authorized apply, Workflow directives, then Conflicts.
- The wide edit state blooms the selected profile in place and keeps the other presets and downstream live context visible.
- At an explicit 685×817 viewport, the selected profile, launch snapshot, seats, and directives resolve into a two-column Causal Header Grid above a full-width editor.
- The implementation keeps Synara's existing typography, borders, button treatments, inputs, menus, icons, and shared disclosure motion. No new palette, font, or bespoke toggle animation was introduced.
- The effort slider preserves the reference's discrete track, visible stops, filled progress, and oversized thumb mechanism at the compact 32px Settings control height. It sits in the previously empty right runtime column while the native provider/model trigger now fills the matching left column.
- Live snapshot data intentionally differs from the empty-state mock: the verified runtime contained five Supervisor seats and no workflow directives or conflicts.
- The in-app screenshot backend rendered the page capture at twice the DOM coordinate scale and clipped the right visual half even though the viewport reported device-pixel-ratio 1. Layout acceptance therefore also used direct DOM geometry: the 685px grid measured two 310.5px columns inside a 637px panel, the editor measured 637px wide, the Save action ended at x=661, and document scroll width remained 685px.

## Interaction and accessibility review

- The delayed role-card preview rendered full Developer instructions plus provider, model, and reasoning-effort metadata, then remained open when the pointer entered the preview card.
- Clicking a role card or `New profile` opened the same accessible dialog while Snapshot Relay remained visible behind it.
- Cancel and Escape were sampled 30ms after activation: popup and backdrop were still mounted and both carried `data-ending-style`, proving the close transition runs before draft cleanup.
- At 685×817 there was no horizontal overflow; at 420×800 the shared dialog primitive produced a full-width bottom-stuck card.

- Opening `Supervisor Default` produced the Node Bloom editor with a disabled Save action and `No unsaved changes`.
- Editing the name produced `Unsaved changes` and enabled Save.
- Expanding Provider options used the shared disclosure primitive and exposed an accessible `Provider options JSON` textbox.
- Invalid JSON displayed `Provider options must be valid JSON.` and disabled Save.
- Cancel returned to the browsing relay without persisting the temporary draft.
- Search produced and recovered from the `No profiles found.` state.
- The profile overflow menu exposed Edit, Duplicate, Export, and Archive.
- Browser console error check returned zero errors.

## Automated evidence

- `bun run test src/components/settings/SupervisedOrchestrationSettingsPanel.test.ts`: 1 file passed, 2 tests passed.
- `bun run build` completed the web production bundle successfully. Existing Vite chunk-size warnings remained warnings only.
- Popup follow-up re-run: the focused test again passed 2/2 and the full production build completed 5/5 tasks successfully.
- Browser console errors after hover, edit, validation, Escape, and responsive checks: none.
- Live D6 geometry: Provider & model and Reasoning effort both measured 359×32px at y=388.875 in the same runtime row; the model-specific Luna control exposed five discrete positions with `Medium` selected.
- Isolated true-empty geometry: all three relay regions measured 320px high and shared the same center at y=456.25. The isolated browser surface showed its expected SocketOpen warning because it used a disposable QA home/server connection; production validation remained on `127.0.0.1:5733`.
- D5/D6 re-run: the focused profile-editor test passed 2/2, the shared provider/model browser suite passed 16/16, and the web production bundle completed successfully.
- D7 smooth-drag evidence: the range emitted fractional visual positions from 1.44 through 3.66 and settled to discrete index 4 on release; keyboard Home/End and arrow selection remained discrete and accessible.
- D7 spacing evidence: the editor panel computed 20px top padding and measured 20px from the header divider to the first form field, replacing the overridden 0px state shown in the owner's screenshot.
- D7 repeated-create evidence: fresh `Medium` New profile dialogs opened on four consecutive cycles after Cancel, X, and Escape; the focused test passed 2/2 and the web production build completed successfully.
- Full `bun fmt`, `bun lint`, and `bun typecheck` were not run because current repository policy requires explicit user authorization for those heavyweight checks.

## D8 design-only profile library + import drop zone

### Comparison target and normalization

- Source visual truth: `/var/folders/63/s3x44l1935l9dkthd410t7mr0000gn/T/codex-clipboard-c320d929-66fc-4d59-b4c9-ffce5e1a12ed.png`, 1076×1220 pixels. This is the owner's focused Profile presets composition, not a complete page-state mock.
- Connector reference: `/var/folders/63/s3x44l1935l9dkthd410t7mr0000gn/T/codex-clipboard-daa7b538-d84d-4547-8d55-1232df05e05a.png`.
- Implementation URL: `http://127.0.0.1:4178/`.
- Implementation base capture: `SPEC-supervised-orchestration-settings-redesign-assets/import-drop-preview/preview-base.jpg`, 685×1016 pixels at a 685×817 CSS viewport and 1× capture density.
- Interaction captures: `preview-drag.jpg` and `preview-done.jpg` in the same preview directory, both captured from the 685×817 CSS viewport.
- State coverage: zero-to-seven active preset layouts, centered sparse states, empty import surface, responsive stacked layout, archived multi-select popover, JSON/TOML file acceptance, file-drag acceptance, and successful-drop feedback.
- Normalization: comparison focused on the Profile presets content region because the source is a 1076px conceptual crop while the implementation is a browser-rendered 685px responsive page. Density-only differences were not filed as visual findings.

### Full-view and focused comparison evidence

- Full view: the prototype removes the tall operational relay, keeps one dominant flexible profile library, and uses the released space for one low-density import surface. At 685px, both regions fit without horizontal overflow and the import surface stacks below the library.
- Focused Profile presets comparison: card order, balanced two-column grouping, the dedicated two-left/one-right three-card composition, centered sparse states, dark low-contrast surfaces, border radius, name hierarchy, provider/model/effort metadata, and per-card action placement remain visibly consistent with the supplied profile reference. There are no dashed lines between individual cards.
- Focused runtime comparison: `preview-model-chips.jpg` replaces the raw `codex · gpt-5.6-sol · medium` line with the exact OpenAI glyph source used by Synara's shared ProviderIcon mapping, formatted `GPT-5.6 Sol`/`GPT-5.6 Luna` labels, and separate Medium badges. All four provider assets loaded successfully and no legacy `.profile-meta` nodes remained.
- Focused connector comparison: the old dashed causal language is retained as one measured 1px connection. At 1280px with three presets it ran from the visible cluster's right edge x=866.16 to the drop-zone boundary x=917.36 at the cluster center y=383.80. During 3→2 reflow it moved to y=463.80 with directional dash motion; at 685px its responsive form became a vertical connector from the cluster bottom to the stacked Import surface.
- Focused motion comparison: `preview-drag.jpg` shows the 7px Blur plus centered `Drag to import`; `preview-done.jpg` shows the existing Synara circle-check asset in green with `Done`. The sequence uses opacity and transform, with reduced-motion overrides.
- Focused archive comparison: `preview-archived-multiselect.jpg` shows the floating popover without changing the profile-grid geometry, three selectable archived rows, two selected rows, and the animated contextual Restore/Clear bar. Clear all remains in the popover header. Archive motion exposed one original card in its exit state, one flying card clone, and the receiving button pulse simultaneously before settlement.
- Focused sparse-state comparison: two active cards shared the profile-region vertical center at y=428.55; the single remaining card shared both x=342.50 and y=422.55 centers with its region; the zero-state panel shared the same x/y center as its 457.52px-high working region.

### Required fidelity surfaces

- Fonts and typography: system UI stack, restrained medium weights, uppercase section labels, compact metadata, and hierarchy match the existing Synara Settings language. No wrapping or truncation issue is visible at 685px.
- Spacing and layout rhythm: the 2×2 grid measures 630.2×344px; the import zone measures 630.2px wide; the connector is centered between regions; the 685px document has no horizontal overflow.
- Colors and tokens: near-black background, low-contrast gray borders, muted metadata, white primary action, and the existing Synara green success tone stay within the current dark theme.
- Image and asset fidelity: the success mark reuses `apps/web/public/central-icons-fill/circle-check.svg`; the Codex provider mark reuses the exact Simple Icons OpenAI path reached through Synara's `ProviderIcon` mapping. There are no generated or placeholder image assets.
- Copy and content: `Drop file to import`, `Review before saving`, and `Nothing is saved until you review it` make the safe import behavior explicit. The zero state invites `Drop a profile export here`, then offers working Create profile and Choose JSON or TOML actions. Separate JSON and TOML demo exports provide test artifacts.

### Interaction and accessibility evidence

- Search, New profile, profile-card edit, Archive, floating Archived popover, multi-select Restore/Clear, Clear all, Restore defaults, file picker, demo-file download, review-import, modal close, backdrop close, and Escape paths are wired in the standalone prototype.
- The drag target is keyboard-focusable and file input accepts `.json` and `.toml`; invalid file type and files over 1 MB receive visible feedback. `?demo=toml` settled into `demo-supervisor-profile.toml`, and Review import normalized its name to `demo-supervisor-profile`.
- Automated prototype query captured both transient drag states. After the sequence the selected file settled into `Done · Ready to review · no changes saved`.
- Browser DOM instrumentation reported `previewErrorCount=0` after base, drag, success, zero-to-seven preset, archive, multi-select Restore/Clear, Clear all, TOML review, popover-open, and restored-state checks.

### Findings

- No actionable P0/P1/P2 differences remain for this design-preview scope.
- No actionable P3 visual difference remains in the desktop connector or three-card composition. Production QA should still recapture both widths after implementation approval because this pass remains an isolated design prototype.

### Comparison history

- Pass 1 found the successful-drop check anchored outside the viewport center because both absolute overlay states relied on grid static positioning.
- Fix: explicitly anchored both overlay states at `top: 50%`, `left: 50%` and carried `translate(-50%, -50%)` through each scale transition.
- Post-fix evidence: the success group measured x=82.9–602.1 and y=362.8–454.2 inside the 685×817 viewport; `preview-done.jpg` shows the green check and `Done` centered.
- The first connected-card pass added dashed bridges between preset cards. The owner removed that visual relationship; the current DOM contains zero internal network-line elements and exactly one Profile-to-import connector.
- Archive/restore evidence at 685px: archive transition contained one exiting source card, one flying ghost, and one receiving-button state; settled state contained three active cards and one archived row. Restore returned `Supervisor Default` to its original first position and reset the badge to zero. The 685px document retained a 685px scroll width.
- Floating popover evidence: opening Archived left the profile grid at x=27.40, y=199.80, width=630.20, and height=166 before and after the transition. Selecting two of three rows exposed the selection bar and retained zero page errors.
- Multi-action evidence: restoring two selected defaults returned them in semantic order; clearing the remaining selected row reduced the archived count to zero and disabled Clear all. A four-row Clear all pass reduced the complete archived set to zero.
- Reflow safety: browser automation exposed a moving-target risk when a second card was clicked before the preceding FLIP reflow settled. Reflowing cards now suppress pointer events until their transform completes, preventing an adjacent card from receiving that click.
- Dynamic connector evidence: the line now measures the complete visible-card cluster instead of a single card, eliminating the offset seen with stacked pairs. It transitions position and length with the 400ms card reflow and runs a 560ms directional dash cue; reduced-motion collapses both effects.
- Three-card evidence: at 1280px, `Lead Default` and `Peer Implementer` occupied the two left slots while `Peer Reviewer` centered in the right slot. The following 3→2 archive kept the Import surface at 517px high throughout, left both surviving cards in the `reflowing` state during the transition, and settled without recorded page errors.

### Implementation checklist

1. Await owner approval of D8; do not edit production code before that approval.
2. If approved, reuse the production profile card/editor paths and implement drag state with the shared icon and reduced-motion behavior.
3. Re-run visual QA at both the current 685px Settings width and a wide desktop Settings width.
