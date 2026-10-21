# CS-API — Public API, contracts and documentation

**Loaded when the task involves** attribute/property/event/slot contracts, custom-elements manifest and editor IntelliSense, deprecation signalling.

Rules in this file are numbered `CS-API-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-API-001 — Document internal state with plain comments, never harvested JSDoc tags

`wca analyze` turns `@property`, `@attr`, `@slot`, `@event` and `@csspart` tags into the public `api.md`, so tagging an internal field publishes it as API. Document internal state with a plain comment at its assignment or use. After any JSDoc change, regenerate `api.md` and diff it against the base branch before shipping.

- **Sources:** AB#1602086
- **Since:** 2026-10-21

### CS-API-002 — Let demo example code throw on a missing element

Optional chaining in example functions (`el?.addEventListener(…)`) turns "this demo is broken" into "this demo is silently inert", and it defeats any retry paired with it. An example's element lookups should fail loudly when the node is absent, so a broken demo page surfaces as an error rather than as an example that quietly does nothing.

- **Sources:** AB#1611713
- **Since:** 2026-10-21

### CS-API-003 — Scope demo element lookups to the example, not the page

Demo element ids share one namespace with the documentation page around them, and short human-friendly ids collide with generated header anchors, so `document.querySelector('#error')` returns the heading, which comes first, instead of the component. Look elements up within the example's own wrapper (`closest('auro-*')` or a query on the wrapper), or namespace the ids, and fail the build on duplicate ids.

- **Sources:** AB#1611713
- **Since:** 2026-10-21
