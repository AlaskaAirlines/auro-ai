# Using the Auro skills in the GitHub Copilot CLI (Windows)

The Auro workflows are packaged three ways, one per product:

| Product | Package | Where |
| ------- | ------- | ----- |
| Claude Code | plugin / skills | [`../plugins/auro/skills/`](../plugins/auro/skills/) — see [`usage.md`](./usage.md) |
| Copilot in VS Code / Visual Studio / JetBrains | prompt files (`.prompt.md`) | [`../copilot/prompts/`](../copilot/prompts/) — see [`copilot-usage.md`](./copilot-usage.md) |
| **Copilot CLI** | **custom agents (`.agent.md`)** | [`../copilot/agents/`](../copilot/agents/) — **this guide** |

> **Why the CLI needs its own package.** The Copilot **CLI** does not load VS Code
> prompt files (`.github/prompts/*.prompt.md`) as slash commands — that's an
> [open feature request](https://github.com/github/copilot-cli/issues/618). The CLI's
> reusable, invocable unit is a **custom agent** (`<name>.agent.md`, invoked with
> `/agent` or `copilot --agent <name>`), so the skills are generated into that format
> in [`../copilot/agents/`](../copilot/agents/).

This guide is written for **Windows** (PowerShell). macOS/Linux users can follow the
same steps, substituting `~/.copilot/agents` for `%USERPROFILE%\.copilot\agents` and
`export VAR=…` for `setx`.

---

## What you get

| Skill | Agent command | Shape |
| ----- | ------------- | ----- |
| `commit` | `/agent commit` · `copilot --agent commit` | inline |
| `pr` | `/agent pr` · `copilot --agent pr` | inline |
| `release-notes` | `/agent release-notes` | inline |
| `post-mortem` | `/agent post-mortem` | inline |
| `ado` | `/agent ado` | bootstrap (needs `AURO_AI_HOME`) |
| `code-review` | `/agent code-review` | bootstrap (needs `AURO_AI_HOME`) |
| `sprint-report` | `/agent sprint-report` | bootstrap (needs `AURO_AI_HOME`) |

**Inline** agents embed the full workflow and are self-contained. **Bootstrap**
agents (whose inlined workflow would exceed the CLI's 30,000-character agent-prompt
cap) read their `SKILL.md` from your local `auro-ai` checkout at runtime — so those
three require the `AURO_AI_HOME` step below.

> **Copilot CLI vs. Claude Code.** These are mechanical ports of the same skills, so
> Claude-only features degrade: `code-review` runs single-model (no adversarial
> multi-model sub-agents); the CLI asks you to approve each terminal command; and
> structured pickers become plain inline questions.

---

## 1. Prerequisites

| Tool | Why | Get it |
| ---- | --- | ------ |
| **Node.js 22+** | Required runtime for the CLI | https://nodejs.org |
| **GitHub Copilot CLI** | The app | `npm install -g @github/copilot` (or `winget install GitHub.CopilotCLI`) |
| Active **Copilot subscription** | CLI is included in all Copilot plans | — |
| **Git for Windows** | Clone the repo; provides Git Bash + `curl` | https://git-scm.com/download/win |
| **GitHub CLI** (`gh`) — for `pr` / `code-review` / `post-mortem` | Those skills post to GitHub | https://cli.github.com → `gh auth login` |

Install and authenticate (PowerShell):

```powershell
npm install -g @github/copilot
copilot        # first run: use /login to authenticate
```

Clone the marketplace repo locally (needed for install, and at runtime by the three
bootstrap agents):

```powershell
git clone https://github.com/AlaskaAirlines/auro-ai.git C:\src\auro-ai
```

---

## 2. Install the agents

Choose a scope and copy the generated `.agent.md` files there.

### Option A — User level (all your repos, recommended)

```powershell
New-Item -ItemType Directory -Force $env:USERPROFILE\.copilot\agents | Out-Null
Copy-Item C:\src\auro-ai\copilot\agents\*.agent.md $env:USERPROFILE\.copilot\agents\
```

### Option B — Per repo (shared with your team)

Run from the root of the repo you want the agents in, and commit them:

```powershell
New-Item -ItemType Directory -Force .github\agents | Out-Null
Copy-Item C:\src\auro-ai\copilot\agents\*.agent.md .github\agents\
git add .github/agents
git commit -m "chore: add Auro Copilot CLI agents"
```

Restart `copilot` (instruction/agent changes aren't picked up mid-session), then
confirm they're loaded:

```text
copilot
> /agent            # the Auro agents appear in the picker
```

---

## 3. Point the bootstrap agents at your checkout (`AURO_AI_HOME`)

`ado`, `code-review`, and `sprint-report` read their full workflow from your
`auro-ai` checkout at runtime. Tell them where it is with a **user environment
variable** so the CLI inherits it:

```powershell
setx AURO_AI_HOME "C:\src\auro-ai"
```

Then **fully restart** the CLI (`setx` only affects new processes). If `AURO_AI_HOME`
is unset, the agent will ask you for the checkout path instead.

---

## 4. Set `ADO_PAT` — only for `ado` and `sprint-report`

These read an Azure DevOps Personal Access Token from the environment.

1. **Create the PAT** at
   [itsals ▸ User settings ▸ Personal access tokens](https://itsals.visualstudio.com/_usersSettings/tokens):
   **New Token** → Organization `itsals` → Scopes **Work Items → Read & Write** → set
   an expiration → **Create**, and copy the token (shown only once).
2. **Set it** (PowerShell, no admin needed):
   ```powershell
   setx ADO_PAT "<your-token>"
   ```
3. **Fully restart** the CLI so it picks up the new variable.
4. **Verify** in the terminal:
   ```powershell
   curl.exe -sS -u ":$env:ADO_PAT" "https://itsals.visualstudio.com/_apis/connectionData?api-version=7.0-preview"
   ```
   You should get JSON with your identity — **not** an HTML sign-in page (which means
   the PAT is missing, expired, or lacks the Work Items scope).

> **Security:** the PAT is a live secret — never commit it, and rotate it if it leaks.

---

## 5. Invoke

```powershell
# interactively — pick from the /agent list, then it asks for the argument inline
copilot
> /agent commit

# one-shot from the shell — the --prompt text is the argument (${input})
copilot --agent commit --prompt "1602084"
copilot --agent pr
copilot --agent sprint-report
```

---

## Keeping the agents current

The agent files are **generated** from the skill sources — never edit them by hand.
To change a workflow, edit the relevant `plugins/auro/skills/<name>/SKILL.md`, then
regenerate:

```shell
npm run build:copilot:agents      # agents only
npm run build:copilot:all         # prompt files + agents
```

Releases regenerate and commit them automatically (see the repo `README.md`), and CI
([`check-copilot-prompts.yml`](../.github/workflows/check-copilot-prompts.yml)) fails
a PR whose `copilot/agents/` output has drifted from the skills. After pulling an
update, re-copy the files into your agent location (step 2) and restart `copilot`.

---

## Troubleshooting (Windows)

| Symptom | Fix |
| ------- | --- |
| Auro agents don't appear in `/agent` | Confirm the files are in `%USERPROFILE%\.copilot\agents\` (Option A) or the repo's `.github\agents\` (Option B), then restart `copilot`. |
| `ado` / `code-review` / `sprint-report` can't find their workflow | Set `AURO_AI_HOME` to your `auro-ai` checkout (step 3) and restart, or give the path when the agent asks. |
| `ado` / `sprint-report` say "No Azure DevOps token found" | `setx ADO_PAT …` didn't reach the CLI — confirm it ran and **fully restart** `copilot`. |
| Azure DevOps returns sign-in HTML | PAT missing/expired/wrong scope — recreate with Work Items → Read & Write and re-run `setx ADO_PAT`. |
| `pr` / `code-review` / `post-mortem` fail | Install and authenticate `gh` (`gh auth login`). |
| `curl` not found | Install Git for Windows; in PowerShell use `curl.exe` (as above) to avoid the `Invoke-WebRequest` alias. |

---

## Reference

- Marketplace / skills repo — `AlaskaAirlines/auro-ai`
- Copilot CLI — [install](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli),
  [custom agents](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli),
  [custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)
