---
name: ado
description: 'Draft or edit an Azure DevOps work item for the Auro design system. Requires a mode argument — `new` to create a work item, or an ADO ticket number to edit an existing one. In create mode it collects a change description, infers the component it''s for (confirming with the user), reads the matching GitHub repo to classify the work (bug vs user story, tracking chores), derives the ADO Area path, and drafts the title, description, and acceptance criteria as three separate field-ready blocks — looping until approved. In edit mode it looks up the ticket in Azure DevOps, confirms it with the user, then refines the existing content into an improved draft (using the same standards as create mode) and reviews it with the user. After the user confirms, it submits to Azure DevOps — creating the new work item (create mode) or updating the existing one (edit mode) — then reports success with a link to the ticket, or the error if the submission fails.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/ado/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`): "new | <ADO ticket #>" — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **ado** workflow. Its full instructions are large and live in the `auro-ai` repository rather than inline here. **Read the workflow file in full and follow every step in order:**

1. Determine the path to your local `auro-ai` checkout — prefer the `AURO_AI_HOME` environment variable; if it is unset, ask the user for the path.
2. Read `"$AURO_AI_HOME/plugins/auro/skills/ado/SKILL.md"` in full (e.g. `cat` it via your shell tool, or open it with your read tool).
3. Execute that workflow exactly, in order. Treat every `$ARGUMENTS` reference in it as `${input}` — the argument you were invoked with. Where a step says to prompt the user, ask inline in chat.

Do not summarize, reorder, or skip steps — follow the file as written.
