---
name: pr
description: Open a GitHub pull request for the current branch — assigned to you, seeded from the repo's .github PR template. Prompts whether to target the repo's default branch or a branch you name, and whether the PR should be a draft or ready for review. On auro-formkit it applies a component label (auro-<name>) for every component touched by the PR's commits. In the description it adds one section per post-mortem ticket in the PR — the ticket's Executive Summary text plus a link to its "Post Mortems" GitHub Discussion — sourced from post-mortem files added on the branch and AB#<n> references in the commits. If a PR already exists for the branch, it refreshes that description block and adds any missing component labels instead of opening a second PR. Never pushes.
disable-model-invocation: true
argument-hint: "[base branch]"
allowed-tools: Bash(gh pr create *), Bash(gh pr list *), Bash(gh repo view *), Bash(gh auth status *), Bash(gh api *), Bash(git symbolic-ref *), Bash(git rev-parse *), Bash(git rev-list *), Bash(git merge-base *), Bash(git branch *), Bash(git ls-remote *), Bash(git status *), Bash(git fetch *), Bash(git log *), Bash(git diff *), Bash(git remote *), Bash(git config *), Read, Glob, Grep, Write(/tmp/*), AskUserQuestion
---

## Task — start now

You are executing the **pr** skill. The invocation itself is the request: **begin the workflow immediately** and walk through the steps below **in order**. Do not skip a step and do not reorder them. Several steps require a user prompt — ask it, wait for the reply, and branch on the answer before continuing.

> **Scope guardrail — open one PR, or refresh one existing PR; nothing more.** This skill's **only** mutating side effects are (a) a single `gh pr create` that opens **one pull request** (Step 11), (b) applying **component labels** to that PR (Step 11), and (c) — when a PR already exists for the branch and you explicitly opt in — refreshing **only** that PR's **description** post-mortem block and adding any **missing component labels** (Step 2). Every mutation happens only after you confirm. It must **NOT**, under any circumstance:
> - `git push`, force-push, or otherwise write to the remote — if the branch isn't already pushed, it **stops and tells the user to push** (Step 5);
> - commit, amend, stage, create/move/delete tags or branches, or edit any file in the repo (the only file it writes is a temporary PR body under `/tmp`);
> - mark a PR ready-for-review after creation, merge, close, or comment on one; **remove** labels; reassign an existing PR; or change an existing PR's title, base, reviewers, or draft state — the only permitted edits to an existing PR are the opt-in description refresh and additive labels in Step 2;
> - run any CI/release workflow.
>
> If any step seems to call for one of these actions, stop and hand control back to the user instead.

**The invocation takes one optional argument** — available as `$ARGUMENTS` (the text after `/pr`, trimmed; empty if none): an explicit **base branch** to target. If provided, it **pre-fills** the base-branch prompt in Step 3 (you still confirm it there); if empty, Step 3 prompts from scratch.

### Shell constraints

Treat the shell as **non-interactive and sandboxed**: avoid `$(...)` command substitution and `<<'EOF'` heredocs where a file will do. For any multi-line body (GraphQL queries, JSON payloads, the PR description), **write it to a file under `/tmp` with the Write tool** and pass it by reference (`-F query=@/tmp/…`, `--body-file /tmp/…`, `-F body=@/tmp/…`). The frontmatter grants `Write(/tmp/*)` for exactly this, so bodies containing backticks or `$` are never interpreted by the shell.

GitHub **Discussions have no REST API** — every discussion read/search operation must go through `gh api graphql`.

Work through the steps below in order.

---

## Step 0 — Preconditions

1. Confirm the GitHub CLI is authenticated: `gh auth status`. If it reports not-logged-in (non-zero exit), **stop** and tell the user: "GitHub CLI isn't authenticated — run `gh auth login`, then re-run `/pr`." Do not continue.
2. Resolve the repo root with `git rev-parse --show-toplevel` and treat all paths below as relative to it.
3. Identify the current repo: `gh repo view --json nameWithOwner -q .nameWithOwner` → `REPO` (e.g. `AlaskaAirlines/auro-formkit`). Split it into `<owner>/<name>`. Set `IS_FORMKIT = (REPO == AlaskaAirlines/auro-formkit)` — this gates component labeling (Steps 8 & 11).

---

## Step 1 — Determine the current branch

```
git symbolic-ref --short HEAD
```

Call this `<branch>`. (The same-branch guard against the base runs in Step 3, once the base is known.)

---

## Step 2 — Existing-PR check (offer to refresh it)

Check for an open PR on this branch **and fetch its body in the same call** so the refresh path needs no extra round-trip:

```
gh pr list --head <branch> --state open --json number,url,title,baseRefName,body,labels
```

If **none** exists, continue to Step 3 (create a new PR).

If one **already exists**, do **not** create a second PR. Ask the user whether to refresh it. Prompt with `AskUserQuestion`:

> An open PR already exists for `<branch>`: #<number> — <title> (<url>). Refresh its description's post-mortem section and add any missing component labels?

Options (exactly two):
- **Refresh it** — sync the post-mortem block and add missing labels (procedure below), then stop.
- **No — exit** — take no action whatsoever and end the workflow immediately.

If the user chooses **No — exit**, end now without touching the PR, the branch, or any file.

If the user chooses **Refresh it**, do exactly the following and nothing else (do **not** run Steps 3–12 — no new PR is created). This refresh **must not** reassign the PR, change its title, base, reviewers, or draft state, and **must not** remove any label:

1. **Build the post-mortem block** using the Step 6 + Step 7 procedure, but relative to the **existing PR's base** (`baseRefName` from the query above) rather than a freshly resolved default. If there are **no** post-mortem tickets, tell the user there is nothing to sync and **do not** blank or otherwise change the description — skip straight to the label sync in sub-step 4.
2. **Insert or replace — always overwrite, never diff-and-skip.** The block is wrapped in idempotency markers (`<!-- auro-pr:pm:start -->` / `<!-- auro-pr:pm:end -->`, invisible in GitHub's rendered view) so re-runs never stack copies:
   - If the fetched body **already contains** the markers, replace everything between them (inclusive) with the freshly built block. Exactly one such block must remain afterward.
   - Otherwise, insert the block **directly after the first Markdown header** in the body (the first line beginning with `#` that is **not** inside a fenced code block or an HTML comment); if the body has no header, prepend the block to the top.
   - Never rewrite unrelated parts of the body.
3. **Write it back via the REST API** — not `gh pr edit`, which issues a GraphQL query referencing the deprecated Projects-classic field and hard-errors on repos where Projects (classic) is enabled (see [cli/cli#11983](https://github.com/cli/cli/issues/11983)); the REST `PATCH .../pulls/<n>` endpoint has no such dependency and sends **only** the `body` field, leaving the PR's assignee(s), title, base, reviewers, labels, and draft state untouched. `gh api` auto-substitutes `{owner}` and `{repo}`, so pass them literally. Write the full updated body to `/tmp/pr-body-<branch>.md` with the **Write tool** (sanitize `<branch>` — replace `/` with `-`) and reference it:
   ```
   gh api --method PATCH repos/{owner}/{repo}/pulls/<number> -F body=@/tmp/pr-body-<branch>.md
   ```
4. **Add missing component labels** (auro-formkit only). If `IS_FORMKIT`, run Step 8 to derive the component set for this PR, then compare against the PR's current labels (from the query above) and **add only the ones not already present** via REST — never remove any:
   ```
   gh api --method POST repos/{owner}/{repo}/issues/<number>/labels -f "labels[]=<label>" [-f "labels[]=<label>" ...]
   ```
   Apply only labels that actually exist in the repo (Step 8 records which do). If `IS_FORMKIT` is false, skip labeling.
5. **Report** the existing PR's URL as a clickable link, how many post-mortem sections were synced, and which labels were added (if any), then **stop**. Do not create a new PR, do not push, do not make any other change.

---

## Step 3 — Resolve the base branch (prompt)

First resolve the repo's **default branch** as `<default>`, in this order (mirrors the code-review skill so a branch cut from a non-default base is still detected correctly):

1. `git symbolic-ref --short refs/remotes/origin/HEAD` → returns e.g. `origin/main`; strip the `origin/` prefix.
2. If that ref isn't set locally, run `git remote set-head origin --auto` once to populate it, then retry step 1.
3. If it still fails, fall back to `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`.

**Now prompt the user** with a plain-text question (not `AskUserQuestion`, so a branch name can be typed freely). If `$ARGUMENTS` is non-empty, mention it as the suggested answer:

> Which branch should this PR target? Reply **yes** to target the default branch (`<default>`), or type a branch name to target that instead.

Interpret the reply:
- **`yes`** (or `y`, `default`, or any clear affirmative) → `<base>` = `<default>`.
- **A branch name** → `<base>` = that name. Verify it exists on the remote: `git ls-remote --heads origin <name>`. If that returns nothing, tell the user the base branch wasn't found on `origin` and **re-prompt** (loop until you get `yes` or a branch that exists).

Record the resolved `<base>` (a plain branch name).

**Same-branch guard.** If `<branch>` **equals** `<base>`, **stop** — you can't open a PR from a branch into itself. Tell the user: "You're on `<branch>`, which is also the chosen base — switch to a feature branch or pick a different base, then re-run `/pr`."

---

## Step 4 — Prompt for draft vs. ready-for-review

Ask with `AskUserQuestion`:

> Should this PR be opened as a draft, or ready for review?

Options (exactly two):
- **Ready for review** — open a normal, review-ready PR.
- **Draft** — open as a draft PR.

Record the choice as `DRAFT` (true/false). It controls the `--draft` flag in Step 11 and is echoed in the confirmation (Step 10).

---

## Step 5 — Remote/push guard (never push)

A PR can only be created from a branch that already exists on the remote, and its head must match what's pushed. **This skill never pushes** — it verifies and stops if the branch isn't ready.

1. Warn about work that won't be in the PR: if `git status --porcelain` shows uncommitted changes, note that they won't be included (only committed, pushed work is) — but continue; do not block.
2. Confirm the branch is on `origin` and update its tracking ref in one call:
   ```
   git fetch origin <branch>
   ```
   If this **fails** (e.g. `couldn't find remote ref <branch>`), the branch was never pushed — **stop** and tell the user:
   > ⚠️ `<branch>` hasn't been pushed to `origin` yet. Push it first, then re-run `/pr`:
   > ```
   > git push -u origin HEAD
   > ```
3. If the fetch **succeeded**, verify the local branch isn't **ahead** of the remote (unpushed local commits would be missing from the PR):
   ```
   git rev-list --left-right --count origin/<branch>...HEAD
   ```
   The second number is **ahead** (local commits not on the remote). If **ahead > 0**, **stop** and tell the user they have `<ahead>` unpushed commit(s); instruct them to `git push`, then re-run. (If the first number, **behind**, is > 0, just note it — informational, not blocking; the PR uses the remote head.)

---

## Step 6 — Identify the post-mortem tickets in this PR

The PR's tickets come from **two** sources, unioned:

**6a — Post-mortem files added on the branch.**
```
git diff <base>..HEAD --name-only --diff-filter=A -- 'docs/post-mortem/*.md'
```
Each returned file is named `<ticket>.md` — the basename (digits) is a ticket ID. Record each ticket with its file path.

**6b — `AB#<n>` references in the branch's commit messages.**
```
git log <base>..HEAD --format=%s%n%b
```
Scan the output for `AB#<digits>` (also accept a bare `#<digits>` only when adjacent to `AB`); collect each distinct ticket number.

**Union** the ticket IDs from 6a and 6b into an ordered, de-duplicated `TICKETS` set (preserve first-seen order; 6a files first, then any commit-only tickets). For each ticket, note whether a post-mortem **file** is available for it — either one added on the branch (6a) or an existing `docs/post-mortem/<ticket>.md` in the repo (check with `Glob`). If `TICKETS` is empty, there is simply no post-mortem block to add — continue to Step 7, which will produce an empty block.

---

## Step 7 — Build the post-mortem description block

For each ticket in `TICKETS` (in order), assemble one section containing its Executive Summary text **and** a link to its "Post Mortems" GitHub Discussion.

**7a — Executive Summary text (from the file, if any).** When a `docs/post-mortem/<ticket>.md` file is available, extract just its Executive Summary — **do not read the whole file** (post-mortems can be large):
1. **Grep** the file for `^## ` with `-n` (line numbers). The `## Executive Summary` line is the start; the **next** `## ` line is the end.
2. **Ranged `Read`** only that span (`offset`/`limit` from the two line numbers) and take the text between the heading and the next `##`.
3. If the file has **no** `## Executive Summary` section, or no file is available for the ticket, there is no summary text — include the section with just the discussion link (7b).

**7b — Post-mortem Discussion link (GraphQL search).** Find the ticket's discussion in the repo's "Post Mortems" category. Write the query to `/tmp/pr-disc.graphql` and search by title:
```
query($q:String!){
  search(query:$q, type:DISCUSSION, first:10){
    nodes{ ... on Discussion { number title url category { name } } }
  }
}
```
Call it with `-f q="repo:<owner>/<name> in:title AB#<ticket>"`. Keep the first result whose title contains `AB#<ticket>` and whose `category.name` matches **"Post Mortems"** case-insensitively (tolerate `Post-Mortems`/`Post Mortem`). Record its `url`. If none matches, note "no published post-mortem discussion found" for that ticket and omit the link line (keep the summary text if there was any). Handle a GraphQL/permission error gracefully — skip the link, don't crash.

**7c — Assemble the block.** Wrap everything in idempotency markers and give each ticket its own subsection:
```
<!-- auro-pr:pm:start -->
## Post-Mortems

### AB#<ticket>

Post-mortem discussion: <url>

<executive summary text>

### AB#<ticket2>

...
<!-- auro-pr:pm:end -->
```
Rules: one `### AB#<ticket>` subsection per ticket, in `TICKETS` order, all inside a **single** marker pair (never one pair per ticket). Omit the "Post-mortem discussion:" line for a ticket with no discussion; omit the summary paragraph for a ticket with no summary text; a ticket may legitimately have only one of the two. If `TICKETS` is empty, the block is empty — omit it entirely (no markers).

---

## Step 8 — Derive component labels (auro-formkit only)

If `IS_FORMKIT` is false, skip this step — no labels.

If `IS_FORMKIT`:
1. List the files the PR's commits touch: `git diff <base>..HEAD --name-only`.
2. For every path matching `components/<name>/…`, map `<name>` → candidate label `auro-<name>`. Collect the distinct set — this is the **component set**.
3. Fetch the repo's labels and keep only component labels that actually exist (never create labels). Write the query to `/tmp/pr-labels.graphql`:
   ```
   query($owner:String!,$repo:String!){
     repository(owner:$owner,name:$repo){ labels(first:100){ nodes{ name } } }
   }
   ```
   Call with `-f owner=<owner> -f repo=<name>`. For each component, match a label named `auro-<name>` (or bare `<name>`), case-insensitively. Record the **matched label names** (`LABELS`) and note any component with **no** matching label (report it later; don't create it).

Record `LABELS` for Steps 10/11.

---

## Step 9 — Assemble the PR body & title

**9a — Locate the PR template.** Find the repo's pull-request template, checking these locations (GitHub's supported set), case-insensitively, first match wins:
1. `.github/pull_request_template.md` (also `PULL_REQUEST_TEMPLATE.md`).
2. `.github/PULL_REQUEST_TEMPLATE/` — a directory of named templates; prefer `default`/`pull_request_template`, else the first `*.md` (note which).
3. Repo root `pull_request_template.md` / `PULL_REQUEST_TEMPLATE.md`.
4. `docs/pull_request_template.md` / `docs/PULL_REQUEST_TEMPLATE.md`.

Use `Glob` (e.g. `.github/**/*ull_*equest*emplate*.md`) then `Read` the match. If **none** is found, warn ("ℹ️ No PR template found under `.github/` — creating the PR with the post-mortem section only.") and continue with an empty template.

**9b — Compose the body**, top to bottom:
1. The **post-mortem block** from Step 7 (only if non-empty).
2. A `---` horizontal rule (only if both a block and a template exist).
3. The **PR template** verbatim.
4. If **neither** a template nor any post-mortem block exists, use a minimal body: a one-line description synthesized from the branch's commits (the `git log` from Step 9c).

**Write the assembled body** to `/tmp/pr-body-<branch>.md` with the **Write tool** (sanitize `<branch>` — replace `/` with `-`). Do not build it on the command line.

**9c — Generate the title.** From the branch's commits relative to base:
```
git log <base>..HEAD --format=%s
```
- **One commit** → reuse its subject verbatim.
- **Multiple commits** → synthesize a concise Conventional-Commits-style title `<type>(<scope>): <summary>`. On auro-formkit prefer the primary affected component as the scope (from the changed paths); elsewhere infer a natural scope or omit it. One readable line.

---

## Step 10 — Confirm (loop until approved)

**Do not create the PR before the user approves.** Show the full proposal once:

```
Base:     <base>  ←  <branch>   (<draft|ready for review>)
Assignee: @me
Title:    <title>
Labels:   <comma-separated LABELS, or "none"> (auro-formkit only)

<the assembled body>
```

Also note whether a template was used, how many post-mortem sections were included, and — for auro-formkit — any component with no matching label. Then ask with a plain-text prompt (not `AskUserQuestion`, so the user can approve *or* give free-form edits):

> Create this PR? Reply **yes** to create it, **no** to cancel, or tell me what to change (title, body, base, draft/ready, labels).

Interpret the reply:
- **Approval** (`yes`, `y`, `create`, or any clear affirmative) → proceed to Step 11.
- **Rejection** (`no`, `n`, `cancel`, `exit`, `abort`) → **stop without creating anything.** Note that no PR was created, and end.
- **Anything else** → treat as change instructions. Revise title/body/base/draft/labels (rewrite the `/tmp` body file if the body changed; re-resolve the base via Step 3's verification if the base changed). When re-presenting, keep it lean: always show the updated **title** and the changed field(s), and for the body show **only what changed** (offer "reply `show` to see the full body"). Then ask the same question. Repeat until approved or rejected.

---

## Step 11 — Create the PR

On approval, create the PR — assigned to the current user, targeting `<base>`, with the body file, and (auro-formkit) the component labels. Include `--draft` only if `DRAFT` is true:

```
gh pr create [--draft] --base <base> --head <branch> --assignee @me --title "<title>" --body-file /tmp/pr-body-<branch>.md [--label <label> --label <label> ...]
```

- Capture the **PR URL** that `gh` prints on success.
- If the command fails **specifically** because of `--assignee @me` (e.g. the user lacks assignable permission), retry the same command **without** `--assignee @me` and note the PR was created **unassigned** (assign manually). Do not retry by dropping `--draft` or changing the base.
- If the command fails **specifically** because a `--label` value isn't assignable, retry **without** the `--label` flags and apply the labels afterward via REST (`gh api --method POST repos/{owner}/{repo}/issues/<number>/labels -f "labels[]=<label>"`), noting any that still fail.
- Do **not** run `gh pr ready`, merge, or otherwise edit the PR afterward.

---

## Step 12 — Report

Tell the user concisely:
- The **PR URL** as a clickable link.
- A one-line summary: `<base> ← <branch>`, **draft** or **ready for review**, assignee (`@me` or "unassigned — assign manually"), whether the `.github` template was applied, how many post-mortem sections were added, and (auro-formkit) which component labels were applied plus any component that had no matching label.
- Anything degraded: a post-mortem ticket with no discussion found, GraphQL/permission errors, etc.

Do not push and do not change the PR's draft state — hand control back to the user.
