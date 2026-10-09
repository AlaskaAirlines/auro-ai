# CS-BUILD — Build, packaging, dependencies and release

**Loaded when the task involves** bundler and monorepo task configuration, published-artifact correctness, versioning and which gate a check belongs on.

Rules in this file are numbered `CS-BUILD-001` upward, assigned in order, never renumbered and never reused. Maximum 25 rules; at 26 the category splits and this file's IDs stay as they are.

## Rules

### CS-BUILD-001 — Declare Turbo build deps explicitly when dependencies are hoisted

Turbo's `^build` resolves through the dependencies a package declares in its own `package.json`. Hoisting those to the root leaves `^build` resolving to the empty set, so Turbo schedules a component in parallel with the siblings it imports; `nodeResolve` then follows the workspace symlink to a `dist/` that does not exist yet, returns `null`, and Rollup externalizes the import silently. The race is unstable, so the resulting bug reads as intermittent. Add an explicit `<name>#build` `dependsOn` block for every affected component — the hoist that caused this got seven right and missed one. Do not rely on a source import implying a Turbo edge: nothing checks that "X imports workspace package Y" means "Turbo knows X depends on Y."

- **Sources:** AB#1575423
- **Applies to:** any build orchestrated by Turbo
- **Since:** 2026-09-16

### CS-BUILD-002 — Throw on UNRESOLVED_IMPORT in any Rollup config that publishes

Rollup's default is to warn, treat the specifier as external, leave the bare `import` in the output, and exit 0. That is the right default when a downstream consumer will rebundle, and the wrong one for a library that publishes its `dist/` directly — it ships a malformed artifact behind a green build. Set `onwarn` to throw on `UNRESOLVED_IMPORT`, and name the real causes in the message so the next person is not guessing.

- **Sources:** AB#1575423
- **Since:** 2026-09-16

### CS-BUILD-003 — Certify the built artifact on disk, and gate the publish path on it

Workspace tests certify the wrong thing: WTR loads `src/`, and framework smoke tests resolve bare specifiers against `node_modules` symlinks pointing back into the workspace, so a leaked specifier resolves cleanly in CI and fails only for a consumer installing from npm. Read the artifact off disk and check its imports against an allowlist derived from the bundler config. Put that check on the release workflow, not only the pull-request one — force-pushes, branch-protection bypasses, and direct-to-main flows skip the PR gate entirely.

- **Sources:** AB#1575423
- **Since:** 2026-09-16
