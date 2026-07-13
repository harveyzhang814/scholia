# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend tests (Node.js, no external deps)
npm test
node tests/server.test.js   # run a single test file

# Frontend dev server (proxies API to localhost:7654)
cd web && npm run dev

# Frontend build
cd web && npm run build      # runs tsc + vite build → web/dist/

# Frontend tests
cd web && npm test

# Run the CLI locally
npm link                     # first time only
scholia serve --open
scholia config set work-dir ~/vdl-work
scholia config get work-dir
```

Config persists to `~/.config/scholia/settings.conf`.

## Architecture

This is a **local-first annotation tool** with three layers:

### Backend (`server/`, `cli/`, CommonJS)
- `server/index.js` — `createApp(options)` factory; returns `{ app, token }`. The Koa app + router are assembled here; all API routes live in this file. Bearer token is generated per-process and required on all routes except media streaming (which accepts `?token=` query param for `<video>` src compatibility).
- `server/paths.js` — pure path helpers. Videos: `<workDir>/<taskId>/` (highlights/notes co-located). Articles: `<workDir>/article-<slug>/` — annotations live under the same `workDir` as videos, not under the article vault (`contentDir`).
- `server/video-source.js` / `server/article-source.js` — read-only adapters over the two content formats.
- `cli/index.js` — thin CLI; reads config, calls `createApp`, starts `http.createServer`. No framework.

### Frontend (`web/`, React 19 + TypeScript + Vite + Tailwind v4)
- `web/src/lib/api.ts` — all fetch calls; reads `?token=` from URL on load.
- `web/src/stores/` — Zustand stores: `player-store.ts` (video playback state), `ui-store.ts` (panel visibility, selected task).
- `web/src/routes/` — React Router v7 file-based routes: `_layout.tsx` (sidebar), `_index.tsx` (home/list), `tasks.$id.tsx` (detail view), `tasks.$id.gantt.tsx` (timeline view).
- Production: `web/dist/` is bundled by `npm run build` and served as static files by the Koa server.

### Content formats
- **Videos** — VDL format: `<workDir>/<taskId>/{meta.json, article.md, subtitles.json, media/video.mp4}`. Scholia writes `highlights.json` and `notes.json` alongside.
- **Articles** — Any Markdown directory (`contentDir`, read-only). Slugs derived from relative path (`2024/react-tips.md` → `article-2024-react-tips`). Annotations stored in `<workDir>/article-<slug>/{highlights.json,notes.json}` — same `workDir` as videos, kept separate from `contentDir` so the source vault is never written to.

### Key invariants
- Article task IDs are prefixed `article-` (`isArticleId` in `server/article-source.js` is the discriminator used everywhere).
- Writes use atomic rename: write to `.tmp` then `fs.rename`.
- No database — everything is JSON files read on each request.

## Git 工作流

分支命名规范、保护规则与合并流程详见 [docs/reference/git-workflow.md](docs/reference/git-workflow.md)。