---
name: capture-standard
description: Capture coding standards from the post-mortems a release carries, while preparing that release. Run when asked to capture coding standards or lessons from a release, an rc branch, or a commit range into the Auro coding-standards corpus — usually by the release-prep skill as an rc branch is merged into main. Proposes new rules and source-appends, previews them, and on one confirmation opens a pull request against auro-ai plus a review ticket. Not for writing or reviewing code, writing post-mortems, or release notes.
argument-hint: "<repo> <branch | from..to> [--corpus-ref <branch>]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/capture.sh), Bash(${CLAUDE_SKILL_DIR}/scripts/capture.sh *), Read, Write(/tmp/*), AskUserQuestion
---

## Task — start now

Turn the post-mortems a release carries into a reviewed pull request of proposed coding standards. Work through the steps below **in order**. Steps 1–5 are **read-only**. Step 6 asks **one** confirmation. Step 7 is the **only** step that writes anything — a branch and pull request on `AlaskaAirlines/auro-ai`, and an Azure DevOps review ticket — and only after an explicit yes.

**This skill never blocks a release.** If any step fails, stop, report the failure as the result line (see *Calling contract*), and let the caller carry on. Capture can be re-run for the same branch afterwards; re-running is safe.

## Calling contract

Release prep (or a person) calls this skill with:

| Input | Form | Default |
|---|---|---|
| repo | the releasing repository, `auro-formkit` or `AlaskaAirlines/auro-formkit` | — required |
| what is released | the branch being merged into `main` (`rc/1638615`), or an explicit `<from>..<to>` range for testing and recovery (`v6.0.2..v6.0.3`) | — required |
| `--corpus-ref` | the `auro-ai` branch whose rules are deduped against and which the PR targets | `main` |

The caller gets back **exactly one** line, always the last thing this skill prints, starting `CAPTURE_RESULT:`:

- `CAPTURE_RESULT: PR <url> · review ticket AB#<id>` — published (on a re-run, with `· re-run: branch reset, body replaced`);
- `CAPTURE_RESULT: nothing extractable — <why>` — no post-mortems, or none yielded a change;
- `CAPTURE_RESULT: declined — nothing written` — the person said no at Step 6;
- `CAPTURE_RESULT: failed — <step and reason>` — anything else. **The caller reports it and continues the release.**

A ticket failure after the PR opened is still a published result; the line says so and a re-run retries the ticket.

**How to run each step.** All shell work lives in `${CLAUDE_SKILL_DIR}/scripts/capture.sh`; each step is one call to it. Run every command **exactly as written** — one call per Bash invocation, the path unquoted, nothing added: no `cd`, no `VAR=value` prefix, no `&&`/`;`, no pipes or redirects. That shape is all the permission rule approves. Put arguments in **single quotes** (branch names can contain `#`). State passes between steps through `/tmp/capture_*` files, so there is nothing to carry between calls. Never call `gh` or `curl` directly — if a step needs something the script does not do, stop and say so.

**Access.** GitHub goes through the runner's own `gh` login, so the PR is theirs and CI runs on it. Azure DevOps uses `$ADO_PAT`. Without a token, Steps 1–6 still run, but escape detection (Step 5b) is skipped and no review ticket can be created — say so in the preview. Never print the token.

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

`tickets` finds every `AB#` in the range's commit messages and every merged PR number, with each ticket's ADO state and **closed date**. `postmortems` fetches `docs/post-mortem/<id>.md` from the head of the range for each one — by ticket, or by PR number for post-mortems named that way. Over-inclusion is harmless: a post-mortem whose lessons are already in the corpus produces no change. `NO_POSTMORTEMS` → result `nothing extractable — no post-mortems in this release`. `WARNING_INCOMPLETE` goes into the PR body.

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
```

Pass `--corpus-ref` if one was given, otherwise `main`. `corpus` copies every category file to `/tmp/capture_corpus/<cat>.md` and prints an index: ID, active or retired, title, sources, `Since`. **Read** the category files you need for full rule text. `CORPUS_MISSING` on `main` means Phase 1 has not landed there — result `failed — corpus ref has no rules; pass --corpus-ref`. `next-ids` prints the next free ID per category, already accounting for IDs held by other open capture PRs. `open-pr` says whether this branch already has a PR (a re-run) and its review ticket.

---

## Step 5 — Extract, dedupe, write the proposal

### 5a. Extract candidates

For **each** post-mortem, read its located sections and extract candidate rules. A candidate is:

- **category** — one of `a11y form intx life style api build test xbrw tool`. Choose the **mechanism that fails**, not the symptom that was reported (`CS-A11Y-001`'s defect is two code paths drifting apart, which surfaced as an ARIA bug). If a second category is **defensibly arguable, flag it** — the team decides before the ID is permanent;
- **title** — imperative, ≤ 80 characters;
- **body** — 1–4 sentences: the rule and the failure it prevents. No narrative, no ticket history;
- **source** — `AB#<7 digits>`, or `<repo>#<n>` for a PR-named post-mortem;
- **applies to** — only for a genuine *technical precondition* ("any build orchestrated by Turbo"). Usually absent. Never a repo name where a condition will do.

Rules that bite:

- **Fan-out is normal.** One post-mortem often yields several rules across categories. Fan-in is too — two tickets teaching one lesson become one rule.
- **Anti-platitude bar.** A candidate survives only if you can name a concrete generated output it changes. "Test thoroughly" and "consider accessibility" are **rejected**, with that reason.
- **Within one post-mortem, dedupe first.** A `Symptoms → Lesson` table often restates the lessons section below it — one lesson, one candidate.
- **No lessons section** (`sections: NONE`) **but a real post-mortem** (it has a title, a ticket and a root cause): **Read** `/tmp/capture_pm/<file>` and derive candidates from its root cause and fix, each labelled **derived** — or record "nothing extractable" honestly. **Never fabricate.**
- **Not a post-mortem** — no H1, no ticket ID, no root-cause heading (consumer release notes have landed in `docs/post-mortem/` before): skip it, and list it as *not a post-mortem*.

### 5b. Dedupe — batch first, then the corpus

Give every candidate **exactly one** outcome and a **one-line reason**:

| Outcome | When | Action |
|---|---|---|
| **new** | No equivalent in the batch or the corpus | New rule: the next free ID for its category, assigned upward within this run; `Since` = the run date |
| **merged in batch** | Equivalent to another candidate in this run | One rule citing every source; the others record this outcome pointing at it |
| **source-append** | Equivalent to an existing **active** rule that does not yet cite this source | Append the source to `Sources`, set `Learned: ×N` to the new distinct-source count, keep the ID and `Since`. Sharpen the wording only if the new post-mortem adds real precision |
| **already cited — no change** | The existing rule already cites this source | Nothing. Re-capturing a post-mortem must change nothing |
| **rejected** | Fails the anti-platitude bar, or is not a lesson about code or tooling | Nothing |

Equivalence is about the **lesson**, not the wording. When unsure between *new* and *source-append*, prefer *source-append* and say why — a near-duplicate rule is the costlier mistake. Never append to a retired rule or a tombstone; never retire, merge or renumber existing rules — that is a review decision.

**Escape detection.** For every **source-append**, compare the source ticket's **closed date** (Step 2) with the rule's `Since`. Closed **after** `Since` means the rule existed and the mistake shipped anyway — an **escape**. Each escape gets a root-cause stub in the PR body (below). With no ADO data, say escape detection was skipped.

### 5c. Write the proposal

For each category that changes, **Read** `/tmp/capture_corpus/<cat>.md` and **Write** the full new file to `/tmp/capture_out/<cat>.md` — the corpus text with new rules appended under `## Rules` and source-appends edited in place. Only changed categories; nothing else in the file moves. Each rule block:

```markdown
### CS-<CAT>-<NNN> — <imperative title>

<1–4 sentence body>

- **Sources:** AB#1234567, auro-formkit#1511
- **Applies to:** <only if a technical precondition>
- **Learned:** ×2
- **Since:** <YYYY-MM-DD>
```

`Learned` only when there is more than one distinct source. Then check it:

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh check
```

It runs the corpus ref's own validator over the proposal — the same gate CI runs on the PR. On `CHECK_FAILED`, fix the files and re-run until `CHECK_OK`. `NO_CHANGES` (every candidate was *already cited* or *rejected*) → nothing to publish: result `nothing extractable — every lesson is already in the corpus`, after showing the outcomes.

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

## For the reviewer
**Arguable categories** — <rule: category chosen vs. alternative, and why>
**Derived candidates** — <rule: derived from which section of which post-mortem>
**Escapes** — for each:
> `AB#<id>` closed <date>, after `CS-<…>` shipped on <Since>. Which link failed? — [ ] trigger (the skill never loaded) · [ ] routing (its category was not opened) · [ ] platitude (too vague to change the code) · [ ] precondition (`Applies to` too narrow)

**Not post-mortems** — <files> · **No lessons located** — <files>
```

Keep `{{REVIEW_TICKET}}` exactly as written — `publish` fills it in. Write "none" under any empty flag rather than dropping the heading: a reviewer should see that nothing was flagged.

---

## Step 6 — Preview and the one confirmation

Show a short summary in chat: the release, how many post-mortems, a table of candidates (**ID or rule · outcome · one-line reason**), the flags, and whether this **opens** a new PR or **replaces** an existing one (`open-pr`). Then ask with `AskUserQuestion`:

> Publish this capture — a pull request against `auro-ai` targeting `<corpus ref>`, plus a review ticket? (On a re-run: replace the existing PR's branch and body.)

Options: **Publish** · **Don't publish**. Anything but **Publish** → nothing is written; result `declined — nothing written`. When called by release prep, still ask: nothing is published without a person's yes.

## Step 7 — Publish (only after Publish)

```bash
${CLAUDE_SKILL_DIR}/scripts/capture.sh publish
```

It re-runs `check`, writes one commit on the corpus ref's tip and points `capture/<repo>-<label>` at it — **resetting** the branch on a re-run, never appending — opens the PR or replaces its body, and, if the PR has no review ticket yet, creates a **Committed** User Story in the current sprint (area `auro-ai`, tag `coding-standards-capture`) and writes its `AB#` into the body. Its last line is the `CAPTURE_RESULT:` line — **print it verbatim as your final line.** A `PUBLISH_FAILED` line → result `failed — <that line>`.
