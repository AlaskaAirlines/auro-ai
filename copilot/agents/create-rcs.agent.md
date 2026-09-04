---
name: create-rcs
description: 'Build a Release Candidate Summary (RCS) from the Auro Design System Azure DevOps board for a chosen sprint iteration. It prompts for which iteration to summarize, defaulting to the current sprint, then gathers the work items whose Iteration Path is that sprint — scoped to items under `E_Retain_Content\Auro Design System`, excluding the Test Case/Test Plan/Test Suite/Epic/Feature/Initiative/Design Story/Task work item types, limited to items whose State is Committed/Blocked/Active/Ready For Acceptance/Resolved/Closed, and excluding anything tagged `auro-rcs` (so a re-run never gathers the skill''s own Release tickets) — and lists them grouped by the Area Path they sit in, collapsing any area under `E_Retain_Content\Auro Design System\auro-formkit` into a single `auro-formkit` group. It then plans a `Release <area> - <iteration>` User Story per area — set to the iteration, on the area''s path, State Blocked, Target Date set to the iteration''s last day, tagged `auro-rcs`, with Predecessor links to every ticket in that area and child `Generate Release Notes` and `Update Dependencies` Tasks. Before creating anything it reconciles existing links: a predecessor already linked (via the `auro-rcs` tag) to a Release ticket in another sprint can be moved to this sprint''s ticket, and an area already linked to a this-sprint Release ticket can reuse it instead of creating a duplicate. The skill plans the full change set, shows it, and writes to Azure DevOps — creating work items and adding/removing links — only after the user confirms at a submit gate.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/create-rcs/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`) — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **create-rcs** workflow. Its full instructions are large and live in the `auro-ai` repository rather than inline here. **Read the workflow file in full and follow every step in order:**

1. Determine the path to your local `auro-ai` checkout — prefer the `AURO_AI_HOME` environment variable; if it is unset, ask the user for the path.
2. Read `"$AURO_AI_HOME/plugins/auro/skills/create-rcs/SKILL.md"` in full (e.g. `cat` it via your shell tool, or open it with your read tool).
3. Execute that workflow exactly, in order. Treat every `$ARGUMENTS` reference in it as `${input}` — the argument you were invoked with. Where a step says to prompt the user, ask inline in chat.

Do not summarize, reorder, or skip steps — follow the file as written.
