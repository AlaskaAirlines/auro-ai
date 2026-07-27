---
name: pr
description: Open a draft GitHub pull request for the current branch into the repo default branch — assigned to you, seeded from the repo's .github PR template, with the Executive Summary of any new post-mortem files prepended to the description, and returns a link to the new PR. If a PR already exists for the branch, offers to refresh its Executive Summary instead. Never pushes.
disable-model-invocation: true
argument-hint: "[base branch]"
allowed-tools: Bash(gh pr create *), Bash(gh pr list *), Bash(gh repo view *), Bash(gh auth status *), Bash(gh api --method PATCH repos/*/*/pulls/* *), Bash(git symbolic-ref *), Bash(git rev-parse *), Bash(git rev-list *), Bash(git branch *), Bash(git ls-remote *), Bash(git status *), Bash(git fetch *), Bash(git log *), Bash(git diff *), Bash(git remote set-head *), Bash(git config *), Read, Glob, Grep, Write(/tmp/*), AskUserQuestion
---

## Task — start now

You are executing the **pr** skill. The invocation itself is the request: **begin the workflow immediately** and walk through the steps below **in order**. Do not skip a step and do not reorder them. Some steps require a user prompt — ask it, wait for the reply, and branch on the answer before continuing.

> **Scope guardrail — open one draft PR, or refresh one existing PR's summary; nothing more.** This skill's **only** mutating side effects are (a) a single `gh pr create` that opens **one draft pull request** (Step 10), or (b) — when a PR already exists for the branch and you explicitly opt in — editing **only** that PR's **description** to refresh the post-mortem Executive Summary block (Step 2). Both happen only after you confirm. It must **NOT**, under any circumstance:
> - `git push`, force-push, or otherwise write to the remote — if the branch isn't already pushed, it **stops and tells the user to push** (Step 4);
> - commit, amend, stage, create/move/delete tags or branches, or edit any file in the repo (the only file it writes is a temporary PR body under `/tmp`);
> - mark a PR ready-for-review, merge, close, or comment on one; the **only** permitted edit to an existing PR is the opt-in Executive-Summary description sync in Step 2 — nothing else about an existing PR is touched;
> - run any CI/release workflow.
>
> If any step seems to call for one of these actions, stop and hand control back to the user instead.

**The invocation takes one optional argument** — available as `$ARGUMENTS` (the text after `/pr`, trimmed; empty if none): an explicit **base branch** to target, overriding the automatic default-branch detection in Step 3. Leave it empty for the normal flow (PR into the repo's default branch).

Work through the steps below in order.

---

## Step 0 — Preconditions

1. Confirm the GitHub CLI is authenticated: `gh auth status`. If it reports not-logged-in (non-zero exit), **stop** and tell the user: "GitHub CLI isn't authenticated — run `gh auth login`, then re-run `/pr`." Do not continue.
2. Resolve the repo root with `git rev-parse --show-toplevel` and treat all paths below as relative to it.

---

## Step 1 — Determine the current branch

```
git symbolic-ref --short HEAD
```

Call this `<branch>`. (The same-branch guard against the base runs in Step 3, once the base is known.)

---

## Step 2 — Existing-PR check (offer to refresh its Executive Summary)

Check for an open PR on this branch **and fetch its body in the same call** so the refresh path needs no extra round-trip:

```
gh pr list --head <branch> --state open --json number,url,title,baseRefName,body
```

If **none** exists, continue to Step 3 (create a new PR).

If one **already exists**, do **not** create a second PR. Ask the user whether to refresh that PR's Executive Summary. Prompt with `AskUserQuestion`:

> An open PR already exists for `<branch>`: #<number> — <title> (<url>). Do you want to update its description with the latest post-mortem Executive Summary?

Options (exactly two):
- **Update the Executive Summary** — sync the summaries into the existing PR (procedure below), then stop.
- **No — exit** — take no action whatsoever and end the workflow immediately.

If the user chooses **No — exit**, end now without touching the PR, the branch, or any file.

If the user chooses **Update the Executive Summary**, do exactly the following and nothing else (do **not** run Steps 3–11 — no new PR is created). This refresh touches **only** the PR's description body: **do not reassign the PR** — leave its existing assignee(s) exactly as they are — and do not change its title, base, reviewers, labels, or draft state:

1. **Collect the summaries** using the Step 6 procedure, but relative to the **existing PR's base** (`baseRefName` from the query above) rather than the default branch:
   ```
   git diff <baseRefName>..HEAD --name-only --diff-filter=A -- 'docs/post-mortem/*'
   ```
   For each returned file, extract the content under its `## Executive Summary` heading with the Grep-then-ranged-Read technique in Step 6, skipping files without that section. If there are **no** new post-mortem summaries, tell the user there is nothing to sync and stop — **do not** blank or otherwise change the description.
2. **Build the injected block**, wrapped in idempotency markers so re-runs never stack copies (the markers are invisible in GitHub's rendered view). Put one `## Executive Summary — <filename>` section per post-mortem, in order, inside a **single** marker pair:
   ```
   <!-- auro-pr:pm-exec-summary:start -->
   ## Executive Summary — <post-mortem filename>

   <copied executive-summary text>
   <!-- auro-pr:pm-exec-summary:end -->
   ```
   (If there are several post-mortems, repeat the `## Executive Summary — <filename>` heading + text for each **inside the same** start/end pair — one block total, never one pair per file.)
3. **Use the body already fetched** in the `gh pr list` query above — do not re-fetch it.
4. **Insert or replace — always overwrite, never diff-and-skip.**
   - If the body **already contains** the `auro-pr:pm-exec-summary:start`/`:end` markers, replace everything between them (inclusive) with the freshly built block. Exactly one such block must remain afterward — never append a second copy.
   - Otherwise, insert the block **directly after the first Markdown header** in the body (the first line beginning with `#` that is **not** inside a fenced code block or an HTML comment); if the body has no header, prepend the block to the top.
   - Never rewrite unrelated parts of the body.
5. **Write it back via the REST API** — not `gh pr edit`, which issues a GraphQL query referencing the deprecated Projects-classic field and hard-errors on repos where Projects (classic) is enabled (see [cli/cli#11983](https://github.com/cli/cli/issues/11983)); the REST `PATCH .../pulls/<n>` endpoint has no such dependency and sends **only** the `body` field, leaving the PR's assignee(s), title, base, reviewers, labels, and draft state untouched. `gh api` auto-substitutes `{owner}` and `{repo}` from the current repo, so pass them literally — no `gh repo view` lookup needed — and send the full updated body via stdin (quoted heredoc, so backticks/`$` are never interpreted by the shell):
   ```
   gh api --method PATCH repos/{owner}/{repo}/pulls/<number> -F body=@- <<'EOF'
   <full updated PR body>
   EOF
   ```
   If the sandbox blocks the heredoc, write the full updated body to `/tmp/pr-body-<branch>.md` with the **Write tool** (sanitize `<branch>` — replace `/` with `-`) and pass `-F body=@/tmp/pr-body-<branch>.md` instead.
6. **Report** the existing PR's URL as a clickable link and how many Executive Summaries were synced, then **stop**. Do not create a new PR, do not push, do not make any other change.

---

## Step 3 — Resolve the base branch (and same-branch guard)

**If `$ARGUMENTS` is non-empty**, treat it as an explicit base branch. Verify it exists on the remote with `git ls-remote --heads origin <$ARGUMENTS>`; if that returns nothing, tell the user the base branch wasn't found on `origin` and stop. Otherwise use it as `<base>`.

**Otherwise**, resolve the repo's **default branch** as `<base>`, in this order (mirrors the code-review skill so a branch cut from a non-default base is still targeted correctly):

1. `git symbolic-ref --short refs/remotes/origin/HEAD` → returns e.g. `origin/main`; strip the `origin/` prefix.
2. If that ref isn't set locally, run `git remote set-head origin --auto` once to populate it, then retry step 1.
3. If it still fails, fall back to `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`.

Record the resolved `<base>` (a plain branch name, e.g. `main`).

**Same-branch guard.** If `<branch>` **equals** `<base>`, **stop** — you can't open a PR from the base branch into itself. Tell the user: "You're on `<branch>`, which is the base branch — switch to a feature branch, then re-run `/pr`."

---

## Step 4 — Remote/push guard (never push)

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
   The second number is **ahead** (local commits not on the remote). If **ahead > 0**, **stop** and tell the user they have `<ahead>` unpushed commit(s); instruct them to `git push`, then re-run. (If the first number, **behind**, is > 0, just note it — the remote has commits your local branch lacks; the PR uses the remote head, so this is informational, not blocking.)

---

## Step 5 — Locate the PR template

Find the repo's pull-request template. Check these locations (GitHub's supported set), case-insensitively, and use the **first** match:

1. `.github/pull_request_template.md` (also `PULL_REQUEST_TEMPLATE.md`).
2. `.github/PULL_REQUEST_TEMPLATE/` — a directory of named templates. If present, prefer one named `default`/`pull_request_template`; otherwise use the first `*.md` in it and note which you picked.
3. Repo root `pull_request_template.md` / `PULL_REQUEST_TEMPLATE.md`.
4. `docs/pull_request_template.md` / `docs/PULL_REQUEST_TEMPLATE.md`.

Use `Glob` (e.g. `.github/**/*ull_*equest*emplate*.md`) then `Read` the match. If **no** template is found, **warn** ("ℹ️ No PR template found under `.github/` — creating the PR with the imported summaries only.") and continue with an empty template body (Step 7 still assembles whatever it has).

---

## Step 6 — Collect Executive Summaries from new post-mortems

Find post-mortem files **added on this branch** relative to the base:

```
git diff <base>..HEAD --name-only --diff-filter=A -- 'docs/post-mortem/*'
```

For **each** file returned (preserve the order listed), extract just the Executive Summary — **do not read the whole file** (post-mortems can be large):

1. **Grep** for the section boundaries to get line numbers: `Grep` the file with pattern `^## ` and `-n` (line numbers). The `## Executive Summary` line is the start; the **next** `## ` line is the end.
2. **Ranged `Read`** only that span (`offset`/`limit` from the two line numbers) and take the text between the heading and the next `##`.
3. If the file has **no** `## Executive Summary` section, **skip it** — do not synthesize one.

Keep each extracted summary paired with its source filename. If no new post-mortems are found (or none have the section), there are simply no summaries to prepend — continue.

---

## Step 7 — Assemble the PR body

Compose the body top-to-bottom:

1. **Executive Summaries block** (only if Step 6 found any) — one section per post-mortem, in order, labeled by source file:
   ```
   ## Executive Summary — <post-mortem filename>

   <copied executive-summary text>
   ```
   After the last summary, add a `---` horizontal rule to separate it from the template.
2. **PR template** (from Step 5) verbatim below the rule. If no template was found, omit this and the rule.
3. If **neither** a template nor any summaries exist, use a minimal generated body: a one-line description synthesized from the branch's commits (Step 8's `git log`).

**Write the assembled body to a temp file** with the **Write tool** — `/tmp/pr-body-<branch>.md` (sanitize `<branch>` — replace `/` with `-`). Do **not** build the body on the command line or via a shell redirect; the frontmatter grants `Write(/tmp/*)` for exactly this, so the body (which may contain backticks or `$`) is never interpreted by the shell.

---

## Step 8 — Generate the PR title

Build a title from the branch's commits relative to the base:

```
git log <base>..HEAD --format=%s
```

- **One commit** → reuse its subject verbatim as the title.
- **Multiple commits** → synthesize a concise Conventional-Commits-style title: `<type>(<scope>): <summary>` where the summary captures the branch's overall intent. In the `auro-formkit` repo, prefer the primary affected component as the scope (infer from the changed paths, e.g. `components/select/...` → `select`); in other repos, infer a natural scope or omit it. Keep it to a single readable line.

---

## Step 9 — Confirm or edit (loop until approved)

**Do not create the PR before the user approves.**

**First presentation** — show the full proposal once:

```
Base:     <base>  ←  <branch>   (draft)
Assignee: @me
Title:    <title>

<the assembled body>
```

Also note whether a template was used and how many post-mortem summaries were imported. Then ask with a plain-text prompt (not `AskUserQuestion`, so the user can reply with approval *or* free-form edits):

> Create this draft PR? Reply **yes** to create it, **no** to cancel, or tell me what to change (title, body, base).

Interpret the reply:
- **Approval** (`yes`, `y`, `create`, or any clear affirmative) → proceed to Step 10.
- **Rejection** (`no`, `n`, `cancel`, `exit`, `abort`) → **stop without creating anything.** Note that no PR was created, and end.
- **Anything else** → treat it as change instructions. Revise the title and/or body (rewrite the `/tmp` file if the body changed). When you **re-present**, keep it lean: always show the updated **title**, but for the body show **only what changed** — the revised section(s), or a one-line note like "updated the Testing section" — not the whole body again (offer "reply `show` to see the full body" if they want it). Then ask the same confirmation question. Repeat until approved or rejected.

---

## Step 10 — Create the draft PR

On approval, create the PR — draft, targeting `<base>`, assigned to the current user, with the body from the temp file:

```
gh pr create --draft --base <base> --head <branch> --assignee @me --title "<title>" --body-file /tmp/pr-body-<branch>.md
```

- Capture the **PR URL** that `gh` prints on success.
- If the command fails **specifically** because of `--assignee @me` (e.g. the user lacks assignable permission on the repo), retry the same command **without** `--assignee @me` and note in the report that the PR was created **unassigned** (assign manually). Do not retry by dropping `--draft` or changing the base.
- Do **not** run `gh pr ready`, merge, or edit the PR afterward.

---

## Step 11 — Report

Tell the user concisely:
- The **PR URL** as a clickable link so they can jump straight to it.
- A one-line summary: `<base> ← <branch>`, **draft**, assignee (`@me` or "unassigned — assign manually"), whether the `.github` template was applied, and how many post-mortem Executive Summaries were imported into the description.

Do not push and do not mark the PR ready-for-review — hand control back to the user.
