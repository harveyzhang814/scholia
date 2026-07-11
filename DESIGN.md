# DESIGN.md

Design system extracted from the live Scholia app (Phase 2 rendered-page audit, not from source). Scholia is a dense, task-focused workspace app — these are **App UI rules**, not marketing/landing rules.

## Typeface

- **Sans (UI + prose):** `Inter, system-ui, -apple-system, sans-serif`
- **Mono (timestamps, counters, IDs):** `"JetBrains Mono", ui-monospace, monospace` — used for things like `0:00 / 1:37:58`, `811 段`, task IDs in URLs/headers.
- Two font families total. Stays under the 3-family ceiling.

## Color Palette

Warm neutral base with a single sage-green accent. Correction (2026-07-11 full audit): dark mode DOES exist — driven by `prefers-color-scheme: dark` in `web/src/styles/globals.css`, no manual toggle in the UI. The rendered-page-only pass that produced the original version of this file missed it because the audit browser was in light mode.

**Light** (`:root`):

| Role | Hex | Usage |
|---|---|---|
| Page background | `#F9F8F4` | App shell, list backgrounds |
| Surface | `#FFFFFF` | Cards, panels |
| Elevated surface | `#F1EFE9` | Hover states, kbd chips |
| Border | `#E5E2DA` | Card borders, dividers |
| Primary text | `#2C2A24` | Headings, titles |
| Secondary text | `#67645E` | Body/prose — contrast ratio 5.55:1 on canvas, passes AA |
| Tertiary text | `#6E6961` | Metadata, timestamps, slugs — **updated 2026-07-11**, was `#9C9890` (2.70:1, failed WCAG AA); now ~5.1:1 |
| Accent (sage green) | `#5A8A5A` | Active tab underline, active nav state, progress/scrubber |

**Dark** (`prefers-color-scheme: dark`):

| Role | Hex |
|---|---|
| Page background | `#1A1A18` |
| Surface | `#232322` |
| Primary text | `#E8E8E6` |
| Secondary text | `#9A9B98` |
| Tertiary text | `#868782` (updated 2026-07-11, was `#6B6C69` at ~3.29:1) |
| Accent | `#7DAE7D` |

All warm-toned (no blue-gray mixed in) — consistent per the "warm or cool consistently" rule. No purple/violet anywhere — good, avoids the AI-slop gradient trap.

## Typography Scale

| Element | Size | Weight | Notes |
|---|---|---|---|
| App title (H1, "Scholia") | 18px | 600 | |
| List item title (H2) | 15px | 500 | Video/article card titles |
| Nav links (视频/阅读/纯读/剧场) | 16px | — | Top bar mode switcher |
| Tab labels (总结/文章) | 14px | 500 | 2px sage-green underline when active |
| Small buttons/labels (中文/EN/复制/保存) | 12px | — | |
| Body/prose text | 13.5px | — | line-height 23.625px (~1.75 ratio) — generous leading, good for long-form reading |

No skipped heading levels observed (H1 → H2, no jump to H3+ on audited pages).

## Spacing

4px base unit, observed directly in button padding:
- `4px 8px` — compact buttons (e.g. the `✦` icon button)
- `0px 8px` — nav-bar text buttons
- `4px 12px` — save button
- `10px 0px` — tab buttons (vertical rhythm, horizontal flush)

## Radius

Two-tier scale (corrected 2026-07-11 — the original single "4px dominant token" note was wrong; that sample only hit toolbar buttons):
- `12px` (Tailwind `rounded-xl`) — cards (TaskCard, ArticleCard) and card-like link containers.
- `4px` (Tailwind `rounded`) — small controls: toolbar buttons, kbd chips, mode-switcher buttons.
- No uniform bubbly radius across everything — the two-tier split is intentional hierarchy, not an AI-slop pattern.

## Layout

- **Article/prose reading column:** max-width ~680px — respects the 45–75 char measure guideline.
- **Task detail view:** 3-pane workspace (subtitle/transcript sidebar · summary+article center · notes sidebar), collapsible via mode switcher (视频/阅读/纯读/剧场/纯文/剧场). This is workspace-app density, not marketing-page composition — correct for the product.
- **List views (home):** 2-column card grid (video tab), dense 2-column table-like rows (article tab).

## Content & Microcopy

- Empty states follow the "warmth" pattern: icon + heading + one supporting sentence. Example (Gantt view with no data): 📊 icon, "此任务暂无执行时间数据" heading, one sentence explaining when it will populate. No bare "No data." states observed.
- No happy-talk / welcome paragraphs on the home page — content starts immediately with the video/article list.
- UI copy is short, utility-first Chinese labels (视频/文章/阅读/纯读/剧场/复制/显示文件/保存) — orientation and action language, not brand voice. Correct register for an App UI.

## AI Slop Check

None of the 11 blacklisted patterns were observed: no purple/gradient backgrounds, no 3-column icon-in-circle feature grid, no centered-everything, no decorative blobs/wavy dividers, no emoji-as-bullets, no colored left-border cards, no generic hero copy (this app has no marketing hero), no `system-ui`/`-apple-system` as the *primary* font (Inter is primary, system-ui is just the fallback stack).

## Full Audit (2026-07-11)

Ran a full `/design-review` pass (home video/article tabs, task detail, gantt empty state, pure-read mode). Fixed and committed:
- `--text-tertiary` contrast (light + dark) — see Color Palette above.
- Home page 视频/文章 tab buttons: hit area was 28×43px (below the 44px minimum for a primary nav control); widened to 52×47px without shifting visible text.
- ArticleCard: title now `line-clamp-2`, slug line now `truncate` — matches TaskCard's existing pattern, fixes inconsistent card heights caused by unbounded slug wrapping.

Flagged but **not fixed** (outside design-review's CSS-only scope — needs a product decision, not a style fix):
- The task-detail header's `⋯` overflow-menu button (`web/src/routes/tasks.$id.tsx:89`) has no `onClick` handler at all — it's dead UI, not just unstyled. Either wire it to something or remove it.
- Console logs a recurring 404 loop: `GET /api/events` (SSE) and `GET /api/tasks/:id/steps` fire repeatedly and fail. Backend/routing issue, not visual — worth a look since it's firing continuously in production use.

## Open Questions / Not Yet Covered

Not yet audited: the 阅读 (reader) and 剧场 (theater) modes' distinct layouts, the notes panel's interaction states (hover/focus/error), mobile breakpoint behavior for the task-detail workspace, and the command palette (`⌘K`) contents. The compact toolbar buttons in the task-detail header (mode switcher, back arrow) are also under 44px but were deliberately left alone — the header is a fixed 48px bar and forcing 44px targets there would require a larger layout change than a CSS-only design-review fix should make; flagging here instead of fixing blind.
