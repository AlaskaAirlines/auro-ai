# [1.5.0](https://github.com/AlaskaAirlines/auro-ai/compare/v1.4.0...v1.5.0) (2026-08-13)


### Features

* enhance post-mortem skill to validate ticket completeness and extract requirements ([4539116](https://github.com/AlaskaAirlines/auro-ai/commit/45391164eb692ccda2d862b7a8295923c9e421e9))

# [1.4.0](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.11...v1.4.0) (2026-08-13)


### Features

* add new post-mortem skill and update code-review to validate correct PMs were created ([6cabcfe](https://github.com/AlaskaAirlines/auro-ai/commit/6cabcfe8ddef3aff67993f1f0697624984da18e3))

## [1.3.11](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.10...v1.3.11) (2026-08-11)


### Bug Fixes

* clarify draft handling and user confirmation steps in ADO skill ([919d8bb](https://github.com/AlaskaAirlines/auro-ai/commit/919d8bb3122ce6765fb7759013c7d61e686b9bd0))

## [1.3.10](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.9...v1.3.10) (2026-08-11)


### Bug Fixes

* clarify model usage and error handling in code-review skill documentation ([bd87849](https://github.com/AlaskaAirlines/auro-ai/commit/bd878491d660dc5913326e389142d1fe4035ef20))

## [1.3.9](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.8...v1.3.9) (2026-08-11)


### Bug Fixes

* enhance acceptance checklist formatting in SKILL.md for clarity ([c8f814f](https://github.com/AlaskaAirlines/auro-ai/commit/c8f814f77ff3539ce90f70b212acdc17616b47bd))

## [1.3.8](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.7...v1.3.8) (2026-08-07)


### Bug Fixes

* enhance description and clarify user prompts in code-review skill ([37a3daf](https://github.com/AlaskaAirlines/auro-ai/commit/37a3daff89a9c181790a284a1b6334d4849fc921))
* improve ADO ticket description guidelines for clarity and non-technical readability ([24174a1](https://github.com/AlaskaAirlines/auro-ai/commit/24174a1ed77b3741200c0af420a527fed6631fd0))

## [1.3.7](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.6...v1.3.7) (2026-07-29)


### Bug Fixes

* update ADO ticket description guidelines to support Markdown formatting ([b99f590](https://github.com/AlaskaAirlines/auro-ai/commit/b99f590d7417d9196bad7f975b507eed2468b900))

## [1.3.6](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.5...v1.3.6) (2026-07-29)


### Bug Fixes

* add bug effort tagging and strip html formatting ([7be81ee](https://github.com/AlaskaAirlines/auro-ai/commit/7be81eee0d61f7d62a56e423cf9630d733209b7e))

## [1.3.5](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.4...v1.3.5) (2026-07-29)


### Bug Fixes

* improve structure and clarity of ADO ticket description guidelines ([f5a3db0](https://github.com/AlaskaAirlines/auro-ai/commit/f5a3db021b468028a1a06f2f6c510acd70d81037))

## [1.3.4](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.3...v1.3.4) (2026-07-29)


### Bug Fixes

* use as little HTML as possible when inserting content into ADO tickets ([3d5fc15](https://github.com/AlaskaAirlines/auro-ai/commit/3d5fc15b83683ee6bae0acc357df41bdda00850b))

## [1.3.3](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.2...v1.3.3) (2026-07-29)


### Bug Fixes

* move design review recommendation to acceptance criteria ([d9935d7](https://github.com/AlaskaAirlines/auro-ai/commit/d9935d759a7222cabb3264dc768d3b7d09d17014))

## [1.3.2](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.1...v1.3.2) (2026-07-29)


### Bug Fixes

* only prompt for tokens version on UI/UX issues ([c9cdf28](https://github.com/AlaskaAirlines/auro-ai/commit/c9cdf28c2b5af63df4796bc3b75d35edc7946234))

## [1.3.1](https://github.com/AlaskaAirlines/auro-ai/compare/v1.3.0...v1.3.1) (2026-07-29)


### Bug Fixes

* improve order of content in description for readability ([496e1e2](https://github.com/AlaskaAirlines/auro-ai/commit/496e1e289b87daa8339696f265f41e20bc6230cd))

# [1.3.0](https://github.com/AlaskaAirlines/auro-ai/compare/v1.2.2...v1.3.0) (2026-07-28)


### Features

* add new ado skill ([ce1ad47](https://github.com/AlaskaAirlines/auro-ai/commit/ce1ad47a80e5edde626ed93223fb29853b760404))

## [1.2.2](https://github.com/AlaskaAirlines/auro-ai/compare/v1.2.1...v1.2.2) (2026-07-28)


### Performance Improvements

* improve release notes to allow updating existing files ([9a92281](https://github.com/AlaskaAirlines/auro-ai/commit/9a92281fe787a7af189753dd8ee38e5c1f37f195))

# Changelog

All notable changes to the `auro` plugin are documented here. This project
follows [Semantic Versioning](https://semver.org/). Releases are automated by
[semantic-release](https://github.com/semantic-release/semantic-release): on push
to `main` it derives the next version from [Conventional Commits](https://www.conventionalcommits.org/),
updates this file, bumps the version in both
`plugins/auro/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
(via `scripts/bump-version.mjs`), commits that back to `main`, and tags/publishes
the GitHub Release. Do not edit versions by hand — just write Conventional Commits.

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
