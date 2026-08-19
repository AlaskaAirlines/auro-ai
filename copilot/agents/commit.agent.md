---
name: commit
description: 'Guided commit workflow for auro-formkit — takes an ADO ticket or PR number as its argument (or `amend` to fold staged changes into the previous commit), checks you are not on dev/main/master, verifies the branch is synced, then builds a Conventional Commits message from the staged changes and creates the commit.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/commit/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "<ADO ticket # | PR # | prev | amend>" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **commit** skill. The invocation is the request: **begin the workflow immediately** and walk through the steps below **in order**. Do not skip a step, and do not reorder them. Some steps require a user prompt — ask it, wait for the reply, and branch on the answer before continuing. This skill's only mutating side effects are a `git pull` (Step 2, only if the user asks for it), a repo-local `git config` write recording the reference (Step 6), and the final `git commit` — either a new commit or, in **amend mode**, a `git commit --amend` that rewrites the previous commit (Step 6, only after the user confirms). Never push.

**The invocation takes one argument** — available as `${input}` (the text after `/commit`, trimmed; empty if none):
- an **ADO ticket or PR number** (or `prev`) to associate with a **new** commit — the normal flow, resolved in **Step 3**; or
- **`amend`** — fold the current staged changes into the **previous** commit and rewrite its message. This selects **amend mode**, determined in **Step 0**.

Work through the steps below in order.

---

## Step 0 — Determine mode (normal vs amend)

Inspect `${input}` (trimmed, case-insensitive):

- If it is exactly **`amend`** (optionally followed by an explicit reference — e.g. `amend 1602084` — which overrides the reference resolved in Step 3), this is **amend mode**. Set `AMEND_MODE = true`. In amend mode the workflow folds the current staged changes into the **previous** commit (`git commit --amend`) and rewrites its message to describe the combined result, following the exact same subject/body rules as a normal commit.
  - Before continuing, confirm there is a commit to amend: run `git rev-parse --verify HEAD` (and note whether a parent exists with `git rev-parse --verify HEAD~1`). If `HEAD` does not resolve (no commits yet), stop and tell the user: "No commit to amend — the branch has no commits yet. Stage your changes and run `/commit <reference>` to create the first commit." Then end the workflow.
- Otherwise `AMEND_MODE = false` — the **normal** new-commit flow.

Carry `AMEND_MODE` through the remaining steps. Steps 1 and 2 run identically in both modes (with one extra amend caution noted in Step 2); Steps 3–6 have explicit **amend-mode** branches.

---

## Step 1 — Branch safety check

Determine the current branch:

```
git symbolic-ref --short HEAD
```

If the current branch is **`dev`**, **`main`**, or **`master`** (match exactly, case-insensitive), the user is about to commit directly onto a protected branch. **Warn and confirm** before going any further. Ask with the `AskUserQuestion` tool:

> ⚠️ You are on the protected branch `<branch>`. Committing here writes directly to `<branch>` rather than a feature branch. Do you want to continue?

Options:
- **Continue on `<branch>`** — proceed to Step 2.
- **Stop** — end the workflow immediately with a short note ("Exited — create or switch to a feature branch, then re-run `/commit`."). Do not run any further steps.

If the current branch is **not** one of the protected branches, say nothing about it and proceed directly to Step 2.

---

## Step 2 — Sync check

Verify the current branch is in sync with its upstream (not behind the remote). First refresh remote-tracking refs, then compare:

```
git fetch
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git rev-list --left-right --count @{u}...HEAD
```

- If the branch has **no upstream** (`@{u}` fails), treat it as "nothing to sync" — there is no remote to pull from. Note "ℹ️ No upstream configured — nothing to sync." and proceed to Step 3 without prompting.
- `git rev-list --left-right --count @{u}...HEAD` prints two numbers: **behind** (commits on the remote not local) and **ahead** (local commits not on the remote). If **behind == 0**, the branch is already synced — note "✅ Branch is up to date with `<upstream>`." and proceed to Step 3 without prompting.
- If **behind > 0**, the branch is behind the remote. **Prompt** with `AskUserQuestion`:

> Your branch is behind `<upstream>` by `<behind>` commit(s). How do you want to proceed?

Options (exactly these three):
1. **Sync and continue** — run `git pull`. If the pull exits non-zero **or** reports a conflict/error, **report the exact error output and exit the workflow** (do not attempt to resolve conflicts, do not continue to Step 3). If the pull succeeds, proceed to Step 3.
2. **Continue without syncing** — proceed to Step 3 without pulling.
3. **Exit** — end the workflow immediately with a short note. Do not run any further steps.

**Amend-mode caution.** If `AMEND_MODE` is true, the commit you are about to rewrite may already have been pushed. Using the **ahead** count from `git rev-list --left-right --count @{u}...HEAD` (the second number, local commits not on the remote): if there is an upstream **and ahead == 0**, the previous commit already exists on `<upstream>` — amending it rewrites published history and will require a force-push to update the remote (this skill never pushes). **Warn and confirm** with `AskUserQuestion`:

> ⚠️ The commit you're about to amend appears to already be on `<upstream>`. Amending rewrites it and will require a force-push to update the remote. Continue?

Options: **Continue with amend** — proceed to Step 3; **Exit** — end the workflow immediately. If there is no upstream, or ahead > 0 (the previous commit is local-only), say nothing about this and proceed normally.

---

## Step 3 — Ticket / PR reference (from the argument)

**Amend mode.** If `AMEND_MODE` is true, do **not** prompt. The reference is inherited from the commit being amended so the rewritten subject keeps the same trailing reference:
- If the invocation supplied an explicit reference after `amend` (e.g. `amend 1602084`), classify that number by the length rules in step 2 below and use it (it overrides the inherited one).
- Otherwise read the previous commit's message (`git log -1 --pretty=%B`) and extract the trailing reference from its subject — the last `AB#<digits>` (ADO ticket) or `#<digits>` (PR) token. Reuse it verbatim (and remember whether it is an ADO ticket or PR, from the `AB#` vs `#` form).
- If the previous subject has no such token, fall back to `git config --local --get commit.skillLastRef`. If that is also unset, prompt once with: "The previous commit has no ticket/PR reference. Enter the ADO ticket number (7 digits) or PR number (fewer than 7 digits) to add, or reply `none` to amend without one:" — classify the reply per step 2, or omit the reference on `none`.

Then continue to Step 4. The rest of this step (the `prev` and explicit-number rules below) applies to the **normal** flow only.

The reference comes from **`${input}`** — do **not** prompt for it in the normal case. Resolve it as follows.

**1. `prev` / `previous`.** If `${input}` (trimmed, case-insensitive) is `prev` or `previous`, reuse the reference from the last time `/commit` was run in this repo. Read it with:

```
git config --local --get commit.skillLastRef
```

- If it returns a value, use it verbatim as the resolved reference (it is already stored in final form — e.g. `AB#1602084` or `#123`) and skip the length classification below.
- If it is unset (no prior run recorded), stop and tell the user: "No previous reference found — this looks like the first `/commit` run in this repo. Re-run `/commit <ADO ticket # | PR #>` with an explicit number." Then end the workflow.

**2. An explicit number.** Otherwise classify `${input}` by its **character length** (trim whitespace; strip a leading `#` or `AB#` if present, then measure the remaining digits):
- **Exactly 7 characters** → **ADO ticket**. The subject will end with `AB#<number>`.
- **Fewer than 7 characters** → **PR number**. The subject will end with `#<number>`.

**3. Missing or invalid — the reference is required.** If `${input}` is empty, or is 8+ characters, or is not numeric after stripping, the skill cannot proceed without a reference. Prompt with a plain-text message:

> A ticket or PR number is required. Enter the ADO ticket number (7 digits), a PR number (fewer than 7 digits), or `prev` to reuse the last one:

Apply steps 1–2 to the reply. If the reply is still empty or invalid, **re-prompt** — repeat until the user supplies a valid ADO ticket or PR number (or `prev` that resolves). Do **not** proceed to Step 4 without a resolved reference. (If the user clearly wants to abandon the commit — e.g. replies `cancel`/`exit`/`quit` — end the workflow without committing.)

Remember the resolved reference (its final form and whether it is an ADO ticket or PR) for Step 4, and record it in Step 6.

---

## Step 4 — Assess staged changes and build the subject

**Normal mode.** Look **only at staged changes** (what will actually be committed):

```
git diff --cached --stat
git diff --cached
```

If there are **no staged changes**, stop and tell the user: "Nothing staged — run `git add` for the files you want to commit, then re-run `/commit`." Do not create an empty commit.

**Amend mode.** The amended commit's final content is the **combination** of the previous commit's changes and the newly staged changes. Assess that combined set — compare the index against the previous commit's **parent** so the diff reflects everything the amended commit will contain:

```
git diff --cached --stat HEAD~1
git diff --cached HEAD~1
```

- If the previous commit is the **root** commit (no `HEAD~1`, per Step 0), compare against the empty tree instead: use `git diff --cached --stat 4b825dc642cb6eb9a060e54bf8d69288fbee4904` and `git diff --cached 4b825dc642cb6eb9a060e54bf8d69288fbee4904` (that hash is git's canonical empty-tree object).
- Also read the previous commit's existing message (`git log -1 --pretty=%B`) — use it to understand the original intent so the rewritten message describes the *original changes together with the new ones* (Step 5 handles preserving its trailers).
- If there are **no new staged changes** in amend mode, this is a message-only amend. That is allowed — note "ℹ️ No new staged changes — amending will only update the previous commit's message." and continue (do not hard-stop as the normal flow does).

From the assessed diff, construct the commit **subject** as a single line, **≤ 100 characters total**, in this shape:

```
<type>(<scope>): <imperative summary> <reference>
```

The colon-and-space (`: `) between the scope and the summary is **required** — for example: `fix(datepicker): correct year rollover AB#1602084`.

**1. Type** — pick the Conventional Commits type that matches the staged changes:
- `feat` — a new feature (MINOR bump)
- `fix` — a bug fix (PATCH bump)
- `perf` — a performance improvement (PATCH bump)
- `build` — build system or external dependency changes
- `ci` — CI configuration changes
- `docs` — documentation-only changes
- `refactor` — a code change that neither fixes a bug nor adds a feature
- `style` — formatting/whitespace only, no meaning change
- `test` — adding or correcting tests
- `chore` — maintenance tasks

When the staged changes span multiple categories, resolve by **priority: `feat` > `fix` > `perf` > all others.** (A change that adds a feature and fixes a bug is `feat`; a change that fixes a bug and updates docs is `fix`; a change that improves performance and updates docs is `perf`.) **Changes confined to `.claude/` tooling (skills, commands, hooks, agents, settings) are never `feat`/`fix` — use `chore`**, since they are not part of the published npm package and carry no semver impact.

**2. Scope** — the **component-scope** convention below applies **only in the `auro-formkit` repository.** First confirm the repo: run `git rev-parse --show-toplevel` and check whether its basename is `auro-formkit` (or the remote URL contains `auro-formkit` — `git config --get remote.origin.url`).
- **In `auro-formkit`:** the scope is the **primary component** affected, in parentheses — e.g. `(datepicker)`, `(combobox)`, `(select)`. Infer it from the staged file paths (e.g. `components/datepicker/...` → `datepicker`). If the changes clearly span multiple components with no single primary one, omit the scope (`<type>: ...`) rather than guessing.
- **In any other repository:** do not apply the component convention. Either infer a conventional scope naturally from the change (e.g. a module, package, or directory name) or omit the scope entirely (`<type>: ...`) — do not force a component name.

**3. Summary** — imperative mood (command form): "add", "fix", "restore", "modify" — **not** "adds", "added", "will add". Describe what the change does. Keep the whole subject line at or under 100 characters including the type, scope, and trailing reference.

**4. Reference** — append at the end of the subject, per the Step 3 classification:
- ADO ticket (7 chars) → ` AB#<number>`
- PR (<7 chars) → ` #<number>`
- If Step 3 yielded no valid reference, omit it.

---

## Step 5 — Build the body

Write a commit **body**: a concise executive summary of what changed across the staged files — short, but detailed enough that a reader understands *what* changed and *why* without reading the diff. Prefer one short paragraph or a few bullet points.

**Amend mode.** Base the body on the previous commit's message (read in Steps 3–4) and revise it so the executive summary describes the **combined** result — the original changes together with the newly staged ones — as a single coherent commit, not a changelog of "then I also…". Do **not** simply append; rewrite so it reads as one commit. Preserve the original message's **trailers** and merge them with any new ones:
- Keep every existing `Co-authored-by:` trailer from the original commit; add any new co-author (from the prompt below) without duplicating one already present.
- Keep the existing AI accreditation (`Co-authored-by AI:`) and, if AI contributed to the *new* staged changes, ensure the model(s) used are represented (add the current model if it is not already listed). Do not drop models that contributed to the original commit.
- Re-evaluate the breaking-change and post-mortem rules below against the **combined** change set, not just the new staged diff.

**Breaking changes.** Inspect the staged diff for any breaking change to a component's public API: a removed or renamed attribute/property/method, a changed event name or payload, an altered default behavior, or a changed slot contract. If one is present, make the **first paragraph** of the body a breaking-change notice in exactly this form:

```
BREAKING CHANGE: <which feature/API breaks> — <how it breaks and what consumers must change>
```

Then continue with the executive summary below it.

**Post-mortem link.** Check whether a post-mortem for this change already exists on the branch and covers the staged changes; if it does, link to it from the body.
1. Look for a post-mortem file matching the reference resolved in Step 3, at `docs/post-mortem/<number>.md` (use the numeric part of the reference — e.g. `AB#1602084` → `docs/post-mortem/1602084.md`, `#123` → `docs/post-mortem/123.md`). Also check whether such a file appears among this branch's added files (`git diff <upstream-or-base>..HEAD --name-only --diff-filter=A -- 'docs/post-mortem/*'`, and `git diff --cached --name-only --diff-filter=A -- 'docs/post-mortem/*'` for a staged-but-uncommitted one). If no post-mortem file is found, skip this step entirely — do not invent or require one here (that is the code-review skill's job).
2. If a post-mortem file is found, **Read** it and determine whether it actually documents the staged changes (the sections describing the fix/feature in the staged diff). If it does not correspond to the staged changes, skip the link.
3. If it does correspond, add a line near the end of the body (before the AI accreditation) that links to the post-mortem **and calls out the specific line range** that explains the staged changes further — cite the repo-relative path with the line numbers, e.g.:
   ```
   See post-mortem docs/post-mortem/1602084.md (lines 24–38) for the root cause and rationale behind these changes.
   ```
   Point at the narrowest range that explains the staged changes (the relevant `## Root Cause` / `## Solution` lines), not the whole file. If multiple distinct sections apply, cite each range.

**Human co-author.** Prompt the user for any additional person who helped write this commit. Ask with a plain-text message (not `AskUserQuestion`, since this is free-form input):

> Did anyone co-author this commit? Enter their GitHub username or `Name <email>`, or reply `none`:

- If the reply is `none` (or `no`/`n`/`skip`), add no co-author trailer.
- Otherwise treat the reply as a co-author identity and add a `Co-authored-by:` trailer near the end of the body (with the AI accreditation, after the summary). Format it as `Co-authored-by: <name> <email>`:
  - If the reply already contains an email in angle brackets (`Name <email>`), use it verbatim.
  - If the reply is a bare GitHub username (no email), format it as `Co-authored-by: <username> <username@users.noreply.github.com>` and note to the user that GitHub links a co-author reliably only when the trailer uses the account's real name and no-reply email (`<id>+<username>@users.noreply.github.com`) — offer to use that form if they provide the numeric ID.
  - GitHub only links the co-author when the trailer is separated from the body by a blank line, so place all `Co-authored-by:` trailers together in a trailing block.

**AI authorship accreditation.** At the **end** of the body, state whether any of the staged code was authored with AI assistance:
- If AI contributed to the staged changes, add a line crediting the model(s) used, e.g.:
  ```
  Co-authored-by AI: Claude Opus 4.8
  ```
  List every model that contributed if more than one. If you generated any of the staged code in this session, credit the model you are running as (see the model named in the environment context). If you cannot determine from context whether AI was involved, ask the user before finalizing.
- If no AI was involved, omit the accreditation entirely (do not add a "no AI used" line).

---

## Step 6 — Confirm and commit (loop until approved)

**Do not commit before the user approves the message.** This step is a loop: present the proposed message, ask for confirmation, and either commit or revise based on what the user says — repeating until they approve.

Present the full proposed message for review, formatted as:

```
<subject>

<body>
```

Show the subject's character count (and flag it if it somehow exceeds 100). **In amend mode**, make clear this will **rewrite the previous commit** — show which commit is being replaced with `git log -1 --oneline` before the prompt. Then ask with a plain-text prompt (not `AskUserQuestion`, so the user can reply either with approval or with free-form change instructions):

> Is this commit message correct? Reply **yes** to commit it, **no** to exit without committing, or tell me what to change.

(In amend mode, phrase it as "Reply **yes** to amend the previous commit, …".)

Interpret the reply:
- **Approval** (`yes`, `y`, `looks good`, `commit`, or any clear affirmative) → run the commit, passing subject and body as separate `-m` arguments so the blank line between them is preserved:
  ```
  git commit -m "<subject>" -m "<body>"
  ```
  **In amend mode**, add `--amend` so the previous commit is rewritten instead of creating a new one:
  ```
  git commit --amend -m "<subject>" -m "<body>"
  ```
  (If the body contains characters that would be unsafe on the command line, write it via a temp file and `git commit -F <file>` — add `--amend` in amend mode — instead.) After a successful commit, **record the reference so `prev` works next time** — store its final form (e.g. `AB#1602084` or `#123`) with:
  ```
  git config --local commit.skillLastRef "<resolved reference>"
  ```
  (Skip this write if Step 3 resolved to no reference at all.) Then print the resulting commit with `git log -1 --oneline` so the user sees it landed, and end the workflow. **Do not push.**
- **Rejection** (`no`, `n`, `cancel`, `exit`, `abort`, or any clear negative) → **exit the workflow immediately without committing anything.** Do not stage, commit, or modify anything. Note briefly that nothing was committed, and end.
- **Anything else** → treat the reply as change instructions. Revise the subject and/or body accordingly (keeping the subject ≤ 100 characters and all the Step 4/5 rules intact), then **re-present the updated message and ask the same confirmation question again.** Repeat this loop — revise, re-present, ask — until the user approves or rejects. Only commit once they have approved.
