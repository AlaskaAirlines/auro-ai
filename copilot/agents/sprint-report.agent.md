---
name: sprint-report
description: 'Generate a sprint report from the Auro Design System Azure DevOps board. It prompts for which iteration (sprint) to report on, reports the date range that iteration covers, then runs a saved ADO query filtered to work items changed during that range (excluding the Test Case/Test Plan/Test Suite/Epic/Feature/Initiative work item types report-wide) and summarizes them as a Work Item Type × current State matrix (User Story/Bug/Design Story/… against New/New (edit only)/Approved/Active/Blocked/Resolved/…), with the New column split into items actually created during the sprint versus older items still in New (New (edit only)), and the Closed column split into items that have a linked GitHub pull request or commit versus those that don''t. It also renders a matrix showing the +/- change in each count versus the previous sprint, the same current/diff matrices filtered to items carrying the Support tag, a breakdown of the current sprint by assignee, the same current/diff matrices grouped by Area Path, two flat lists of tickets finished this sprint (current state Closed/Done/Rejected) split by whether they have a linked GitHub commit or pull request, a flat list of open work-in-progress — every ticket that held a state other than New or Approved at any point during the sprint (using each item''s revision history, not just its current state) and whose current state is a still-open worked state (not New, Approved, Closed, Removed, Rejected, or Done) — and a sprint-completion breakdown table (completed User Story count and summed Story Points, plus resolved Bug counts by Severity: Critical/High/Medium/Low) over the closed-this-sprint-with-linked-code set. It also generates a per-bug root-cause **narrative** section (Section 8a) that, for every closed Bug that shipped code, flags whether it was a Support ticket (and who reported it), traces the fix''s changed lines back through `git blame` to the prior GitHub pull request(s) that last touched them (link and date), names who reviewed that last touch (humans vs AI bots), lists the contributors who last touched the buggy lines, makes an evidence-grounded (fallback code-style) AI-vs-human guess about who wrote that code, gives a leadership-level explanation of the process gap that let the defect slip past that earlier review, records the regression remedies the fix already applied, and recommends follow-on prevention steps. After rendering, it offers to export the report to a Markdown file at a filename and directory you choose (defaulting the filename to the sprint name). Read-only against Azure DevOps — it never creates or edits work items.'
user-invocable: true
disable-model-invocation: true
---

<!-- Generated from plugins/auro/skills/sprint-report/SKILL.md by scripts/build-copilot-agents.mjs. Do not edit by hand. -->

> **Argument** (`${input}`) — you receive it as the text of the prompt you were invoked with (the part after the agent name; empty if none). Where a step says to prompt the user, ask inline in chat.

## Task — start now

You are executing the **sprint-report** workflow. Its full instructions are large and live in the `auro-ai` repository rather than inline here. **Read the workflow file in full and follow every step in order:**

1. Determine the path to your local `auro-ai` checkout — prefer the `AURO_AI_HOME` environment variable; if it is unset, ask the user for the path.
2. Read `"$AURO_AI_HOME/plugins/auro/skills/sprint-report/SKILL.md"` in full (e.g. `cat` it via your shell tool, or open it with your read tool).
3. Execute that workflow exactly, in order. Treat every `$ARGUMENTS` reference in it as `${input}` — the argument you were invoked with. Where a step says to prompt the user, ask inline in chat.

Do not summarize, reorder, or skip steps — follow the file as written.
