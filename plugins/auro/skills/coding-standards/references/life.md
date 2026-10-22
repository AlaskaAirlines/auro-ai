# CS-LIFE — Component lifecycle and reactivity

**Loaded when the task involves** Lit lifecycle hooks, disconnect/reconnect, observer and listener attachment, reactive-state updates.

Rules in this file are numbered `CS-LIFE-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-LIFE-001 — Re-attach in connectedCallback whatever disconnectedCallback removes

Lit's `firstUpdated` runs once, ever, so an observer, listener or timer attached there and torn down in `disconnectedCallback` stays dead after the host is reparented or re-inserted — and that survives every test that renders the element and leaves it alone. Attach it in `connectedCallback` instead, gated on `hasUpdated` so `firstUpdated` still owns the first attach, and make the attach idempotent (return early if the observer already exists, or use an `AbortController`). A `firstUpdated` attach with no teardown keeps working across a reconnect and must not be re-armed, or every re-insertion adds a duplicate listener. Pin whichever shape you choose with a disconnect-and-reconnect test.

- **Sources:** auro-formkit#1511
- **Since:** 2026-09-16

### CS-LIFE-002 — Never write a container's state into its children's own properties

`auro-menu` expressed its `disabled` state by setting `disabled` on every option, so re-enabling the menu wiped each option's own authored `disabled`. Derive the effective state where it is used instead, walking the whole ancestor chain — a deep query such as `this.items` spans nested submenus — and apply that check on every path that reaches the behavior (keyboard, pointer and programmatic `value=`) and in every class that asks the question. State that assistive technology reads straight off the DOM, such as `aria-disabled`, must still be pushed, with the same ancestor check and without clobbering the child's own value, on both triggers: the container's property changing and its children changing.

- **Sources:** AB#1566578
- **Since:** 2026-10-22
