# Phase 1b trigger-scenario artifacts — AB#1643440

Raw output from the Phase 1b gate run of **2026-09-24**, testing whether the
`auro:coding-standards` skill fires unprompted when it should, stays quiet when
it should not, and changes generated code when it loads.

**The written analysis is not in this repository.** It is to be posted as a TRD
Discussion. These are the underlying artifacts, kept here because they are raw
run data with nowhere else to live and cannot be reconstructed.

## How the run was performed

One fresh session per arm, all in `auro-formkit` on `dev`, tree reset between
arms (`git checkout . && git clean -fd`). Prompts were passed verbatim as the
sole argument, with no preamble and no mention of coding standards:

```
claude -p --session-id <uuid> --permission-mode acceptEdits "<prompt>"
```

Baseline arms additionally passed `--setting-sources project,local`, which
drops user-scoped settings and therefore the plugin — verified by the string
`auro:coding-standards` appearing zero times in those transcripts.

## Scoring

```bash
npm run score:trigger -- ~/.claude/projects/<project>/<session-id>.jsonl
```

The criterion is **ordering**: the Skill record must appear before the first
`Edit`/`Write` touching component source. See
`scripts/score-trigger-transcript.mjs` for why a raw grep gets this wrong in
two separate ways.

## The arms

| File | Scenario | Session ID | Result |
|---|---|---|---|
| `s1a.out`, `s1a.diff` | S1a — prompt names the mechanism | `6e763158-2377-4331-b129-d8a6add415c2` | fired #9, first edit #20 — **before** |
| `s1b-run1.diff` | S1b run 1 — symptom only | `d07e2df7-790a-4e53-95ce-152538907c1f` | **never fired**; stopped after first edit |
| `s1b-run2.out`, `s1b-run2.diff` | S1b run 2 — symptom only, run to completion | `df52e71c-40d9-4b00-a707-208a4db4889d` | **never fired**; edited component source |
| `s3.out` | S3 — unrelated task (over-fire check) | `8f2b1c44-5a10-4e3b-9d77-1a2b3c4d5e6f` | never loaded — correct |
| `s4-base1.out` | S4 baseline 1 | `a8618234-23e1-46b7-ba4a-e927ce71cd3b` | plugin absent; correct binding anyway |
| `s4-base2.out` | S4 baseline 2 | `03bac842-29fa-4438-884f-726ed9d692a7` | plugin absent; correct binding anyway |
| `s4-base3.out` | S4 baseline 3 | `76885d2f-7dde-4e44-a10b-4753c71205f9` | plugin absent; correct binding anyway |
| `s4-treat1.out` | S4 treatment — skill available | `10d456f1-0486-4c2c-a7c1-35453a9ae54a` | skill never fired, so effectively untreated |
| `s4-treat2.out` | S4 treatment — skill forced | `e61af10d-3fe4-48c0-98dc-231f93d63bb2` | fired #1; cites rules by ID |
| `s5a.out` | S5a — `Implement AB#1533044` | `2c9d7e10-6b33-4f81-8a05-9e1f2a3b4c5d` | **never fired**; could not resolve the ticket |
| `s5b.out` | S5b — bare ADO URL | `3e4f5a6b-7c8d-49e0-b1f2-a3b4c5d6e7f8` | **never fired**; resolved it, no edits |

`s4-prompt.txt` is the fixture and prompt used verbatim in all five S4 arms.

## Reading these files

`.out` files are the session's final response, captured verbatim — so each one
begins with a harness warning about a `Write(.claude/**)` permission rule. That
line is emitted by the CLI before the session starts and is **not** model
output.

`.diff` files are `git diff` against `auro-formkit` on `dev`, taken before the
tree was reset for the next arm.

Full JSONL transcripts are **not** included — they live outside the repo, under
`~/.claude/projects/`, keyed by the session IDs above.
