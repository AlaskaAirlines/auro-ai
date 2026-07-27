# auro-ai

A Claude Code **plugin marketplace** for the Auro design system and `auro-formkit`
workflows. It distributes the team's custom skills so they're available in **any**
repository, with versioning and change history tracked in git.

## What's inside

| Plugin | Skills | Invocation |
| ------ | ------ | ---------- |
| `auro` | `commit` — guided Conventional Commits workflow (branch/sync guards, ADO/PR reference, post-mortem linking, AI + human co-author accreditation) | `/auro:commit <ADO # \| PR # \| prev>` |
| `auro` | `code-review` — multi-model PR / local branch review | `/auro:code-review <PR #>` · `/auro:code-review local` |
| `auro` | `release-notes` — derive the next version from Conventional Commits and author the release-notes doc | `/auro:release-notes [base ref]` |
| `auro` | `pr` — open a draft PR (current branch → default), assigned to you, seeded from the `.github` template + post-mortem summaries | `/auro:pr [base branch]` |

> Plugin skills are **namespaced** by the plugin name, so `/commit` becomes
> `/auro:commit`. Namespacing prevents collisions with other plugins.

## Repository layout

```
auro-ai/
├── .claude-plugin/
│   └── marketplace.json          # the catalog Claude Code reads
└── plugins/
    └── auro/                     # one plugin
        ├── .claude-plugin/
        │   └── plugin.json       # plugin manifest (name, version)
        └── skills/
            ├── commit/SKILL.md
            ├── code-review/SKILL.md
            ├── release-notes/SKILL.md
            └── pr/SKILL.md
```

## Install (individual / manual)

```shell
# 1. Register the marketplace (owner/repo, or a full git/SSH URL)
/plugin marketplace add AlaskaAirlines/auro-ai

# 2. Install the plugin (choose user / project / local scope)
/plugin install auro@auro-ai

# 3. Activate in the current session
/reload-plugins
```

Pin to a released tag when you want a stable version:

```shell
/plugin marketplace add https://github.com/AlaskaAirlines/auro-ai.git#v1.0.0
```

## Install for a whole team / repo (automatic)

Commit the snippet in [`docs/project-settings-snippet.json`](docs/project-settings-snippet.json)
into a project's `.claude/settings.json`. When a teammate trusts the repo folder,
Claude Code prompts them to install the marketplace and enable the plugin.

## Versioning & change logging

- Bump `version` in **both** `plugins/auro/.claude-plugin/plugin.json` and the
  matching entry in `.claude-plugin/marketplace.json` on every release — users only
  receive updates when the version changes.
- Tag releases (`git tag v1.1.0`) so consumers can pin a specific version with `#v1.1.0`.
- The git history of this repo **is** the changelog. Consider keeping a `CHANGELOG.md`.

## Developing / testing locally

Test without publishing by pointing Claude Code at the plugin directory:

```shell
claude --plugin-dir ./plugins/auro
```

Then run `/reload-plugins` after edits.
