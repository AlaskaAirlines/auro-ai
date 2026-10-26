# Using the Auro skills as GitHub Copilot prompt files

The same Auro workflows shipped as the `auro` Claude Code plugin are also generated
as **GitHub Copilot prompt files** (`.prompt.md`). They live in
[`../copilot/prompts/`](../copilot/prompts/) and are invoked as slash commands in
**Copilot Chat** (agent mode).

> **Availability:** Copilot prompt files are a public-preview feature supported in
> **VS Code**, **Visual Studio (17.10+)**, and **JetBrains** — not on github.com or
> in the CLI. They are **not** namespaced, so the command is bare `/commit` (Copilot),
> versus `/auro:commit` (Claude Code).
>
> **Using the Copilot CLI instead?** The CLI doesn't load these prompt files; the
> skills are packaged there as **custom agents** — see
> [`copilot-cli-usage.md`](./copilot-cli-usage.md).

---

## Coding standards: install the `auro` plugin

The Auro **coding standards** (`coding-standards`) are not generated as prompt files.
They load automatically when you write or change code, and that only works as a
skill. VS Code can load Claude-format plugins (experimental), so Copilot reads the
standards straight from the same `auro` plugin Claude Code uses. There is one copy of
every rule, and nothing is generated.

Add this to your **user** `settings.json`:

```jsonc
"chat.plugins.enabled": true,
"chat.plugins.marketplaces": ["AlaskaAirlines/auro-ai"]   // experimental
```

Then install **auro** from the Extensions view (filter `@agentPlugins`). To recommend
it to everyone who opens a repo, add this to that repo's `.claude/settings.json`. VS
Code shows it under `@agentPlugins @recommended`, and Claude Code users get the same
recommendation. It is the same snippet as
[`project-settings-snippet.json`](./project-settings-snippet.json):

```json
{
  "extraKnownMarketplaces": {
    "auro-ai": { "source": { "source": "github", "repo": "AlaskaAirlines/auro-ai" } }
  },
  "enabledPlugins": { "auro@auro-ai": true }
}
```

To try an unreleased branch, clone `auro-ai` and register the plugin folder directly
with `"chat.pluginLocations": { "<checkout>/plugins/auro": true }` (experimental).

**What to expect** in agent mode:
- **The skill loads on its own** when a task involves Auro code. A plain description
  of a bug or change is enough, and so is a bare ticket number.
- **It opens only the rule categories the task needs**, and applies them as it writes.
- **It cites a rule by ID**, such as `CS-A11Y-001`, when the rule changes the code.
- **It stays silent on non-code work**, such as a sprint report.

**Verified in Copilot CLI** on 2026-10-22. VS Code agent mode is not verified yet; see
[Verification](#verification-2026-10-22) below.

**Not covered:** Copilot **code review on GitHub** (the PR reviewer on github.com)
reads only files in the repository, not plugins, so it does not see these standards.

---

## What you get

| Skill | Copilot command | What it does |
| ----- | --------------- | ------------ |
| `commit` | `/commit` | Guided Conventional Commits workflow: protected-branch guard, sync check, ADO/PR reference, staged-diff message, co-author accreditation; `amend` folds staged changes into the previous commit |
| `code-review` | `/code-review` | Reviews a GitHub PR (posts comments after you confirm) or the current branch in chat, and cross-checks the linked ADO ticket's requirements |
| `release-notes` | `/release-notes` | Derives the next semantic version with the repo's own semantic-release commit analyzer (needs `npm ci` in the repo) and authors/refreshes the release-notes doc; stages, never commits. Ships with a bundled script — see below |
| `pr` | `/pr` | Opens a GitHub PR for the current branch, assigned to you; prompts for base + draft/ready, applies component labels, adds per-ticket Executive Summary + Discussion link. Never pushes |
| `ado` | `/ado` | Drafts a new Azure DevOps work item or refines an existing one, then writes it to ADO |
| `post-mortem` | `/post-mortem` | Authors a structured post-mortem for a ticket, writes `docs/post-mortem/<ticket>.md`, and publishes a GitHub Discussion |
| `sprint-report` | `/sprint-report` | Generates a read-only sprint report from the Auro ADO board, including per-bug root-cause analysis |
| `create-rcs` | `/create-rcs` | Builds a Release Candidate Summary for a sprint (or one repo, given an npm package) and, after you confirm, creates the Release work items in ADO. Ships with a bundled script — see below |
| `close-dependabot` | `/close-dependabot` | Lists open Dependabot PRs across the Auro repos, asks which to leave open, then closes the rest |
| `doc-review` | `/doc-review` | Checks the branch's component docs against the Auro content guidelines, verifying claims against the code; reports findings only, or applies them (uncommitted) with `write`; `all` covers the whole repo instead of the branch; a component name (formkit) limits it to that component |

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
# skills that bundle helper scripts (currently create-rcs and release-notes) need their folder too:
cp -R /path/to/auro-ai/copilot/prompts/create-rcs /path/to/auro-ai/copilot/prompts/release-notes .github/prompts/
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

> **`create-rcs` and `release-notes` at user level:** each prompt runs a bundled script from
> `.github/prompts/<name>/scripts/`, relative to the open workspace. With a
> user-level install that folder isn't in your workspace, so either copy
> `copilot/prompts/<name>/` into the workspace's `.github/prompts/`, or tell
> Copilot to use `/absolute/path/to/auro-ai/copilot/prompts/<name>` instead.

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
- **External creds unchanged.** `ado`, `post-mortem`, `sprint-report`, and
  `create-rcs` still need the GitHub CLI and/or an Azure DevOps PAT in your environment.
- **Bundled scripts.** A skill can ship helper scripts in
  `plugins/auro/skills/<name>/scripts/`. The build copies them to
  `copilot/prompts/<name>/scripts/` and points the prompt at
  `.github/prompts/<name>/scripts/`, so install that folder next to the prompt file.

---

## Keeping them current

The prompt files are **generated** from the skill sources — never edit them by hand.
To change a workflow, edit the relevant `plugins/auro/skills/<name>/SKILL.md`, then
regenerate:

```shell
npm run build:copilot
```

Releases regenerate and commit them automatically (see the repo `README.md`), and CI
fails a PR whose `copilot/prompts/` output (prompt files and copied scripts) has
drifted from the skills.

---

## Verification (2026-10-22)

Phase 4 ([AB#1668633](https://itsals.visualstudio.com/E_Retain_Content/_workitems/edit/1668633)). The full evidence is in [`evidence/phase-4/README.md`](https://github.com/Alaska-ECommerce/auro-workbook/blob/main/projects/coding-standards/evidence/phase-4/README.md) in auro-workbook.

| Check | Copilot CLI 1.0.103 | VS Code agent mode |
|---|---|---|
| `coding-standards` loads on a coding prompt | ✅ 4/4, at the first tool call | not run |
| Opens the matching rule files before the first edit | ✅ 4/4 (a11y, form and test for aria-invalid; life, a11y and test for a DOM move) | not run |
| Stays out of unrelated work (sprint report, ticket question) | ✅ 2/2 | not run |
| `${CLAUDE_SKILL_DIR}` expands | ❌ left literal. Fixed: the skills that use it fall back to the skill's base directory, which Copilot provides | not run |

VS Code agent mode was not run: Copilot Chat in VS Code 1.143 had no language model
available on the test machine ("Language model unavailable"). The plugin settings
above are untested in VS Code until someone runs the check.

Two Copilot behaviours to know about:
- **Copilot drops a skill whose frontmatter is not strict YAML, or whose description is over 1024 characters, without any error.** `coding-standards` was invisible until its description was fixed, and `validate-standards` now guards it. On `main`, this drops five workflow skills: `ado`, `post-mortem` and `pr` have descriptions over 1024 characters, and `create-rcs` and `sprint-report` have an unquoted `: ` in the description, which is not valid YAML. So Copilot does not load those from the plugin. Use their generated prompt files or agents in Copilot. `doc-review` on `main` is not dropped, but its description contains `#660`, and YAML reads a space then `#` as the start of a comment, so Copilot most likely sees only its first 147 characters.
- **Skills marked `disable-model-invocation` are not offered to the model.** Only `code-review` is marked, which is expected for a workflow you start yourself.
