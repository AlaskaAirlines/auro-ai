# CS-INTX — Keyboard and pointer interaction

**Loaded when the task involves** key handling, modifier/chorded keys, focus movement, typeahead and selection buffers.

Rules in this file are numbered `CS-INTX-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-INTX-001 — Filter chorded keys out of printable-key paths

A keyboard handler that treats any single-character `evt.key` as printable will accept `Cmd+C`, `Ctrl+V` and `Alt+<letter>` as typed input — the copy leaks characters into the typeahead buffer and matches the wrong option, and `Cmd+Space` toggles the bib. Native `<select>` ignores modified keys entirely. Return early on `ctrlKey || metaKey || altKey` at the top of the printable-character and Space branch, before any side effect. Do not put the guard at the top of the whole handler: Alt+ArrowDown/Up and Ctrl+Arrow are meaningful chords and must still reach their branches.

- **Sources:** auro-formkit#1532
- **Since:** 2026-09-18

### CS-INTX-002 — Clear interaction buffers on programmatic value change and reset()

A typeahead or selection buffer is scoped to the user's current interaction, and focus loss is a proxy for "the interaction ended", not the definition of it. `hideBib()` closes the dropdown without blurring the host, so a blur-keyed clear never fires and the next keystroke concatenates onto stale characters, matching the wrong option. Clear in the value-change branch of `updated()` and again in `reset()` — the second covers the `undefined → undefined` case, where the value-change branch never runs at all.

- **Sources:** auro-formkit#1532
- **Since:** 2026-09-16

### CS-INTX-003 — Guard an interaction in the method that performs it, not at one entry point

A method called from a component's own event handler can still be a public integration point — `auro-select` and `auro-combobox` call `auro-menu.makeSelection()` directly, bypassing the menu's handler. Likewise `pointer-events: none` blocks only genuine pointer hit-testing; synthetic events, other event sources and test automation walk around it. Put the guard inside the method that performs the action, so every caller and every input channel meets it.

- **Sources:** AB#1566578
- **Since:** 2026-10-22
