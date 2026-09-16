# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.6.0] - 2026-09-16

### Added

- Creator detail page at `/creator/:key` (web) and `GET /api/creator/:key` (server) — a creator's combined video list, sorted by `upload_date`.
- Video: surface `uploader_id` through the API and video detail page.

### Changed

- Server: registry channels are now joined by pre-normalized key.

### Fixed

- Creator key lookup is now case-insensitive.
- Creator matching falls back to `channel_id` when the registry entry lacks one.
- Server degrades gracefully when a `creators.json` entry lacks videos.
- Web: creator query page no longer retries on 404.

## [0.5.0] - 2026-08-17

### Added

- X timelines: read-only view of synced X (Twitter) account archives — new home tab, `/x/:handle` detail route, tweet/quote/reply cards, and an `x-dir` config key.
- Read/unread state tracking for videos, articles, and tweets, with unread indicators on X timeline handles.
- CLI: `status`, `restart`, `config list`, and `version`/`help` commands.

### Fixed

- Tweet read-marker overlap and a read-state write race under concurrent requests.

## [0.4.2] - 2026-07-31

### Fixed

- `npm run release:local` no longer 404s on `@harveyzhang814/markdown-preview-core` — `npm install -g` propagates `npm_config_global=true` to postinstall's child processes, which made the nested `web/` install ignore the project `.npmrc` even after the 0.4.1 fix; the nested install now forces `npm_config_global=false` so it reads `web/.npmrc`. Verified with a real `npm run release:local` run.

## [0.4.1] - 2026-07-31

### Fixed

- `npm run release:local` (and any global install from a packed tarball) no longer fails to resolve `@harveyzhang814/markdown-preview-core` — `postinstall` now regenerates `web/.npmrc` before installing web dependencies, since npm always strips `.npmrc` from published tarballs regardless of the `files` whitelist.

## [0.4.0] - 2026-07-31

### Added

- Home list: per-tab (video/article) sort controls, persisted across sessions.
- Home list: redesigned cards — author/tag pills and highlight/note counts on both video and article cards.
- Header navigation: video/article tab switch moved into the header nav bar.
- Reader: note-anchor highlighting — clicking a note highlights and scrolls to its anchor in the article, distinct from regular highlights, with hover sync in both directions.

### Changed

- Reader: markdown rendering now uses `@harveyzhang814/markdown-preview-core` in place of `react-markdown` + a homegrown Mermaid component.
- Server: migrated internal routing from `koa-router` to `@koa/router`.

### Fixed

- Article date now falls back to `publish_date`/`fetch_date` frontmatter when missing, and displays in the same bottom meta row position as video cards.
- Task detail and article tab pages return to the correct originating list route when navigating back.
- Highlight anchors spanning inline markdown elements (e.g. bold/link boundaries) now highlight correctly.
- Home list sorting no longer misorders empty-string values; article sort field is now validated.
- Note card hover-link background no longer shows while the note is being edited.

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
