# Changelog

All notable changes to the `auro` plugin are documented here. This project
follows [Semantic Versioning](https://semver.org/). Bump the version in both
`plugins/auro/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
with each release, and tag the release (`git tag vX.Y.Z`).

## [1.2.1] — unreleased

### Changed
- `release-notes` skill — token-efficiency pass on how it reads git history: classify from
  commit **subjects only** (plus a targeted `BREAKING CHANGE` footer grep) instead of loading
  every commit body, gather per-commit file lists in a single `git log --name-only` call rather
  than a `git show` per commit, and pull bodies/diffs only for the release-worthy commits — with
  diff inspection bounded to path-scoped patches. No behavior or output change.

## [1.2.0] — unreleased

### Added
- `pr` skill — open a **draft** GitHub pull request for the current branch into the
  repo default branch: assigns it to you (`@me`), seeds the body from the repo's
  `.github` PR template, prepends the `## Executive Summary` of any post-mortem files
  added on the branch, and returns a link to the new PR. If a PR already exists for the
  branch, offers to idempotently refresh that PR's Executive Summary instead of creating
  a duplicate. Never pushes.

## [1.1.0] — unreleased

### Added
- `release-notes` skill — derive the next semantic version from the Conventional
  Commits since the last documented release, generate a release-notes document from
  the repo template, wire it into the accordion index, and stage the files.

## [1.0.0] — unreleased

### Added
- `commit` skill — guided Conventional Commits workflow: protected-branch guard,
  sync check, required ADO ticket / PR reference (with `prev` reuse), staged-diff
  message generation, post-mortem linking, and AI + human co-author accreditation.
- `code-review` skill — multi-model PR and local-branch review.
