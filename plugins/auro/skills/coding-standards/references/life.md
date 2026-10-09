# CS-LIFE — Component lifecycle and reactivity

**Loaded when the task involves** Lit lifecycle hooks, disconnect/reconnect, observer and listener attachment, reactive-state updates.

Rules in this file are numbered `CS-LIFE-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-LIFE-001 — firstUpdated is one-shot — re-arm from connectedCallback

Lit's `firstUpdated` runs once, ever. Any observer, listener, or timer attached there is dead after a disconnect/reconnect cycle, and the symptom surfaces only once the host is reparented or re-inserted — so it survives every test that renders the element and leaves it alone. Re-arm from `connectedCallback` gated on `hasUpdated`, which skips the first connect so `firstUpdated` still owns the initial attach. This has bitten `auro-select` twice.

- **Sources:** auro-formkit#1511
- **Since:** 2026-09-16
