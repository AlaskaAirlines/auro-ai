# CS-TOOL — Agent tooling and repo workflow

**Loaded when the task involves** skill and agent authoring, sandbox-safe shell constructs, commit and pull-request conventions, review process.

Rules in this file are numbered `CS-TOOL-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-TOOL-001 — Never pin a mutable identifier in a document that ships with it

A commit message citing post-mortem line numbers freezes those sections: the document can only ever be appended to, because any insertion above silently repoints the reference at the wrong text. A commit SHA cited inside a post-mortem riding the same branch is rewritten by every amend and again by the squash-merge, so it dangles almost immediately. Cite stable handles instead — a `## Heading`, or a subject plus branch plus PR number.

- **Sources:** AB#1636704, AB#1344690, AB#1599649
- **Learned:** ×3
- **Since:** 2026-09-16

### CS-TOOL-002 — Tooling is not a feature — prefix commits by what ships

Files under `.claude/` — skills, commands, hooks, agents, settings — have no public API and no semver impact, so `feat`, `fix`, or `perf` on them triggers an unearned release. Use `chore`. Keep semver prefixes for code that actually ships, and keep documentation gates universal in the same breath: a missing post-mortem is a release blocker even when nothing reaches npm, and the fix for a gate that feels unwarranted is to satisfy it, never to add an exemption.

- **Sources:** AB#1599649
- **Since:** 2026-09-16

### CS-TOOL-003 — Instruction-as-code must survive the sandbox, fallbacks included

A procedural skill is software, and its acceptance test is a real run rather than a proofread — every substantive defect in the code-review skill was found by executing it, not by reading it. Sandboxed shells reject `$(...)` and `<<'EOF'` heredocs, and a fallback that says "write to a temp file" is unreachable if the frontmatter grants no `Write`, so audit the fallback path under the declared tool grants and not just the happy path. Prefer a narrow REST call to `gh` porcelain for writes: `gh pr edit` drags in deprecated Projects-classic fields and hard-errors on orgs that still have them enabled.

- **Sources:** AB#1599649
- **Since:** 2026-09-16
