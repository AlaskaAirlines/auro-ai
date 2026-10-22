---
name: capture-standard
description: Capture coding standards from the post-mortems a release carries, while preparing that release. Run when asked to capture coding standards or lessons from a release, an rc branch, or a commit range into the Auro coding-standards corpus — usually by the release-prep skill as an rc branch is merged into main. Proposes new rules and source-appends, previews them, and on one confirmation opens a pull request against auro-ai plus a review ticket. Not for writing or reviewing code, writing post-mortems, or release notes.
argument-hint: "<repo> <branch | from..to> [--corpus-ref <branch>]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/capture.sh), Bash(${CLAUDE_SKILL_DIR}/scripts/capture.sh *), Read, Edit(//tmp/capture_out/**), Edit(//tmp/capture_pr_body.md), Edit(//tmp/capture_checks.tsv), AskUserQuestion
---

## Task — start now

Turn the post-mortems a release carries into a reviewed pull request of proposed coding standards. Work through the steps below **in order**. Steps 1–5 are **read-only**. Step 6 asks **one** confirmation. Step 7 is the **only** step that writes anything — a branch and pull request on `AlaskaAirlines/auro-ai`, an Azure DevOps review ticket, and a check ticket for each machine-checkable rule — and only after an explicit yes.

**This skill never blocks a release.** If any step fails, stop, report the failure as the result line (see *Calling contract*), and let the caller carry on. Capture can be re-run for the same branch afterwards; re-running is safe.

## Calling contract

Release prep (or a person) calls this skill with:

| Input | Form | Default |
|---|---|---|
| repo | the releasing repository, `auro-formkit` or `AlaskaAirlines/auro-formkit` | — required |
| what is released | the branch being merged into `main` (`rc/1638615`), or an explicit `<from>..<to>` range for testing and recovery (`v6.0.2..v6.0.3`) | — required |
| `--corpus-ref` | the `auro-ai` branch whose rules are deduped against and which the PR targets | `main` |

The caller gets back **exactly one** line, always the last thing this skill prints, starting `CAPTURE_RESULT:`:

- `CAPTURE_RESULT: PR <url> · review ticket AB#<id> · check tickets: <list>` — published (on a re-run, with `· re-run: branch reset, body replaced`). `<list>` is `AB#<id> CS-<…> (new|existing), …`, or `none flagged` when no rule is machine-checkable;
- `CAPTURE_RESULT: nothing extractable — <why>` — no post-mortems, or none yielded a change;
- `CAPTURE_RESULT: declined — nothing written` — the person said no at Step 6;
- `CAPTURE_RESULT: failed — <step and reason>` — anything else. **The caller reports it and continues the release.**

A ticket failure after the PR opened is still a published result; the line says so and a re-run retries the ticket. Check tickets are linked to the review ticket, so with no review ticket the segment reads `check tickets: not raised (no review ticket …) — re-run publish to retry`; a check ticket that failed on its own is named in a `· <n> check ticket(s) FAILED: …` segment. A caller that only needs the PR should read up to the first ` · ` — the segments after it may grow.

**How to run each step.** All shell work lives in `${CLAUDE_SKILL_DIR}/scripts/capture.sh`; each step is one call to it. Run every command **exactly as written** — one call per Bash invocation, the path unquoted, nothing added: no `cd`, no `VAR=value` prefix, no `&&`/`;`, no pipes or redirects. That shape is all the permission rule approves. Put arguments in **single quotes** (branch names can contain `#`). State passes between steps through `/tmp/capture_*` files, so there is nothing to carry between calls. Never call `gh` or `curl` directly — if a step needs something the script does not do, stop and say so.

**In Copilot,** the skill-directory variable at the start of the paths in this file is left unexpanded. If a path still begins with a `$`-variable, replace that variable with this skill's base directory, given at the top of the skill's context.

**Access.** GitHub goes through the runner's own `gh` login, so the PR is theirs and CI runs on it. Azure DevOps uses `$ADO_PAT`. Without a token, Steps 1–6 still run, but escape detection (Step 5b) is skipped, shipped checks cannot be read, and no review or check ticket can be created — say so in the preview. Never print the token.

---

## Step 1 — What is being released

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh range '<repo>' '<branch or from..to>'
```

It pins both ends to commits, names the capture branch (`capture/<repo>-<label>`), and prints the **run date**. `EMPTY_RANGE` → result `nothing extractable — nothing is being released`. `REPO_NOT_FOUND` / `REF_NOT_FOUND` / `GH_AUTH_MISSING` → result `failed`.

## Step 2 — Tickets and post-mortems

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh tickets
${CLAUDE_SKILL_DIR}/scripts/capture.sh postmortems
```

`tickets` finds every `AB#` in the range's commit messages and every merged PR number, with each ticket's ADO state and **closed date**. `postmortems` fetches `docs/post-mortem/<id>.md` from the head of the range for each one — by ticket, or by PR number for post-mortems named that way. Over-inclusion is harmless: a post-mortem whose lessons are already in the corpus produces no change. `WARNING_INCOMPLETE` goes into the PR body.

`NO_POSTMORTEMS` → skip Step 3 and run Step 4 anyway: a check may have shipped since the last capture, and recording it (Step 5b) is a change worth publishing. If `checks` lists no shipped check still to record either, the result is `nothing extractable — no post-mortems in this release`. `GITHUB_FAILED` (the post-mortem list or a post-mortem could not be read; only a missing `docs/post-mortem/` counts as none) → result `failed`, never "nothing extractable".

## Step 3 — Locate the lessons

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh sections
```

For each post-mortem it prints the title, the tickets its body cites, whether it has a root-cause heading, and the **raw text of every lessons section** — `Learnings`, `Lessons…`, `Key Lessons`, `Recommendations…`, `Takeaway`, `Prevention`, `Symptoms → Lesson` tables — at any heading level. Locating is deterministic; **deciding what the lessons are is your job.**

## Step 4 — Corpus, IDs, existing PR

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh corpus '<corpus ref>'
${CLAUDE_SKILL_DIR}/scripts/capture.sh next-ids
${CLAUDE_SKILL_DIR}/scripts/capture.sh open-pr
${CLAUDE_SKILL_DIR}/scripts/capture.sh checks
```

Pass `--corpus-ref` if one was given, otherwise `main`. `corpus` copies every category file to `/tmp/capture_corpus/<cat>.md` and prints an index: ID, active or retired, title, sources, `Since`, `Enforced by`. **Read** the category files you need for full rule text. `CORPUS_MISSING` on `main` means Phase 1 has not landed there — result `failed — corpus ref has no rules; pass --corpus-ref`. `next-ids` prints the next free ID per category, already accounting for IDs held by other open capture PRs. `open-pr` says whether this branch already has a PR (a re-run) and its review ticket. `checks` lists every `coding-standards-check` ticket with its rule and a status: **open**, **shipped** (Closed as *Acceptance tests pass* or *Code complete…*, **and** Committed, Active or Resolved at some point before), **no-check** (Closed as out of scope, rejected, abandoned or in error), or **unclear** (Closed for any other reason, or closed as done without ever being worked on — ADO records *Acceptance tests pass* whenever a New ticket is closed, so that alone cannot mean shipped. Show it in the preview; never treat it as shipped).

---

## Step 5 — Extract, dedupe, write the proposal

### 5a. Extract candidates

For **each** post-mortem, read its located sections and extract candidate rules. A candidate is:

- **category** — one of `a11y form intx life style api build test xbrw tool`. Choose the **mechanism that fails**, not the symptom that was reported (`CS-A11Y-001`'s defect is two code paths drifting apart, which surfaced as an ARIA bug). If a second category is **defensibly arguable, flag it** — the team decides before the ID is permanent;
- **title** — imperative, ≤ 80 characters;
- **body** — 1–4 sentences: the rule and the failure it prevents. No narrative, no ticket history;
- **source** — `AB#<7 digits>`, or `<repo>#<n>` for a PR-named post-mortem;
- **applies to** — only for a genuine *technical precondition* ("any build orchestrated by Turbo"). Usually absent. Never a repo name where a condition will do;
- **machine check** — could a machine catch a breach of this rule, so it no longer depends on someone remembering it? Give the **kind** — `lint` (a lint rule), `build` (a build or bundler setting), `test` (a test that fails on the breach), `helper` (a shared helper that makes the wrong shape impossible to write), or `none` — and for anything but `none` the **target repo and file** where it would live (`auro-formkit` `eslint.config.mjs`) and a **one-line reason** it would catch the breach. Judge whether a check is *feasible and precise*, not whether it is easy: a check that cannot tell the breach from correct code is `none`. Most rules are `none` — judgment rules, like naming the accessible name, stay human.

Rules that bite:

- **Fan-out is normal.** One post-mortem often yields several rules across categories. Fan-in is too — two tickets teaching one lesson become one rule.
- **The extraction bar — a candidate must pass all three, or it is rejected with the test it failed.** The corpus is meant to be a small set of stable rules, not a log of every lesson:
  1. **It changes code.** You can name a concrete output it changes. "Test thoroughly" and "consider accessibility" fail.
  2. **It changes what is written, not how someone investigates.** "Re-derive the repro from the live component" and "a bug that works sometimes is a tell" are good habits, and fail.
  3. **It generalises beyond the component it came from.** A fact about one component's internals — which class holds `auro-input`'s text — fails; the lesson behind it, if there is one that holds for other components, may pass.
- **Within one post-mortem, dedupe first.** A `Symptoms → Lesson` table often restates the lessons section below it — one lesson, one candidate.
- **No lessons section** (`sections: NONE`) **but a real post-mortem** (it has a title, a ticket and a root cause): **Read** `/tmp/capture_pm/<file>` and derive candidates from its root cause and fix, each labelled **derived** — or record "nothing extractable" honestly. **Never fabricate.**
- **Not a post-mortem** — no H1, no ticket ID, no root-cause heading (consumer release notes have landed in `docs/post-mortem/` before): skip it, and list it as *not a post-mortem*.

### 5b. Dedupe — batch first, then the corpus

Give every candidate **exactly one** outcome and a **one-line reason**:

| Outcome | When | Action |
|---|---|---|
| **new** | No equivalent in the batch or the corpus | New rule: the next free ID for its category, assigned upward within this run; `Since` = the run date |
| **merged in batch** | Equivalent to another candidate in this run | One rule citing every source; the others record this outcome pointing at it |
| **source-append** | Equivalent to an existing **active** rule that does not yet cite this source | Append the source to `Sources`, set `Learned: ×N` to the new distinct-source count, keep the ID and `Since`. Keep the wording: add at most one sentence, and only for a shape the rule as written does not cover |
| **already cited — no change** | The existing rule already cites this source | Nothing. Re-capturing a post-mortem must change nothing |
| **rejected** | Fails one of the extraction bar's three tests — the reason names which | Nothing |

Equivalence is about the **lesson**, not the wording. When unsure between *new* and *source-append*, prefer *source-append* and say why — a near-duplicate rule is the costlier mistake. Never append to a retired rule or a tombstone; never retire, merge or renumber existing rules — that is a review decision.

**Escape detection.** For every **source-append**, compare the source ticket's **closed date** (Step 2) with the rule's `Since`. Closed **after** `Since` means the rule existed and the mistake shipped anyway — an **escape**. Each escape gets a root-cause stub in the PR body (below). With no ADO data, say escape detection was skipped.

**Repeat lessons this release** are those escapes counted: every source in this release dated after the `Since` of the rule it matches. This count is the project's main measure of whether the standards work, so the PR body reports it **every** release, including zero. A PR-named source has no closed date — list it as *date unknown* rather than guess.

**Check tickets.** Each rule this run proposes or source-appends whose **machine check** is not `none` gets one line in `/tmp/capture_checks.tsv` (5c) — judged once per resulting rule, so a batch merge is one line. Skip a rule that already has `Enforced by`, and a rule whose ticket `checks` lists as **no-check** (the team declined it; name it under *For the reviewer* rather than raise it again). An **open** ticket for the rule is reused on publish, never duplicated.

**Shipped checks.** For each **shipped** row in `checks` whose rule is active in the corpus and has no `Enforced by` yet, add `- **Enforced by:** <planned check> (AB#<ticket>)` to that rule — for example `- **Enforced by:** lint — auro-formkit \`eslint.config.mjs\` (AB#1670001)`. If the planned check is `-` or not in the form `<kind> — <repo> \`<path>\``, do not invent one: list the rule under *For the reviewer* as *shipped, location needed*. Recording a check never retires its rule — that is a review decision.

### 5c. Write the proposal

For each category that changes, **Read** `/tmp/capture_corpus/<cat>.md` and **Write** the full new file to `/tmp/capture_out/<cat>.md` — the corpus text with new rules appended under `## Rules`, and source-appends and `Enforced by` records edited in place. Only changed categories; nothing else in the file moves. Use the **Write** tool, never a shell `mkdir`/`cp` (Write creates `/tmp/capture_out/`; the frontmatter's `Edit(//tmp/capture_out/**)` is the grant that covers it — Claude Code matches file permissions only through `Edit(path)` rules). Each rule block:

```markdown
### CS-<CAT>-<NNN> — <imperative title>

<1–4 sentence body>

- **Sources:** AB#1234567, auro-formkit#1511
- **Applies to:** <only if a technical precondition>
- **Learned:** ×2
- **Since:** <YYYY-MM-DD>
```

`Learned` only when there is more than one distinct source. `Enforced by` only on a rule whose check has shipped (5b).

Then **Write** `/tmp/capture_checks.tsv`: one line per rule that gets a check ticket (5b), five tab-separated fields — rule ID, kind, target repo, target path, one-line reason:

```
CS-BUILD-004	lint	auro-formkit	eslint.config.mjs	an import rule can see a deep import from another package's src/
```

Write the file **even when it is empty** — an empty file records that nothing in this capture is machine-checkable. Then check everything:

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh check
```

It validates `/tmp/capture_checks.tsv`, then runs the corpus ref's own validator over the proposal — the same gate CI runs on the PR. On `CHECKS_INVALID` or `CHECK_FAILED`, fix the files and re-run until `CHECK_OK`. `NO_CHANGES` (every candidate was *already cited* or *rejected*) → nothing to publish: result `nothing extractable — every lesson is already in the corpus`, after showing the outcomes.

Then **Write** the PR body to `/tmp/capture_pr_body.md`, in this order. It is the full record reviewers work from:

```markdown
**Review ticket:** {{REVIEW_TICKET}}

## Release
`<repo>` `<base>...<head>` · <n> commits · run <date> · corpus `<ref>` @ `<sha7>`
Tickets: <all, comma-separated> · with post-mortems: <…> · without: <…>

## Post-mortems
### <file> — <title>
Located: `<heading>` (line <n>)[, …] — or **none located**
| # | Candidate | Outcome | Rule | Reason |
|---|---|---|---|---|

## Repeat lessons this release
**<n>** — <for each: `AB#<id>` closed <date> repeats `CS-<…>` (since <Since>)> — or **0**

## Machine-checkable
**Check tickets:** {{CHECK_TICKETS}}
| Rule | Kind | Where | Why a machine can catch it |
|---|---|---|---|
**Enforced by recorded** — <rule: check, from AB#<ticket>> — or none

## For the reviewer
**Arguable categories** — <rule: category chosen vs. alternative, and why>
**Derived candidates** — <rule: derived from which section of which post-mortem>
**Escapes** — for each:
> `AB#<id>` closed <date>, after `CS-<…>` shipped on <Since>. Which link failed? — [ ] trigger (the skill never loaded) · [ ] routing (its category was not opened) · [ ] platitude (too vague to change the code) · [ ] precondition (`Applies to` too narrow)

**Check tickets to settle** — <rules whose check the team declined (no-check), whose ticket closed for an unclear reason, or whose shipped check has no location> — or none
**Not post-mortems** — <files> · **No lessons located** — <files>
```

The **Machine-checkable** table has one row per line of `/tmp/capture_checks.tsv`. A reviewer who rejects a rule closes its check ticket — the review ticket's acceptance criteria say so.

Keep `{{REVIEW_TICKET}}` and `{{CHECK_TICKETS}}` exactly as written — `publish` fills them in. Write "none" under any empty flag rather than dropping the heading: a reviewer should see that nothing was flagged.

---

## Step 6 — Preview and the one confirmation

Show a short summary in chat: the release, how many post-mortems, a table of candidates (**ID or rule · outcome · machine check · one-line reason**), the repeat-lesson count, any `Enforced by` being recorded, the flags, whether this **opens** a new PR or **replaces** an existing one (`open-pr`), and **how many check tickets will be raised** — the count `check` printed, noting that an open ticket for the same rule is reused rather than duplicated. Then ask with `AskUserQuestion`:

> Publish this capture — a pull request against `auro-ai` targeting `<corpus ref>`, a review ticket, and <n> check ticket(s)? (On a re-run: replace the existing PR's branch and body.)

Options: **Publish** · **Don't publish**. Anything but **Publish** → nothing is written; result `declined — nothing written`. When called by release prep, still ask: nothing is published without a person's yes.

## Step 7 — Publish (only after Publish)

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh publish
```

It re-runs `check`, writes one commit on the corpus ref's tip and points `capture/<repo>-<label>` at it — **resetting** the branch on a re-run, never appending — opens the PR or replaces its body, and, if the PR has no review ticket yet, creates a **Committed** User Story in the current sprint (area `auro-ai`, tag `coding-standards-capture`) and writes its `AB#` into the body. Then, for each line of `/tmp/capture_checks.tsv`, it raises a check ticket — a **New** User Story with no sprint, tag `coding-standards-check`, on the target repo's area under the Auro team (the team's root area if that repo has none), linked to the review ticket and the PR — or reuses an open one for the same rule (any state but Closed, Rejected or Removed, so Resolved counts), and writes the list into **Check tickets:** in the body. The check ticket asks the team to move it to Active when work starts and close it as *Acceptance tests pass* when the check ships, which is what the next capture's `checks` reads as **shipped**. To decline, the team closes it as *Abandoned* or *Out of scope*: once a ticket has been worked on, a close with any other reason reads as shipped. Its last line is always a `CAPTURE_RESULT:` line — published, or `failed — <reason>` for any failure along the way — and a ticket reused from an earlier partial run is named as such (only an open one is reused: a Closed or Resolved story with the same title gets a new ticket; a reused one is linked to this PR and moved to Committed if it was left New). **Print it verbatim as your final line.**
