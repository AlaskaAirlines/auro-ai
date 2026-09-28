# Remedy verification — broadened `description` — 2026-09-25

The Phase 1b gate failed on S1b and S5: the skill fired only on prompts that
already used its own vocabulary. Diagnosis and ranked remedies are in
`docs/post-mortem/1643440.md`. Mitigation 1 — broaden the `description` — was
approved and applied.

**The change is one line of `plugins/auro/skills/coding-standards/SKILL.md`
frontmatter.** No rule text, no reference file, and no body logic changed. The
added vocabulary covers the three shapes that were missing:

- **debugging verbs** — `debugging, or fixing`
- **ticket references** — `AB#1234567`, a work-item URL, `"implement <ticket>"`
- **plain-language symptoms** — *not working, not updating, breaking or
  regressing after a change, wrong in one browser, wrong with a screen reader*
- **component names** — any task naming an `auro-` element

The word *report* was deliberately kept out, to avoid matching S3's
*"write me a sprint report"*.

## Results — every failing scenario now passes, and nothing regressed

| Scenario | Before | After | Arms |
|---|---|---|---|
| **S1a** names the mechanism | fired #9, edit #20 | fired **#1**, edit #20 | 1 |
| **S1b** symptom only | **never fired** | **3/3 fired #1** | 3 |
| **S2** routing narrows | build/tool/xbrw closed | still closed | from S1a |
| **S3** does not over-fire | never loaded | **still never loads** | 1 |
| **S5a** bare ticket | **never fired** | **2/2 fired before first edit** | 2 |
| **S5b** bare URL | **never fired** | fired #5, edit #36 | 1 |

### What the routing shows

- **S1b opens `a11y.md` + `life.md`.** The prompt names no mechanism — *"the
  label stops updating after the element is moved in the DOM"* — and the skill
  selected lifecycle. That is routing on intent rather than on shared
  vocabulary, which is the behaviour the effort is actually betting on.
- **S1a lost `test.md` and gained `api.md`** relative to the 09-24 run. Both
  are defensible for an attribute-contract change; the count is unchanged and
  all three forbidden categories stayed closed.
- **S5 routes to `api.md`, `style.md`, `test.md`** for the datepicker `stacked`
  attribute — a public attribute needing styles and tests. Correct.
  `tool.md` in `s5a-run2.out` is exempt under always-on directive 4.

## The one caveat — intermittent early firing on bare ticket references

`s5a.out` (run 1) fired at tool-use **#2** with `args: 'AB#1494457'` and opened
**no reference files**. At that moment the session knew only a ticket number, so
`SKILL.md`'s opening gate — *"stop here if this is not code work"* — had nothing
to evaluate and the skill exited. By event #34 it was editing
`auro-datepicker.js` with no rules in context.

**It is intermittent, not systematic.** `s5a-run2.out` fired at #1 on the same
prompt and routed to four references. S5b avoids it because resolving the URL
takes five tool calls, so the work is known before the skill fires.

This still passes §6.3, which judges **ordering** — the skill record precedes
the first edit in both arms. But ordering was a proxy for "the rules reached the
code," and in run 1 they did not. **The fix is in the body, not the
description**: when invoked with only a ticket reference, resolve the scope
first and route then, rather than exiting the gate. That change has *not* been
made — it is beyond the approved remedy and is recorded here as a follow-up.

## Files

| File | Scenario | Session |
|---|---|---|
| `s1a.out` | S1a + S2 | `b1b2c3d4-0005-…` |
| `s1b.out`, `s1b-run6.out`, `s1b-run7.out` | S1b ×3 | `…-0001-…`, `…-0006-…`, `…-0007-…` |
| `s3.out` | S3 | `b1b2c3d4-0004-…` |
| `s5a.out`, `s5a-run2.out` | S5a ×2 | `…-0002-…`, `…-0008-…` |
| `s5b.out` | S5b | `b1b2c3d4-0003-…` |

Fixture for both S5 arms: **`AB#1494457`** (`auro-datepicker`: `stacked`
declared but not implemented), verified open, unassigned, and absent from the
repo before the run.

Scored with `npm run score:trigger`. Protocol is unchanged from the 09-24 run —
one fresh headless session per arm, tree reset between arms, prompts verbatim.
