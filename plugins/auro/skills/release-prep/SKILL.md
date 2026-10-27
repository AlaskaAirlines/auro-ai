---
name: release-prep
description: Run the release preparation steps for an Auro rc branch about to merge into main, in one pass. Calls capture-standard to capture coding standards from the release's post-mortems, then release-notes to write and stage the release notes, and ends with one summary that also lists the steps it does not run. Run when asked to prepare a release, run release prep, or get an rc branch ready to merge into main. Writes nothing itself; each called skill asks before it publishes or writes. Not for cutting, tagging or publishing a release, Release tickets, release notes or capture on their own, or code review.
argument-hint: "[<repo>] [<rc branch | from..to>] [--corpus-ref <branch>] [--notes-base <ref>]"
allowed-tools: Skill(auro:capture-standard), Skill(auro:capture-standard *), Skill(auro:release-notes), Skill(auro:release-notes *), Bash(${CLAUDE_SKILL_DIR}/scripts/preflight.mjs), Bash(${CLAUDE_SKILL_DIR}/scripts/preflight.mjs *), AskUserQuestion
---

## Task — start now

Prepare a release in one pass: a read-only **preflight**, then **capture-standard**, then **release-notes**, then **one summary**. Work through the steps below **in order**. Do not skip a step and do not reorder them.

**Release prep writes and publishes nothing itself, and asks no confirmation of its own.** Each called skill keeps its own single confirmation: capture asks before it opens the PR and tickets, release-notes asks before it writes and stages the notes. **Never answer a called skill's prompt** — every confirmation must be the person's own reply, never yours or this skill's on their behalf. A "declined" or "cancelled" answer is a result, not a failure.

**A failed step never stops release prep.** Record it, run the next step, and report it in the summary. Release prep never blocks the release itself, which semantic-release performs when the `rc` PR merges.

**Out of scope.** Release prep never commits, pushes, opens a PR, tags, publishes, switches branches, fetches into the person's checkout, or writes to Azure DevOps (not even to close the Release ticket's tasks). If a step seems to need one of those, stop that step and list it for the person.

**The invocation** — available as `$ARGUMENTS`:

| Argument | Default |
|---|---|
| repo (`auro-formkit` or `AlaskaAirlines/auro-formkit`) | the checkout's `origin` |
| what is released — an `rc` branch, or `<from>..<to>` for testing and recovery | the one open PR into `main` whose head is `rc/*`; if there are none or several, ask |
| `--corpus-ref <branch>` | `main`; passed through to capture |
| `--notes-base <ref>` | none; passed through to release-notes as its base ref |

**In Copilot,** the skill-directory variable at the start of the paths in this file is left unexpanded. If a path still begins with a `$`-variable, replace that variable with this skill's base directory, given at the top of the skill's context.

---

## Step 0 — Preflight (read-only, no prompt)

Run the preflight script with the invocation's arguments, each in **single quotes** (branch names can contain `#`):

```bash
${CLAUDE_SKILL_DIR}/scripts/preflight.mjs '<arg>' '<arg>' …
```

Run it **exactly as written** — one call, the path unquoted, nothing added: no `cd`, no `VAR=value` prefix, no `&&`/`;`, no pipes or redirects. That shape is all the permission rule approves. With no arguments, run it bare. It only reads `git` in this checkout, and `gh pr list` and `gh api` for the `rc` PR and the branch tip. It prints `KEY: value` lines:

- **`ASK:`** — what is released could not be decided (no open `rc` PR, several — listed in `RC_CANDIDATES` — or `gh` failed), or there is no repo to default to. Ask the person with `AskUserQuestion` for the branch or `<from>..<to>` range (offer the candidates), then run preflight again with their answer added. This is a question about input, not a confirmation. If they give none, stop: there is nothing to prepare.
- **`INVALID:`** — the repo, branch, range, `--corpus-ref` or `--notes-base` holds characters a repo or git ref name should not (only letters, digits and `. _ / # -` pass). Say which argument, without repeating its value, and ask the person with `AskUserQuestion` for a corrected one; run preflight again with it. Never pass a value preflight rejected to either skill, and never quote or rewrite it into a command yourself.
- **`DROPPED:`** — open `rc` PRs ignored because their branch name or tip was unsafe. PRs from forks are never considered. Mention it in the plan.
- **`ERROR:`** — the arguments could not be read. Show it and stop.
- Otherwise: `REPO`, `CHECKOUT`, `RELEASED`, `RC_PR`, `RELEASE_TICKET`, `CORPUS_REF`, `NOTES_BASE`, `ADO_PAT` (set / not set), `CAPTURE_ARGS`, `NOTES` (`run`, or `skip — <reason>`), `NOTES_ARGS`, `NOTES_LATER`.

**The notes step runs only when preflight says `NOTES: run`.** The notes reach the release through the `rc` PR: they are written and staged here, committed to a branch, merged into `dev`, and carried into the `rc` branch by the `rc` workflow. A commit made straight to `rc/*` is lost the next time `dev` is pushed. So preflight skips the notes step unless the checkout is the released repo, has the release-notes paths, is not on an `rc/*` branch, and its `HEAD` contains the tip of what is released (taken from GitHub, so a stale local ref cannot pass). **Never switch branches, fetch, or merge to make the check pass** — report the skip and `NOTES_LATER` instead. In a repo without the release-notes paths (for example `auro-tabs`), the skip reason is "repo not set up for release-notes", and release-notes is not called at all.

Show the plan — repo, what is released and its PR, the Release ticket, the corpus ref, whether `ADO_PAT` is set (without it capture opens the PR but raises no tickets), and whether the notes step will run or why not — then go straight on to Step 1. **Do not ask to proceed.**

## Step 1 — Capture coding standards

Call capture through its calling contract, with preflight's `CAPTURE_ARGS` as the arguments — exactly as preflight printed them, never rebuilt from the invocation or a PR:

```
Skill(auro:capture-standard, "<CAPTURE_ARGS>")
```

Let capture run its own steps and its own single confirmation; the person answers it. Keep capture's **last `CAPTURE_RESULT:` line, verbatim** — do not reword, shorten or summarize it. If no such line comes back (the Skill call errored, was denied, or was interrupted), record `CAPTURE_RESULT: failed — no result line (<what happened>)`, and note that capture can be re-run safely for the same branch. Whatever the result, go on to Step 2.

## Step 2 — Release notes

If preflight said `NOTES: skip — <reason>`, do not call release-notes. Record `skipped — <reason>` and `NOTES_LATER` for the summary, and go to Step 3.

Otherwise call release-notes with preflight's `NOTES_ARGS` as its base ref — no arguments when it is `(none)`:

```
Skill(auro:release-notes)
Skill(auro:release-notes, "<NOTES_ARGS>")
```

It works on this checkout's `HEAD`, asks the person once ("Write and stage / Cancel"), and stages the notes without committing. Keep its **last `RELEASE_NOTES_RESULT:` line, verbatim**. `no release notes needed — …` and `cancelled — …` are results, not failures. If no such line comes back, record `RELEASE_NOTES_RESULT: failed — no result line (<what happened>)`.

## Step 3 — Summary

End with one summary in this shape. Every step always gets a line: its result line, or `skipped — <reason>`.

```
Release prep — <repo name> <released> → main · <today, YYYY-MM-DD>
Release ticket: AB#<n>            (or: none)

1. capture-standard
   CAPTURE_RESULT: …               (verbatim)
2. release-notes
   RELEASE_NOTES_RESULT: …         (verbatim; or: skipped — <reason>. Later: <NOTES_LATER>)

Not run by release prep — run these yourself:
- /auro:commit, then /auro:pr — commit the staged notes and open their PR into dev
- /auro:code-review <rc PR #> — manual only (expensive, posts to GitHub)
- Close the Release ticket's "Generate Release Notes" task once the notes merge
```

Adjust the not-run list to what happened: drop the `/auro:commit` line when no notes were staged, and keep the notes-later instruction on the release-notes line when that step was skipped. Use `RC_PR`'s number in the code-review line, or `<PR #>` when there is no `rc` PR. Never call `code-review` (it is manual-only), `commit` or `pr` (publishing the notes, and choosing `dev` as their base, is the person's step), or `create-rcs` (it ran earlier; its Release ticket is shown only as the `AB#`).
