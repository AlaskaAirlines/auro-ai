# CS-INTX — Keyboard and pointer interaction

**Loaded when the task involves** key handling, modifier/chorded keys, focus movement, typeahead and selection buffers.

Rules in this file are numbered `CS-INTX-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-INTX-001 — Filter chorded keys out of printable-key paths

A keyboard handler that treats any single-character `evt.key` as printable will accept `Cmd+C`, `Ctrl+V` and `Alt+<letter>` as typed input — the copy leaks characters into the typeahead buffer and matches the wrong option, and `Cmd+Space` toggles the bib. Native `<select>` ignores modified keys entirely. Gate on `ctrlKey || metaKey || altKey` at the top of the handler, before any side effect, rather than filtering after the fact.

- **Sources:** auro-formkit#1532
- **Since:** 2026-09-18

### CS-INTX-002 — Act on the highlighted element, not a cached index

A numeric active index goes stale whenever the option list reconciles — a selection collapsing to empty, a filter, a re-render — while the element the user sees highlighted does not. Resolve a keyboard action (Enter, Space, arrow from the current position) against the active element at the moment of the action, deriving any index from it then, rather than trusting an index stored earlier.

- **Sources:** AB#1606433
- **Since:** 2026-10-21
