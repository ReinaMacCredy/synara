# Spec Workflow Home

This directory is the repository-local home for the Spec Workflow Repo Evolution OS.

Tracked durable knowledge:

- `REPO_EVOLUTION.md`: current full picture, target vision, gaps, and Now/Next/Later outcomes.
- `MEMORY.md`: bounded semantic memory for future agents.
- `README.md` and `.gitignore`: lifecycle and staging boundary.

Untracked working state:

- `active/`: one full bundle per non-trivial in-flight work item.
- `paused/`: evidence-paused or superseded bundles.
- `.tmp/`: recreatable lifecycle staging only.

After VERIFY passes and ship or handoff evidence exists, the lifecycle engine appends compressed
memory, requires the Evolution Map to be reconciled, and moves the complete bundle to
`~/.agents/specs/<repo>/<work-id>/`. It never stages, commits, pushes, or deletes authored evidence.

For repositories adopting this workflow, `import-legacy --dry-run` inventories root legacy
artifacts before one reviewed group is copied or moved into a recoverable active or paused bundle.
