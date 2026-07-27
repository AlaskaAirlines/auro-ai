# Changelog

All notable changes to the `auro` plugin are documented here. This project
follows [Semantic Versioning](https://semver.org/). Bump the version in both
`plugins/auro/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
with each release, and tag the release (`git tag vX.Y.Z`).

## [1.0.0] — unreleased

### Added
- `commit` skill — guided Conventional Commits workflow: protected-branch guard,
  sync check, required ADO ticket / PR reference (with `prev` reuse), staged-diff
  message generation, post-mortem linking, and AI + human co-author accreditation.
- `code-review` skill — multi-model PR and local-branch review.
