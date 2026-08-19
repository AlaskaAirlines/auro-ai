---
name: release-notes
description: 'Generate or update the next release-notes document for auro-formkit. Determines the next semantic version from the Conventional Commits since the last released version (BREAKING CHANGE → major, feat → minor, fix/perf → patch), exits with an explanation if nothing release-worthy has landed. If a release-notes file for the current in-progress release already exists on this branch it refreshes that file in place; otherwise it generates a rich new file from the repo''s Release_Guide_TEMPLATE.md. Either way it wires the release into docs/templates/RELEASE_NOTES.md as the sole expanded accordion and stages the changed files (never commits). Exits early with instructions if the repo lacks the required release-notes folders/templates.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/release-notes/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "[base ref]" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **release-notes** skill. The invocation itself is the request: **begin the workflow immediately** and walk through the steps below **in order**. Do not skip a step and do not reorder them. This skill's only mutating side effects are the two files it writes/edits (the new release-notes file and `docs/templates/RELEASE_NOTES.md`) and a final `git add` that **stages** those files. It never commits and never pushes.

> **Scope guardrail — author release notes only, never perform a release.** The actual release is owned entirely by the GitHub Actions release workflow (semantic-release). This skill **only creates and modifies the release-notes documents**. It must **NOT**, under any circumstance:
> - commit, push, or open a PR;
> - create, move, or delete git tags (the `git tag -l` allowance is read-only listing — never `git tag <name>`);
> - edit `package.json` / version fields, lockfiles, or any changelog other than the release-notes files named in this skill;
> - run `npm version`/`npm publish`/`semantic-release`, create GitHub Releases, or trigger/dispatch any CI or release workflow;
> - touch build config, `.github/`, or anything outside `docs/releases/` and `docs/templates/RELEASE_NOTES.md`.
>
> Everything above is handled by the release workflow. If any step seems to call for one of these actions, stop and hand control back to the user instead.

**The invocation takes one optional argument** — available as `${input}` (the text after `/release-notes`, trimmed; empty if none): an explicit **base ref** (tag, branch, or commit) to use as the start of the commit range, overriding the automatic boundary detection in Step 2. Leave it empty for the normal flow.

Work through the steps below in order.

---

## Step 0 — Prerequisite check (fail fast if the repo isn't set up)

This skill only works in a repo laid out like `auro-formkit`. Before anything else, confirm the running repo has **all** of the following. Resolve the repo root first with `git rev-parse --show-toplevel` and check paths relative to it:

1. `docs/releases/` — the releases directory (must exist).
2. `docs/releases/Release_Guide_TEMPLATE.md` — the per-release content template.
3. `docs/templates/RELEASE_NOTES.md` — the accordion index.

Use `Glob`/`Read` to verify each. If **any** are missing, **stop immediately** and tell the user exactly which are missing, then instruct them to create the folders and copy the template files from a repo that has them. Use this message shape (list only the missing items):

> ⚠️ This repo isn't set up for the release-notes workflow. Missing:
> - `docs/releases/` (directory)
> - `docs/releases/Release_Guide_TEMPLATE.md`
> - `docs/templates/RELEASE_NOTES.md`
>
> Create the missing folder(s) and copy the template file(s) from a repo that has them (e.g. `auro-formkit`), then re-run `/release-notes`.

Do not run any further steps, and do not create these files yourself — the templates carry repo-specific structure the user must supply.

---

## Step 1 — Determine the last released version, and whether this branch already has a notes file

`package.json` in `auro-formkit` is `0.0.0` (managed by semantic-release), so it is **not** the source of truth. The **release-notes filenames are.** This step produces two things: the **base (last released) version**, and the **mode** — *update* if this branch already has an in-progress release-notes file, otherwise *create*.

**1a — List the release files on disk.** `Glob` `docs/releases/*.md`, **excluding** `Release_Guide_TEMPLATE.md`. Filenames are zero-padded, two digits per segment: `NN.NN.NN.md` (e.g. `06.00.02.md`). Parse each into a numeric `major.minor.patch` triple (compare numerically, not as strings).

**1b — Identify any in-progress file(s) for this branch.** A release file is *in-progress* if it exists in the working tree but has **not yet been released** — i.e. it was created on the current branch or isn't committed. Take the **union** of:
- **Uncommitted additions** — `git status --porcelain -- docs/releases/`: lines starting with `??` (untracked) or `A` (staged add).
- **Added on this branch vs. the default branch** — resolve the default branch with `git rev-parse --abbrev-ref origin/HEAD` (fall back to `origin/main`, then `main`), then `git diff --name-status <default>...HEAD -- docs/releases/`: files with status `A`.

Ignore `Release_Guide_TEMPLATE.md`. Call the result the **in-progress set** (normally zero or one file).

**1c — Base (last released) version.** From the disk files **excluding the in-progress set**, pick the highest by numeric semver order. Record its padded form (`06.00.02`) and human semver (`6.0.2`) — this is the **base version**. If nothing remains (all files are in-progress, or there are none), treat the base as `0.0.0` and note this will be the first release; continue.

> Excluding the in-progress set is what prevents a file the skill created earlier on this branch from being mistaken for the base and triggering a **second** version bump / duplicate file.

**1d — Choose the mode.**
- **In-progress set empty → create mode** (a brand-new file, the default flow).
- **Exactly one in-progress file → update mode.** That file is the **target**; the skill will refresh it in place rather than create a new one. Record its path and its version (parsed from the filename).
- **More than one in-progress file → ambiguous.** Ask the user with `AskUserQuestion` which file to update (or to start a fresh create), and proceed on their choice.

---

## Step 2 — Determine the commit range to assess

You need every commit that has landed **since the base release was cut**, up to `HEAD`.

**If `${input}` is non-empty**, treat it as an explicit base ref and use the range `<${input}>..HEAD` (verify it resolves with `git rev-parse --verify <ref>`; if it doesn't, tell the user the ref is invalid and stop). Skip the automatic detection below.

**Otherwise**, detect the boundary automatically, in this order:

1. **The commit that added the latest release file** (preferred — robust even when tags lag):
   ```
   git log --diff-filter=A --format=%H -- docs/releases/<base padded>.md
   ```
   Take the **last** line (the original add). The range is `<that commit>..HEAD`.
2. **Matching version tag** — if step 1 finds nothing, try `git rev-parse --verify v<base semver>` (e.g. `v6.0.2`). If it resolves, use `v<base semver>..HEAD`.
3. **Prompt once** — if neither resolves, ask the user with `AskUserQuestion` for a base ref (tag/branch/commit) to compare against, then use `<ref>..HEAD`.

List the commits in the range for classification — **subjects only** (do not pull bodies yet; they're only needed in Step 4, and only for the commits that make it into the notes):
```
git log --format=%H%x1f%s <range>
```
(`\x1f` separates hash from subject; one commit per line.) Then, in a single targeted call, get the hashes of any commits whose **body** carries a breaking-change footer — so you don't load every body just to find the rare breaking one:
```
git log -E --grep='^BREAKING[ -]CHANGE:' --format=%H <range>
```
Call this the **breaking-change set**. If the classification range is **empty** (no commits), stop and report: "No commits since the base release (`<base semver>`) — nothing to release."

---

## Step 3 — Classify commits and compute the new version

Classify **each** commit in the range by Conventional Commits, using the subjects from Step 2 and the breaking-change set:

- **major** — the subject type has a `!` (e.g. `feat!:`, `fix!:`) **or** the commit hash is in the **breaking-change set** from Step 2 (the `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer grep).
- **minor** — subject type is `feat` (and not major).
- **patch** — subject type is `fix` or `perf` (and not major/minor).
- **none** — any other type (`docs`, `chore`, `ci`, `test`, `refactor`, `style`, `build`) or an unparseable subject.

Take the **highest-precedence** bump across all commits: **major > minor > patch > none.**

**No-op exit.** If the highest bump is **none** (every commit is docs/chore/ci/etc.), **stop and report why** — do not create a release notes document. Message shape:

> No release-worthy changes since `<base semver>`. The <N> commit(s) in range are all non-release types (docs/chore/ci/test/refactor/style/build), so no release notes are needed. If you expected a release, check that your `feat`/`fix`/`perf` commits are on this branch.

Briefly list the commit subjects you assessed so the user can verify.

**Compute the new version** from the base version and the bump:
- major → `(base.major + 1).0.0`
- minor → `base.major.(base.minor + 1).0`
- patch → `base.major.base.minor.(base.patch + 1)`

Record the new semver (e.g. `6.1.0`) and its zero-padded filename form (`06.01.00`).

**Update mode — reconcile against the existing file.** In update mode you already know the in-progress file's version (Step 1d). Use **that existing file's version and filename** as the target for Steps 4–6 — do not create a second file or rename it here. Normally the freshly computed version equals it. If they **differ** (e.g. a `feat` landed since the file was first written, escalating a patch to a minor), still refresh the existing file, but record the mismatch and surface it in the Step 7 report so the user can decide whether to regenerate fresh at the new number (by deleting the stale file and re-running, or passing an explicit base ref). In **create mode**, the target is the newly computed version/filename.

---

## Step 4 — Generate the release-notes file

**Read** `docs/releases/Release_Guide_TEMPLATE.md` — it defines the required structure and carries HTML comments telling you which sections to include or omit. Also **Read** the most recent existing release file (the base version's) as a concrete style reference for tone, grouping, and detail level. **In update mode, also Read the target in-progress file** (Step 1d) before rewriting it, so you preserve any manual edits and keep tone consistent while refreshing it over the full range.

Determine the **target path**:
- **Create mode:** `docs/releases/<new padded>.md` (e.g. `docs/releases/06.01.00.md`).
- **Update mode:** the existing in-progress file's path (Step 1d) — **overwrite it in place** with the regenerated notes covering the full unreleased range.

Write the file to the target path, following the template and honoring its include/omit rules:

- **Intro + release-type line** — always. State the previous version and that this is a `<major|minor|patch>` release, with a one-clause focus and breaking-change status.
- **Summary** — always. An executive-summary paragraph plus consumer-facing bullets (what now works / what changed), not a raw commit log. Close with the migration-impact line.
- **Breaking Changes + Migration** — only for a **major** bump.
- **Features** — only if there are `feat` commits. Group items under `### AURO-<COMPONENT>`.
- **Bug Fixes** — if there are `fix` commits. Keep the template's `_Note: ..._` line verbatim.
- **Improvements** — if there are `perf` commits. Keep the template's `_Note: ..._` line verbatim.
- **Build & Packaging / Test Coverage / Documentation** — include only when the commit set has relevant `build`/`ci`, test, or docs changes worth surfacing.

**Per-item shape** (matching recent notes):
```
- **<imperative summary>** — [<ref>](<link>)

    <indented detail paragraph: what changed / why / what was broken and how it's fixed>
```

**Deriving the details for each item:**
- **Component grouping** — infer the component from the files each commit touched. Get the file lists for the **whole range in one call**, not a `git show` per commit:
  ```
  git log --format='%x1e%H %s' --name-only <range>
  ```
  (`\x1e` marks each commit boundary; the header line is `<hash> <subject>`, followed by that commit's file paths.) Map `components/<name>/...` → `AURO-<NAME>` (uppercased). If a commit spans several components, place it under the primary one; if there's no clear component, group it under a general heading or the relevant top-level section.
- **Reference link** — extract the trailing reference from the commit subject and link it:
  - `AB#<7 digits>` (ADO work item) → `[AB#<n>](https://itsals.visualstudio.com/5e9f12eb-f830-406f-bee9-be25938f7aaa/_workitems/edit/<n>)`
  - `#<n>` (GitHub PR) → `[#<n>](https://github.com/AlaskaAirlines/auro-formkit/pull/<n>)`
  - If a commit has no reference, omit the link (just the bold summary + detail).
- **Detail paragraph** — pull bodies for **only the release-worthy commits** (the `feat`/`fix`/`perf` ones that will appear in the notes), not the whole range — batch them in one call: `git show -s --format='%x1e%H%n%b' <hash> <hash> …`. Synthesize the detail from the subject and body. When the body is thin, you already have the commit's file list from the component-grouping call above; only when subject + body + file list still don't explain the change, pull the patch **scoped to the relevant path** (`git show <hash> -- <path>`). Do not pull full, unscoped diffs, and do not invent behavior you can't see in the commit.
- **Post-mortems** — if the range added files under `docs/post-mortem/`, link them from the Documentation section (match the existing notes' style).

Keep the writing at the altitude of the recent notes: precise, consumer-facing, no filler.

---

## Step 5 — Wire the new release into the accordion index

**Read** `docs/templates/RELEASE_NOTES.md`. It is a list of `<auro-accordion>` blocks, each with a `<span slot="trigger">FormKit v<version></span>` and an `AURO-GENERATED-CONTENT` include that pulls in the matching release file. Exactly the newest release is expanded (`<auro-accordion expanded>`); the rest are collapsed.

**Update mode — refresh, don't duplicate.** First check whether a block already references the target file (`docs/releases/<target padded>.md`) or its version in the trigger. If one **already exists** (a previous run wired it), do **not** insert another — just ensure it is the **sole** `expanded` block (collapse any other expanded one) and that its `src` and trigger are correct, then skip edit 1 below. If no block exists yet for the target version, insert it exactly as in create mode.

Make the following edits (in create mode, and in update mode only when the target block is missing):

1. **Insert** a new block for the target version as the **first** accordion (immediately after the intro paragraph / changelog link, before the current first accordion), expanded:
   ```
   <auro-accordion expanded>
   <span slot="trigger">FormKit v<target semver></span>

   <!-- AURO-GENERATED-CONTENT:START (FILE:src=./docs/releases/<target padded>.md) -->
   <!-- AURO-GENERATED-CONTENT:END -->

   </auro-accordion>
   ```
   Use the human semver in the trigger (e.g. `FormKit v6.1.0`) and the zero-padded filename in the include `src` (e.g. `./docs/releases/06.01.00.md`) — match the exact spacing/format of the existing blocks.

2. **Collapse the previously-expanded accordion** — change its `<auro-accordion expanded>` to `<auro-accordion>` so that **only** the target release is expanded.

Verify afterward that exactly one `<auro-accordion expanded>` remains in the file (the target release) and that the target version appears in exactly **one** accordion block (no duplicates). Do not touch the trailing `CHANGELOG.md` include or any other content.

---

## Step 6 — Stage the changed files

Stage exactly the new/changed files (do **not** commit, do **not** push). Use the **target padded** filename — the newly computed one in create mode, or the existing in-progress file in update mode:
```
git add docs/releases/<target padded>.md docs/templates/RELEASE_NOTES.md
```
Then run `git status` to confirm both are staged and nothing unexpected was picked up.

---

## Step 7 — Report

Tell the user concisely:
- Whether this was a **create** (new file) or an **update** (refreshed the existing in-progress file for this branch).
- **Base (last released) version** and **target version**, with the **bump type** and the reason — the specific commit(s) that triggered it (e.g. "minor: `feat(select): add multiselect AB#123`").
- In update mode, **if the recomputed version differed** from the existing file's version, say so plainly and note the options (delete the stale file and re-run, or pass an explicit base ref) so the number can be corrected.
- A one-line summary of what each section of the generated file covers.
- The path of the file written (`docs/releases/<target padded>.md`) and that it plus `docs/templates/RELEASE_NOTES.md` are **staged and ready to commit** (suggest `/commit` to finalize).

Do not commit or push — hand control back to the user.
