---
name: coding-standards
description: Auro design-system coding standards distilled from team post-mortems. Consult before writing, modifying, or reviewing code in any Auro repository — component source, styles, tests, build/release config, or plugin tooling — to apply the rules the team has already learned. Read-only: it advises, it never edits.
allowed-tools: Read, Glob, Grep
---

## Stop here if this is not code work

**If this task is not writing, modifying, or reviewing code, stop now and say nothing.** Do not open a reference file. Do not mention this skill, and do not report that you checked it and found nothing. Continue the task exactly as if the skill had never loaded.

This skill is selected by a fuzzy match against its description, so it will sometimes load on work it has no business in. That is expected and cheap — one read of this file — provided you exit here rather than further down.

**Not code work, exit now:** writing a sprint report; drafting, grooming, or querying an ADO ticket; answering a question about repository or release history; renaming or moving files; authoring a post-mortem or TRD; summarizing a discussion or a pull-request thread.

**Code work, continue:** authoring or changing component source, styles, or tokens; writing or changing tests; changing build, bundler, dependency, or release configuration; authoring skill, agent, or hook instructions; reviewing a diff containing any of those.

---

## Always-on

These six apply to every code task, before the routing table and independently of which categories match.

1. **Read-only.** This skill advises; it never edits a file, runs a command, or opens a pull request. The rules shape the code the task itself writes.
2. **A rule is a rule everywhere.** These standards apply to all Auro code in every Auro repository. There is no per-repo scoping, and no rule is limited to the project it was learned in — a lesson from `auro-formkit` applies in `auro-button` unless something technical makes it inapplicable. **Most rules carry no `Applies to` line; those apply unconditionally.** Where one is present it states a *technical precondition*: if it does not describe the change in front of you, skip the rule and do not mention it. Judge that against the code, never against which repo you are in.
3. **Cite by ID.** When a rule changes what you write, name it — `CS-A11Y-003` — so the engineer can trace the advice back to the post-mortem that taught it. Cite the ID only; do not paste the rule body back.
4. **Open `references/tool.md` whenever the task will produce a commit, a pull request, or a change to skill/agent/hook instructions** — regardless of which other rows matched below. Those rules govern the act of shipping the work rather than the code itself, so they have no routing condition of their own.
5. **An empty category is not an error.** A file with no rules under `## Rules` simply means the team has not written standards for that category yet. Carry on with whatever else matched and **say nothing about it in your response** — not that a file was empty, not that there was nothing to cite, not that you consulted the standards at all. When no rule applies, the correct output is silence.
6. **Do not invent rules.** Apply only what is written in the reference files. If nothing applies, apply nothing — no output is the correct output.

---

## Routing — open every category that matches

Evaluate **every row below independently**, then `Read` **all** the files that matched. This is a set of co-occurring conditions, not a classification: a real task routinely matches three or four rows, and the most valuable match is usually the non-obvious one.

**Do not choose the best-matching category. Matching exactly one row is a signal that you under-matched — re-read the list before proceeding.**

Paths are relative to this file.

| File | Open it when **any** of these is true |
|---|---|
| `references/a11y.md` | The change touches an ARIA attribute or a role; the component's accessible name, description, or state can change; validity, error, or expansion state is communicated to assistive technology; or you are about to add a role. A label or error-text change counts — the label *is* the accessible name. |
| `references/form.md` | The change involves validation or validity state, form submission or `reset()`, a retained hidden native control, autofill or password-manager behavior, or a value set programmatically rather than typed. |
| `references/intx.md` | The change handles keyboard or pointer events, modifier or chorded keys, moves or traps focus, or maintains a typeahead or selection buffer — including when the interaction is incidental to a validation or lifecycle change rather than the point of it. |
| `references/life.md` | The change adds or removes an observer, listener, or timer; uses `firstUpdated`, `connectedCallback`, `disconnectedCallback`, or `updated`; depends on a reactive property update; or the symptom appears only after the element is moved, re-rendered, or re-inserted. |
| `references/style.md` | The change crosses the shadow boundary, adds or edits CSS, uses or adds a design token, or affects layout, spacing, or overflow — including styling added in service of an accessibility or interaction change. |
| `references/api.md` | The change adds, renames, removes, or deprecates an attribute, property, event, slot, or CSS custom property; touches the custom-elements manifest or editor IntelliSense; or alters documented behavior a consumer relies on. |
| `references/build.md` | The change touches bundler or monorepo task configuration, `package.json` dependencies or exports, the published artifact, versioning, or the question of which gate a check belongs on. |
| `references/test.md` | The task writes, changes, or reviews a test — which includes the regression test for a bug fix, so nearly every fix matches this row. Also open it for changes to timing, fake timers, or CI configuration. |
| `references/xbrw.md` | The change depends on browser-specific behavior, or on consumption from React, Vue, or Angular — including wrapper packages, SSR, and framework-level event or property binding. |
| `references/tool.md` | The task authors or edits a skill, agent, command, or hook; builds shell commands that must run in a sandbox; or will produce a commit message, pull-request description, or any document that cites another artifact. **Also opened unconditionally per always-on directive 4.** |

**Worked example.** *"`auro-select`'s label stops updating after the component is moved in the DOM."* Three rows match: `life.md` (observer re-attachment across a DOM move), `test.md` (the fix needs a regression test), and `a11y.md` (a stale label is a stale accessible name, not a cosmetic bug). Seven files stay closed and cost nothing. The third match is the one an engineer would not have thought to make, and it is the reason this table is not a classifier.

---

## Applying what you read

- Apply rules **as you author**, in the same pass. Do not produce a standards report alongside unchanged code.
- Discard a rule only when it carries an `Applies to` precondition that does not describe this change (always-on directive 2). Do not list what you discarded.
- Where a rule changed a decision, cite its ID in one short clause. Where it merely confirmed what you were going to do, say nothing.
- If a rule conflicts with an explicit instruction from the engineer, follow the engineer and note in one line which rule you set aside and why.

Each rule is one block: `### CS-<CAT>-<NNN> — <imperative title>`, a one-to-four-sentence body, then `Sources` (one or more `AB#`), optionally `Applies to` when the rule has a technical precondition, and `Learned: ×N` when more than one post-mortem taught it. A high `×N` means the team has made that mistake repeatedly — weight it accordingly.
