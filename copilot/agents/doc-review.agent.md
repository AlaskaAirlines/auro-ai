---
name: doc-review
description: 'Review, or fix, the component documentation on the current branch against the Auro "Content guidelines for component documentation" (WC-Generator discussion #660). Fetches the current guidelines and the shared auro-templates headings on every run, so it never works from memory. Scopes the review the way the guidelines'' "What to update" section does — every JSDoc block, README partial, and demo section the branch touches, in full — and checks each factual claim against the component''s code and styles, not just the wording. Reports findings grouped as inaccurate claims, guideline issues, problems outside this change (report only), shared template content to fix in auro-templates, and open questions the guidelines don''t settle. With `fix`, it edits only the in-scope documentation sources, rebuilds, and verifies the generated custom-elements.json and docs/api.md. It never commits, pushes, edits generated files directly, or edits the guidelines discussion.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/doc-review/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "[fix] [base branch]" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **doc-review** skill. The invocation itself is the request: **begin immediately** and run the steps below **in order**. Don't skip a step and don't reorder them.

> **Scope guardrail.** In **review** mode (the default) this skill is read-only: its only writes are scratch files under `/tmp`. In **fix** mode it may also edit the documentation **sources** that are in scope (Step 3) and run the repo's build. In either mode it must **NOT**:
> - edit generated files directly (`custom-elements.json`, `docs/api.md`, `demo/*.md`, or `AURO-GENERATED` sections of `README.md`); change their sources and rebuild instead;
> - edit content outside the scope set in Step 3, including shared template content;
> - change code behavior to match a doc claim; when the docs and the code disagree, fix the docs and report the disagreement;
> - commit, push, stage, or edit the guidelines discussion.

**Why this skill exists.** Engineers asking an AI to "check the docs against the guidelines" were getting different results, because each run picked its own scope, its own rules, and whether to verify claims. This skill fixes all three. Follow it exactly. Where it says to report rather than decide, report.

**`${input}`** = the text after `/doc-review`, trimmed (empty if none).

### Shell constraints

This skill runs in a **non-interactive, sandboxed shell** that rejects `$(...)` command substitution and `<<'EOF'` heredocs. Write multi-line bodies (GraphQL queries) to a file under `/tmp` with the Write tool and pass them by reference, for example `gh api graphql -F query=@/tmp/doc_review_guidelines.graphql`.

---

## Step 0 — Preconditions and arguments

1. Resolve the repo root with `git rev-parse --show-toplevel`. Run `gh auth status`. If it fails, **stop** and tell the user: "GitHub CLI isn't authenticated. Run `gh auth login`, then re-run `/auro:doc-review`." The guidelines can't be loaded without it.
2. Parse `${input}` into tokens:
   - `fix` (any case) → **MODE = fix**.
   - Any other single token → **BASE_ARG**, a base branch.
   - Nothing → **MODE = review**, no `BASE_ARG`.
   - More than one non-`fix` token → **stop** and output only: "⚠️ Unrecognized arguments `${input}`. Expected `/auro:doc-review [fix] [base branch]`."
3. Confirm this is a component repo: `Glob` for `**/docs/partials/*.md` and `**/src/**/*.{js,mjs,ts}` (excluding `node_modules`). If neither matches, **stop** and say this skill reviews Auro component repos.

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

1. Run `git fetch origin`.
2. **Base branch.**
   - **No `BASE_ARG`:** use the repo's default branch. Resolve it with `git symbolic-ref --short refs/remotes/origin/HEAD`. If that fails, run `git remote set-head origin --auto` once and retry, then fall back to `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` (prefix with `origin/`).
   - **`BASE_ARG` given:** use `origin/<BASE_ARG>` if `git rev-parse --verify --quiet origin/<BASE_ARG>` succeeds, else `<BASE_ARG>` if it resolves as a ref. If neither resolves, **stop** and report: "⚠️ Base branch `<BASE_ARG>` not found."
3. Record `git merge-base <base> HEAD` as `MERGE_BASE`. Diffing against `MERGE_BASE` includes uncommitted work.
4. `git diff <MERGE_BASE> --name-only` → the changed-file list.

---

## Step 3 — Set the scope

Apply the guidelines' **What to update** section mechanically.

**3a — Classify each changed file.**

| Kind | Paths | Treatment |
| --- | --- | --- |
| **Doc source** | JSDoc in `**/src/**/*.{js,mjs,ts}`; `**/docs/partials/*.md`; visible text in `**/apiExamples/*.html`; `README.md` text outside `AURO-GENERATED` markers | Review; fix in fix mode |
| **Generated** | `custom-elements.json`, `**/docs/api.md`, `**/demo/*.md`, `AURO-GENERATED` sections of `README.md`, `dist/`, `*.min.js` | Never review as a source and never edit. Use as verification evidence (Step 4c) |
| **Out of scope** | Everything else, including `docs/post-mortem/**`, lockfiles, configs, styles, tests | Not reviewed. Styles and code are still read as evidence |

If no changed file is a doc source, say so, report the base you compared against, and **stop**.

**3b — Find the touched items.** For each doc source, run `git diff <MERGE_BASE> -U0 -- <file>` and map every added or changed line to the item that contains it:
- **JSDoc:** the whole `/** … */` block that contains the line, or the block directly above the changed declaration. The whole block is in scope: description, every tag, and every example.
- **Markdown partial:** the whole section, from the nearest heading above the line down to the next heading of the same or higher level.
- **API example HTML:** the whole file's visible text.

These **touched items** are the scope. List them with `file:line-range`.

**3c — Untouched remainder.** Everything else in the same doc-source files is **outside this change**. Problems there are reported, never fixed. Don't sweep files the branch didn't change.

**3d — Shared template content.** Inside any doc source, these are shared template content, whether touched or not:
- Sections between `AURO-GENERATED-CONTENT:START (REMOTE:…)` and `…:END` markers.
- Headings whose text matches the shared heading set from Step 1b, ignoring case and punctuation.

Never fix these. Report them under **Shared template content** so they can be fixed in `auro-templates`.

---

## Step 4 — Review the touched items

For each touched item, in file order:

**4a — Identify the item type** using the guidelines' **Patterns by item type** headings: component description and summary, property or attribute (boolean, fixed set of values, or free text), slot, CSS part, CSS custom property, method or function (and its `@param`, `@returns`, and `@throws`), deprecation, security note, or README and demo prose. README and demo prose has no subsection of its own, so the general sections in 4b apply to it.

**4b — Apply the rules** from these guideline sections, in this order: the matching **Patterns by item type** subsection, then **Structure**, **Voice and tone**, **Word choices**, and **Formatting**. Use these searches as a starting point. They don't replace reading each item against the rules.
- `e\.g\.|i\.e\.` · `\bwill\b` · `DEPRECATED` · ` — ` (spaced em dash) · `This (property|attribute|Boolean)|Used to` · `HTML5` · `a11y`
- Attribute, property, value, and tag names not in backticks, such as "(the link's href)".
- Headings not in sentence case (except shared headings; see 3d).
- Descriptions over the sentence limit in **Structure › Keep it brief**. Count the exceptions it allows.

**4c — Verify every factual claim.** This is required, not optional. For each claim about behavior, such as defaults, accepted values, what happens in each state, conditions ("ignored when …"), icons, `rel` values, or URL handling, find the code that decides it and confirm it:
- the component source (`src/**`), including base classes and imported helpers;
- the styles (`src/styles/**`) for visual claims, such as underlines, sizes, colors, and which variants have styles;
- `custom-elements.json`, if present, for what the manifest actually publishes;
- for each `@cssprop`, that the property exists in `src/styles/**`, and the guidelines' rule on which custom properties to document.

A claim the code contradicts is an **Inaccurate claim**. If you can't confirm or refute a claim from the code, list it under **Open questions** with what you checked. Never guess.

**4d — Note the untouched remainder.** While reading each file, note clear guideline problems in its untouched parts, per 3c. Keep these brief. They are report-only.

---

## Step 5 — Review mode: report

Skip to Step 6 if MODE is fix.

Bash output isn't reliably shown to the user, so put everything in your reply. Use this structure:

**Header:**
- Guidelines: `<url>` (version `<date>`)
- Compared against: `<base>` (default branch, or the `BASE_ARG` you were given)
- In scope: the touched items from 3b, one line each

**Findings**, in this order. Leave out empty groups.
1. **Inaccurate claims:** the doc says something the code contradicts.
2. **Guideline issues:** in-scope items that break a cited rule.
3. **Outside this change (report only):** from 4d.
4. **Shared template content (fix in auro-templates):** from 3d.
5. **Open questions:** cases the guidelines don't settle, claims you couldn't verify, and fallback-source rulings.

Format each finding as:

> `file:line`: what's wrong. *Rule: <guideline section>.*
> Current: "…" → Suggested: "…"

Number the findings consecutively across groups, so they can be referred to by number. End with one line: the number of findings in groups 1 and 2, and "Run `/auro:doc-review fix` to apply the in-scope fixes."

If the user then asks for the findings as something to send to the PR author, render the same findings as a Markdown block addressed to the author, keeping the groups and numbering.

**Stop here in review mode.**

---

## Step 6 — Fix mode: apply, rebuild, verify

1. **Apply** every finding in groups 1 and 2 (Inaccurate claims and Guideline issues) by editing the doc source, never a generated file. Keep each edit to the touched item. Don't edit groups 3–5. For an inaccurate claim, change the doc to match the code. Never change the code.
2. **Rebuild.** Find the `package.json` nearest the changed sources that has a `build` script (in a monorepo, the component's package). Run `npm run build` there with a generous timeout. If that `package.json` has a `cem:check` script and `build` doesn't already run it, run `npm run cem:check` too. If the build or check fails, report the output and stop. Don't try to fix build problems the docs didn't cause.
3. **Verify the generated output.** In the rebuilt `custom-elements.json` and `docs/api.md`, confirm each fix appears as intended. Read the first sentence of each changed description on its own and confirm it still makes sense (guidelines: **Structure › The first sentence stands alone**).
4. **Check for unrelated churn.** Run `git status --short` and `git diff --stat`. Generated files can change for reasons unrelated to your edits, such as a `REMOTE` template that changed upstream. List any generated-file change your edits didn't cause, so the user can decide whether to keep it.

---

## Step 7 — Fix mode: report

Tell the user:
- The guidelines version and base used.
- **Fixed:** each finding applied, with `file:line` and the rule.
- **Not fixed:** groups 3–5 from Step 5's structure, in full, with the same numbering. The user may want to send these to the PR author or to `auro-templates`.
- **Build:** the result of the build and `cem:check`, plus any unrelated churn from 6.4.
- That nothing was committed. Hand control back to the user.
