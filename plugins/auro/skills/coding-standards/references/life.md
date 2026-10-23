# CS-LIFE — Component lifecycle and reactivity

**Loaded when the task involves** Lit lifecycle hooks, disconnect/reconnect, observer and listener attachment, reactive-state updates.

Rules in this file are numbered `CS-LIFE-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-LIFE-001 — Re-attach in connectedCallback whatever disconnectedCallback removes

Lit's `firstUpdated` runs once, ever, so an observer, listener or timer attached there and torn down in `disconnectedCallback` stays dead after the host is reparented or re-inserted — and that survives every test that renders the element and leaves it alone. Attach it in `connectedCallback` instead, gated on `hasUpdated` so `firstUpdated` still owns the first attach, and make the attach idempotent (return early if the observer already exists, or use an `AbortController`). A `firstUpdated` attach with no teardown keeps working across a reconnect and must not be re-armed, or every re-insertion adds a duplicate listener. Pin whichever shape you choose with a disconnect-and-reconnect test.

- **Sources:** auro-formkit#1511
- **Since:** 2026-09-16
