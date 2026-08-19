# Auro skills as GitHub Copilot prompt files

This folder holds the Auro workflow skills packaged as **GitHub Copilot prompt
files** (`.prompt.md`) — the Copilot analog of the Claude Code skills in
[`../plugins/auro/skills/`](../plugins/auro/skills/). Each is invoked as a slash
command in Copilot Chat (VS Code / Visual Studio / JetBrains): `/commit`, `/pr`,
`/code-review`, `/release-notes`, `/ado`, `/post-mortem`, `/sprint-report`.

> **Generated — do not edit by hand.** These files are produced from the `SKILL.md`
> sources by [`../scripts/build-copilot-prompts.mjs`](../scripts/build-copilot-prompts.mjs)
> (`npm run build:copilot`). Edit the skill, then regenerate. Hand edits here are
> overwritten on the next build and flagged by CI.

## Install

Copilot has no plugin marketplace, so you install these one of two ways:

- **Per repo (shared with your team):** copy the files into that repo's
  `.github/prompts/` and commit them.
- **User level (all your repos):** add this folder as a user prompt-files location.

Full instructions, the per-skill invocation table, and the Claude → Copilot
behavior differences are in [`../docs/copilot-usage.md`](../docs/copilot-usage.md).
