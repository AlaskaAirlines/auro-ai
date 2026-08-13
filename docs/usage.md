# Using the `auro` plugin in another repository

This guide covers everything needed to install and use the `auro` Claude Code plugin
— which provides the `commit`, `code-review`, `release-notes`, `pr`, `ado`, and `post-mortem` skills — in any repository.

The plugin is distributed through the **`auro-ai` marketplace**, hosted in this repo
(`AlaskaAirlines/auro-ai`). Claude Code plugins are **not** npm packages: installing
this repo as a dependency won't work, because Claude Code doesn't scan `node_modules/`
for skills. Use the marketplace flow below instead.

---

## What you get

| Skill | Invocation | What it does |
| ----- | ---------- | ------------ |
| `commit` | `/auro:commit <ADO # \| PR # \| prev \| amend>` | Guided Conventional Commits workflow: protected-branch guard, sync check, required ADO/PR reference, staged-diff message generation, post-mortem linking, AI + human co-author accreditation. `amend` folds staged changes into the previous commit and rewrites its message |
| `code-review` | `/auro:code-review <PR #>` · `/auro:code-review local` | Adversarial multi-model review of a GitHub PR (posts comments) or the current branch (chat output) |
| `release-notes` | `/auro:release-notes [base ref]` | Authors the next release-notes document for `auro-formkit`: derives the next semantic version from the Conventional Commits since the last documented release, generates a rich notes file from the repo's template, wires it into the accordion index, and **stages** the files. If a notes file for the current in-progress release already exists on this branch it **refreshes that file in place** instead of creating a duplicate. Never commits, pushes, tags, or performs the release itself |
| `pr` | `/auro:pr [base branch]` | Opens a **draft** GitHub PR for the current branch into the repo default branch, **assigned to you** (`@me`), seeded from the repo's `.github` PR template, with the `## Executive Summary` of any post-mortem files added on the branch prepended to the description — then returns a link to the new PR. Never pushes |
| `ado` | `/auro:ado new` · `/auro:ado <ADO #>` | Drafts a new Azure DevOps work item — or refines an existing one — to Auro design-system standards: infers the component and reads its GitHub repo, classifies bug vs. user story, and writes the Title, Description, Acceptance Criteria, and (for bugs) Repro Steps, Actual/Expected Results, System Info, and the ADO classification picklists. After you approve, it **creates or updates the ticket in Azure DevOps and returns a link**. Requires a one-time [ADO PAT setup](#prerequisite--azure-devops-personal-access-token-pat) |
| `post-mortem` | `/auro:post-mortem [ADO #]` | Authors a structured post-mortem for a ticket — gathering context from the current branch, the conversation, the ADO work item, and any linked TRD — then writes it to `docs/post-mortem/<ticket>.md` **and** publishes it as a GitHub Discussion in the repo's "Post Mortems" category (tagging a label per mentioned component on `auro-formkit`). Prompts for the ticket (offering to reuse the last one); re-running a ticket **updates** the existing file and discussion instead of duplicating them. ADO context uses the same [ADO PAT setup](#prerequisite--azure-devops-personal-access-token-pat) but is optional |

> **Namespacing:** plugin skills are always prefixed with the plugin name, so the
> commands are `/auro:commit`, `/auro:code-review`, `/auro:release-notes`, `/auro:pr`,
> `/auro:ado`, and `/auro:post-mortem` — not the bare forms.

---

## Option A — Install for a whole repo/team (recommended)

Make the plugin available to everyone who opens a repository by committing a settings
block into it. This is the durable, shareable path.

### 1. Add the settings block

Create or edit `.claude/settings.json` in the target repository and add:

```json
{
  "extraKnownMarketplaces": {
    "auro-ai": {
      "source": { "source": "github", "repo": "AlaskaAirlines/auro-ai" }
    }
  },
  "enabledPlugins": { "auro@auro-ai": true }
}
```

> This exact snippet is also kept at [`project-settings-snippet.json`](./project-settings-snippet.json).
> If the repo already has a `.claude/settings.json`, merge these two keys into it rather
> than overwriting the file. Commit the change so teammates get it.

### 2. Install and activate

When you (or a teammate) next open the repo and trust the folder, Claude Code prompts
you to install the marketplace and plugin. Accept, then restart the session or run
`/reload-plugins`.

If your environment doesn't surface that prompt (see [Option B](#option-b--install-manually-via-the-cli) for
the CLI, needed in the VS Code extension), run the one-time install described there.

---

## Option B — Install manually (via the CLI)

The interactive `/plugin` panel isn't available in every environment (notably the
**VS Code extension**, which reports `/plugin isn't available in this environment`).
The `claude plugin` shell CLI does the same job everywhere.

```shell
# 1. Register the marketplace (owner/repo shorthand, or a full git/SSH URL)
claude plugin marketplace add AlaskaAirlines/auro-ai

# 2. Install the plugin — scope: user | project | local  (default: user)
claude plugin install auro@auro-ai --scope project

# 3. Enable it if it isn't already, then restart the session (or /reload-plugins)
claude plugin enable auro@auro-ai
```

- **`--scope project`** writes the enablement into the repo's `.claude/settings.json`
  (shared with collaborators). Use **`user`** to enable it for yourself across all repos,
  or **`local`** for yourself in this repo only.
- If `/plugin` **is** available in your environment, the interactive equivalents are
  `/plugin marketplace add AlaskaAirlines/auro-ai` and `/plugin install auro@auro-ai`.

### Verify the install

```shell
claude plugin list                    # should show: auro@auro-ai — enabled
claude plugin details auro@auro-ai    # lists the plugin's skills + token cost
```

Then try it:

```shell
/auro:commit prev
```

---

## Using the skills

### `/auro:commit`

```shell
/auro:commit 1602084     # 7-digit value → ADO ticket, subject ends with AB#1602084
/auro:commit 123         # fewer than 7 digits → PR, subject ends with #123
/auro:commit prev        # reuse the reference from the last /auro:commit in this repo
/auro:commit amend       # fold staged changes into the previous commit, rewriting its message
```

Walks you through: a protected-branch (`dev`/`main`/`master`) warning, a sync check,
generating a Conventional Commits subject + body from your **staged** changes, and a
confirm-or-edit loop before it commits. A ticket/PR reference is required.

**Amend mode (`amend`).** Instead of creating a new commit, this rewrites the **previous**
commit (`git commit --amend`) so the staged changes are folded into it and the message is
regenerated to describe the *combined* result — following the same subject/body rules. It
reuses the reference from the previous commit (pass `amend 1602084` to override), preserves
the original commit's co-author and AI-accreditation trailers, and allows a message-only
amend when nothing new is staged. If the commit being amended is already on the remote,
you're warned first — rewriting it needs a force-push (the skill never pushes).

### `/auro:code-review`

```shell
/auro:code-review 1572    # review GitHub PR #1572 and post inline + summary comments
/auro:code-review local   # review the current branch against a chosen base, output in chat
```

### `/auro:release-notes`

```shell
/auro:release-notes            # detect the range since the last documented release automatically
/auro:release-notes v6.0.2     # override: use an explicit base ref (tag/branch/commit) as the range start
```

Authors the **next** release-notes document for `auro-formkit` — it does **not** perform
the release (that's owned by the GitHub Actions semantic-release workflow). It:

1. **Checks prerequisites** — the repo must have `docs/releases/`,
   `docs/releases/Release_Guide_TEMPLATE.md`, and `docs/templates/RELEASE_NOTES.md`. If any
   are missing it stops and tells you what to copy from a repo that has them.
2. **Determines the base version and the mode** — it reads the highest-numbered
   `docs/releases/NN.NN.NN.md` file for the last *released* version (not `package.json`,
   which is `0.0.0` under semantic-release), and checks whether this branch already has an
   **in-progress** notes file (one added on the branch or not yet committed). That in-progress
   file — if any — is excluded from the base calculation so it's never mistaken for a prior
   release. The result is one of two modes:
   - **Create mode** (no in-progress file) — it will generate a brand-new notes file.
   - **Update mode** (an in-progress file already exists on the branch) — it will **refresh
     that existing file in place** rather than create a second one. If more than one
     in-progress file is found it asks you which to update.
3. **Classifies the commits** in range by Conventional Commits and computes the next
   version — `BREAKING CHANGE`/`!` → major, `feat` → minor, `fix`/`perf` → patch. If every
   commit is a non-release type (docs/chore/ci/…), it **exits early** and explains why. In
   update mode it keeps the existing file's version as the target; if a newly landed commit
   would change that number (e.g. a `feat` bumps a patch to a minor) it still refreshes the
   existing file and **flags the mismatch** in its report so you can decide whether to
   regenerate at the new number.
4. **Generates or refreshes** the notes file — in create mode it writes
   `docs/releases/<new version>.md` from the template; in update mode it **overwrites the
   existing in-progress file** (reading it first to preserve any manual edits) with notes
   covering the full unreleased range. Either way it **wires the release in** as the sole
   expanded accordion in `docs/templates/RELEASE_NOTES.md`, reusing the existing accordion
   block in update mode instead of adding a duplicate.
5. **Stages** both files with `git add` — then hands back to you. Run `/auro:commit` to
   finalize.

> **Scope guardrail:** this skill only writes the two release-notes files and stages them.
> It never commits, pushes, opens a PR, creates or moves tags, edits `package.json`, or
> triggers any release workflow.
>
> **Idempotent re-runs:** because it detects an existing in-progress file and updates it in
> place, running `/auro:release-notes` more than once on the same branch keeps refreshing the
> **same** file as new commits land — you won't accumulate a pile of duplicate release-notes
> files or accordion entries.

### `/auro:pr`

```shell
/auro:pr            # PR the current branch into the repo default branch
/auro:pr release/6  # override: target an explicit base branch instead of the default
```

Opens a **draft** pull request for the current branch and hands you a link to it. It:

1. **Checks preconditions** — `gh` must be authenticated, and you must be on a feature branch.
2. **Handles an existing PR first** — if an open PR already exists for the branch, it doesn't
   create a second one; instead it asks whether to **refresh that PR's Executive Summary**. Say
   yes and it re-syncs the post-mortem summaries into the existing PR's description
   (idempotently, leaving the assignee and everything else untouched); say no and it exits
   without touching anything. Checking this up front avoids doing any other work on a re-run.
3. **Resolves the base and verifies the push** — targets the repo's default branch (or the
   `[base branch]` argument), and requires the branch to be **pushed** to `origin` (stops with
   push instructions otherwise, since it never pushes).
4. **Builds the description** — seeds it from the repo's `.github` PR template and prepends the
   `## Executive Summary` of any post-mortem files **added on this branch** (one block each).
5. **Confirms first** — auto-generates a Conventional-Commits-style title and shows the full PR
   for a confirm-or-edit loop before anything is created.
6. **Creates the draft PR** assigned to you (`@me`) and returns the URL.

> **Scope guardrail:** this skill's only side effect is opening one draft PR. It **never
> pushes** — if the branch isn't pushed yet it stops and tells you to `git push` first — and
> it never commits, marks the PR ready-for-review, merges, or edits files.

### `/auro:ado`

Drafts, refines, and **submits** Azure DevOps work items for the Auro design system. Unlike
the other skills, `ado` talks to a remote service, so it needs a one-time credential setup —
see [Prerequisite — Azure DevOps PAT](#prerequisite--azure-devops-personal-access-token-pat)
below **before** first use.

```shell
/auro:ado new        # draft a brand-new work item from a description
/auro:ado 1223707    # look up an existing ticket and refine it
/auro:ado            # asks whether you're creating a new item or editing one
```

**Create mode (`new`).** You describe the change; the skill infers the affected Auro
component (you confirm or correct it), reads that component's GitHub repo for context,
classifies the item as a **Bug** or **User Story**, and drafts the full ticket — Title,
Description, Acceptance Criteria, and, for bugs, Repro Steps, Actual/Expected Results,
System Info, and the ADO classification picklists (see below). Just before showing you the
draft it asks whether the ticket is being opened **on behalf of** another team or user, and
records your answer (a name, or `no`) at the end of the description. It derives the Area
path, loops with you until you approve, and then — **only after an explicit confirm** —
creates the work item in Azure DevOps and returns a link.

**Edit mode (`<ADO #>`).** The skill fetches the existing ticket, shows you the current
content, confirms it's the right one, then refines every field to the same standards. It
also **reads all comments on the ticket** and factors them in as additional context —
weighed against the actual code and the ticket's intent, never assumed correct — and
surfaces any substantive suggestion it didn't adopt so you can decide. For the picklist and
System Info fields (and the on-behalf-of note) it tells you the current value and asks
whether to keep it before offering to change it. After you approve, and **only after an
explicit confirm**, it updates the ticket and returns a link.

**Bug specifics.** For bugs the skill collects five classification picklists whose choices
come **only from ADO's live allowed values** — Impacted Guest Experience, Highest
Environment Impacted, Defect How Found, Defect Root Cause, and Issue Type (it suggests an
Issue Type from the drafted content; you confirm or change it). The *System Info and Misc
Information* field captures three answers: which version of the component reproduced the
issue, which version of AuroDesignTokens, and whether it reproduces on
`https://auro.alaskaair.com/` (each answerable as a value or `unknown`). Existing answers in
a ticket are reused.

**How bug content is stored.** Bugs consolidate their narrative into the bug-form fields
rather than the generic Description/Acceptance Criteria fields. On submit, a bug's **Repro
Steps** field leads with the description and is followed by the reproduction steps, and its
**System Info and Misc Information** field has the acceptance criteria appended to the end.
The bug's own **Description** and **Acceptance Criteria** fields are left empty (and cleared
on edit if an older ticket had used them). User stories are unaffected — they keep their
Description and Acceptance Criteria in those fields as normal. You still draft and edit each
block separately during the review loop; the consolidation happens only when the ticket is
written.

**Refinement tag.** Every work item the skill writes — whether newly created or edited — is
tagged **`Refinement`** in Azure DevOps (added alongside any existing tags, never
duplicated), so skill-authored tickets are easy to find.

> **Scope guardrail:** the skill is read-only until your final confirmation. Its only
> mutation is the single create/update it makes after you say yes. It never touches git,
> never edits repo files, and never prints, echoes, or writes your PAT to disk.

#### Prerequisite — Azure DevOps Personal Access Token (PAT)

The `ado` skill authenticates to Azure DevOps with a **Personal Access Token** read from the
`ADO_PAT` environment variable. (It does **not** use `az login` — Azure CLI tokens are
unreliable against the `itsals` org under Conditional Access, which is why the skill uses a
PAT instead.) This is a one-time setup.

**1. Create the PAT.** Go to
[itsals ▸ User settings ▸ Personal access tokens](https://itsals.visualstudio.com/_usersSettings/tokens):

- **New Token** → Organization: `itsals`
- **Scopes:** **Work Items → Read & Write** (that scope is sufficient; no others are needed)
- Set an expiration, click **Create**, and copy the token — you won't be able to see it again.

**2. Export it in `~/.zshenv` — not `~/.zshrc`.** This is the part that trips people up.
Claude Code runs skill commands in a **non-interactive** shell, which sources **`~/.zshenv`**
and **not** `~/.zshrc` (the latter is loaded for interactive shells only). If you put the
token in `~/.zshrc` it will work in your own terminal but the skill will report *"No Azure
DevOps token found."*

Add this to `~/.zshenv` (create the file if it doesn't exist):

```sh
# Azure DevOps PAT for the /auro:ado skill (Work Items Read & Write scope on the itsals org)
# Create/rotate at: https://itsals.visualstudio.com/_usersSettings/tokens
export ADO_PAT="<your-token>"
```

Claude Code's tool shell reads `~/.zshenv` fresh on each call, so no restart is needed —
just re-run the skill. (Open a new interactive terminal, or `source ~/.zshenv`, if you also
want it in your own shell.)

**3. Verify it works:**

```sh
curl -sS -u ":$ADO_PAT" "https://itsals.visualstudio.com/_apis/connectionData?api-version=7.0-preview" | head -c 200
```

You should see JSON with your identity — **not** an HTML sign-in page. If you get the sign-in
HTML, the PAT is missing, expired, or lacks the Work Items scope.

> **Security:** the PAT is a live secret. Keep it only in `~/.zshenv` (which isn't in any
> repo), never commit it, and rotate it if it leaks. PATs expire — when yours does, Azure
> DevOps returns its sign-in page and the skill will tell you to refresh `ADO_PAT`.

---

## Getting new or updated skills

When new skills — or fixes to existing ones — are pushed to `AlaskaAirlines/auro-ai`,
consuming repos do **not** pick them up automatically just because the code changed.
Updates are **version-gated**: a consumer only receives them once the plugin's `version`
is bumped and they pull the new version. Here is the full flow.

### 1. Maintainer step (in the `auro-ai` repo)

After adding or editing skills:

1. Bump `version` in **both** `plugins/auro/.claude-plugin/plugin.json` **and** the
   matching entry in `.claude-plugin/marketplace.json` (they must agree).
2. Update `CHANGELOG.md`, commit, tag the release (`git tag vX.Y.Z`), and push.

> If `version` were omitted from `plugin.json`, every commit would count as a new
> version — but this plugin pins an explicit `version`, so the bump is required. Without
> it, `claude plugin update` sees no change and consumers stay on the old skills.

### 2. Consumer step — pull the update

New skills added to the existing `auro` plugin arrive **as part of the plugin** — you do
not install them one by one. In the consuming repo:

```shell
claude plugin marketplace update auro-ai                # refresh the catalog so it sees the new version
claude plugin update auro@auro-ai --scope project       # pull the latest plugin version to disk
```

> **Match the scope you installed at.** `claude plugin update` defaults to `--scope user`.
> If you installed the plugin at **project** scope (the recommended, shared setup — see
> [Option A](#option-a--install-for-a-whole-repoteam-recommended) / `--scope project` in
> [Option B](#option-b--install-manually-via-the-cli)), you **must** pass `--scope project`
> or the update fails with `Plugin "auro" is not installed at scope user`. Check your scope
> with `claude plugin list` (it prints `Scope: project`) and use the matching flag.

Then **fully restart the Claude Code session** to load the new skills — plugins are read at
startup, and the update itself prints `restart required to apply`. Do **not** rely on
`/reload-plugins` for a *newly added* skill: it refreshes already-loaded skills into context
but does **not** rebuild the slash-command index, so `/auro:<new-skill>` won't be invocable
until a real restart (in the **VS Code extension**, reload the window / reopen the panel).
Confirm the new version and its skills with:

```shell
claude plugin list                         # verify the active Version bumped (e.g. 1.1.0)
claude plugin details auro@auro-ai         # lists every skill in the current version
```

### 3. Auto-update (optional, off by default)

Third-party marketplaces have auto-update **disabled by default**. To let Claude Code
refresh the marketplace and update installed plugins automatically after each session
start (with a random delay up to ~10 minutes), enable it via `/plugin` → **Marketplaces**
→ select `auro-ai` → **Enable auto-update** (where `/plugin` is available). When an update
lands you are prompted to run `/reload-plugins`, or it loads on the next launch.

### Lock to a specific version

To pin instead of tracking latest, add the marketplace at a tag:

```shell
claude plugin marketplace add https://github.com/AlaskaAirlines/auro-ai.git#v1.1.0
```

### A brand-new *plugin* (not just a new skill)

The steps above cover new skills inside the existing `auro` plugin. If a whole new
**plugin** is added to the marketplace (a new `plugins/<name>/` entry with its own
manifest), consumers must refresh the catalog and install that plugin explicitly:

```shell
claude plugin marketplace update auro-ai
claude plugin install <name>@auro-ai --scope project
```

Then add it to the shared `.claude/settings.json` `enabledPlugins` record
(`"<name>@auro-ai": true`) so teammates get it too.

---

## Managing the plugin

```shell
claude plugin list                     # installed plugins + status
claude plugin disable auro@auro-ai     # turn off without uninstalling
claude plugin enable  auro@auro-ai     # turn back on
claude plugin uninstall auro@auro-ai   # remove entirely
claude plugin marketplace update auro-ai   # refresh the catalog
claude plugin marketplace remove  auro-ai  # remove the marketplace (uninstalls its plugins)
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `/plugin isn't available in this environment` | Use the `claude plugin …` CLI (Option B). The VS Code extension doesn't expose the interactive panel. |
| A **new** skill doesn't appear after `claude plugin update` | Fully **restart** the session — `/reload-plugins` does *not* rebuild the slash-command index, so a newly added `/auro:<skill>` won't register until restart. In the VS Code extension, reload the window / reopen the panel. |
| `Failed to update plugin … not installed at scope user` | `claude plugin update` defaults to `--scope user`. Re-run with the scope you installed at, e.g. `claude plugin update auro@auro-ai --scope project`. Check with `claude plugin list`. |
| Existing skills don't appear after install | Run `/reload-plugins`, or restart the Claude Code session — plugins load at startup. |
| `Marketplace "auro-ai" not found` | `claude plugin marketplace add AlaskaAirlines/auro-ai`, then retry the install. |
| Plugin shows **disabled** despite `enabledPlugins` | `claude plugin enable auro@auro-ai`. |
| Private-repo clone fails | Ensure you have git access to `AlaskaAirlines/auro-ai` (HTTPS or SSH). |
| `/auro:ado` says **"No Azure DevOps token found"** / `ADO_PAT` missing | The token isn't visible to Claude Code's non-interactive shell. Put `export ADO_PAT=…` in **`~/.zshenv`** (not `~/.zshrc`), then re-run the skill. See [the PAT prerequisite](#prerequisite--azure-devops-personal-access-token-pat). |
| `/auro:ado` returns a **sign-in HTML page** / auth failure | The PAT is missing, expired, or lacks scope. Recreate it at [itsals tokens](https://itsals.visualstudio.com/_usersSettings/tokens) with **Work Items → Read & Write** and update `ADO_PAT` in `~/.zshenv`. This is **not** a missing-ticket error. |

---

## Reference

- Marketplace / plugin repo — `AlaskaAirlines/auro-ai`
- Claude Code docs — [Plugins](https://code.claude.com/docs/en/plugins),
  [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
  [Discover & install plugins](https://code.claude.com/docs/en/discover-plugins)
