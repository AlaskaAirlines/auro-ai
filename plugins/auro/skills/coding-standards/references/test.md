# CS-TEST — Testing and CI

**Loaded when the task involves** assertion strength (no vacuous conditionals), deterministic timing, artifact-level certification.

Rules in this file are numbered `CS-TEST-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-TEST-001 — No vacuous conditionals — assert the precondition and the wiring

`if (labelSlot && menu.hasAttribute('aria-label')) expect(...)` passes green in exactly the case it exists to catch: the wiring regresses, the guard goes false, the assertion is skipped. Defensive chains such as `expect(x === undefined || x === null).to.be.true` fail the same way, and when they do fail they report "expected true to equal true" rather than what was actually wrong. Assert the precondition, then assert the wiring; never gate the wiring check on the precondition.

- **Sources:** auro-formkit#1532
- **Since:** 2026-09-16

### CS-TEST-002 — Scope fake timers to the timer under test, and install the clock first

`sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` leaves rAF, microtasks, and `Date` real, so Lit's scheduler and `elementUpdated` keep working while only the timer under test becomes deterministic. Install the clock *before* the code that schedules the timer, or the timer lands on the real queue and the fake never sees it. Restore in a `finally` so one test cannot leak a clock into the next. This replaced a 2200 ms wall-clock sleep, removing a CI flake source and its wall-clock cost together.

- **Sources:** auro-formkit#1532
- **Since:** 2026-09-16
