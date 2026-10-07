# Handoff — 2026-10-07 — ready to start Phase 2a coding

**Committed to this branch on purpose**, so the pick-up point travels to a new
machine. It is a working note, not a project record: remove it (or replace it
with a newer handoff) before the 2a pull request is opened.

**Where things stand in one line:** Phase 1 is built, verified and stacked as
three open PRs; Phase 2's design is settled and written up; this branch exists;
nothing in Phase 2 has been coded yet.

---

## Setting up a new machine

Nothing below lives in git except this file, so a fresh laptop needs:

1. **Clone and switch**

   ```
   git clone https://github.com/AlaskaAirlines/auro-ai.git ~/Desktop/Alaska-Dev/auro-ai
   cd ~/Desktop/Alaska-Dev/auro-ai
   git switch 'jjones/phase-2a/AB#1658228'
   npm ci
   ```

2. **GitHub** — `gh auth login` as **`jordanjones243-auro`** (MAINTAIN on the
   repo; scopes `repo`, `read:org`, `workflow`, `gist`). The old account
   `jordanjones243` was restored by GitHub but is no longer the working one.

3. **Azure DevOps** — export `ADO_PAT` in **`~/.zshenv`**, not `~/.zshrc`. On
   the old machine it lived in `.zshrc`, so non-interactive shells (which is
   what Claude Code runs) saw a stale value and got HTTP 401.

4. **Install the `auro` plugin from this checkout, not the marketplace.** The
   GitHub marketplace serves `main`, which has no `coding-standards` skill.

   ```
   claude plugin marketplace add ~/Desktop/Alaska-Dev/auro-ai
   claude plugin install auro@auro-ai
   ```

   A directory-sourced marketplace loads **in place from the working tree**, so
   the skill follows whatever branch is checked out. Restart Claude Code, then
   confirm it serves 15 rules:

   ```
   grep -c '^### CS-' plugins/auro/skills/coding-standards/references/*.md | awk -F: '{s+=$2} END {print s}'
   ```

5. **What does not come with you** — all of it on the old machine only:

   | What | Matters? |
   |---|---|
   | `.s5-scratch/` (git-excluded) — earlier handoffs, the 2026-10-06/07 edit scripts, and the pre-edit copy of every TRD, PR and ADO text changed | Only to **roll back** one of those edits. Copy it across if you want that: `tar czf s5-scratch.tgz -C ~/Desktop/Alaska-Dev/auro-ai .s5-scratch` |
   | Local `backup/*` branches from the restacks | No — the stack is verified and pushed |
   | Claude Code's memory notes for this project | No — this file carries what they held |

---

## Start here

- This branch is cut from #55's tip, so it carries all of Phase 1: the
  `coding-standards` skill, 15 rules, the validator and its 41-case suite, and
  the trigger scorer. It has no Phase 2 commits yet — only this file.
- **Read [#57](https://github.com/AlaskaAirlines/auro-ai/discussions/57) before
  coding.** It is the authority; the summary below is not.

**First commit of 2a** — step 1 of #57 §4: add `capture-standard` to
`EXCLUDED_SKILLS` in both `scripts/build-copilot-prompts.mjs` and
`scripts/build-copilot-agents.mjs`, run `npm run build:copilot:all`, confirm
zero diff, commit alone. Then `capture.sh` (step 2). Steps 1–7a are 2a; step 8
is 2b.

---

## Phase 2 — the design, in brief

`capture-standard` is a skill. **An overarching release-prep skill runs it**
(with release notes and other release-prep skills) when an `rc` branch is
merged into `main`. It:

1. takes the branch being released (or an explicit `<from>..<to>` range for
   testing and recovery);
2. finds tickets via `compare main...<branch>` — `create-rcs` repo mode's
   exact logic — plus `Merge pull request #N` for PR-named post-mortems;
3. locates lessons sections deterministically (level-agnostic,
   case-insensitive; see #57 §2.1 for every heading variant) and lets the
   model extract candidates;
4. dedupes in batch, then against the corpus, read from `--corpus-ref`
   (default `main`; use the Phase 1 stack until Phase 1 reaches `main`);
5. previews in chat and asks **one** confirmation;
6. on yes: opens or updates **one** PR against `auro-ai` (branch
   `capture/<repo>-<branch>`), and creates a **Committed** User Story to review
   it in the sprint containing the run date, area path
   `E_Retain_Content\Auro Design System\auro-ai`, tag `coding-standards-capture`.

**Decided 2026-10-07 in a meeting between Jordan and Jason Baker:**

- **No model in CI** — not possible in this organisation. Hence the
  release-prep design above. (A CI design was drafted and withdrawn the same
  day; #57's history shows it.)
- **Capture omits `disable-model-invocation`.** A skill with that flag cannot
  be called by another skill — Claude Code blocks it (verified against the
  docs). Narrow description plus the confirmation contains the risk. This
  **reverses parent Q4**.
- **Phase 2 starts before the Phase 1 gate review** — approved by the team
  lead. Recorded in #46 (revision 30, at the hard gate) and #57's status.
- **Points:** Phase 2 = 13, 2a = 8, 2b = 5.

**Not Phase 2 — the release-prep skill itself** (#57 OQ-9). It cannot call
any skill that sets `disable-model-invocation: true`, which today includes
**`release-notes`**. Jordan is fine removing that flag; history shows no
reason for it on any skill except `code-review` (expensive, posts to GitHub).
Remove it from `release-notes` only, with a narrow description, when
release-prep work starts. Leave the other skills alone.

**Universality** (from parent Phase 1, never run) is carried into **2b**.

---

## Work items

| | ADO | State | Sprint | Points |
|---|---|---|---|---|
| Phase 2 | [AB#1658227](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1658227) | Active | 21.26 | 13 |
| 2a build | [AB#1658228](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1658228) | Committed | 21.26 | 8 |
| 2b verify | [AB#1658229](https://dev.azure.com/itsals/E_Retain_Content/_workitems/edit/1658229) | New | 22.26 | 5 |

Parent of Phase 2 is the Feature **AB#1642023**. Phase 1: AB#1642074 and
AB#1643440 are *Ready For Acceptance*; AB#1643439 is *Closed*.

## GitHub

| | What | State |
|---|---|---|
| #46 | parent TRD | revisions 25–30 added 2026-10-06/07 |
| #47 | Phase 1 TRD | corrected 2026-10-06; §4.3 records the integration-branch rename |
| #48 | Phase 1a trigger log | unchanged apart from the rename |
| #49 | Phase 1b gate evidence | gate review requested 10-05; **no response yet**. No longer blocks Phase 2 |
| #57 | **Phase 2 TRD** | current |
| #39, #40, #43 | the **original** TRDs and trigger log, from the old account | **restored** by GitHub after 09-28; marked superseded → #46/#47/#48 and **locked** 2026-10-07 |
| PR #41, #44 | the original Phase 1a PRs | **restored**; closed as superseded by #50/#51 on 2026-10-07, review history kept |
| PR #50 | Phase 1 machinery → `coding-standards-integration` | open, green, no human review |
| PR #51 | pilot rules → #50's branch | open, green, no human review |
| PR #55 | Phase 1b → #51's branch | open, green, no human review |

**Integration branch: `coding-standards-integration`** — renamed from the
Phase-1-only branch on 2026-10-07 to cover the whole project (#47 §4.3). It sits
at the same commit as `main` as of that date; #50 targets it. The old name was
replaced everywhere it could be — repo, PRs, Discussions, ADO — except three
notes that explain the rename and one 09-17 commit message.

**The stack:** `coding-standards-integration` ← #50 ← #51 ← #55 ← **this
branch**. Phase 1 stays unmerged, with no date for `main`. On 10-06 the stack
was rebased onto current `main` (conflicts in `marketplace.json` and the drift
gates resolved in `main`'s favour); if `main` moves again, the same restack may
be needed before Phase 1 lands.

---

## Gotchas learned

- **The auto-mode classifier blocks branch rewrites** (`branch -f`, `rebase`)
  as destructive. Jordan runs the first command himself; continuing a rebase
  and `--force-with-lease` pushes have then gone through.
- **`git branch -f <b> origin/main` silently sets `<b>`'s upstream to
  `origin/main`.** Reset it with `git branch --set-upstream-to=origin/<b> <b>`
  before any bare `git push`.
- **ADO strips anything shaped like an HTML tag from Markdown fields** —
  `<repo>` vanished from a description on 10-06. Never put angle brackets in
  ADO text.
- **ADO only creates a User Story as `New`.** Committed is a second PATCH.
  Matters for D14.
- **Sandbox:** `gh` cannot read its config, `dev.azure.com` is unreachable,
  and `.git` writes fail — those commands need the sandbox disabled. `sed -i`
  and heredoc temp files also fail inside it.
- **zsh gotchas:** a bare `====` argument is read as a command lookup (quote
  it), and `$VAR:r…` applies a modifier — write `${VAR}:refs/…` in refspecs.
- **Older git (2.37) has no `merge-tree --write-tree`.** Use the three-argument
  form with the merge base to test a merge.
- **Edit TRDs and tickets with anchored replacements** — each one must match
  exactly once, and ADO PATCHes should carry a `test` on `/rev` — and save the
  original before writing.
