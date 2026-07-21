# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.3.0] - 2026-07-21

### Added

- `scholia start` — run the server detached from the terminal, logging to `~/.config/scholia/scholia.log`; closing the terminal no longer stops it.
- `scholia web` — open the browser page for whichever instance is currently running, without needing `--open` at start time.

### Changed

- `scholia serve`/`scholia start` no longer exit with an `EADDRINUSE` error when the requested port is taken — they fall back to an OS-assigned free port instead.

### Fixed

- Article detail page now preserves the originating list tab when navigating back.

## [0.2.0] - 2026-07-20

### Added

- Core server (`server/`): filesystem-based video/article task readers, Koa HTTP API, path helpers.
- CLI (`cli/`): `scholia serve`, `scholia config set/get`, `scholia stop` — with a running-file guard that refuses to start a second instance and cleans up on stop.
- Frontend (`web/`), migrated from VDL: task list, task detail, gantt/timeline views.
- Article support: arbitrary YAML frontmatter parsing rendered via `ArticleMetaBar`; annotations (highlights/notes) co-located with the source article file; bilingual reading entries (`meta.json` + `Origin`/`Translation`) treated as a single article.
- Subtitle overlay: consolidated size/language/CC menu, with font size scaling to the player container width.
- Home list sorting by content date (video occurrence date / article fetch date).
- `npm run release:local` for a standalone global install detached from the repo working copy.

### Fixed

- Path traversal guard on media streaming and content assets.
- SSE reconnect loop hitting a 404 route (`/api/tasks/:id/steps`).
- Reading-mode table of contents disappearing mid-scroll.
- Article detail page simplified to a read-only view; oversized subtitle base font size reduced.

## [0.1.0] - project scaffold
