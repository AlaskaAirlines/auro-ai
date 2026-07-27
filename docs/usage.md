# Using the `auro` plugin in another repository

This guide covers everything needed to install and use the `auro` Claude Code plugin
— which provides the `commit`, `code-review`, `release-notes`, and `pr` skills — in any repository.

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
| `release-notes` | `/auro:release-notes [base ref]` | Authors the next release-notes document for `auro-formkit`: derives the next semantic version from the Conventional Commits since the last documented release, generates a rich notes file from the repo's template, wires it into the accordion index, and **stages** the files. Never commits, pushes, tags, or performs the release itself |
| `pr` | `/auro:pr [base branch]` | Opens a **draft** GitHub PR for the current branch into the repo default branch, **assigned to you** (`@me`), seeded from the repo's `.github` PR template, with the `## Executive Summary` of any post-mortem files added on the branch prepended to the description — then returns a link to the new PR. Never pushes |

> **Namespacing:** plugin skills are always prefixed with the plugin name, so the
> commands are `/auro:commit`, `/auro:code-review`, `/auro:release-notes`, and `/auro:pr`
> — not the bare forms.

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
claude plugin details auro@auro-ai    # shows the 2 skills + token cost
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
2. **Determines the base version** from the highest-numbered `docs/releases/NN.NN.NN.md`
   file (not `package.json`, which is `0.0.0` under semantic-release).
3. **Classifies the commits** in range by Conventional Commits and computes the next
   version — `BREAKING CHANGE`/`!` → major, `feat` → minor, `fix`/`perf` → patch. If every
   commit is a non-release type (docs/chore/ci/…), it **exits early** and explains why.
4. **Generates** `docs/releases/<new version>.md` from the template and **wires it in** as
   the sole expanded accordion in `docs/templates/RELEASE_NOTES.md`.
5. **Stages** both files with `git add` — then hands back to you. Run `/auro:commit` to
   finalize.

> **Scope guardrail:** this skill only writes the two release-notes files and stages them.
> It never commits, pushes, opens a PR, creates or moves tags, edits `package.json`, or
> triggers any release workflow.

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

---

## Reference

- Marketplace / plugin repo — `AlaskaAirlines/auro-ai`
- Claude Code docs — [Plugins](https://code.claude.com/docs/en/plugins),
  [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
  [Discover & install plugins](https://code.claude.com/docs/en/discover-plugins)
