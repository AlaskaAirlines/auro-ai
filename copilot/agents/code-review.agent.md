---
name: code-review
description: 'Review a GitHub pull request or local branch for bugs and correctness issues. Use a PR number to review a PR — findings are previewed in chat and saved, and only posted to GitHub when you re-run with `post` — or `local` (or no argument) to review the current branch in chat. An optional effort level (`low`…`max`) forces the review depth. It also cross-checks the linked ADO ticket''s requirements against the actual code changes and reports which parts of the ticket the change resolved and which it did not.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/code-review/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "<PR number> [low|medium|high|xhigh|max]  ·  <PR number> post  ·  local [base] [low|medium|high|xhigh|max]" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **code-review** workflow. Its full instructions are large and live in the `auro-ai` repository rather than inline here. **Read the workflow file in full and follow every step in order:**

1. Determine the path to your local `auro-ai` checkout — prefer the `AURO_AI_HOME` environment variable; if it is unset, ask the user for the path.
2. Read `"$AURO_AI_HOME/plugins/auro/skills/code-review/SKILL.md"` in full (e.g. `cat` it via your shell tool, or open it with your read tool).
3. Execute that workflow exactly, in order. Treat every `$ARGUMENTS` reference in it as `${input}` — the argument you were invoked with. Where a step says to prompt the user, ask inline in chat.

Do not summarize, reorder, or skip steps — follow the file as written.
