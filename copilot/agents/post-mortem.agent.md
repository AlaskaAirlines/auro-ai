---
name: post-mortem
description: 'Author or refresh a post-mortem for a piece of work, keyed to an Azure DevOps ticket. Prompts for the ADO ticket number (offering to reuse the ticket from the most recent post-mortem), then gathers context from the current git branch (commits + diff vs. its base), this session''s conversation, the ADO work item, and any linked Technical Research Document (TRD). It cross-checks the ticket''s requirements and acceptance criteria against the actual code changes to determine which parts were resolved and which were not. It composes a structured post-mortem — Executive Summary (with a link to the ADO ticket), optional TRD link, The Problem, Root Cause, The Fix, Why This Works, Outcome, Ticket Completeness (what the ticket asked for and what the change did/didn''t resolve), Learnings, and any failed iterations — then writes it to docs/post-mortem/<ticket>.md and publishes it as a GitHub Discussion in the repo''s "Post Mortems" category. On auro-formkit it also applies a discussion label for each component the post-mortem mentions. If a file or discussion already exists for the ticket, it updates them in place instead of creating duplicates.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/post-mortem/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "[ADO ticket #]" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **post-mortem** skill. The invocation itself is the request: **begin immediately** and run the steps below **in order** — don't skip a step and don't reorder them. Most steps read from git, GitHub, Azure DevOps, and the conversation; the **only** mutating side effects are (1) writing/updating `docs/post-mortem/<ticket>.md`, (2) creating/updating one GitHub Discussion in the "Post Mortems" category, and (3) applying component labels to that discussion (auro-formkit only). It **never** commits, pushes, tags, edits any other file, or touches Azure DevOps (ADO is read-only enrichment here).

**Fresh start.** Each `/post-mortem` invocation is a clean slate. Do not carry a `TICKET`, gathered content, or draft from a previous run — rebuild everything from this run's git reads, ADO fetch, TRD fetch, and conversation. The only pre-existing content you may reuse is what you fetch fresh in this run and the existing `docs/post-mortem/<ticket>.md` (when updating).

**`${input}`** = the text after `/post-mortem`, trimmed (empty if none): an optional ADO ticket number (digits, optional leading `#`/`AB#`).

### Azure DevOps access (PAT) — enrichment only

ADO context is **best-effort** in this skill: it enriches The Problem and Executive Summary but is **not required**. Do **not** hard-stop if it's unavailable — warn once and continue from git + conversation.

Every ADO REST call authenticates with a **Personal Access Token** in the `ADO_PAT` environment variable via HTTP Basic auth with an **empty username**: `curl -u ":$ADO_PAT"` (org `itsals`, project `E_Retain_Content`).
- **Before the first ADO call,** check the token is present: `[ -n "$ADO_PAT" ]`. If empty, note *"⚠️ No `ADO_PAT` set — writing the post-mortem without ADO ticket context. (Set a PAT with Work Items **Read** scope from https://itsals.visualstudio.com/_usersSettings/tokens and `export ADO_PAT=<token>` to include it.)"* and continue.
- **Detect auth failures, don't mistake them for missing data.** ADO answers an unauthenticated/insufficient request with its sign-in **HTML page** (HTTP 203, or a body starting with `<!DOCTYPE` / containing `Azure DevOps Services | Sign In`) or a 302/401. Treat that as an auth failure (missing/expired/under-scoped PAT), warn as above, and continue — never report it as a missing ticket.
- **Never** print the PAT, echo `$ADO_PAT`, or write it to a file — always reference it as the `$ADO_PAT` variable. Capture the HTTP status to tell success from a bounce, e.g. `-o /tmp/pm_ado.json -w "%{http_code}"`, and confirm `200`.

### Shell constraints

This skill runs in a **non-interactive, sandboxed shell** that rejects `$(...)` command substitution and `<<'EOF'` heredocs. For any multi-line body (GraphQL queries, JSON payloads), **write it to a file under `/tmp` with the Write tool** and pass it by reference:
- GraphQL: `gh api graphql -F query=@/tmp/pm_query.graphql -f var=value`
- ADO POST/PATCH: `curl ... --data @/tmp/pm_payload.json`

GitHub **Discussions have no REST API** — every discussion read/create/update/label operation must go through `gh api graphql`.

---

## Step 0 — Preconditions & repo detection

1. Resolve the repo root: `git rev-parse --show-toplevel`. Verify GitHub auth with `gh auth status` — if it fails, stop and tell the user to run `gh auth login` (the discussion step needs it).
2. Identify the current repo: `gh repo view --json nameWithOwner -q .nameWithOwner` → `REPO` (e.g. `AlaskaAirlines/auro-formkit`). Set `IS_FORMKIT = (REPO == AlaskaAirlines/auro-formkit)`.
3. The post-mortem lives at `docs/post-mortem/<ticket>.md` (relative to the repo root). The folder already exists in a set-up repo; writing the file will create it if needed.

---

## Step 1 — Resolve the ticket ID (with a reuse option)

1. **From the argument:** strip a leading `#`/`AB#` from `${input}`; if what remains is all digits → `TICKET` = that number. Skip to Step 2.
2. **Offer the previous ticket:** if `${input}` is empty, `Glob docs/post-mortem/*.md`. If any files exist, find the **most-recently-modified** one — `ls -t docs/post-mortem/*.md` and take the first — and parse its ticket ID from the filename (`<ticket>.md`). Ask with `AskUserQuestion`: reuse that ticket, or enter a different one. (No persisted state is needed — the last run's file *is* the most recent one.)
   - Reuse → `TICKET` = that number.
   - Different / no files exist → prompt: *"What's the ADO ticket number for this post-mortem?"* Strip a leading `#`/`AB#`; if all digits → `TICKET` = that number; otherwise say it isn't a valid ticket number and ask again, looping until you get one (or the user cancels → stop).

Record `TICKET` (digits only). The ADO work-item link is `https://itsals.visualstudio.com/E_Retain_Content/_workitems/edit/<TICKET>`.

---

## Step 2 — Gather context (all read-only)

Collect from **all four** sources; you'll synthesize them in Step 3.

**2a — Git (the change itself).**
- Resolve the base branch: `git rev-parse --abbrev-ref origin/HEAD` (fall back to `origin/main`, then `main`). Call it `BASE`.
- Find the merge-base: `git merge-base <BASE> HEAD` → `MB`.
- Read the commits on this branch: `git log <MB>..HEAD --format=%H%x1f%s%x1f%b` (subjects + bodies — the bodies often describe root cause and abandoned attempts).
- Read the diff: `git diff --stat <MB>..HEAD` for the shape, then `git diff <MB>..HEAD` (open specific files with Read only when a hunk needs surrounding context).
- Derive components from touched/referenced paths: `components/<name>/...` → `auro-<name>`. Record this **component set** — it drives the discussion labels in Step 5. Note components referenced (imports, slotted peers) as well as those directly changed.

**2b — ADO ticket (best-effort enrichment).** If `ADO_PAT` is present, fetch the work item:
```
curl -sS -u ":$ADO_PAT" \
  -o /tmp/pm_ado.json -w "%{http_code}" \
  "https://itsals.visualstudio.com/E_Retain_Content/_apis/wit/workitems/<TICKET>?api-version=7.0"
```
On `200`, read `System.Title`, `System.Description`, and `Microsoft.VSTS.Common.AcceptanceCriteria` from `/tmp/pm_ado.json` (fields live under `.fields`) — use them to ground The Problem and the Executive Summary. On a missing token, non-200, or auth-bounce HTML, warn once (per the PAT rules above) and continue without ADO content.

**Extract the ticket's discrete requirements.** From `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria`, decompose the ticket into an itemized checklist of what it actually asked for — each acceptance-criterion line, bullet, or numbered item becomes one requirement; split compound statements into separate items. Record this **requirement set** — you'll check each one against the diff in Step 3 to build the Ticket Completeness section. If ADO was unavailable, note that requirement coverage can't be assessed from the ticket (fall back to any requirements stated in the TRD or the conversation).

**2c — TRD (auto-detect, else ask).** A TRD is a **GitHub Discussion**. Look for its URL, in order, in: the ADO description/acceptance-criteria fetched in 2b; an existing `docs/post-mortem/<TICKET>.md` (if one is present); and the branch commit messages from 2a. URLs look like `https://github.com/orgs/AlaskaAirlines/discussions/<n>` or `https://github.com/<owner>/<repo>/discussions/<n>`.
- **Found →** fetch its content via GraphQL. Org-level discussions are only reachable via GraphQL scoped to their **backing repository** — `gh api orgs/.../discussions/<n>` will not work. Query the repository's discussion by number for its `title` and `body`. If the fetch fails, keep the **link** but note the body couldn't be read.
- **Not found →** ask the user once: *"Is there a Technical Research Document (TRD) for this work? Paste its GitHub Discussion URL, or reply `none`."* Use the URL if given; `none` → no TRD.
- **No TRD →** omit section (c) entirely in Step 3.

**2d — Conversation.** Fold in what this session established that isn't in git or ADO: the problem framing, the root cause, why the fix is correct, results, and especially **approaches that were tried and abandoned** (these become the "Iterations That Didn't Work" section). Do not invent details you can't source from git, ADO, the TRD, or the conversation.

---

## Step 3 — Compose the post-mortem

**First, assess ticket completeness.** Take the **requirement set** from Step 2b (plus any requirements from the TRD or conversation) and check each item against the actual code changes (the diff/commits from Step 2a and the results established in this session). Classify every requirement as one of:
- **Resolved** — the change demonstrably satisfies it (cite the file/mechanism that does so).
- **Partially resolved** — some of it is addressed but a gap remains (say what's missing).
- **Not resolved** — the change does not address it (say so plainly).

Do not mark a requirement resolved unless the diff or a verified session result actually supports it — when in doubt, mark it partial or not resolved and note the uncertainty. This classification feeds the Ticket Completeness section below.

Write for two audiences, as marked. Non-technical sections target Product Managers and leadership — plain language, no code identifiers. Technical sections are for engineers and AI tools. Use this structure exactly (Markdown):

- **(a) Title** — H1 = `# AB#<TICKET>` (the ticket ID; the `AB#` prefix keeps the discussion searchable).
- **(b) Executive Summary** — `## Executive Summary`. A brief, **non-technical** explanation of what changed, for PMs and leadership. Include the ADO link: `[AB#<TICKET>](https://itsals.visualstudio.com/E_Retain_Content/_workitems/edit/<TICKET>)`.
- **(c) Technical Research Document** — `## Technical Research Document`. A link to the TRD Discussion (and a one-line summary if its body was fetched). **Omit this whole section if there is no TRD.**
- **(d) The Problem** — `## The Problem`. **Non-technical** explanation of the problem this work solved.
- **(e) Root Cause** — `## Root Cause`. The cause in the code — files, functions, and the mechanism, grounded in the diff/commits.
- **(f) The Fix** — `## The Fix`. What the change does in the code.
- **(g) Why This Works** — `## Why This Works`. Additional context for why The Fix is correct (invariants restored, edge cases covered, why alternatives were rejected).
- **(h) Outcome** — `## Outcome`. **Non-technical** results of the change set.
- **(i) Ticket Completeness** — `## Ticket Completeness`. The requirement-by-requirement assessment from the analysis above, showing which parts of the linked ticket the change resolved and which it did not. Present it as two labeled lists (plain language, so PMs can read it): **Resolved** — each satisfied requirement with a one-line note on how; and **Not Resolved / Partial** — each unmet or partially-met requirement with a one-line note on what's missing. If everything was resolved, say so explicitly and omit the second list. Open the section with a one-line summary (e.g. "3 of 4 acceptance criteria resolved"). **If ADO was unavailable and no requirements could be sourced from the TRD or conversation, replace the lists with a single note that ticket completeness couldn't be assessed because the ticket's requirements weren't accessible.**
- **(j) Learnings** — `## Learnings`. A bulleted list of important takeaways for humans and AI tools.
- **Iterations That Didn't Work** — `## Iterations That Didn't Work`. Fixes/changes that were tried and abandoned, and why. **Omit if none surfaced** from the commits or conversation.

Keep it precise and consumer-facing where marked; no filler.

---

## Step 4 — Write or update the file

Target: `docs/post-mortem/<TICKET>.md` (repo-root-relative).
- **If it exists** (`Glob`/`Read` it first), refresh it in place with the regenerated content — preserve any manual edits that still hold, and keep the same path.
- **Otherwise** `Write` a new file.

Report the path and whether it was created or updated.

---

## Step 5 — Publish or update the GitHub Discussion (GraphQL only)

All operations use `gh api graphql`. Write each query/mutation to a `/tmp/*.graphql` file and pass it with `-F query=@...`; pass variables with `-f`/`-F`.

**5a — Resolve the repository and the "Post Mortems" category.** Query the repo id and its discussion categories:
```
query($owner:String!,$repo:String!){
  repository(owner:$owner,name:$repo){
    id
    discussionCategories(first:50){ nodes{ id name } }
  }
}
```
Call it with `-f owner=<owner> -f repo=<name>` (split `REPO`). Match a category whose name equals **"Post Mortems"** case-insensitively (tolerate `Post-Mortems` / `Post Mortem`). **If none matches,** skip Step 5, and in the final report tell the user the discussion was not created because the repo has no "Post Mortems" discussion category (the file was still written).

**5b — Find an existing discussion for this ticket.** Use GraphQL `search` scoped to the repo and category, matching the title on `AB#<TICKET>`, e.g. query `search(query:"repo:<owner>/<name> in:title AB#<TICKET>", type:DISCUSSION, first:10)` and keep any result whose `category.name` matches "Post Mortems" and whose title contains `AB#<TICKET>`. Record its `id` and `number` if found.

**5c — Create or update.** Use the same body as the file (the full post-mortem markdown) and title `AB#<TICKET> — <short descriptive title>`.
- **Found →** `updateDiscussion(input:{discussionId:$id, title:$title, body:$body})`.
- **None →** `createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body})`.

Pass the body via a `-F` file variable to avoid quoting problems (write the markdown to `/tmp/pm_body.md` and reference it, e.g. `-F body=@/tmp/pm_body.md`). Record the returned discussion `url`.

**5d — Component labels (auro-formkit only).** If `IS_FORMKIT`:
- Fetch the repo's discussion-capable labels: `repository(...){ labels(first:100){ nodes{ id name } } }`.
- For each component in the Step 2a component set (`auro-<name>`), find a label whose name matches the component (try `auro-<name>` and bare `<name>`, case-insensitively). Collect the label ids that exist.
- Apply them in one call: `addLabelsToLabelable(input:{labelableId:$discussionId, labelIds:$ids})`.
- Report which labels were applied and list any component with **no** matching label (don't create labels).
- If `IS_FORMKIT` is false, skip labeling entirely.

Handle GraphQL/permission errors gracefully — if a call fails (e.g. the token lacks discussion write scope), report what failed and that the file was still written; don't crash the run.

---

## Step 6 — Report

Tell the user concisely:
- The file path and whether it was **created** or **updated**.
- The discussion **URL** and whether it was **created** or **updated** (or why it was skipped — no "Post Mortems" category, or a GraphQL error).
- Labels applied, and any mentioned component that had no matching label (auro-formkit).
- Anything degraded: no TRD (section omitted), ADO unavailable (no ticket context), etc.

Do not commit or push — hand control back to the user.
