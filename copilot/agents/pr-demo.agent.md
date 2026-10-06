---
name: pr-demo
description: 'Generate a single-page review demo for a GitHub pull request. Paste a PR link (or number) and it reads the PR, works out the problem and the fix, and writes one page next to the component''s other demo pages that shows the problem, the fix, the component''s behavior before and after the change, and any open questions such as a possible breaking change. On auro-formkit, behavior changes get a live HTML page where both columns run the real component source from the PR''s base and head commits, each in its own iframe, with a probe table that highlights every value that differs. PRs that only change docs, tests, or build/CI get a markdown explainer in the same place instead. Writes one untracked file (plus a build cache under node_modules/.cache) and never checks out branches, commits, pushes, or comments on the PR.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/pr-demo/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "<PR url or number>" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.
>
> **Bundled scripts:** this workflow runs scripts from your local `auro-ai` checkout at `$AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/`. Set `AURO_AI_HOME` to the checkout path before invoking it; if it is unset, ask the user for the path.

## Task — start now

You are executing the **pr-demo** skill. The invocation is the request: **begin immediately** and run the steps below **in order**.

The reader is a reviewer who wants to understand a PR in a couple of minutes: what was wrong, what the PR does about it, what changes for users and consumers, and what still needs a decision. Every sentence on the page should serve that. Be concise and use plain language. Don't restate the diff or narrate the code.

> **Scope guardrail.** The only things this skill writes are **one demo file** (Step 4) and a build cache under `<REPO_ROOT>/node_modules/.cache/pr-demo/<n>/`. It must **not**: check out or switch branches, stash, or edit any tracked file; commit, push, or tag; comment on, review, or label the PR; or add the demo to `pages.json`, `docs/pages/`, or any nav. The PR is read through `gh` and `git fetch`/`git show`, never by checking it out. `gh api` is for **reading** only (GET requests). If a step seems to need any of these, stop and ask.

**`${input}`**: a PR URL (`https://github.com/<owner>/<repo>/pull/<n>`) or a bare number. If it's empty, ask for one.

### Shell constraints

The shell is non-interactive and may be sandboxed, and its working directory may reset between calls, so run git as `git -C <REPO_ROOT> …`. Don't use `$(...)` or heredocs. Create and edit files with the Read, Write, and Edit tools, not shell commands. Run each `pr-demo.mjs` command **exactly as shown**: one call per Bash invocation, with no `cd`, `&&`, pipes, or redirects.

If the sandbox blocks a command, retry it with the sandbox disabled. (In some sandboxes a command prints correct output and then `operation not permitted: …/cwd-…` with exit code 1. That trailer comes from the sandbox, not the command; use the output.) That applies to every `gh` call and `git fetch` (they need the network), and to `pr-demo.mjs build`, `assemble`, and `verify` (they write into the repo and launch a browser).

---

## Step 0 — Preconditions

1. `gh auth status`. If it fails, stop and tell the user to run `gh auth login`.
2. `git rev-parse --show-toplevel` → `REPO_ROOT`. `gh repo view --json nameWithOwner -q .nameWithOwner` → `REPO`.
3. Parse `${input}` → `PR` (number) and, from a URL, `PR_REPO` (`owner/name`). If `PR_REPO` differs from `REPO`, stop: *"Run this from a clone of `<PR_REPO>`; the demo is built from that repo's source."*
4. `IS_FORMKIT = (REPO == AlaskaAirlines/auro-formkit)`.

## Step 1 — Read the PR

1. `gh pr view <PR> --json number,title,url,author,state,baseRefName,headRefOid,mergeCommit,body,files`
2. Fetch both sides so you can read them locally:
   - `git -C <REPO_ROOT> fetch --no-tags origin pull/<PR>/head <baseRefName>`
   - **`AFTER`** = `headRefOid`.
   - **`BEFORE`** = `<mergeCommit.oid>^1` if the PR is `MERGED`; otherwise `git -C <REPO_ROOT> merge-base origin/<baseRefName> <AFTER>`.
   Use these two everywhere below: in diffs, in `git show`, and for the build.
3. **Read the change.** Start with `git -C <REPO_ROOT> diff --stat <BEFORE> <AFTER>` and the same command with `--ignore-cr-at-eol -w` added. A file that disappears or shrinks a lot in the second run has whitespace or line-ending changes only. Say that in one line instead of describing it as a rewrite. Then read the diff with `git -C <REPO_ROOT> diff <BEFORE> <AFTER> -- <paths>`. To read a file at either side use `git show <sha>:<path>`; to find specific lines in a long one use `git grep -n <pattern> <sha> -- <path>`.
4. **Read the commits that belong to the PR**: `git -C <REPO_ROOT> log --no-merges --format=%h%x1f%s%x1f%b <BEFORE>..<AFTER>`. A branch cut from another long-lived branch (for example from `main` into `dev`) can carry dozens of old commits. Ignore any commit whose changes aren't in the PR's diff. Commit bodies often explain root cause and abandoned approaches.
5. **Tickets** (`AB#<n>`): take them from the title and body first, and from the in-scope commits only.
6. **Post-mortems.** Read any `docs/post-mortem/*.md` the PR adds. Also search the existing ones: `git -C <REPO_ROOT> grep -n <pattern> <BEFORE> -- docs/post-mortem` for the changed symbols, properties, and the PR's tickets. The PR may make an older post-mortem out of date, which is an open question.

## Step 2 — Classify the PR

Put the PR in exactly one bucket:

- **Behavior**: changes runtime source a user or consumer can observe: `components/*/src/**` or `packages/*/src/**` (JS or SCSS).
- **Non-behavior**: everything else, such as docs, READMEs, `docs/pages`, `apiExamples`, stories and tests only, build scripts, `.github/` workflows, dependency bumps with no source change, and release notes.

A PR that mixes both is **Behavior**. For a Behavior PR outside auro-formkit, fall back to the non-behavior markdown output: the live before/after build supports formkit's `components/<name>/src` layout only. Say so in the final report.

## Step 3 — Understand it

Before writing anything, work out the following:

- **Problem**: what went wrong, for whom, and how to trigger it. Use one concrete example (a markup fixture plus steps).
- **Fix**: what the PR changes, at the level a reviewer cares about.
- **Scenarios**: usually 1 to 3 that each show one thing. Prefer this order:
  1. the bug reproduced, failing in Before and fixed in After;
  2. any other behavior that **changed**, intended or not;
  3. at most one key behavior that **must not** change, to show it still works on both sides.

  If the PR bundles several unrelated fixes (often one per ticket), use one scenario per fix and fold the "must not change" check into that fix's scenario as an extra action.
- **Probes**: for each scenario, the handful of values that prove the claim (properties, attributes, `aria-*`, events fired, computed style, positions, selected value). The page highlights every probe that differs, so choose probes whose differences tell the story:
  - Normalize values that differ only incidentally, such as `undefined` vs `""` (`value ?? ''`).
  - Don't include a probe that's identical on both sides unless it's the "must not change" check.
- **Open questions**: things a reviewer may need to decide. Leave the section out if there are none. Always check for:
  - **Breaking changes.** The team's definition: removing or disabling any existing API feature (property, attribute, event, slot, CSS part, or documented behavior) is a breaking change **even if it was buggy or partly working**. One exception: a parent component no longer copying its own state onto its children (for example a menu no longer writing `disabled` onto its options) isn't breaking when the parent property still does its job. Breaking changes are marked with `BREAKING CHANGE:` in the commit body; the team doesn't use the `!` suffix. Breaking changes target the normal base branch (`dev` on auro-formkit) like any other change, so never suggest moving them to a separate branch. Do point out when a commit should carry the footer and doesn't.
  - Documentation, post-mortems, or release notes that the change makes out of date.
  - Behavior changes that look unintended, or that the PR description doesn't mention.
  - **For CI, build, and release PRs:** does the new trigger fire when intended (and not more often than intended)? Do the tokens, secrets, and permissions it needs exist? Does any reusable workflow it calls accept those inputs? Where you can, check read-only: `gh api repos/<owner>/<repo>/contents/<path>` for a reusable workflow, and for a merged PR, `gh run list --workflow <file> --limit 5` to see whether it has run since.

  Each open question is one or two sentences: what changed, who it affects, and what needs deciding. Don't restate the whole review.

## Step 4 — Decide where the file goes

`<n>` is the PR number. Use this order:

1. **auro-formkit, one component affected**: `components/<name>/demo/pr-<n>.html` (or `.md`). A change in `packages/*` counts toward the components its scenarios exercise.
2. **auro-formkit, several components**: place it with the riskiest change, meaning the one carrying an open question such as a breaking change. Otherwise use the component whose `src` changed most. If two are about equal, ask which one to use.
3. **Single-component repo** (a `demo/` directory at the root): `demo/pr-<n>.html` (or `.md`).
4. **No demo directory applies**, including formkit PRs that only touch `packages/`, `docs/`, `.github/`, or root files: `<REPO_ROOT>/pr-<n>.html` (or `.md`).

If the file already exists, overwrite it; it's this skill's own output from an earlier run. Also Glob for `**/pr-<n>.html` and `**/pr-<n>.md` outside `node_modules`: a copy at a different location is a leftover from an earlier run that chose differently. Mention it in the report so the user can delete it; don't delete it yourself. Never add the file to `pages.json` or `docs/pages/`.

## Step 5a — Behavior PR: build the live page (auro-formkit)

1. **Choose components to register.** Each component's `src/registered.js` registers only that component's own tag, so list **every component whose tag appears in your fixtures**. For example, a fixture with `<auro-select>` containing `<auro-menu>` needs `select,menu`. Sub-components a component renders inside its own shadow DOM (like select's dropdown) register themselves. The page reports any fixture tag that ended up unregistered.
2. **Build** (runs `git fetch` and `git archive`; never checks anything out):
   ```
   node $AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/pr-demo.mjs build --repo <REPO_ROOT> --pr <PR> --base-branch <baseRefName> --components <list>
   ```
   For a `MERGED` PR, add `--before <mergeCommit.oid>^1`. The build prints the short Before/After SHAs and the work directory `<WORK>`. Rebuilding deletes `<WORK>`, so build before writing the draft.
   If the build fails, report the error. Don't patch component source or the script to work around it.
3. **Draft the page.** Read `$AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/page-template.html`, fill every `FILL` block, and Write the result to `<WORK>/draft.html`, keeping everything marked `RUNTIME` exactly as it is. The template's header comment documents the fixture API and helpers. `$AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/examples/pr-1625-menu.html` is a complete worked example; match its tone and length.
   - **Header**: PR title, link, author as `Name (@login)`, and tickets. Leave `__BEFORE_SHA__`/`__AFTER_SHA__` as placeholders.
   - **TL;DR**: two or three plain sentences each for *The problem* and *The fix*. For a PR with several separate fixes, use one short bullet per fix instead.
   - **One `<section class="scenario">` per scenario**, each with a unique `id`:
     - a **What to look for** line saying exactly what differs between columns;
     - one button per action (`data-scenario="<id>" data-action="<name>"`). Order the buttons so that clicking them left to right walks through the story, because the verify step clicks them in that order;
     - a fixture with real, minimal markup, using real tag names (`auro-menu`, not prefixed);
     - a fixture script that sets `window.scenario = { actions, probe }`. Actions are async and change the fixture through public API (or a real `.click()`); `probe()` returns `{ label, value }` pairs.
   - **Focus, hover, and timers.** The runtime runs Before's action, then After's, then probes both, and focus or hover can only exist in one frame at a time. For that kind of state, measure inside the action (focus, `await settle()`, record `styleOf(...)`/`rectOf(...)`, then blur) and have `probe()` return the recorded values. Use `await wait(ms)` for state a component sets in a timer.
   - **Open questions**: from Step 3, or delete the section.
4. **Assemble**:
   ```
   node $AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/pr-demo.mjs assemble --repo <REPO_ROOT> --pr <PR> --draft <WORK>/draft.html --out <output path from Step 4>
   ```
5. **Verify**. This loads the page in headless Chromium and clicks every action button in page order. It prints the rows that differ for every scenario in the initial state, then the clicked scenario's full probe table after each click, with `≠` on rows that differ. So a "must not change" check is visible as a row without `≠`.
   ```
   node $AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/pr-demo.mjs verify --repo <REPO_ROOT> --page <output path> --screenshot <WORK>/shot.png
   ```
   Then check:
   - `errors: none`. Otherwise fix the fixture, script, or `--components` list and repeat (rebuild first if the components changed).
   - Each scenario's differences match its *What to look for* line: the bug scenario differs where you said it would, and the "must not change" check shows no differences. If they don't match, either the page's claim or your understanding is wrong. Re-read the source at both commits, fix whichever is wrong, and never edit the claim just to fit the output without understanding why.
   - Read `<WORK>/shot.png` and check that the layout is readable and neither column is empty.

   Stop after three rounds and report what's still wrong. If Playwright isn't installed in the repo, skip this step and say the page wasn't verified.

## Step 5b — Non-behavior PR: write the markdown explainer

Write `pr-<n>.md` at the Step 4 location, aimed at the same reader. "Before" and "after" mean `BEFORE` and `AFTER` from Step 1.

```markdown
# PR #<n> — <title>

[PR #<n>](<url>) by <Name> (@<login>) · <tickets>

## What changed
<two or three sentences: what the PR changes and why>

## Before → after
<the smallest illustration that makes the change concrete; see the rules below>

## Impact
<who notices and how: component consumers, contributors, the release/CI pipeline, the docs site.
Write "None for consumers" when that's true.>

## Open questions
<only if there are any; otherwise leave the section out>
```

**Before → after rules.** A reader should get each change at a glance, without comparing two long blocks line by line:
- **Show only the lines that changed.** Use a ` ```diff ` block with `-`/`+` lines and at most two or three unchanged lines of context, not separate "Before" and "After" copies of the file. Put the file path on the line above the block.
- **Keep each block to about 15 lines.** If a change is bigger, show its most important hunk and summarize the rest in a sentence, for example "…and the same rename in 12 other examples".
- **Use a table for many similar changes**, such as dependency bumps, renamed options, or repeated edits across files: one row per item with *What* · *Before* · *After* columns. Group rows by theme.
- **Prose changes** (docs wording): quote just the changed sentence before and after, not whole paragraphs.
- **Whitespace or line-ending changes**: one sentence, never a block.
- At most three or four illustrations in total. Everything else goes into the "What changed" summary.

Keep the whole file short. If the diff is large, summarize it by theme instead of file by file.

## Step 6 — Report

Tell the user:
- the output path, and the command to open it: `! open <path>`;
- any leftover copies from earlier runs found in Step 4;
- the problem and fix, one line each;
- the open questions, one line each, or "none";
- verification: passed, failed (and what failed), skipped (no Playwright), or not applicable (markdown output);
- that the file isn't tracked by git and shouldn't be committed;
- **only if a build ran:** the build cache is in `<WORK>`; remove it with `node $AURO_AI_HOME/plugins/auro/skills/pr-demo/scripts/pr-demo.mjs clean --repo <REPO_ROOT> --pr <PR>`.
