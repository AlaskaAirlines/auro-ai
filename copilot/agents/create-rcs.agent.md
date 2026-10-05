---
name: create-rcs
description: 'Build a Release Candidate Summary (RCS) from the Auro Design System Azure DevOps board for a chosen sprint iteration. It prompts for which iteration to summarize, defaulting to the current sprint, then gathers the work items whose Iteration Path is that sprint — scoped to items under `E_Retain_Content\Auro Design System`, excluding the Test Case/Test Plan/Test Suite/Epic/Feature/Initiative/Design Story/Task work item types, limited to items whose State is Committed/Blocked/Active/Ready For Acceptance/Resolved/Closed, and excluding anything tagged `auro-rcs` (so a re-run never gathers the skill''s own Release tickets) — and lists them grouped by the Area Path they sit in, collapsing any area under `E_Retain_Content\Auro Design System\auro-formkit` into a single `auro-formkit` group. It then plans a `Release <area> - <iteration>` User Story per area — set to the iteration, on the area''s path, State Blocked, Target Date set to the iteration''s last day, tagged `auro-rcs`, with Predecessor links to every ticket in that area and child `Generate Release Notes` and `Update Dependencies` Tasks. Whenever the sprint plans any non-`AuroDocsSite` Release ticket, an `AuroDocsSite` Release ticket is always planned too (even if the `AuroDocsSite` area has no sprint tickets): it keeps its own area''s tickets as Predecessors, is additionally Predecessor-linked to every other area''s Release ticket, and its Acceptance Criteria lists an `@aurodesignsystem/<area>` dependency-update checkbox for each of those other releases. Before creating anything it reconciles existing links: a predecessor already linked (via the `auro-rcs` tag) to a Release ticket in another sprint can be moved to this sprint''s ticket, and an area already linked to a this-sprint Release ticket can reuse it instead of creating a duplicate. The skill plans the full change set, shows it, and writes to Azure DevOps — creating work items and adding/removing links — only after the user confirms at a submit gate. Optionally pass an npm package (e.g. `@aurodesignsystem/auro-button`) to run in repo mode: instead of gathering the sprint''s tickets by area, it plans a single Release ticket for that repo''s area whose Predecessors are every ticket referenced (`AB#<id>`) by a commit on the repo''s `dev` branch that is not yet on `main`, plus every ticket under the repo''s area currently Committed/Blocked/Active/Ready For Acceptance (any iteration). The `AuroDocsSite` companion ticket is still planned; a reused one has just that package added to its dependency checklist.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/create-rcs/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "[npm package, e.g. @aurodesignsystem/auro-button]" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.
>
> **Bundled scripts:** this workflow runs scripts from your local `auro-ai` checkout at `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/`. Set `AURO_AI_HOME` to the checkout path before invoking it; if it is unset, ask the user for the path.

## Task — start now

Build the RCS by running the steps below **in order**. Step 0 reads the optional repo argument and picks the mode: **sprint mode** (no argument — gather the sprint's tickets by area) or **repo mode** (an npm package — gather one repo's unreleased and in-flight tickets). Step 1 prompts the user to pick an iteration (defaulting to the current sprint) — ask, wait for the reply, and resolve it before continuing. **Steps 1–2 and the planning phase of Step 3 are strictly read-only** against Azure DevOps (org `itsals`, project `E_Retain_Content`). Step 3 then **plans** every change — new Release work items plus any link add/removes from reconciliation — shows the user the full change set, and **writes to Azure DevOps only after the user confirms at the submit gate**, at which point it creates work items and adds/removes links. **Send no `POST`/`PATCH` before that gate.**

**How to run each step.** All of the shell work lives in the bundled script `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh`; each step below is one call to it. Run every command **exactly as written** — one `rcs.sh` call per Bash invocation, the path unquoted, and nothing added: no `cd`, no `VAR=value` prefix, no `&&`/`;` chains, no pipes or redirects. The skill's permission rule approves only that exact command shape, so anything extra needs manual approval (and in auto mode may be blocked). Put user-supplied text in **single quotes** (escape an embedded `'` as `'\''`). Steps hand state to each other through `/tmp/rcs_*` files, so there are no variables to carry between calls. Never write ad-hoc `curl` calls against Azure DevOps — if a step needs something the script doesn't do, stop and tell the user.

**Azure DevOps access (PAT).** Every ADO REST call authenticates with a **Personal Access Token** in the `ADO_PAT` environment variable via HTTP Basic auth with an **empty username** (the script does this; it never prints the token).
- **Missing token.** Any command that calls ADO prints `ADO_PAT_MISSING` and stops if `ADO_PAT` is empty. Then tell the user: *"No Azure DevOps token found. Create a PAT at https://itsals.visualstudio.com/_usersSettings/tokens with **Work Items (Read & Write)** scope (Read is enough for Steps 1–2 and Step 3's planning phase; Write is required only when you confirm submission), then `export ADO_PAT=<token>` in your shell and re-run."*
- **Auth failures aren't empty results.** ADO answers an unauthenticated/insufficient request with its sign-in **HTML page** (HTTP 203) or a 302/401. The script turns any non-`200` on its query calls into `ADO_AUTH_FAILURE — … HTTP <code>`. Treat that (or any output that's plainly HTML instead of data) as an **auth failure** — the PAT is missing, expired, or lacks scope — and show the same PAT guidance above. Never report it as an empty sprint or invent `az login` commands.
- **Never** print the PAT, echo `$ADO_PAT`, or write it to a file.

**GitHub access (repo mode only).** Repo mode reads the repo's branches and commits through the `gh` CLI (read-only `gh api` GETs). If the script prints `GH_AUTH_MISSING`, stop and tell the user: *"Repo mode needs the GitHub CLI signed in — run `gh auth login`, then re-run."*

---

## Step 0 — Choose the mode (optional repo argument)

`${input}` = the text after `/create-rcs`, trimmed.
- **Empty → sprint mode.** Run `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh mode` (it prints `SPRINT_MODE` and clears any stale repo-mode marker from an earlier run), then go to Step 1.
- **Non-empty → repo mode.** It names the repo by npm package: `@scope/name` (e.g. `@aurodesignsystem/auro-button`), or a bare `name`, which means `@aurodesignsystem/<name>`. Run:
  ```bash
  $AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh mode '<the argument>'
  ```
  It looks up the package's GitHub repo in the npm registry, falling back to `AlaskaAirlines/<name>` if the registry has no repository URL. It then checks that the repo and its `dev` and `main` branches exist, and matches the repo to its ADO area under `E_Retain_Content\Auro Design System`. To match, it compares the GitHub repo name and then the package's base name, case-insensitively, against the area names, so `Icons` → `icons` and `AuroDesignTokens` match without a map.

Handle the results:
- **`GH_AUTH_MISSING`**: stop (see GitHub access).
- **`REPO_NOT_FOUND`**: tell the user no GitHub repo could be found for that package and ask them to check the name. Stop.
- **`BRANCH_MISSING`**: tell the user `<repo>` has no `dev` (or `main`) branch — the `branch …: MISSING` line says which — so there is nothing to compare. Stop.
- **`ADO area: NO_MATCH`**: the script lists the area names under Auro Design System. Ask which one the repo releases under, then run `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh repo-area '<their pick>'`. (`NO_SUCH_AREA` means the pick isn't on the list — show the list again and re-ask.)

`REPO_MODE_OK` means the repo-mode marker is written (`/tmp/rcs_repo.tsv`: package, GitHub repo, ADO area, published-on-npm). Tell the user, e.g. **"Repo mode: `<PKG>` → `<GH_REPO>` (ADO area `<REPO_AREA>`). I'll gather tickets referenced by commits on `dev` that aren't on `main`, plus `<REPO_AREA>` tickets currently Committed/Blocked/Active/Ready For Acceptance."** Then go to Step 1. In repo mode the chosen iteration only sets the Release ticket's Iteration Path and Target Date. It does **not** filter which tickets are gathered.

---

## Step 1 — Choose the iteration (sprint), defaulting to current

Fetch the project's iterations and present the active sprints:
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh iterations
```
It prints a numbered list, most recent first, with the sprint containing today marked `← current`. (The list is top-level sprints only; the Archive / Content Migration folders are left out but still resolvable by name.)

Present that numbered list to the user and ask: **"Which iteration should I summarize? Reply with a number from the list, a sprint name, or `current` — the default is the current sprint, so reply `current` (or just confirm) to use it. Older sprints not shown (the Archive) can be selected by name."**

**Resolve their reply** by passing it through verbatim (pass `current` for an empty reply or a plain confirmation):
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh iter-select '<what the user replied>'
```
- **A number `N`** → entry `N` of the list. **A name (or partial name)** → matched case-insensitively against every dated iteration, archive included. **`current`** → the entry whose range contains today.
- **`NO_MATCH`** → tell them and re-ask. **`MULTI: …`** → show the matches and ask them to narrow it. **`NO_CURRENT`** → today falls in no iteration; ask them to pick from the list. **`OUT_OF_RANGE`** → the number isn't on the list; re-ask.
- On success it prints `ITERATION`, `DATES`, and `ITER_PATH`, and saves them to `/tmp/rcs_iter.tsv` for the later steps. `ITER_PATH` is the queryable Iteration Path, derived from the iteration's classification-node path (the leading backslash and the `Iteration` segment dropped, e.g. `\E_Retain_Content\Iteration\Sprint 17.26 08.12-08.25` → `E_Retain_Content\Sprint 17.26 08.12-08.25`). Never guess it.

Tell the user which sprint you resolved, e.g. **"Summarizing **`<ITER_NAME>`** (`<START>` → `<FINISH>`) — gathering every work item assigned to that iteration."** In repo mode say instead: **"The `<REPO_AREA>` Release ticket will go in **`<ITER_NAME>`** (`<START>` → `<FINISH>`)."**

---

## Step 2 — Gather the iteration's work items, grouped by Area Path

**Repo mode skips this step and runs Step 2R instead.** (The same command runs both; it picks by the Step 0 marker.)

A WIQL query returns only work item **IDs**, so this runs in two stages: query for the IDs of the items whose Iteration Path is `ITER_PATH`, then batch-fetch each item's fields and group them by Area Path. The query is **scoped to items under `E_Retain_Content\Auro Design System`** (so bare-root ComMod/Content work sharing the sprint is excluded), **excludes the `Test Case`, `Test Plan`, `Test Suite`, `Epic`, `Feature`, `Initiative`, `Design Story`, and `Task` work item types**, is **limited to items whose State is one of `Committed`, `Blocked`, `Active`, `Ready For Acceptance`, `Resolved`, or `Closed`** (so `New`, `Approved`, `Design`, `Rejected`, `Removed`, and `Done` items are left out), and **excludes anything tagged `auro-rcs`**. The last two filters keep the skill's own output out of the gather on a re-run — the Release User Stories it creates are tagged `auro-rcs` and land on this sprint's path in State Blocked, and their child `Generate Release Notes` / `Update Dependencies` items are Tasks — so without them a second run would gather its own Release tickets and re-link them as predecessors.

```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh gather
```

It writes the rows to `/tmp/rcs_rows.tsv` (`id  type  state  assignee  area  title`) and prints them split into two top-level groups. Any area at or under `E_Retain_Content\Auro Design System\auro-formkit` collapses to a single `auro-formkit` sub-group; other areas have the constant prefix trimmed.

**Render the grouped list for the user.** Present it as **two top-level groups**, in the order the output emits them:
1. **`@@@ GROUP 1: Root … @@@`** — the tickets filed directly on the Auro Design System node. If there are none, say so and skip the section.
2. **`@@@ GROUP 2: By area … @@@`** — all other tickets, kept sub-grouped by area (each `=== <sub-group>  (<count>) ===` block, alphabetical, `auro-formkit` collapsed).

For each `=== <sub-group>  (<count>) ===` block, print a heading and a compact table of its work items with columns **ID · Type · State · Assigned To · Title**. Lead with a one-line summary of the total item count and how it splits across the two groups. If `fetched rows` is lower than the `work items in iteration` count, warn that some items couldn't be fetched. If the query returned zero items, tell the user the iteration has no eligible work items assigned to it. Then continue to Step 3.

---

## Step 2R — Gather the repo's unreleased and in-flight tickets (repo mode only)

Repo mode collects two sets of tickets and merges them:
1. **Unreleased.** Every ADO ticket referenced as `AB#<id>` (subject or body) by a commit on the repo's `dev` branch that is not on `main`. These come from GitHub's `main...dev` compare, paged through.
2. **In flight.** Every ticket under the repo's area path (`E_Retain_Content\Auro Design System\<REPO_AREA>`, sub-areas included) whose State is `Committed`, `Blocked`, `Active`, or `Ready For Acceptance`, **in any iteration**.

Both sets use the same exclusions as Step 2: no `Test Case`/`Test Plan`/`Test Suite`/`Epic`/`Feature`/`Initiative`/`Design Story`/`Task` items, and nothing tagged `auro-rcs`. Unreleased tickets have **no State filter**, because code on `dev` ships whatever state its ticket is in. They are also kept whatever area they're filed under. Commit-referenced tickets that get excluded, or that can't be fetched, are **listed, not silently dropped**.

```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh gather
```

It writes `/tmp/rcs_rows.tsv` in Step 2's exact format, but with **every row's area set to the repo's area**, so Step 3 plans one Release ticket for the repo. Its output has four sections: the tickets to release (`id / source / type / state / assigned / real area / title`, where source is `commit`, `in-flight`, or `commit+in-flight`), the commit references (`id / sha`), the skipped tickets (`id / reason / type / title`), and the commits with no `AB#` reference.

If the fetched commit count is lower than GitHub's `ahead` count, warn the user that some commits weren't read, so the ticket list may be incomplete.

**Render it for the user.** Start with one summary line: the number of commits on `dev` not on `main`, how many tickets they reference, how many in-flight tickets there are, and the total being released. Then show one table, **ID · Source · Type · State · Assigned To · Title**. Add an **Area** column only when a ticket's real area differs from `<REPO_AREA>`, so tickets filed elsewhere are easy to spot. After the table, list:
- the **skipped** tickets and why;
- the **commits with no `AB#` reference** (short sha and subject), since those changes ship without a ticket in this RC.

Skip either list if it's empty. **If zero tickets are left to release, stop:** tell the user there is nothing to release for `<PKG>` and write nothing. Otherwise continue to Step 3.

---

## Step 3 — Reconcile Release links, plan the changes, then submit on confirmation

For each **Group 2** area sub-group (skip the `(root)` group), the skill plans a parent **User Story** titled `Release <area> - <iteration>` plus its child **Tasks** `Generate Release Notes` and `Update Dependencies`. It runs in phases: **3A** builds the drafts and scans for existing links (read-only), **3B** shows the full change set, **3C** asks the user to confirm, **3D** performs the ADO writes only on a yes, and **3E** reports what changed. **Nothing is written to Azure DevOps before the 3C gate.**

**In repo mode** Step 2R has put every ticket under the repo's area, so Step 3 plans one Release ticket, for `<REPO_AREA>`, plus the `AuroDocsSite` companion described next (unless the repo *is* `AuroDocsSite`). Everything below applies unchanged, apart from three repo-mode differences:
- the Release ticket's description says where its predecessors came from;
- the docs dependency checklist uses the repo's real npm package name (none if the package isn't published);
- a **reused** `AuroDocsSite` ticket gets that one package **added** to its existing checklist. It isn't rebuilt, because repo mode knows only this repo, and a rebuild would drop the other sprint releases already listed.

**The `AuroDocsSite` Release ticket is always planned when any other area releases.** The Auro docs site depends on every Auro component, so whenever the sprint plans at least one non-`AuroDocsSite` Release ticket, an `AuroDocsSite` Release ticket is planned too — **even if the `AuroDocsSite` area has no sprint tickets of its own** (in which case it simply has no area-ticket Predecessors). Beyond its own area tickets, the `AuroDocsSite` Release ticket is **Predecessor-linked to every other area's Release ticket** this sprint (so it gates on all of them), and its **Acceptance Criteria** carries a dependency-update checklist — one `@aurodesignsystem/<area>` item per other release — for the version bumps that must ship with it. Because those other Release tickets don't exist until submit, the cross-release Predecessor links are added in 3D after they're created (the `AuroDocsSite` story is created last for this reason). Since a zero-ticket `AuroDocsSite` area is invisible to the successor-link scan below, 3A separately queries for an existing this-sprint `auro-rcs` `AuroDocsSite` Release ticket and reuses it rather than creating a duplicate on a re-run. Unlike other reused tickets (whose fields are left untouched), a reused `AuroDocsSite` ticket **has its Acceptance Criteria refreshed** in 3D from the freshly-built draft, so its dependency checklist always reflects the current sprint's releases.

Every Release ticket the skill creates is stamped with the tag **`auro-rcs`** (`System.Tags`). That tag is how the skill recognizes its *own* Release tickets when reconciling — it never treats an untagged or legacy "release"-titled work item as one of its Release tickets.

Each planned **parent User Story** carries:
- **Title:** `Release <area> - <ITER_NAME>` (`<area>` = the sub-group label, e.g. `auro-formkit`, `auro-hyperlink`, `AuroDocsSite`).
- **Work item type:** `User Story`.
- **Iteration Path:** `ITER_PATH` (the iteration being worked).
- **Area Path:** the sub-group's area — `E_Retain_Content\Auro Design System\<area>` (for the collapsed `auro-formkit` group this is exactly the `…\auro-formkit` node).
- **State:** `Blocked`.
- **Target Date:** `Microsoft.VSTS.Scheduling.TargetDate` = the iteration's last day (`FINISH`).
- **Tag:** `auro-rcs` (`System.Tags`) — the marker the skill uses to recognize its own Release tickets.
- **Predecessor links:** one `System.LinkTypes.Dependency-Reverse` (**Predecessor**) relation to **every** ticket in that area sub-group, so the release gates on all of them. **For the `AuroDocsSite` story only,** an additional Predecessor relation to **every other area's Release ticket** this sprint — added in 3D once those tickets exist.
- **Description** and **Acceptance Criteria** as drafted in 3A. **For the `AuroDocsSite` story only,** the Acceptance Criteria is prefixed with a **dependency-update checklist**: one NPM-package checkbox per other release this sprint. Package names default to `@aurodesignsystem/<area>` but come from an area→package map in the script that overrides exceptions — e.g. `WebCoreStyleSheets` → `@aurodesignsystem/webcorestylesheets`, `icons` → `@alaskaairux/icons`. Areas with **no published npm package** (a `nopkg` set in the script — e.g. `auro-ai`, a spike/tooling area) are **omitted from the checklist** but still get a Release ticket and a cross-release Predecessor link. On a **reused** `AuroDocsSite` ticket this checklist is refreshed at submit (3D); on a newly created one it is written with the rest of the fields.

**Large-text fields are written as Markdown, not HTML.** `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` default to HTML — which collapses the drafted line breaks, `**bold**`, and `` `code` `` into one unformatted run. So every payload that writes one of these fields also sends a companion `multilineFieldsFormat` op set to `Markdown`, and the create/update calls use **`api-version=7.1`** (7.0 silently ignores `multilineFieldsFormat` and stores the content as HTML). ADO only applies the format op when the field's value actually changes, so any later reformat of an existing ticket must send a changed value alongside the op.

Each **child Task** (`Generate Release Notes`, `Update Dependencies`) carries the same Area Path / Iteration Path and its own Markdown description. During planning (3A) the child payloads are written without a parent link; at submit time (3D) the parent story is created first, then each Task is created with a `System.LinkTypes.Hierarchy-Reverse` (**Parent**) link to the new story's id.

### 3A — Build the drafts and scan existing links (read-only)

**Build the drafts.**
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh plan
```
It first checks that `Blocked` is an allowed `User Story` State. On **`STATE_INVALID`** it lists the valid States and stops: ask the user which State to use for the Release stories, then re-run as `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh plan '<their State>'`. Otherwise it re-labels the fetched rows into area sub-groups (`/tmp/rcs_labeled.tsv`), works out the area set (forcing `AuroDocsSite` in, per above) and the docs dependency package list, writes the JSON-patch payloads per area under `/tmp/rcs_draft_*` — a parent User Story plus the two child Tasks — and prints a readable draft for each. It writes nothing to ADO. Show the user the drafts.

**Scan for existing Release links (read-only).**
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh scan-links
```
For every ticket being released it finds any link to one of the skill's own Release tickets (tag `auro-rcs`) and classifies it `this` (same iteration) or `other`. A ticket sits on the **Successor** side (`System.LinkTypes.Dependency-Forward`) of the link the skill creates, so that is what the scan follows. Results are printed and saved to `/tmp/rcs_links.tsv` (`area  ticketId  releaseId  releaseIter  class  releaseTitle`). It also resets the three decision files (`/tmp/rcs_reuse.tsv`, `/tmp/rcs_moves.tsv`, `/tmp/rcs_left.tsv`) to empty, so 3B/3D work even with nothing to reconcile.

**Decide reconciliation.** If the scan found no links, skip the prompts. Otherwise, using the scan output:
- **Scenario B — an area has a `this`-class link:** for each such area ask once: *"Some tickets in `<area>` are already linked to this-sprint Release ticket #`<id>` (`<title>`). Link ALL of `<area>`'s tickets to that ticket instead of creating a new Release ticket?"* On **yes**, run `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh decide reuse '<area>' <id>`. On **no**, do nothing (a new ticket is created; the pre-existing link is left, which may be an intentional dual-link).
- **Scenario A — a ticket has an `other`-class link:** for **each** such ticket ask: *"Ticket #`<ticketId>` is linked to Release #`<releaseId>` in `<releaseIter>` (not this sprint). Remove that link and link it to this sprint's `<area>` Release ticket instead?"* On **yes**, run `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh decide move <ticketId> <releaseId>`. On **no**, run `$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh decide leave <ticketId> <releaseId>`.

`decide` looks the rest of the row up from the scan and refuses (`NO_SUCH_LINK`) a pairing the scan didn't find. Recording the same answer twice is harmless.

**Reuse an existing `AuroDocsSite` Release ticket (read-only).** A forced `AuroDocsSite` area with no sprint tickets of its own never appears in the successor-link scan above, so on a re-run its existing ticket would be invisible and a **duplicate** would be created. Always run:
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh docs-reuse
```
If `AuroDocsSite` is in the area set and not already a reuse entry, it queries for an existing this-sprint `auro-rcs` `User Story` on the `AuroDocsSite` area path and, if one exists, records it for reuse. (A reused `AuroDocsSite` ticket has its Acceptance Criteria refreshed at submit time — see 3D — so its dependency checklist is not left stale; other reused tickets' fields are untouched.)

### 3B — Present the planned change set

Print exactly what the submit step would do (still no writes), then show it to the user:
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh preview
```

### 3C — Confirm gate

Show the 3B summary and ask the user in plain words: **"Submit these changes to Azure DevOps? (yes/no)"** — this creates the Release work items and applies the link changes above. If the user says anything other than an explicit **yes**, stop: write nothing and tell them the plan was discarded (then run 3E to print the "left linked" list). Only on an explicit **yes** run 3D.

### 3D — Apply the changes (only after an explicit "yes")

This is the **only** phase that writes to ADO, and `apply` is the only command that writes. **Never run it without the explicit "yes" from 3C.**
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh apply
```
It processes the areas with `AuroDocsSite` last, so every other Release ticket's id is known before the docs release is Predecessor-linked to them. For each area it either:
- **reuses** the recorded ticket — adding Predecessor links for the area's tickets not already linked to it, and for `AuroDocsSite` refreshing the Acceptance Criteria (repo mode: adding the one package to the existing checklist; an AC stored as HTML is left alone and reported as a failure to fix by hand) — or
- **creates** the parent story from its draft (fields, tag, and Predecessor links), then the two child Tasks with a Parent link to it.

For `AuroDocsSite` it then adds a Predecessor link to every other Release ticket, skipping ones already linked so re-runs are idempotent. Last, it removes each Scenario A "move" ticket's old out-of-sprint Successor link (guarded by a `rev` test so a concurrent edit fails instead of removing the wrong link). Results go to `/tmp/rcs_applied.tsv` and failures to `/tmp/rcs_apply_fail.tsv`; it ends with a success/failure count.

### 3E — Report what changed

Run after 3D (or straight after a "no" at 3C, when nothing was applied):
```bash
$AURO_AI_HOME/plugins/auro/skills/create-rcs/scripts/rcs.sh summary
```

Then summarize to the user in prose: how many Release tickets were created (with ids) or reused, which links were added/removed, any failures, and the list of tickets left linked to out-of-sprint Release tickets (or that none were). If the user declined at 3C, say plainly that nothing was written.
