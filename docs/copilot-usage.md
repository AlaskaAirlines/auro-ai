# Using the Auro skills as GitHub Copilot prompt files

The same Auro workflows shipped as the `auro` Claude Code plugin are also generated
as **GitHub Copilot prompt files** (`.prompt.md`). They live in
[`../copilot/prompts/`](../copilot/prompts/) and are invoked as slash commands in
**Copilot Chat** (agent mode).

> **Availability:** Copilot prompt files are a public-preview feature supported in
> **VS Code**, **Visual Studio (17.10+)**, and **JetBrains** — not on github.com or
> in the CLI. They are **not** namespaced, so the command is bare `/commit` (Copilot),
> versus `/auro:commit` (Claude Code).

---

## What you get

| Skill | Copilot command | What it does |
| ----- | --------------- | ------------ |
| `commit` | `/commit` | Guided Conventional Commits workflow: protected-branch guard, sync check, ADO/PR reference, staged-diff message, co-author accreditation; `amend` folds staged changes into the previous commit |
| `code-review` | `/code-review` | Reviews a GitHub PR (posts comments after you confirm) or the current branch in chat, and cross-checks the linked ADO ticket's requirements |
| `release-notes` | `/release-notes` | Derives the next semantic version from Conventional Commits and authors/refreshes the release-notes doc; stages, never commits |
| `pr` | `/pr` | Opens a GitHub PR for the current branch, assigned to you; prompts for base + draft/ready, applies component labels, adds per-ticket Executive Summary + Discussion link. Never pushes |
| `ado` | `/ado` | Drafts a new Azure DevOps work item or refines an existing one, then writes it to ADO |
| `post-mortem` | `/post-mortem` | Authors a structured post-mortem for a ticket, writes `docs/post-mortem/<ticket>.md`, and publishes a GitHub Discussion |
| `sprint-report` | `/sprint-report` | Generates a read-only sprint report from the Auro ADO board, including per-bug root-cause analysis |

Each generated prompt begins with an **Argument** line (Copilot prompts you for it as
`${input:args}`) and, where relevant, a **Copilot compatibility** note.

---

## Option A — Install for a repo/team (recommended)

Copy the prompt files into the target repository's `.github/prompts/` folder and
commit them so everyone on the repo gets the commands:

```shell
mkdir -p .github/prompts
# from a checkout of AlaskaAirlines/auro-ai:
cp /path/to/auro-ai/copilot/prompts/*.prompt.md .github/prompts/
git add .github/prompts && git commit -m "chore: add Auro Copilot prompt files"
```

Reload VS Code (or run **Developer: Reload Window**). The commands then appear in
Copilot Chat when you type `/`.

---

## Option B — Install for all your repos (user level)

Register `auro-ai/copilot/prompts` as a **user prompt-files location** so the
commands are available in every workspace for your account:

1. In VS Code, open **Settings** and search for **Chat: Prompt Files Locations**
   (`chat.promptFilesLocations`), or edit your user `settings.json`:

   ```jsonc
   {
     "chat.promptFiles": true,
     "chat.promptFilesLocations": {
       "/absolute/path/to/auro-ai/copilot/prompts": true
     }
   }
   ```

2. Reload the window. `git pull` the `auro-ai` repo to pick up new or updated skills.

> Alternatively, use **Chat: New Prompt File** and choose the *user data folder* as
> the location, then copy the files there — but pointing at a checkout keeps them
> updatable with `git pull`.

---

## Claude Code → Copilot differences

These ports are generated mechanically from the `SKILL.md` sources, so a few
Claude-only capabilities degrade:

- **No sub-agents / multi-model.** `code-review` runs an adversarial *multi-model*
  review under Claude; under Copilot it is a single-model review. GitHub comment
  posting still works via the `gh` CLI in the terminal.
- **Terminal approvals.** Claude's fine-grained `Bash(...)` allowlists become
  Copilot's `runCommands` tool — Copilot asks you to approve each terminal command
  rather than silently allowing a pre-approved set.
- **Prompts are inline.** Claude's structured `AskUserQuestion` picker becomes a
  plain inline question in Copilot Chat.
- **External creds unchanged.** `ado`, `post-mortem`, and `sprint-report` still need
  the GitHub CLI and/or an Azure DevOps PAT in your environment.

---

## Keeping them current

The prompt files are **generated** from the skill sources — never edit them by hand.
To change a workflow, edit the relevant `plugins/auro/skills/<name>/SKILL.md`, then
regenerate:

```shell
npm run build:copilot
```

Releases regenerate and commit them automatically (see the repo `README.md`), and CI
fails a PR whose `copilot/prompts/` output has drifted from the skills.
