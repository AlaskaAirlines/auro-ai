# doc-review — work units for a monorepo

A whole-repository review of a monorepo is too large for one session: auro-formkit's components have more than a thousand JSDoc blocks and about six hundred partials, pages, and API examples, and every claim in them has to be checked against the code. So `/auro:doc-review all` splits the components into **work units**, and one `auro:doc-review-component` agent reviews each unit. You stay the **orchestrator**: you load the rules and the ledger once, review the root documentation yourself, merge every unit's results, update the ledger, rebuild, and write the one report.

Read this file when `SKILL.md` Step 3e sends you here. It replaces Step 4 for the units' files, and in write mode Step 6.1 and 6.2 for them too. Everything else in `SKILL.md` still applies.

**Shell constraints still apply.** No `$(...)` and no heredocs. Write every input file with the Write tool.

---

## F1 — Build the work units

1. **Group the files.** Take the file list from Step 3 and group it by component (`components/<name>/`). Files outside `components/` (the root `docs/partials/` and the README templates) aren't in any unit. You review them yourself in F4.
2. **Measure each component.** Count its JSDoc blocks:
   ```bash
   git grep -c -F '/**' -- ':(glob)components/*/src/**/*.js' ':(glob)components/*/src/**/*.mjs' ':(glob)components/*/src/**/*.ts'
   ```
   It prints `path:count` for each source file. A component's **size** is the sum of its files' counts plus the number of its partials, pages, and API examples in the Step 3 list.
3. **Make the units,** in component path order:
   - **Size over 200:** two units. `<name>-code` gets the component's `src/` files, and `<name>-docs` gets the rest.
   - **Size under 40:** pool it with the other small components, in path order, into units named `small-1`, `small-2`, and so on. Start a new pool when the next component would take the pool over 80.
   - **Otherwise:** one unit named `<name>`.

   Every file is in exactly one unit, so no two workers ever edit the same file.
4. **One unit or none:** don't fan out. Go back to `SKILL.md` Step 4 and review everything yourself.
5. List the units with their components and sizes. The report's header uses this list.

## F2 — Write each unit's inputs

For each unit, with the Write tool:
- `/tmp/doc_review_<RUN_TAG>_unit_<id>_files.txt`: the unit's paths, one per line.
- `/tmp/doc_review_<RUN_TAG>_unit_<id>_ledger.json`: when LEDGER is `loaded`, a JSON array of every ledger entry (any status) whose `file` is in the unit, copied as is from the ledger data. Otherwise `[]`.

The workers read the guidelines and template files Step 1 already wrote, so they must exist before F3.

## F3 — Run the workers

Run the units in **batches of up to five**. For each batch, make one `Agent` call per unit in a **single message**, in the foreground (`run_in_background: false`), so the batch runs at the same time and every result returns before the next batch starts. Use `subagent_type: auro:doc-review-component` and this prompt:

```
Doc-review instructions: ${CLAUDE_SKILL_DIR}/SKILL.md
Adapter: ${CLAUDE_SKILL_DIR}/component-worker.md
RUN_TAG: <RUN_TAG>
Unit: <id>
Files: /tmp/doc_review_<RUN_TAG>_unit_<id>_files.txt
Ledger entries: /tmp/doc_review_<RUN_TAG>_unit_<id>_ledger.json
Mode: <review|write>
Guidelines: <url> (version <date>)
Repository root: <path>
```

**Check each result.** It must be the adapter's JSON, with `unit` set to the unit's ID and `guidelinesVersion` set to the version from Step 1.
- **The first call fails because subagents aren't available** (the `Agent` tool is missing, or nesting is disabled through `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`): stop and give the fallback from `SKILL.md` Step 3e. Nothing has been reviewed yet.
- **`skipped` is set, the call fails, or the output isn't the expected JSON:** retry that unit once, on its own. If it fails again, record it as **not reviewed**, with the reason, and carry on. In write mode, run `git status --short -- <the unit's files>` and record any files it changed before failing, so the report can list them for the user to check. Don't revert them.
- **A finding or fix whose `path` isn't in the unit's files:** drop it, and note how many were dropped for that unit.

## F4 — Review the root documentation and merge

1. **Root files.** Review the files outside every unit yourself, with `SKILL.md` Steps 3b, 3d, and 4a–4e as SCOPE = all describes. In write mode, apply the fixes for the root `docs/partials/` with Step 6.1 and 6.2. README templates stay report-only (3d).
2. **Merge the findings** from every unit and your own into one list.
   - **Template findings:** merge those with the same `rule` and the same `current` text into one finding that lists every file it appears in. A shared heading repeated in every component is one problem, not thirteen.
   - Keep everything else as it is.
3. **Merge the write-mode results:** every unit's `fixed` and `notFixed`, plus your own.
4. **Ledger (Step 4f).** When LEDGER is `loaded` or `new`, run **L3** from `ledger.md` on the merged list, as written, with one change: for an `open` entry in a unit that was reviewed, use that unit's `ledgerChecks` result instead of re-checking it yourself (`fixed` → close it with the given reason; `holds` → report it as still open; `cantTell` → leave it open and report what the worker checked). Re-check only the entries in your own root files. Leave the entries of units that weren't reviewed as they are. Add up every unit's `suppressed` count and your own.

## F5 — Back to `SKILL.md`

- **Review mode:** go to Step 5. In the header:
  - **In scope:** one line per unit instead of one per file: the unit ID, its components, its file count, and its item count, then one line for the root files.
  - **Not reviewed:** each unit that failed twice, with the reason. Leave the line out when every unit ran.
  - **Status:** when a unit wasn't reviewed, the run can't converge. Say "**Not converged: N open, M units not reviewed**", even when groups 1 and 2 are empty.
  - **Findings:** within each group, order them by component path, so each component's findings stay together.
- **Write mode:** go to Step 6.3. Step 6.1 and 6.2 are done. Rebuild once, after every unit has finished, as Step 6.3 describes for known components; never while a batch is still running, because the workers' edits all feed the one root manifest. In Step 6.4, use each `fixed` entry's `newFirstSentence` to find it in the rebuilt output. In Step 7, add every unit that wasn't reviewed under **Not fixed**, with the files it changed before failing.
