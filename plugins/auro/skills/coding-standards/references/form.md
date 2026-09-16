# CS-FORM — Forms, validation and native control behavior

**Loaded when the task involves** authoritative validity state, submission and reset, retained native controls, autofill and password managers.

Rules in this file are numbered `CS-FORM-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-FORM-001 — Keep the hidden native control in sync on every path

Any DOM node retained under `name` submits with the form — `aria-hidden` and `tabindex="-1"` block users, not user agents. Autofill, password managers, and bfcache restore write to it directly, without consulting its option list. `auro-select`'s multiSelect branch was right to decline to *apply* an autofilled scalar but returned bare, leaving the native mirror holding a value the form then POSTed instead of the component's own. Every early return on a native-control change event needs a snap-back call, not a bare `return`.

- **Sources:** AB#1532

### CS-FORM-002 — Clear interaction buffers on programmatic value change and reset()

A typeahead or selection buffer is scoped to the user's current interaction, and focus loss is a proxy for "the interaction ended", not the definition of it. `hideBib()` closes the dropdown without blurring the host, so a blur-keyed clear never fires and the next keystroke concatenates onto stale characters, matching the wrong option. Clear in the value-change branch of `updated()` and again in `reset()` — the second covers the `undefined → undefined` case, where the value-change branch never runs at all.

- **Sources:** AB#1532
