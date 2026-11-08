---
name: doc-review
description: 'Review the component documentation on the current branch against the Auro "Content guidelines for component documentation" (WC-Generator discussion #660). Run when asked to review, check, or fix component documentation against the Auro content guidelines, or when another skill needs those checks run. Fetches the current guidelines and the shared auro-templates headings on every run, so it never works from memory. Scopes the review the way the guidelines'' "What to update" section does — every JSDoc block, README partial, and demo section the branch touches, in full — and checks each factual claim against the component''s code and styles, not just the wording. Its own suggested fixes and edits are held to the same guidelines and checked before they''re reported or kept. With `all`, it reviews every documentation source in the repository instead of only what the branch touches. In a monorepo such as auro-formkit, passing a component name (e.g. `dropdown`, `datepicker`) limits either scope to that component. Reports findings grouped as inaccurate claims, guideline issues, problems outside this change (report only), shared template content to fix in auro-templates or the repo''s own README template, and open questions the guidelines don''t settle. When the branch has an open PR, it keeps a findings ledger in one sticky PR comment, so findings that were deferred, rejected, or waived aren''t raised again and open ones are re-checked on every run; people change a finding''s status by replying with a `doc-review:` directive. Once the ledger has a run, later runs re-review only what changed since the last reviewed commit, unless `full` is passed; `since <commit>` sets that commit explicitly. By default it only reports and changes no files. With `write`, it edits only the in-scope documentation sources, rebuilds, and verifies the generated custom-elements.json and docs/api.md, leaving the changes uncommitted. It never commits, pushes, edits generated files directly, or edits the guidelines discussion. Not for reviewing code changes, release notes, or editing the guidelines themselves.'
user-invocable: true
---

<!-- Generated from plugins/auro/skills/doc-review/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "[write] [all | base branch] [full | since <commit>] [component …]" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **doc-review** workflow. Its full instructions are large and live in the `auro-ai` repository rather than inline here. **Read the workflow file in full and follow every step in order:**

1. Determine the path to your local `auro-ai` checkout — prefer the `AURO_AI_HOME` environment variable; if it is unset, ask the user for the path.
2. Read `"$AURO_AI_HOME/plugins/auro/skills/doc-review/SKILL.md"` in full (e.g. `cat` it via your shell tool, or open it with your read tool).
3. Execute that workflow exactly, in order. Treat every `$ARGUMENTS` reference in it as `${input}` — the argument you were invoked with — and every `${CLAUDE_SKILL_DIR}` as `$AURO_AI_HOME/plugins/auro/skills/doc-review`. Where a step says to prompt the user, ask inline in chat.

Do not summarize, reorder, or skip steps — follow the file as written.
