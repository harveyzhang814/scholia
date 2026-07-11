# DESIGN.md

Design system extracted from the live Scholia app (Phase 2 rendered-page audit, not from source). Scholia is a dense, task-focused workspace app — these are **App UI rules**, not marketing/landing rules.

## Typeface

- **Sans (UI + prose):** `Inter, system-ui, -apple-system, sans-serif`
- **Mono (timestamps, counters, IDs):** `"JetBrains Mono", ui-monospace, monospace` — used for things like `0:00 / 1:37:58`, `811 段`, task IDs in URLs/headers.
- Two font families total. Stays under the 3-family ceiling.

## Color Palette

Warm neutral base with a single sage-green accent. No dark mode detected.

| Role | Value (rgb) | Hex | Usage |
|---|---|---|---|
| Page background | `rgb(249, 248, 244)` | `#F9F8F4` | App shell, list backgrounds |
| Surface | `rgb(255, 255, 255)` | `#FFFFFF` | Cards, panels |
| Primary text | `rgb(44, 42, 36)` | `#2C2A24` | Headings, titles |
| Body text | `rgb(103, 100, 94)` | `#67645E` | Paragraph text |
| Muted text | `rgb(156, 152, 144)` | `#9C9890` | Table headers, timestamps, secondary metadata |
| Border / divider | `rgb(241, 239, 233)` | `#F1EFE9` | Card borders, table rules |
| Accent (sage green) | `rgb(90, 138, 90)` | `#5A8A5A` | Active tab underline, active nav state, progress/scrubber |

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

- `4px` on cards, buttons, small containers — the dominant token.
- `0px` on flush dividers/table cells.
- Full/pill radius (`9999px`-equivalent) reserved for small dot/avatar-style elements only — not used decoratively on every element (avoids the "uniform bubbly radius" AI-slop pattern).

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

## Open Questions / Not Yet Covered

This file was generated from a rendered-page pass over the home list, video task-detail, gantt, and pure-read views only. Not yet audited: the 阅读 (reader) and 剧场 (theater) modes' distinct layouts, the notes panel's interaction states (hover/focus/error), mobile breakpoint behavior for the task-detail workspace, and the command palette (`⌘K`). Re-run `/design-review` for a full audit including these plus WCAG contrast verification, touch-target sizing, and motion/interaction-state checks.
