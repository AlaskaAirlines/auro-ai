---
name: doc-review
description: Review the component documentation on the current branch against the Auro "Content guidelines for component documentation" (WC-Generator discussion #660). Run when asked to review, check, or fix component documentation against the Auro content guidelines, or when another skill needs those checks run. Fetches the current guidelines and the shared auro-templates headings on every run, so it never works from memory. Scopes the review the way the guidelines' "What to update" section does — every JSDoc block, README partial, and demo section the branch touches, in full — and checks each factual claim against the component's code and styles, not just the wording. Its own suggested fixes and edits are held to the same guidelines and checked before they're reported or kept. With `all`, it reviews every documentation source in the repository instead of only what the branch touches. In a monorepo such as auro-formkit, passing a component name (e.g. `dropdown`, `datepicker`) limits either scope to that component. Reports findings grouped as inaccurate claims, guideline issues, problems outside this change (report only), shared template content to fix in auro-templates, and open questions the guidelines don't settle. When the branch has an open PR, it keeps a findings ledger in one sticky PR comment, so findings that were deferred, rejected, or waived aren't raised again and open ones are re-checked on every run; people change a finding's status by replying with a `doc-review:` directive. By default it only reports and changes no files. With `write`, it edits only the in-scope documentation sources, rebuilds, and verifies the generated custom-elements.json and docs/api.md, leaving the changes uncommitted. It never commits, pushes, edits generated files directly, or edits the guidelines discussion. Not for reviewing code changes, release notes, or editing the guidelines themselves.
argument-hint: "[write] [all | base branch] [component …]"
allowed-tools: Bash(gh pr view *), Bash(git rev-parse *), Bash(git symbolic-ref *), Bash(git remote set-head *), Bash(git fetch *), Bash(git merge-base *), Bash(git diff *), Bash(git log *), Bash(git status *), Bash(gh auth status *), Bash(gh repo view *), Bash(gh api *), Bash(npm run *), Read, Grep, Glob, Write, Edit
---

## Task — start now

You are executing the **doc-review** skill. The invocation itself is the request: **begin immediately** and run the steps below **in order**. Don't skip a step and don't reorder them.

> **Scope guardrail.** In **review** mode (the default, whenever `write` isn't passed) this skill is read-only: it reports findings and changes no repository files. Its only writes are scratch files under `/tmp` and, when the branch has an open PR, the findings ledger comment on that PR (`${CLAUDE_SKILL_DIR}/ledger.md`). It never runs the build. Only in **write** mode may it edit the documentation **sources** that are in scope (Step 3) and run the repo's build, and it leaves those edits uncommitted. In either mode it must **NOT**:
> - edit generated files directly (`custom-elements.json`, `docs/api.md`, `demo/*.md`, or `AURO-GENERATED` sections of `README.md`); change their sources and rebuild instead;
> - edit content outside the scope set in Step 3, including shared template content;
> - change code behavior to match a doc claim; when the docs and the code disagree, fix the docs and report the disagreement;
> - commit, push, stage, or edit the guidelines discussion;
> - post, edit, or delete any GitHub comment other than this skill's ledger comment, and write the ledger only in review mode.

**Why this skill exists.** Engineers asking an AI to "check the docs against the guidelines" were getting different results, because each run picked its own scope, its own rules, and whether to verify claims. This skill fixes all three. Follow it exactly. Where it says to report rather than decide, report.

**`$ARGUMENTS`** = the text after `/doc-review`, trimmed (empty if none).

### Shell constraints

This skill runs in a **non-interactive, sandboxed shell** that rejects `$(...)` command substitution and `<<'EOF'` heredocs. Write multi-line bodies (GraphQL queries) to a file under `/tmp` with the Write tool and pass them by reference, for example `gh api graphql -F query=@/tmp/doc_review_guidelines.graphql`.

---

## Step 0 — Preconditions and arguments

1. Resolve the repo root with `git rev-parse --show-toplevel`. Run `gh auth status`. If it fails, **stop** and tell the user: "GitHub CLI isn't authenticated. Run `gh auth login`, then re-run `/auro:doc-review`." The guidelines can't be loaded without it.
2. **List the components.** If the repo has a top-level `components/` folder (the auro-formkit layout, `components/<name>/src`, `docs/partials`, `apiExamples`), `Glob` for `components/*/package.json` and record each `<name>` as a **known component**. Otherwise there are no known components.
3. Parse `$ARGUMENTS` into tokens:
   - `write` (any case) → **MODE = write**.
   - `all` (any case) → **SCOPE = all**: review every documentation source in the repository, not just what the branch touches.
   - A token that matches a known component, ignoring case and an optional `auro-` prefix (so `dropdown`, `Dropdown`, and `auro-dropdown` all match `components/dropdown`) → add that component to **COMPONENTS**. More than one component may be given.
   - Any other single token → **BASE_ARG**, a base branch.
   - **MODE = review** whenever `write` isn't among the tokens. **SCOPE = branch** whenever `all` isn't among the tokens. **COMPONENTS** empty means no component filter.
   - **Stop** and output only "⚠️ Unrecognized arguments `$ARGUMENTS`. Expected `/auro:doc-review [write] [all | base branch] [component …]`." when there is more than one token other than `write`, `all`, and component names, or when `all` comes with a base branch (a whole-repository review has no base). When a component list exists and a token matched nothing, add: "Known components: `<list>`."
   - **Component filter.** When COMPONENTS is non-empty, only paths under `components/<name>/` for those components are in scope, in every step below. Code and styles outside them can still be read as evidence in Step 4c.
4. Confirm this is a component repo: `Glob` for `**/docs/partials/*.md` and `**/src/**/*.{js,mjs,ts}` (excluding `node_modules`). If neither matches, **stop** and say this skill reviews Auro component repos.
5. **Load the findings ledger.** Read `${CLAUDE_SKILL_DIR}/ledger.md` in full. Run its **L1** (find the PR and load the ledger), then its **L2** (apply status directives). In write mode, L2 runs in memory only. When L1 finds no open PR (**LEDGER = none**), the run works exactly as it did before the ledger existed, except for the closing line in Step 5.

---

## Step 1 — Load the rules (every run, never from memory)

**1a — The guidelines.** Write this query to `/tmp/doc_review_guidelines.graphql`:

```graphql
query {
  repository(owner: "AlaskaAirlines", name: "WC-Generator") {
    discussion(number: 660) { url lastEditedAt createdAt body }
  }
}
```

Then run:

```bash
gh api graphql -F query=@/tmp/doc_review_guidelines.graphql --jq '.data.repository.discussion.body' > /tmp/doc_review_guidelines.md
gh api graphql -F query=@/tmp/doc_review_guidelines.graphql --jq '.data.repository.discussion | {url, lastEditedAt, createdAt}'
```

Record the URL and the version date (`lastEditedAt`, or `createdAt` if it was never edited). **Read `/tmp/doc_review_guidelines.md` in full.** If the fetch fails or the body is empty, **stop** and report the error. Do not fall back to what you remember of the guidelines or of the style guides they cite. A partial or remembered rule set is the main cause of inconsistent results.

**1b — Shared template headings.** Fetch the files that define headings shared by every component:

```bash
gh api -H "Accept: application/vnd.github.raw" repos/AlaskaAirlines/auro-templates/contents/templates/default/api.md > /tmp/doc_review_template_api.md
gh api -H "Accept: application/vnd.github.raw" repos/AlaskaAirlines/auro-templates/contents/templates/default/index.md > /tmp/doc_review_template_index.md
gh api -H "Accept: application/vnd.github.raw" repos/AlaskaAirlines/auro-templates/contents/templates/default/README.md > /tmp/doc_review_template_readme.md
```

Collect every Markdown heading in those three files (ignore `{{ … }}` placeholders) as the **shared heading set**. If a fetch fails, warn once and treat only `REMOTE` sections as shared template content.

**How to apply the rules.** The fetched guidelines are the rule set. Every finding you report must cite the guideline section it comes from, by its heading (for example "Structure › Keep it brief" or "Patterns by item type › Deprecations"). The guidelines name outside style guides (Google, Microsoft, MDN) as fallbacks. Only use one when the guidelines don't cover the case, label the finding with that source, and list it under **Open questions** rather than as a required change, because those rulings vary from run to run. If you can't cite a rule, it isn't a finding.

---

## Step 2 — Determine the base and the changed files

**SCOPE = all:** skip this step. There is no base and no changed-file list; Step 3 works from the whole repository.

1. Run `git fetch origin`.
2. **Base branch.**
   - **No `BASE_ARG`:** use the repo's default branch. Resolve it with `git symbolic-ref --short refs/remotes/origin/HEAD`. If that fails, run `git remote set-head origin --auto` once and retry, then fall back to `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (prefix with `origin/`).
   - **`BASE_ARG` given:** use `origin/<BASE_ARG>` if `git rev-parse --verify --quiet origin/<BASE_ARG>` succeeds, else `<BASE_ARG>` if it resolves as a ref. If neither resolves, **stop** and report: "⚠️ Base branch `<BASE_ARG>` not found." When there are known components, add: "It isn't a component either. Known components: `<list>`."
3. Record `git merge-base <base> HEAD` as `MERGE_BASE`. Diffing against `MERGE_BASE` includes uncommitted work.
4. `git diff <MERGE_BASE> --name-only` → the changed-file list.

---

## Step 3 — Set the scope

Apply the guidelines' **What to update** section mechanically.

**SCOPE = all.** Every doc source in the repository is in scope, not only the ones the branch touches:
- Find them with `Glob` for the doc-source patterns in the 3a table (`**/src/**/*.{js,mjs,ts}`, `**/docs/partials/*.md`, `**/apiExamples/*.html`, `**/README.md`), excluding `node_modules`, `dist`, and the generated paths in the table. With COMPONENTS, glob only inside `components/<name>/` for each.
- In 3b, every JSDoc block, every partial section, and every API example file in them is a touched item. Skip the `git diff` mapping.
- Skip 3c and 4d. Nothing is "outside this change", so that report group stays empty.
- 3d still applies: shared template content is reported, never edited.
- In a monorepo, work one component package at a time, in path order, so each component's findings and fixes stay together.

**Component filter (SCOPE = branch).** With COMPONENTS, drop every changed file outside `components/<name>/` before classifying.

**3a — Classify each changed file.**

| Kind | Paths | Treatment |
| --- | --- | --- |
| **Doc source** | JSDoc in `**/src/**/*.{js,mjs,ts}`; `**/docs/partials/*.md`; markup and visible text in `**/apiExamples/*.html`; `README.md` text outside `AURO-GENERATED` markers | Review; edit in write mode |
| **Generated** | `custom-elements.json`, `**/docs/api.md`, `**/demo/*.md`, `AURO-GENERATED` sections of `README.md`, `dist/`, `*.min.js` | Never review as a source and never edit. Use as verification evidence (Step 4c) |
| **Out of scope** | Everything else, including `docs/post-mortem/**`, lockfiles, configs, styles, tests | Not reviewed. Styles and code are still read as evidence |

If no changed file is a doc source, say so, report the base you compared against, and **stop**. With COMPONENTS, say the branch changed no documentation in those components, and suggest adding `all` (e.g. `/auro:doc-review all dropdown`) to review the whole component. (With SCOPE = all, stop only if no doc sources were found.)

**3b — Find the touched items.** For each doc source, run `git diff <MERGE_BASE> -U0 -- <file>` and map every added or changed line to the item that contains it:
- **JSDoc:** the whole `/** … */` block that contains the line, or the block directly above the changed declaration. The whole block is in scope: description, every tag, and every example.
- **Markdown partial:** the whole section, from the nearest heading above the line down to the next heading of the same or higher level.
- **API example HTML:** the whole file, markup and visible text.

These **touched items** are the scope. List them with `file:line-range`.

**3c — Untouched remainder.** Everything else in the same doc-source files is **outside this change**. Problems there are reported, never fixed. Don't sweep files the branch didn't change.

**3d — Shared template content.** Inside any doc source, these are shared template content, whether touched or not:
- Sections between `AURO-GENERATED-CONTENT:START (REMOTE:…)` and `…:END` markers.
- Headings whose text matches the shared heading set from Step 1b, ignoring case and punctuation.

Never fix these. Report them under **Shared template content** so they can be fixed in `auro-templates`.

---

## Step 4 — Review the touched items

For each touched item, in file order:

**4a — Identify the item type** using the guidelines' **Patterns by item type** headings: component description and summary, property or attribute (boolean, fixed set of values, or free text), slot, CSS part, CSS custom property, method or function (and its `@param`, `@returns`, and `@throws`), deprecation, security note, API example, or README and demo prose. README and demo prose has no subsection of its own, so the general sections in 4b apply to it.

**4b — Apply the rules** from these guideline sections, in this order: the matching **Patterns by item type** subsection, then **Structure**, **Voice and tone**, **Word choices**, and **Formatting**. Use these searches as a starting point. They don't replace reading each item against the rules.
- `e\.g\.|i\.e\.` · `\bwill\b` · `DEPRECATED` · ` — ` (spaced em dash) · `This (property|attribute|Boolean)|Used to` · `HTML5` · `a11y`
- Attribute, property, value, and tag names not in backticks, such as "(the link's href)".
- Headings and labels not in sentence case, including button and other control text in API examples, such as "Extra Small" (except shared headings; see 3d).
- API example markup that skips guidance in the component's own docs (its JSDoc and `docs/partials`), such as a control that shows only an icon or a count with no accessible name (no `ariaLabel` slot, `aria-label`, or `aria-labelledby`). Check every example in the file, not only the ones in the section that gives the guidance.
- Descriptions over the sentence limit in **Structure › Keep it brief**. Count the exceptions it allows.

**4c — Verify every factual claim.** This is required, not optional. For each claim about behavior, such as defaults, accepted values, what happens in each state, conditions ("ignored when …"), icons, `rel` values, or URL handling, find the code that decides it and confirm it:
- the component source (`src/**`), including base classes and imported helpers;
- the styles (`src/styles/**`) for visual claims, such as underlines, sizes, colors, and which variants have styles;
- `custom-elements.json`, if present, for what the manifest actually publishes;
- for each `@cssprop`, that the property exists in `src/styles/**`, and the guidelines' rule on which custom properties to document.

A claim the code contradicts is an **Inaccurate claim**. If you can't confirm or refute a claim from the code, list it under **Open questions** with what you checked. Never guess.

**4d — Note the untouched remainder.** While reading each file, note clear guideline problems in its untouched parts, per 3c. Keep these brief. They are report-only.

**4e — Check every suggestion.** Each "Suggested" text is new documentation, so it must meet the same rules as the text it replaces. For every suggestion, in any group:
- Review it as its own touched item: apply 4b (including the searches) and 4c. Any claim the new wording adds or changes, such as a default, a condition, or a value, must be confirmed in the code.
- Review it in place, too. Read the whole item with the change applied, and check the rules a single sentence can pass while the item fails: **Structure › Keep it brief** sentence counts, **Structure › The first sentence stands alone**, and terms and voice that stay consistent with the rest of the item.
- When several findings touch the same text, write one suggestion that fixes all of them, and cite each rule. Separate suggestions for the same text can undo each other.
- If a suggestion fails, revise it and check it again. If you can't write one that passes, because rules conflict or the fix needs a fact the code doesn't settle, give the finding without a suggestion and add an **Open questions** entry that says why.

**4f — Match against the ledger.** Skip this when LEDGER is `none` or `broken`. Otherwise, run **L3** from `ledger.md`. It gives each finding its ledger ID, drops findings already deferred, rejected, or waived, and re-checks every open ledger entry this run didn't reproduce. Entries that are still open go into the report even if this run's review missed them.

---

## Step 5 — Review mode: report

Skip to Step 6 if MODE is write.

Bash output isn't reliably shown to the user, so put everything in your reply. Use this structure:

**Header:**
- Guidelines: `<url>` (version `<date>`)
- Compared against: `<base>` (default branch, or the `BASE_ARG` you were given), or "Entire repository" when SCOPE = all
- Components: the COMPONENTS list, when one was given
- In scope: the touched items from 3b, one line each. With SCOPE = all, list the files instead, one line each, with the number of items reviewed in each
- Ledger (when there's a PR): the PR link, then the counts from 4f (new, still open, fixed, regressed, and suppressed because they were deferred, rejected, or waived), and any directives applied or ignored in L2, each with its reason
- Status: "**Converged** ✅" when groups 1 and 2 are empty, otherwise "**Not converged: N open**"

**Findings**, in this order. Leave out empty groups.
1. **Inaccurate claims:** the doc says something the code contradicts.
2. **Guideline issues:** in-scope items that break a cited rule.
3. **Outside this change (report only):** from 4d.
4. **Shared template content (fix in auro-templates):** from 3d.
5. **Open questions:** cases the guidelines don't settle, claims you couldn't verify, and fallback-source rulings.

Format each finding as:

> `file:line`: what's wrong. *Rule: <guideline section>.*
> Current: "…" → Suggested: "…"

Every "Suggested" text must have passed 4e. Leave out the arrow and the suggestion when 4e found none that passes.

Label each finding so it can be referred to. With a ledger, use its ledger ID (`DR-7`), which stays the same across runs. Without one, number the findings consecutively across groups. End with one line: the number of findings in groups 1 and 2, and "Run `/auro:doc-review write` to apply the in-scope fixes." (with SCOPE = all, "Run `/auro:doc-review write all` to apply the fixes across the repository."). Repeat any component names from `$ARGUMENTS` in the suggested command. When LEDGER is `none`, add: "Open a draft PR to start the ledger."

If the user then asks for the findings as something to send to the PR author, render the same findings as a Markdown block addressed to the author, keeping the groups and labels. With a ledger, link to the ledger comment instead, since it already holds the findings.

**5b — Write the ledger.** When LEDGER is `new` or `loaded`, run **L4** from `ledger.md`, then add its closing line ("Ledger updated:" or "Ledger created:" with the URL, or why it wasn't written) to the end of the report.

**Stop here in review mode.**

---

## Step 6 — Write mode: apply, rebuild, verify

1. **Apply** every finding in groups 1 and 2 (Inaccurate claims and Guideline issues) by editing the doc source, never a generated file. Findings the ledger has as deferred, rejected, or waived were dropped in 4f, so they aren't applied. Use the suggestion checked in 4e. Keep each edit to the touched item. Don't edit groups 3–5. For an inaccurate claim, change the doc to match the code. Never change the code. A finding with no passing suggestion from 4e isn't applied; report it under **Not fixed**.
2. **Re-review your edits.** Run `git diff -- <file>` on each doc source you edited. Treat every item the diff touches as a touched item, and run Step 4a–4c on it again as it now reads. Your edits are held to the same rules as the author's text. If the re-review finds a problem, fix it and re-review that item. Stop after two more passes. Report anything still failing under **Not fixed**, and say which edit caused it.
3. **Rebuild.** Find the `package.json` nearest the changed sources that has a `build` script (in a monorepo, the component's package; with SCOPE = all, every package you edited, one at a time). Run `npm run build` there with a generous timeout. If that `package.json` has a `cem:check` script and `build` doesn't already run it, run `npm run cem:check` too. If the build or check fails, report the output and stop. Don't try to fix build problems the docs didn't cause.
4. **Verify the generated output.** In the rebuilt `custom-elements.json` and `docs/api.md`, confirm each fix appears as intended. Read the first sentence of each changed description on its own and confirm it still makes sense (guidelines: **Structure › The first sentence stands alone**).
5. **Check for unrelated churn.** Run `git status --short` and `git diff --stat`. Generated files can change for reasons unrelated to your edits, such as a `REMOTE` template that changed upstream. List any generated-file change your edits didn't cause, so the user can decide whether to keep it.

---

## Step 7 — Write mode: report

Tell the user:
- The guidelines version and the base used, or "Entire repository" when SCOPE = all, plus the COMPONENTS list when one was given.
- **Fixed:** each finding applied, with `file:line` and the rule. Note any problem the re-review in 6.2 found in your own edits and fixed.
- **Not fixed:** groups 3–5 from Step 5's structure, in full, with the same numbering, plus any finding from 6.1 or 6.2 that couldn't be fixed in a way that passes the guidelines. The user may want to send these to the PR author or to `auro-templates`.
- **Build:** the result of the build and `cem:check`, plus any unrelated churn from 6.5.
- With a ledger: how many findings were skipped because they're deferred, rejected, or waived, and that the ledger wasn't updated. The fixes are local, so a review-mode run after they're committed and pushed marks them fixed.
- That nothing was committed. Hand control back to the user.
