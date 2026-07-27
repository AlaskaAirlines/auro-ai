# Using the `auro` plugin in another repository

This guide covers everything needed to install and use the `auro` Claude Code plugin
— which provides the `commit` and `code-review` skills — in any repository.

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

> **Namespacing:** plugin skills are always prefixed with the plugin name, so the
> commands are `/auro:commit` and `/auro:code-review` — not bare `/commit` / `/code-review`.

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
claude plugin marketplace update auro-ai   # refresh the catalog so it sees the new version
claude plugin update auro@auro-ai          # pull the latest plugin version to disk
```

Then **restart the Claude Code session** (or `/reload-plugins` where available) to load
the new skills — plugins are read at startup. A newly added skill appears as
`/auro:<skill-name>`; confirm what the plugin now provides with:

```shell
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
| Skills don't appear after install | Run `/reload-plugins`, or restart the Claude Code session — plugins load at startup. |
| `Marketplace "auro-ai" not found` | `claude plugin marketplace add AlaskaAirlines/auro-ai`, then retry the install. |
| Plugin shows **disabled** despite `enabledPlugins` | `claude plugin enable auro@auro-ai`. |
| Private-repo clone fails | Ensure you have git access to `AlaskaAirlines/auro-ai` (HTTPS or SSH). |

---

## Reference

- Marketplace / plugin repo — `AlaskaAirlines/auro-ai`
- Claude Code docs — [Plugins](https://code.claude.com/docs/en/plugins),
  [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
  [Discover & install plugins](https://code.claude.com/docs/en/discover-plugins)
