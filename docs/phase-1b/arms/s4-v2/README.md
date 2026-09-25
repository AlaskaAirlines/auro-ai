# S4 re-run against the corrected fixture — 2026-09-25

The 2026-09-24 S4 run scored 🔴: four arms, all producing the correct binding
**without** the rule loaded, which by the anti-platitude bar (parent TRD §3.2)
would mean `CS-A11Y-001` should be cut.

That result was not trusted, because the §7 fixture leaked the answer. It
labelled the property the rule turns on:

```js
validity: { type: String },   // authoritative: "valid" | "valueMissing" | "customError"
```

*Authoritative* is the exact concept under test. Every arm quoted the framing
back.

**The fixture here differs from `../s4-prompt.txt` by one word** — the label
`authoritative:` is removed, leaving the value enumeration intact so the model
still knows what `validity` holds. See `../s4-prompt-v2.txt`. Nothing else
changed: same prompt, same protocol, same `--setting-sources project,local`
for baselines.

## Result — the fixture was leaking, and the defect is reachable without it

| Arm group | Skill | n | Assertion |
|---|---|---|---|
| Baseline | not advertised (verified zero occurrences) | 9 | **8 pass, 1 reproduce the defect** |
| Treatment, plain | advertised, **never fired** | 1 | pass |
| Treatment, forced | fired at tool-use #1 | 5 | **5 pass** |

**`base2.out` is the one that matters.** It binds
`aria-invalid="${this.error ? 'true' : 'false'}"` and mirrors the ARIA write
onto children inside the existing `changedProperties.has('error')` branch. With
`required` set, nothing selected and no `error` string — `validity ===
"valueMissing"` — it emits `aria-invalid="false"`. That is **FAIL-A** in §7's
table, and it is what shipped in AB#1344690 and AB#1636704.

Under the v1 fixture the defect never appeared in four arms. Removing one word
produced it. The v1 probe was measuring its own hint.

## How to read the numbers honestly

- **1 in 9 is a rate with wide error bars.** Treat it as "the defect is
  reachable unaided," not as a measured 11% defect rate. §7's own guidance is
  that *"a single clean baseline pass is weaker evidence than a single
  failure"* — one reproduction is the signal it asks for.
- **The treated arms differ in form, not only in outcome.** All five factor a
  single `get isInvalid()` predicate, bind declaratively on the role-bearing
  `<fieldset>`, cite `CS-A11Y-001` by ID, and several flag that
  `auro-checkbox-group` shares the template (`CS-A11Y-002`) or justify
  `radiogroup` against ARIA 1.2's supported-role list (`CS-A11Y-003`).
- **`base09.out` passes the assertion but not the rule's prescribed form.** It
  writes `aria-invalid` imperatively via `shadowRoot.querySelector('fieldset')`
  in `updated()` rather than binding it in `render()`. The observable outcome
  is correct; the shape is the one `CS-A11Y-001` exists to replace. Counted as
  a pass, because the assertion is the criterion — but it is a second way the
  rule changes output that the assertion alone does not capture.
- **The plain treatment arm never fired the skill.** With the plugin installed
  and advertised, §7's neutral prompt did not trigger it. So in real use the
  rule would not have reached the developer at all. **S4's value is contingent
  on fixing the S1b trigger defect** — a rule that works when loaded is worth
  nothing if it does not load.

## Files

`base1`, `base2`, `base3`, `base06`–`base11` — baseline arms (skill absent).
`treat-plain` — plugin available, skill did not fire.
`treat-forced`, `forced12`–`forced15` — skill forced into context.

Session IDs are `a1b2c3d4-00NN-4a1b-8c2d-0000000000NN`, where `NN` matches the
number in the filename (`base1`/`base2`/`base3` are `0001`–`0003`).
