# CS-STYLE — Shadow DOM, styling, layout and design tokens

**Loaded when the task involves** shadow-boundary CSS behavior, token usage, responsive layout and overflow.

Rules in this file are numbered `CS-STYLE-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-STYLE-001 — Give a flex child `min-width: 0` before adding more CSS

A flex item defaults to `min-width: auto`, so it will not shrink below its content's intrinsic width — a long label then pushes its sibling off the row instead of sharing space or truncating. When a flex child overflows or refuses to share its row, set `min-width: 0` on it first; it is the canonical fix, and layering widths, `overflow` or `flex-basis` on top of `min-width: auto` treats the symptom.

- **Sources:** AB#1494482
- **Since:** 2026-10-21

### CS-STYLE-002 — Fix a layout defect in the component that causes it, not a shared dependency

A change to a shared component is a change for every consumer of it, whether intended or not — `auro-input` has two consumers, so a fix "for everyone" made for the datepicker is also a combobox change. Enumerate a shared component's consumers before touching it. When the defect comes from the consumer's own layout, reproduce the dependency's correct behaviour in the consumer instead of patching the dependency.

- **Sources:** AB#1494482, AB#1602084
- **Learned:** ×2
- **Since:** 2026-10-21

### CS-STYLE-003 — Build width-sensitive CSS for the 320px floor, never below it

320px is the supported minimum viewport width across Auro. A constraint that only fires below it is dead weight at best, and one that enforces it — a host `min-width` — breaks layout inside narrower containers. Size and truncate for the supported range, and do not add host-level width floors to defend widths nobody supports.

- **Sources:** AB#1602084
- **Since:** 2026-10-21

### CS-STYLE-004 — Derive dimensions from design tokens, not hard-coded pixels

A width computed from another element's size — an icon plus its padding minus a margin — must be written as `calc()` over the tokens that define those sizes. A literal such as `28px` is correct only until a token moves, and then drifts silently with nothing to flag it.

- **Sources:** AB#1602084
- **Since:** 2026-10-21
