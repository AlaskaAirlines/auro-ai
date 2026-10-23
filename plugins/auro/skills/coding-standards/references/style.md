# CS-STYLE — Shadow DOM, styling, layout and design tokens

**Loaded when the task involves** shadow-boundary CSS behavior, token usage, responsive layout and overflow.

Rules in this file are numbered `CS-STYLE-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-STYLE-001 — Pick ::slotted() or inheritance by whether the parent must win

To let a container visually influence its children without touching their state, set a CSS custom property from outside — but the two ways of doing it are not interchangeable. An inherited value is only a fallback that any local declaration on the child overrides, while `::slotted()` places a competing declaration on the child itself and can win over the child's own style; but `::slotted()` reaches only the host's direct light-DOM children, never through a nested custom element's slot. When the parent's state must override the child and the tree can nest, declare both together.

- **Sources:** AB#1566578
- **Since:** 2026-10-22
