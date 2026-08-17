# X Timeline Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third scholia content type — X (Twitter) timelines sourced from `sync-xtimeline`'s per-handle archive JSON — with a read-only backend reader, `/api/x-timelines` routes, an `x-dir` config key, and dedicated frontend list/detail pages.

**Architecture:** A self-contained module parallel to (not integrated with) the existing video/article `/api/tasks/:taskId` dispatcher: `server/x-source.js` reads archive files, two new routes expose them, and two new frontend routes render them. No highlight/note support — pure browsing.

**Tech Stack:** Node.js/Koa (CommonJS) backend, React 19 + TypeScript + Vite + Tailwind v4 frontend, plain `node:assert` backend tests, Vitest + Testing Library frontend tests.

**Spec:** `docs/superpowers/specs/2026-08-17-x-timeline-module-design.md` (design drafts validated in `.hskill/sync-design/html/drafts/x-timeline-web-design.html` and `x-timeline-detail-web-design.html`) — read both before starting; this plan argues from that spec but the spec has full rationale for every decision below.

## Global Constraints

- `tweet_id` comparisons MUST use `BigInt`, never `Number` — it's a 19-digit snowflake ID, beyond `Number.MAX_SAFE_INTEGER` (16 digits).
- `x-dir` has **no default value** — same as `work-dir`/`content-dir`: unset means empty list + config-command hint, never an implicit path guess.
- Tweet field parsing is **unknown-field-tolerant** — no schema validation, no field whitelisting, pass objects through as-is.
- `XTweet` fields keep the archive's original snake_case names (`tweet_id`, `author_handle`, ...) — no camelCase transformation layer.
- Tweet type visuals use **no text/tag badges** for type identification — `post` is the unstyled baseline; `reply`/`quote` are card-internal structure only; `repost` is the only type allowed to wrap outside the card boundary (validated in the design draft).
- No new CSS colors, border-radii, or spacing tokens — reuse existing `var(--bg-surface)`, `var(--bg-elevated)`, `var(--border-subtle)`, `var(--border-strong)`, `var(--text-primary/secondary/tertiary)`, `var(--accent-3)`, `var(--accent-11)`, `var(--font-mono)` exactly as defined in `web/src/styles/globals.css`.
- X module is fully decoupled from `/api/tasks/:taskId`, `isArticleId`, and the highlights/notes infrastructure — do not thread it through any of those.

---

## Task 1: Backend data source — `server/x-source.js`

**Files:**
- Create: `server/x-source.js`
- Test: `tests/x-source.test.js`
- Modify: `package.json:22` (add the new test file to the `test` script)

**Interfaces:**
- Produces: `isValidHandle(handle: string): boolean`, `listXTimelines(xDir: string): Promise<Array<{handle: string, tweetCount: number, latestAt?: string, latestPreview?: string}>>`, `getXTimeline(handle: string, xDir: string): Promise<{handle: string, tweets: object[]} | null>` — all three exported from `server/x-source.js`, consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `tests/x-source.test.js`:

```js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-xs-'));
  const xDir = path.join(tmp, 'tweets');
  fs.mkdirSync(xDir, { recursive: true });

  const { listXTimelines, getXTimeline } = require('../server/x-source');

  // Real-magnitude 19-digit snowflake IDs — deliberately beyond
  // Number.MAX_SAFE_INTEGER (16 digits) to catch precision-loss bugs.
  const trqTweets = [
    {
      tweet_id: '2087258093499695106', url: 'https://x.com/trq212/status/2087258093499695106',
      text: 'oldest post', timestamp: '2026-08-11T19:21:23.000Z', author_handle: '@trq212',
      type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最旧的一条',
    },
    {
      tweet_id: '2088049989306192106', url: 'https://x.com/trq212/status/2088049989306192106',
      text: 'everything truly is code', timestamp: '2026-08-13T23:48:06.000Z', author_handle: '@trq212',
      type: 'quote', reply_to_handle: null, quoted_author: '@mannay',
      quoted_text: 'draw faces with js', quoted_timestamp: '2026-08-12T12:50:11.000Z', translated: '一切终究都是代码',
    },
    {
      tweet_id: '2088298127346536578', url: 'https://x.com/lydiahallie/status/2088298127346536578',
      text: 'newest repost content', timestamp: '2026-08-14T16:14:06.000Z', author_handle: '@lydiahallie',
      type: 'repost', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最新的转推内容',
    },
    {
      tweet_id: '2088100000000000001', url: 'https://x.com/trq212/status/2088100000000000001',
      text: 'replying to openai', timestamp: '2026-08-14T01:00:00.000Z', author_handle: '@trq212',
      type: 'reply', reply_to_handle: '@openai', quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '回复 openai',
    },
  ];
  fs.writeFileSync(path.join(xDir, 'trq212.json'), JSON.stringify(trqTweets));
  fs.writeFileSync(path.join(xDir, 'broken.json'), '{not valid json');
  fs.writeFileSync(path.join(xDir, 'empty.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(xDir, 'not-a-tweet-file.txt'), 'ignore me');

  await test('listXTimelines returns one summary per valid handle file, skipping corrupt JSON', async () => {
    const summaries = await listXTimelines(xDir);
    const handles = summaries.map((s) => s.handle).sort();
    assert.deepEqual(handles, ['empty', 'trq212']);
  });

  await test('listXTimelines summary uses the newest tweet by tweet_id, not by array order', async () => {
    const summaries = await listXTimelines(xDir);
    const trq = summaries.find((s) => s.handle === 'trq212');
    assert.equal(trq.tweetCount, 4);
    // Newest by tweet_id is the repost (2088298127346536578), which sits third
    // in the source array — proves this isn't just "last element wins".
    assert.equal(trq.latestAt, '2026-08-14T16:14:06.000Z');
    assert.equal(trq.latestPreview, '最新的转推内容');
  });

  await test('listXTimelines includes zero-tweet handles without latestAt/latestPreview', async () => {
    const summaries = await listXTimelines(xDir);
    const empty = summaries.find((s) => s.handle === 'empty');
    assert.equal(empty.tweetCount, 0);
    assert.equal(empty.latestAt, undefined);
    assert.equal(empty.latestPreview, undefined);
  });

  await test('listXTimelines returns [] for a missing directory', async () => {
    const summaries = await listXTimelines(path.join(tmp, 'does-not-exist'));
    assert.deepEqual(summaries, []);
  });

  await test('getXTimeline sorts tweets by tweet_id descending using BigInt precision', async () => {
    const timeline = await getXTimeline('trq212', xDir);
    assert.ok(timeline);
    assert.deepEqual(timeline.tweets.map((t) => t.tweet_id), [
      '2088298127346536578', // repost, newest
      '2088100000000000001', // reply
      '2088049989306192106', // quote
      '2087258093499695106', // post, oldest
    ]);
  });

  await test('getXTimeline preserves quote-specific fields untouched', async () => {
    const timeline = await getXTimeline('trq212', xDir);
    const quote = timeline.tweets.find((t) => t.type === 'quote');
    assert.equal(quote.quoted_author, '@mannay');
    assert.equal(quote.quoted_text, 'draw faces with js');
    assert.equal(quote.quoted_timestamp, '2026-08-12T12:50:11.000Z');
  });

  await test('getXTimeline returns null for a corrupt JSON file', async () => {
    assert.equal(await getXTimeline('broken', xDir), null);
  });

  await test('getXTimeline returns null for a handle with no archive file', async () => {
    assert.equal(await getXTimeline('nobody', xDir), null);
  });

  await test('getXTimeline returns null for a handle containing path separators', async () => {
    assert.equal(await getXTimeline('../broken', xDir), null);
    assert.equal(await getXTimeline('sub/dir', xDir), null);
  });

  await test('getXTimeline returns an empty tweets array for a handle with zero tweets', async () => {
    const timeline = await getXTimeline('empty', xDir);
    assert.deepEqual(timeline, { handle: 'empty', tweets: [] });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/x-source.test.js`
Expected: FAIL with `Cannot find module '../server/x-source'`

- [ ] **Step 3: Write minimal implementation**

Create `server/x-source.js`:

```js
'use strict';
const fs = require('fs');
const path = require('path');

function isValidHandle(handle) {
  return typeof handle === 'string' && handle.length > 0 && !/[/\\]/.test(handle) && !handle.includes('..');
}

// tweet_id is a 19-digit snowflake ID, beyond Number.MAX_SAFE_INTEGER
// (16 digits) — comparing as Number silently loses precision and produces
// wrong ordering. BigInt is required here.
function compareTweetIdDesc(a, b) {
  const diff = BigInt(b.tweet_id) - BigInt(a.tweet_id);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

async function readHandleFile(xDir, handle) {
  const filePath = path.join(xDir, `${handle}.json`);
  let raw;
  try { raw = await fs.promises.readFile(filePath, 'utf8'); }
  catch { return null; }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

async function listXTimelines(xDir) {
  let entries;
  try { entries = await fs.promises.readdir(xDir, { withFileTypes: true }); }
  catch { return []; }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
  const summaries = [];
  for (const file of files) {
    const handle = path.basename(file.name, '.json');
    const tweets = await readHandleFile(xDir, handle);
    if (!tweets) continue; // corrupt/non-array JSON — skip this handle, don't fail the whole list
    const sorted = tweets.slice().sort(compareTweetIdDesc);
    const latest = sorted[0];
    summaries.push({
      handle,
      tweetCount: tweets.length,
      latestAt: latest ? latest.timestamp : undefined,
      latestPreview: latest ? (latest.translated ?? latest.text) : undefined,
    });
  }
  summaries.sort((a, b) => {
    const at = a.latestAt ? Date.parse(a.latestAt) : 0;
    const bt = b.latestAt ? Date.parse(b.latestAt) : 0;
    return bt - at;
  });
  return summaries;
}

async function getXTimeline(handle, xDir) {
  if (!isValidHandle(handle)) return null;
  const tweets = await readHandleFile(xDir, handle);
  if (!tweets) return null;
  return { handle, tweets: tweets.slice().sort(compareTweetIdDesc) };
}

module.exports = { isValidHandle, listXTimelines, getXTimeline };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/x-source.test.js`
Expected: `11 passed, 0 failed`

- [ ] **Step 5: Wire into the root test script**

In `package.json`, change the `"test"` script (currently `"node tests/config.test.js && node tests/video-source.test.js && node tests/article-source.test.js && node tests/server.test.js && node tests/integration.test.js"`) to insert `node tests/x-source.test.js` after `article-source.test.js` and before `server.test.js`:

```json
"test": "node tests/config.test.js && node tests/video-source.test.js && node tests/article-source.test.js && node tests/x-source.test.js && node tests/server.test.js && node tests/integration.test.js",
```

Run: `npm test`
Expected: all suites pass, including the new one.

- [ ] **Step 6: Commit**

```bash
git add server/x-source.js tests/x-source.test.js package.json
git commit -m "feat: add X timeline archive reader (server/x-source.js)"
```

---

## Task 2: Backend routes — `/api/x-timelines`

**Files:**
- Modify: `server/index.js:9-12` (imports), `server/index.js:61-64` (createApp options), insert new routes after the `/api/articles` handler (`server/index.js:93-103`)
- Modify: `tests/server.test.js` (fixture + new test cases)

**Interfaces:**
- Consumes: `listXTimelines`, `getXTimeline` from `server/x-source.js` (Task 1).
- Produces: `createApp({ ..., xDir })` accepts a new `xDir` option; `GET /api/x-timelines` → `Array<{handle, tweetCount, latestAt?, latestPreview?}>`; `GET /api/x-timelines/:handle` → `{handle, tweets}` or 404. Consumed by Task 3 (CLI wiring) and the frontend (Task 4).

- [ ] **Step 1: Write the failing test**

In `tests/server.test.js`, find the fixture setup block that writes `outside.png` (right before the `createApp` call):

```js
  fs.writeFileSync(path.join(tmp, 'outside.png'), 'outside-bytes');
```

Immediately after that line, add:

```js
  const xDir = path.join(tmp, 'tweets');
  fs.mkdirSync(xDir, { recursive: true });
  fs.writeFileSync(path.join(xDir, 'trq212.json'), JSON.stringify([
    {
      tweet_id: '2087258093499695106', url: 'https://x.com/trq212/status/2087258093499695106',
      text: 'oldest post', timestamp: '2026-08-11T19:21:23.000Z', author_handle: '@trq212',
      type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最旧的一条',
    },
    {
      tweet_id: '2088298127346536578', url: 'https://x.com/lydiahallie/status/2088298127346536578',
      text: 'newest repost content', timestamp: '2026-08-14T16:14:06.000Z', author_handle: '@lydiahallie',
      type: 'repost', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最新的转推内容',
    },
  ]));
```

Then change the `createApp` call:

```js
  const { createApp } = require('../server');
  const { app, token: _t } = createApp({ workDir, contentDir, xDir, token: TOKEN });
```

Then, right before the final `server.close();` line, add the new test cases:

```js
  await test('GET /api/x-timelines returns a summary per handle', async () => {
    const r = await req(port, 'GET', '/api/x-timelines');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].handle, 'trq212');
    assert.equal(r.body[0].tweetCount, 2);
    assert.equal(r.body[0].latestAt, '2026-08-14T16:14:06.000Z');
  });

  await test('GET /api/x-timelines/:handle returns tweets sorted newest-first', async () => {
    const r = await req(port, 'GET', '/api/x-timelines/trq212');
    assert.equal(r.status, 200);
    assert.equal(r.body.handle, 'trq212');
    assert.deepEqual(r.body.tweets.map((t) => t.tweet_id), ['2088298127346536578', '2087258093499695106']);
  });

  await test('GET /api/x-timelines/:handle 404s for an unknown handle', async () => {
    const r = await req(port, 'GET', '/api/x-timelines/nobody');
    assert.equal(r.status, 404);
  });

  await test('GET /api/x-timelines/:handle 404s for a handle with path separators', async () => {
    const r = await req(port, 'GET', `/api/x-timelines/${encodeURIComponent('../trq212')}`);
    assert.equal(r.status, 404);
  });

  await test('GET /api/x-timelines requires auth like other routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/x-timelines`);
    assert.equal(res.status, 401);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/server.test.js`
Expected: FAIL — `/api/x-timelines` returns 404 (route doesn't exist yet; Koa's default for unmatched routes)

- [ ] **Step 3: Write minimal implementation**

In `server/index.js:9-12`, change:

```js
const { getVideoDirs, getArticleAnnotationDirs } = require('./paths');
const { listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent } = require('./video-source');
const { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent, resolveArticleFile } = require('./article-source');
const { createStaticServe } = require('./static-serve');
```

to:

```js
const { getVideoDirs, getArticleAnnotationDirs } = require('./paths');
const { listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent } = require('./video-source');
const { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent, resolveArticleFile } = require('./article-source');
const { listXTimelines, getXTimeline } = require('./x-source');
const { createStaticServe } = require('./static-serve');
```

In `server/index.js:61-64`, change:

```js
function createApp(options = {}) {
  const WORK_DIR = options.workDir || null;
  const CONTENT_DIR = options.contentDir || null;
  const token = options.token || crypto.randomBytes(24).toString('hex');
```

to:

```js
function createApp(options = {}) {
  const WORK_DIR = options.workDir || null;
  const CONTENT_DIR = options.contentDir || null;
  const X_DIR = options.xDir || null;
  const token = options.token || crypto.randomBytes(24).toString('hex');
```

After the `/api/articles` route handler (`server/index.js:93-103`, ends with the closing `});` right before `// Get task (video or article)`), insert:

```js
  // List X timelines
  router.get('/x-timelines', async (ctx) => {
    if (!X_DIR) { ctx.body = []; return; }
    ctx.body = await listXTimelines(X_DIR);
  });

  // Get a single X timeline's full tweet stream
  router.get('/x-timelines/:handle', async (ctx) => {
    const { handle } = ctx.params;
    if (!X_DIR) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const timeline = await getXTimeline(handle, X_DIR);
    if (!timeline) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    ctx.body = timeline;
  });

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/server.test.js`
Expected: all tests pass, including the new `/api/x-timelines*` cases.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add server/index.js tests/server.test.js
git commit -m "feat: add /api/x-timelines routes"
```

---

## Task 3: CLI config — `x-dir`

**Files:**
- Modify: `cli/config.js:45-52` (`readConfig`)
- Modify: `cli/index.js:32-36` (serve's `createApp` call), `cli/index.js:120-136` (`config` subcommand)
- Modify: `tests/config.test.js` (new `readConfig` cases)
- Modify: `tests/integration.test.js` (new CLI round-trip case)

**Interfaces:**
- Consumes: `createApp({ xDir })` from Task 2.
- Produces: `readConfig()` returns `{ workDir, contentDir, xDir }`; `scholia config set|get x-dir <value>` works end-to-end.

- [ ] **Step 1: Write the failing tests**

In `tests/config.test.js`, right after the existing `'readConfig returns both keys'` test block, add:

```js
  await test('readConfig returns xDir', () => {
    const { readConfig, writeValue } = require('../cli/config');
    writeValue('X_DIR', '/tmp/xdir', cfgPath);
    const cfg = readConfig(cfgPath);
    assert.equal(cfg.xDir, '/tmp/xdir');
  });

  await test('readConfig returns null xDir when unset', () => {
    const { readConfig } = require('../cli/config');
    const emptyPath = path.join(tmp, 'empty-xdir.conf');
    fs.writeFileSync(emptyPath, '');
    const cfg = readConfig(emptyPath);
    assert.equal(cfg.xDir, null);
  });
```

In `tests/integration.test.js`, right after the existing `'scholia config set and get'` test block, add:

```js
  await test('scholia config set and get x-dir', async () => {
    const xDir = path.join(tmp, 'tweets');
    const set = spawn(process.execPath, [CLI, 'config', 'set', 'x-dir', xDir], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    const setCode = await new Promise(r => set.on('close', r));
    assert.equal(setCode, 0, 'config set should exit 0');
    const get = spawn(process.execPath, [CLI, 'config', 'get', 'x-dir'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    let out = '';
    get.stdout.on('data', d => { out += d; });
    await new Promise(r => get.on('close', r));
    assert.equal(out.trim(), xDir);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/config.test.js && node tests/integration.test.js`
Expected: FAIL — `cfg.xDir` is `undefined` (not `'/tmp/xdir'`/`null`), and `config set x-dir` exits non-zero with "Unknown key: x-dir"

- [ ] **Step 3: Write minimal implementation**

In `cli/config.js:45-52`, change:

```js
function readConfig(cfgPath = getConfigPath()) {
  const workDirRaw = readValue('WORK_DIR', cfgPath);
  const contentDirRaw = readValue('CONTENT_DIR', cfgPath);
  return {
    workDir: workDirRaw ? expandPath(workDirRaw) : null,
    contentDir: contentDirRaw ? expandPath(contentDirRaw) : null,
  };
}
```

to:

```js
function readConfig(cfgPath = getConfigPath()) {
  const workDirRaw = readValue('WORK_DIR', cfgPath);
  const contentDirRaw = readValue('CONTENT_DIR', cfgPath);
  const xDirRaw = readValue('X_DIR', cfgPath);
  return {
    workDir: workDirRaw ? expandPath(workDirRaw) : null,
    contentDir: contentDirRaw ? expandPath(contentDirRaw) : null,
    xDir: xDirRaw ? expandPath(xDirRaw) : null,
  };
}
```

In `cli/index.js:32-36`, change:

```js
  const config = readConfig();
  const staticDir = path.join(__dirname, '..', 'web', 'dist');
  const { app, token } = createApp({
    workDir: config.workDir,
    contentDir: config.contentDir,
    staticDir,
  });
```

to:

```js
  const config = readConfig();
  const staticDir = path.join(__dirname, '..', 'web', 'dist');
  const { app, token } = createApp({
    workDir: config.workDir,
    contentDir: config.contentDir,
    xDir: config.xDir,
    staticDir,
  });
```

In `cli/index.js:120`, change:

```js
  const KEY_MAP = { 'work-dir': 'WORK_DIR', 'content-dir': 'CONTENT_DIR' };
```

to:

```js
  const KEY_MAP = { 'work-dir': 'WORK_DIR', 'content-dir': 'CONTENT_DIR', 'x-dir': 'X_DIR' };
```

In `cli/index.js:125`, change:

```js
      if (!configKey) { console.error(`Unknown key: ${key}\nKnown keys: work-dir, content-dir`); process.exit(1); }
```

to:

```js
      if (!configKey) { console.error(`Unknown key: ${key}\nKnown keys: work-dir, content-dir, x-dir`); process.exit(1); }
```

In `cli/index.js:136`, change:

```js
    console.error(`Usage: scholia config set|get <work-dir|content-dir> [value]`);
```

to:

```js
    console.error(`Usage: scholia config set|get <work-dir|content-dir|x-dir> [value]`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/config.test.js && node tests/integration.test.js`
Expected: all pass.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add cli/config.js cli/index.js tests/config.test.js tests/integration.test.js
git commit -m "feat: add x-dir config key"
```

---

## Task 4: Frontend API types and hooks

**Files:**
- Modify: `web/src/lib/api.ts` (new types + `api.listXTimelines`/`api.getXTimeline`)
- Create: `web/src/hooks/use-x-timelines.ts`

**Interfaces:**
- Consumes: `GET /api/x-timelines`, `GET /api/x-timelines/:handle` from Task 2.
- Produces: `export interface XTweet`, `export interface XTimelineSummary`, `export interface XTimeline` from `web/src/lib/api.ts`; `api.listXTimelines(): Promise<XTimelineSummary[]>`; `api.getXTimeline(handle: string): Promise<XTimeline>`; `useXTimelines()` and `useXTimeline(handle)` from `web/src/hooks/use-x-timelines.ts`. Consumed by Tasks 5, 7, 8, 9, 10.

There is no existing unit-test convention for `api.ts` or the `use-tasks.ts` hooks in this codebase (grep confirms no `api.test.ts`/`use-tasks.test.ts`) — this task is verified by the TypeScript build instead, consistent with how the rest of the API/hooks layer is (not) tested here.

- [ ] **Step 1: Add the new types to `web/src/lib/api.ts`**

Right after the existing `export interface MediaInfo { ... }` block (before `export const api = {`), add:

```ts
export interface XTweet {
  tweet_id: string;
  url: string;
  text: string;
  timestamp: string;
  author_handle: string;
  type: string; // 'post' | 'repost' | 'quote' | 'reply', kept as string for forward-compat with unknown values
  reply_to_handle: string | null;
  quoted_author: string | null;
  quoted_text: string | null;
  quoted_timestamp: string | null;
  translated: string | null;
}

export interface XTimelineSummary {
  handle: string;
  tweetCount: number;
  latestAt?: string;
  latestPreview?: string;
}

export interface XTimeline {
  handle: string;
  tweets: XTweet[];
}
```

- [ ] **Step 2: Add the API functions**

Inside `export const api = { ... }`, right after `listArticles: () => request<Article[]>('/api/articles'),`, add:

```ts
  listXTimelines: () => request<XTimelineSummary[]>('/api/x-timelines'),
  getXTimeline: (handle: string) => request<XTimeline>(`/api/x-timelines/${handle}`),
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npm run build`
Expected: succeeds (no TypeScript errors; nothing consumes the new exports yet, so this only proves the types themselves are well-formed).

- [ ] **Step 4: Create the hooks**

Create `web/src/hooks/use-x-timelines.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useXTimelines() {
  return useQuery({
    queryKey: ['x-timelines'],
    queryFn: () => api.listXTimelines(),
    staleTime: 60_000,
  });
}

export function useXTimeline(handle: string | undefined) {
  return useQuery({
    queryKey: ['x-timeline', handle],
    queryFn: () => api.getXTimeline(handle!),
    enabled: Boolean(handle),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 5: Verify the build compiles**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/api.ts web/src/hooks/use-x-timelines.ts
git commit -m "feat: add X timeline API types and hooks"
```

---

## Task 5: Sorting — `web/src/lib/sort.ts`

**Files:**
- Modify: `web/src/lib/sort.ts` (add `sortXTimelines`)
- Modify: `web/src/lib/sort.test.ts` (add test cases)

**Interfaces:**
- Consumes: `XTimelineSummary` from `web/src/lib/api.ts` (Task 4), `compareBy`/`SortState` already defined in `sort.ts`.
- Produces: `export function sortXTimelines(timelines: XTimelineSummary[], sort: SortState): XTimelineSummary[]`. Consumed by Task 10. No new `SortField` union member is added — X reuses the existing `'date'` and `'title'` values (`'title'` is repurposed to mean "sort by handle name" in this context, per the design spec's "no new sort field type" decision).

- [ ] **Step 1: Write the failing test**

In `web/src/lib/sort.test.ts`, change the import line:

```ts
import { compareBy, sortTasks, sortArticles } from './sort';
import type { Task } from './api';
import type { Article } from './api';
```

to:

```ts
import { compareBy, sortTasks, sortArticles, sortXTimelines } from './sort';
import type { Task, Article, XTimelineSummary } from './api';
```

At the end of the file, after the `describe('sortArticles', ...)` block, add:

```ts
const baseXTimeline: XTimelineSummary = { handle: 'trq212', tweetCount: 20 };

describe('sortXTimelines', () => {
  it('sorts by date descending using latestAt', () => {
    const timelines: XTimelineSummary[] = [
      { ...baseXTimeline, handle: 'a', latestAt: '2026-08-01T00:00:00.000Z' },
      { ...baseXTimeline, handle: 'b', latestAt: '2026-08-14T00:00:00.000Z' },
    ];
    expect(sortXTimelines(timelines, { field: 'date', direction: 'desc' }).map((t) => t.handle)).toEqual(['b', 'a']);
  });

  it('sorts handles missing latestAt to the end', () => {
    const timelines: XTimelineSummary[] = [
      { ...baseXTimeline, handle: 'a', latestAt: '2026-08-01T00:00:00.000Z' },
      { ...baseXTimeline, handle: 'b' },
    ];
    expect(sortXTimelines(timelines, { field: 'date', direction: 'desc' }).map((t) => t.handle)).toEqual(['a', 'b']);
  });

  it('sorts by handle name (reusing the title field)', () => {
    const timelines: XTimelineSummary[] = [
      { ...baseXTimeline, handle: 'zebra' },
      { ...baseXTimeline, handle: 'apple' },
    ];
    expect(sortXTimelines(timelines, { field: 'title', direction: 'asc' }).map((t) => t.handle)).toEqual(['apple', 'zebra']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/sort.test.ts`
Expected: FAIL — `sortXTimelines` is not exported

- [ ] **Step 3: Write minimal implementation**

In `web/src/lib/sort.ts`, change the import line:

```ts
import type { Task, Article } from './api';
```

to:

```ts
import type { Task, Article, XTimelineSummary } from './api';
```

At the end of the file, after `sortArticles`, add:

```ts
function getXTimelineSortValue(field: SortField, timeline: XTimelineSummary): string | number | undefined {
  if (field === 'date') return timeline.latestAt ? Date.parse(timeline.latestAt) : undefined;
  return timeline.handle;
}

export function sortXTimelines(timelines: XTimelineSummary[], sort: SortState): XTimelineSummary[] {
  return [...timelines].sort((a, b) => compareBy(a, b, (item) => getXTimelineSortValue(sort.field, item), sort.direction));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/sort.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/sort.ts web/src/lib/sort.test.ts
git commit -m "feat: add sortXTimelines"
```

---

## Task 6: UI store — `xSort` state

**Files:**
- Modify: `web/src/stores/ui-store.ts` (add `xSort`/`setXSort`)
- Modify: `web/src/stores/ui-store.test.ts` (add test cases)

**Interfaces:**
- Produces: `useUiStore().xSort: SortState`, `useUiStore().setXSort(sort: SortState): void`, persisted to `localStorage` key `'home-sort-x'`. Consumed by Task 10.

- [ ] **Step 1: Write the failing test**

At the end of `web/src/stores/ui-store.test.ts`, after the `describe('ui-store articleSort', ...)` block, add:

```ts
describe('ui-store xSort', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({
      videoSort: { field: 'date', direction: 'desc' },
      xSort: { field: 'date', direction: 'desc' }
    });
  });

  it('defaults to date descending', () => {
    expect(useUiStore.getState().xSort).toEqual({ field: 'date', direction: 'desc' });
  });

  it('setXSort updates state and persists independently of videoSort', () => {
    useUiStore.getState().setXSort({ field: 'title', direction: 'asc' });
    expect(useUiStore.getState().xSort).toEqual({ field: 'title', direction: 'asc' });
    expect(localStorage.getItem('home-sort-x')).toBe(JSON.stringify({ field: 'title', direction: 'asc' }));
    expect(useUiStore.getState().videoSort).toEqual({ field: 'date', direction: 'desc' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/stores/ui-store.test.ts`
Expected: FAIL — `useUiStore.getState().xSort` is `undefined`

- [ ] **Step 3: Write minimal implementation**

In `web/src/stores/ui-store.ts`, in the `UiState` interface, right after:

```ts
  articleSort: SortState;
  setArticleSort: (sort: SortState) => void;
```

add:

```ts
  xSort: SortState;
  setXSort: (sort: SortState) => void;
```

In the `create<UiState>((set, get) => ({ ... }))` body, right after:

```ts
  articleSort: readSortState('home-sort-article', ['date', 'title']),
  setArticleSort: (articleSort) => {
    localStorage.setItem('home-sort-article', JSON.stringify(articleSort));
    set({ articleSort });
  },
```

add:

```ts
  xSort: readSortState('home-sort-x', ['date', 'title']),
  setXSort: (xSort) => {
    localStorage.setItem('home-sort-x', JSON.stringify(xSort));
    set({ xSort });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/stores/ui-store.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/stores/ui-store.ts web/src/stores/ui-store.test.ts
git commit -m "feat: add xSort to ui-store"
```

---

## Task 7: `XCard` component

**Files:**
- Create: `web/src/components/x-card.tsx`
- Create: `web/src/components/x-card.test.tsx`

**Interfaces:**
- Consumes: `XTimelineSummary` from `web/src/lib/api.ts` (Task 4).
- Produces: `export function XCard({ timeline }: { timeline: XTimelineSummary }): JSX.Element`, linking to `/x/${timeline.handle}`. Consumed by Task 10.

This component's visual spec (avatar circle, handle, 2-line preview, meta row) is validated in `.hskill/sync-design/html/drafts/x-timeline-web-design.html`; its Tailwind implementation follows `web/src/components/article-card.tsx`'s conventions exactly (block link, `rounded-xl border p-4 hover:opacity-80 transition-opacity`, CSS vars via inline `style`) — that real component, not the illustrative CSS in the HTML draft, is the authoritative hover/spacing reference.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/x-card.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { XCard } from './x-card';
import type { XTimelineSummary } from '@/lib/api';

const base: XTimelineSummary = { handle: 'trq212', tweetCount: 20 };

function renderCard(timeline: XTimelineSummary) {
  return render(<MemoryRouter><XCard timeline={timeline} /></MemoryRouter>);
}

describe('XCard', () => {
  it('renders the handle and tweet count', () => {
    renderCard(base);
    expect(screen.getByText('@trq212')).toBeInTheDocument();
    expect(screen.getByText('20 条推文')).toBeInTheDocument();
  });

  it('renders the preview text when present', () => {
    renderCard({ ...base, latestPreview: 'everything truly is code' });
    expect(screen.getByText('everything truly is code')).toBeInTheDocument();
  });

  it('renders without a preview paragraph when latestPreview is absent', () => {
    const { container } = renderCard(base);
    expect(container.querySelector('p')).toBeNull();
  });

  it('links to the handle detail route', () => {
    renderCard(base);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/x/trq212');
  });

  it('shows the relative time derived from latestAt', () => {
    renderCard({ ...base, latestAt: new Date().toISOString() });
    expect(screen.getByText('刚刚')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/x-card.test.tsx`
Expected: FAIL — `Cannot find module './x-card'`

- [ ] **Step 3: Write minimal implementation**

Create `web/src/components/x-card.tsx`:

```tsx
import { Link } from 'react-router';
import type { XTimelineSummary } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';

function initials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 2).toUpperCase();
}

export function XCard({ timeline }: { timeline: XTimelineSummary }) {
  const { handle, tweetCount, latestAt, latestPreview } = timeline;
  return (
    <Link
      to={`/x/${handle}`}
      className="block rounded-xl border p-4 hover:opacity-80 transition-opacity"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
          style={{ background: 'var(--accent-3)', color: 'var(--accent-11)' }}
        >
          {initials(handle)}
        </span>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>@{handle}</span>
      </div>
      {latestPreview && (
        <p className="text-[13px] mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {latestPreview}
        </p>
      )}
      <div className="flex items-center justify-between text-xs"
           style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        <span>{tweetCount} 条推文</span>
        <span>{latestAt ? formatRelativeTime(Date.parse(latestAt)) : ''}</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/x-card.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/x-card.tsx web/src/components/x-card.test.tsx
git commit -m "feat: add XCard component"
```

---

## Task 8: `TweetCard` component

**Files:**
- Create: `web/src/components/tweet-card.tsx`
- Create: `web/src/components/tweet-card.test.tsx`

**Interfaces:**
- Consumes: `XTweet` from `web/src/lib/api.ts` (Task 4).
- Produces: `export function TweetCard({ tweet, ownerHandle }: { tweet: XTweet; ownerHandle: string }): JSX.Element`. Consumed by Task 9.

This is the highest-risk component in the plan — read the "数据语义" table and "推文卡片的归属语义" section of the spec before writing code. Structure (validated in `.hskill/sync-design/html/drafts/x-timeline-detail-web-design.html`): `post` is an unstyled baseline card; `reply` adds a context line *inside* the card, above the head row; `quote` nests a smaller sub-card *inside* the card; `repost` is the only type wrapped in an outer container, and its inner card shows `author_handle` (the **original** author, not `ownerHandle`).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/tweet-card.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TweetCard } from './tweet-card';
import type { XTweet } from '@/lib/api';

const base: XTweet = {
  tweet_id: '1', url: 'https://x.com/trq212/status/1', text: 'hello', timestamp: '2026-08-11T19:21:00.000Z',
  author_handle: '@trq212', type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
  quoted_timestamp: null, translated: null,
};

describe('TweetCard', () => {
  it('renders a plain card for type=post', () => {
    render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('@trq212')).toBeInTheDocument();
  });

  it('shows the reply target inside the card for type=reply', () => {
    const tweet: XTweet = { ...base, type: 'reply', reply_to_handle: '@openai', text: 'replying' };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText(/回复 @openai/)).toBeInTheDocument();
    expect(screen.getByText('replying')).toBeInTheDocument();
  });

  it('nests the quoted tweet inside the main card for type=quote', () => {
    const tweet: XTweet = {
      ...base, type: 'quote', text: 'everything truly is code',
      quoted_author: '@mannay', quoted_text: 'draw faces with js', quoted_timestamp: '2026-08-12T12:50:00.000Z',
    };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText('everything truly is code')).toBeInTheDocument();
    expect(screen.getByText('@mannay')).toBeInTheDocument();
    expect(screen.getByText('draw faces with js')).toBeInTheDocument();
  });

  it('attributes repost content to the original author, not the owner handle', () => {
    const tweet: XTweet = { ...base, type: 'repost', author_handle: '@lydiahallie', text: 'original content' };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText(/trq212 转推了/)).toBeInTheDocument();
    expect(screen.getByText('@lydiahallie')).toBeInTheDocument();
    expect(screen.getByText('original content')).toBeInTheDocument();
    expect(screen.queryByText('@trq212')).toBeNull();
  });

  it('renders translated text alongside the original when present', () => {
    const tweet: XTweet = { ...base, translated: '你好' };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText('你好')).toBeInTheDocument();
  });

  it('omits the translated block when translated is null', () => {
    render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(screen.queryByText('你好')).toBeNull();
  });

  it('falls back to post rendering for an unrecognized type', () => {
    const tweet = { ...base, type: 'boost' } as XTweet;
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders the source link', () => {
    render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(screen.getByRole('link', { name: /在 X 上查看/ })).toHaveAttribute('href', base.url);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/tweet-card.test.tsx`
Expected: FAIL — `Cannot find module './tweet-card'`

- [ ] **Step 3: Write minimal implementation**

Create `web/src/components/tweet-card.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { XTweet } from '@/lib/api';

function initials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 2).toUpperCase();
}

function formatTweetTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Avatar({ handle, small }: { handle: string; small?: boolean }) {
  const size = small ? 20 : 26;
  return (
    <span
      className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: size, height: size, background: 'var(--accent-3)', color: 'var(--accent-11)', fontSize: small ? 9.5 : 11 }}
    >
      {initials(handle)}
    </span>
  );
}

function TweetHead({ handle, time, small }: { handle: string; time: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Avatar handle={handle} small={small} />
      <span className={small ? 'text-[12.5px] font-semibold' : 'text-[13.5px] font-semibold'} style={{ color: 'var(--text-primary)' }}>{handle}</span>
      <span className="ml-auto text-[11.5px] flex-shrink-0" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{formatTweetTime(time)}</span>
    </div>
  );
}

function TweetBody({ text, translated }: { text: string; translated: string | null }) {
  return (
    <>
      <p className="text-sm" style={{ lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>{text}</p>
      {translated && (
        <p className="text-[13px] mt-2 pt-2" style={{ lineHeight: 1.7, color: 'var(--text-secondary)', borderTop: '1px dashed var(--border-subtle)' }}>
          {translated}
        </p>
      )}
    </>
  );
}

function TweetLink({ url }: { url: string }) {
  return (
    <div className="mt-2.5 flex justify-end">
      <a href={url} target="_blank" rel="noreferrer" className="text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
        在 X 上查看 ↗
      </a>
    </div>
  );
}

function BaseCard({ handle, time, text, translated, url, extraTop }: {
  handle: string; time: string; text: string; translated: string | null; url: string; extraTop?: ReactNode;
}) {
  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', padding: '16px 18px' }}>
      {extraTop}
      <TweetHead handle={handle} time={time} />
      <TweetBody text={text} translated={translated} />
      <TweetLink url={url} />
    </div>
  );
}

export function TweetCard({ tweet, ownerHandle }: { tweet: XTweet; ownerHandle: string }) {
  const type = tweet.type === 'reply' || tweet.type === 'quote' || tweet.type === 'repost' ? tweet.type : 'post';

  if (type === 'reply') {
    return (
      <BaseCard
        handle={tweet.author_handle}
        time={tweet.timestamp}
        text={tweet.text}
        translated={tweet.translated}
        url={tweet.url}
        extraTop={
          <div className="flex items-center gap-1.5 text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
            <span>↩</span>回复 {tweet.reply_to_handle}
          </div>
        }
      />
    );
  }

  if (type === 'quote') {
    return (
      <div className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', padding: '16px 18px' }}>
        <TweetHead handle={tweet.author_handle} time={tweet.timestamp} />
        <TweetBody text={tweet.text} translated={tweet.translated} />
        <div className="mt-2.5 rounded-r-lg" style={{ padding: '10px 12px', borderLeft: '2px solid var(--border-strong)', background: 'var(--bg-elevated)' }}>
          <TweetHead handle={tweet.quoted_author ?? ''} time={tweet.quoted_timestamp ?? ''} small />
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)', margin: 0 }}>{tweet.quoted_text}</p>
        </div>
        <TweetLink url={tweet.url} />
      </div>
    );
  }

  if (type === 'repost') {
    return (
      <div className="rounded-xl border" style={{ padding: 10, background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)', margin: '0 0 8px 4px' }}>
          <span>↻</span>{ownerHandle} 转推了
        </div>
        <BaseCard handle={tweet.author_handle} time={tweet.timestamp} text={tweet.text} translated={tweet.translated} url={tweet.url} />
      </div>
    );
  }

  return <BaseCard handle={tweet.author_handle} time={tweet.timestamp} text={tweet.text} translated={tweet.translated} url={tweet.url} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/tweet-card.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/tweet-card.tsx web/src/components/tweet-card.test.tsx
git commit -m "feat: add TweetCard component"
```

---

## Task 9: Detail route — `/x/:handle`

**Files:**
- Create: `web/src/routes/x.$handle.tsx`
- Modify: `web/src/main.tsx` (register the route)

**Interfaces:**
- Consumes: `useXTimeline` (Task 4), `TweetCard` (Task 8).
- Produces: `export default function XTimelineDetail()` rendering at `/x/:handle`. No dedicated test file — this codebase has no route-level tests (`web/src/routes/*.test.tsx` doesn't exist for any existing route); verified via `npm run build` + manual smoke check, consistent with `tasks.$id.tsx`'s own testing posture.

- [ ] **Step 1: Create the route component**

Create `web/src/routes/x.$handle.tsx`:

```tsx
import { useParams, useNavigate } from 'react-router';
import { useXTimeline } from '@/hooks/use-x-timelines';
import { TweetCard } from '@/components/tweet-card';

export default function XTimelineDetail() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/x');
  };
  const { data: timeline, isLoading } = useXTimeline(handle);

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!timeline) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到时间线</div>;

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 flex items-center gap-4 px-5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <button type="button" onClick={goBack} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</button>
        <h1 className="text-sm font-medium">@{timeline.handle}</h1>
      </header>
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-canvas)' }}>
        <div className="mx-auto py-7 pb-10" style={{ maxWidth: 640 }}>
          {timeline.tweets.length === 0 ? (
            <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>该 handle 暂无推文</div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {timeline.tweets.map((tweet) => (
                <TweetCard key={tweet.tweet_id} tweet={tweet} ownerHandle={timeline.handle} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `web/src/main.tsx`, change the imports:

```tsx
import RootLayout from './routes/_layout';
import Home from './routes/_index';
import TaskDetail from './routes/tasks.$id';
import GanttPage from './routes/tasks.$id.gantt';
```

to:

```tsx
import RootLayout from './routes/_layout';
import Home from './routes/_index';
import TaskDetail from './routes/tasks.$id';
import GanttPage from './routes/tasks.$id.gantt';
import XTimelineDetail from './routes/x.$handle';
```

And the router config:

```tsx
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Navigate to="/videos" replace /> },
      { path: '/videos', element: <Home /> },
      { path: '/articles', element: <Home /> },
      { path: '/tasks/:id', element: <TaskDetail /> },
      { path: '/tasks/:id/gantt', element: <GanttPage /> }
    ]
  }
]);
```

to:

```tsx
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Navigate to="/videos" replace /> },
      { path: '/videos', element: <Home /> },
      { path: '/articles', element: <Home /> },
      { path: '/x', element: <Home /> },
      { path: '/tasks/:id', element: <TaskDetail /> },
      { path: '/tasks/:id/gantt', element: <GanttPage /> },
      { path: '/x/:handle', element: <XTimelineDetail /> }
    ]
  }
]);
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npm run build`
Expected: succeeds (Task 10 hasn't wired `_index.tsx` to actually navigate to `/x` yet, but the route itself must type-check and build standalone).

- [ ] **Step 4: Commit**

```bash
git add web/src/routes/x.\$handle.tsx web/src/main.tsx
git commit -m "feat: add /x/:handle detail route"
```

---

## Task 10: Home page — X tab

**Files:**
- Modify: `web/src/routes/_index.tsx`

**Interfaces:**
- Consumes: `useXTimelines` (Task 4), `sortXTimelines` (Task 5), `useUiStore().xSort`/`setXSort` (Task 6), `XCard` (Task 7).
- Produces: a third tab ("X") on the home page at `/x`, completing the feature end-to-end.

This is the final integration task — after this, a user can click "X" in the nav, see the card grid (or the configuration hint if `x-dir` is unset), and click into a handle's tweet stream. No dedicated test file — `_index.tsx` has no existing test coverage in this codebase (same posture as Task 9); verified via `npm run build` plus a manual smoke check described in Step 5.

- [ ] **Step 1: Update imports and tab derivation**

In `web/src/routes/_index.tsx`, change the import block:

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';
import { ArticleCard } from '@/components/article-card';
import { SortSelect } from '@/components/sort-select';
import { api } from '@/lib/api';
import { sortTasks, sortArticles, type SortField } from '@/lib/sort';
import { useUiStore } from '@/stores/ui-store';
```

to:

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useTasks } from '@/hooks/use-tasks';
import { useXTimelines } from '@/hooks/use-x-timelines';
import { TaskCard } from '@/components/task-card';
import { ArticleCard } from '@/components/article-card';
import { XCard } from '@/components/x-card';
import { SortSelect } from '@/components/sort-select';
import { api } from '@/lib/api';
import { sortTasks, sortArticles, sortXTimelines, type SortField } from '@/lib/sort';
import { useUiStore } from '@/stores/ui-store';
```

Change the sort field constants:

```tsx
const VIDEO_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
];

const ARTICLE_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
];
```

to:

```tsx
const VIDEO_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
];

const ARTICLE_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
];

const X_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '最近更新' },
  { value: 'title', label: 'Handle' },
];
```

- [ ] **Step 2: Update tab derivation, data fetching, and filtering**

Change:

```tsx
export default function Home() {
  const tab = useLocation().pathname === '/articles' ? 'article' : 'video';
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: articles = [], isLoading: articlesLoading } = useArticles();
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredTasks = tasks.filter((t) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (t.title ?? '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
  });

  const filteredArticles = articles.filter((a) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return a.title.toLowerCase().includes(q) || a.slug.includes(q);
  });

  const videoSort = useUiStore((s) => s.videoSort);
  const setVideoSort = useUiStore((s) => s.setVideoSort);
  const articleSort = useUiStore((s) => s.articleSort);
  const setArticleSort = useUiStore((s) => s.setArticleSort);

  const sortedTasks = sortTasks(filteredTasks, videoSort);
  const sortedArticles = sortArticles(filteredArticles, articleSort);
```

to:

```tsx
export default function Home() {
  const pathname = useLocation().pathname;
  const tab = pathname === '/articles' ? 'article' : pathname === '/x' ? 'x' : 'video';
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: articles = [], isLoading: articlesLoading } = useArticles();
  const { data: xTimelines = [], isLoading: xLoading } = useXTimelines();
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredTasks = tasks.filter((t) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (t.title ?? '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
  });

  const filteredArticles = articles.filter((a) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return a.title.toLowerCase().includes(q) || a.slug.includes(q);
  });

  const filteredX = xTimelines.filter((x) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return x.handle.toLowerCase().includes(q) || (x.latestPreview ?? '').toLowerCase().includes(q);
  });

  const videoSort = useUiStore((s) => s.videoSort);
  const setVideoSort = useUiStore((s) => s.setVideoSort);
  const articleSort = useUiStore((s) => s.articleSort);
  const setArticleSort = useUiStore((s) => s.setArticleSort);
  const xSort = useUiStore((s) => s.xSort);
  const setXSort = useUiStore((s) => s.setXSort);

  const sortedTasks = sortTasks(filteredTasks, videoSort);
  const sortedArticles = sortArticles(filteredArticles, articleSort);
  const sortedX = sortXTimelines(filteredX, xSort);
```

- [ ] **Step 3: Update the nav, sort control, and loading flag**

Change the nav block:

```tsx
        <nav className="flex items-center gap-1">
          {(['video', 'article'] as const).map((t) => (
            <Link
              key={t}
              to={t === 'video' ? '/videos' : '/articles'}
              className="px-2.5 py-1 rounded-md text-sm transition-colors"
              style={{
                color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                background: tab === t ? 'var(--bg-elevated)' : 'transparent',
                fontWeight: tab === t ? 500 : 400,
              }}
            >
              {t === 'video' ? '视频' : '文章'}
            </Link>
          ))}
        </nav>
```

to:

```tsx
        <nav className="flex items-center gap-1">
          {(['video', 'article', 'x'] as const).map((t) => (
            <Link
              key={t}
              to={t === 'video' ? '/videos' : t === 'article' ? '/articles' : '/x'}
              className="px-2.5 py-1 rounded-md text-sm transition-colors"
              style={{
                color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                background: tab === t ? 'var(--bg-elevated)' : 'transparent',
                fontWeight: tab === t ? 500 : 400,
              }}
            >
              {t === 'video' ? '视频' : t === 'article' ? '文章' : 'X'}
            </Link>
          ))}
        </nav>
```

Change the `SortSelect` usage:

```tsx
        <SortSelect
          value={tab === 'video' ? videoSort : articleSort}
          onChange={tab === 'video' ? setVideoSort : setArticleSort}
          fields={tab === 'video' ? VIDEO_SORT_FIELDS : ARTICLE_SORT_FIELDS}
        />
```

to:

```tsx
        <SortSelect
          value={tab === 'video' ? videoSort : tab === 'article' ? articleSort : xSort}
          onChange={tab === 'video' ? setVideoSort : tab === 'article' ? setArticleSort : setXSort}
          fields={tab === 'video' ? VIDEO_SORT_FIELDS : tab === 'article' ? ARTICLE_SORT_FIELDS : X_SORT_FIELDS}
        />
```

Change the loading flag:

```tsx
  const isLoading = tab === 'video' ? tasksLoading : articlesLoading;
```

to:

```tsx
  const isLoading = tab === 'video' ? tasksLoading : tab === 'article' ? articlesLoading : xLoading;
```

- [ ] **Step 4: Add the X tab content branch**

Change the content block's closing `article` branch (currently the last branch in the ternary chain):

```tsx
      ) : (
        articles.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
            暂无文章<br />
            配置文章目录：<code style={{ color: 'var(--accent-11)', fontFamily: 'var(--font-mono)' }}>scholia config set content-dir ~/notes</code>
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>无匹配结果</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {sortedArticles.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
        )
      )}
```

to:

```tsx
      ) : tab === 'article' ? (
        articles.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
            暂无文章<br />
            配置文章目录：<code style={{ color: 'var(--accent-11)', fontFamily: 'var(--font-mono)' }}>scholia config set content-dir ~/notes</code>
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>无匹配结果</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {sortedArticles.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
        )
      ) : (
        xTimelines.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
            暂无 X 时间线<br />
            配置数据目录：<code style={{ color: 'var(--accent-11)', fontFamily: 'var(--font-mono)' }}>scholia config set x-dir ~/.hskill/sync-xtimeline/tweets</code>
          </div>
        ) : filteredX.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>无匹配结果</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {sortedX.map((x) => <XCard key={x.handle} timeline={x} />)}
          </div>
        )
      )}
```

- [ ] **Step 5: Verify the build and smoke-test manually**

Run: `cd web && npm run build`
Expected: succeeds.

Then, with a real or fixture `x-dir` configured (`scholia config set x-dir <path-with-some-handle.json-files>`), run `scholia serve --open` and manually verify:
- The "X" tab appears in the nav alongside "视频"/"文章" and is clickable at `/x`.
- With no `x-dir` configured, the tab shows the "暂无 X 时间线" hint with the `scholia config set x-dir ...` command.
- With `x-dir` configured, cards render with handle, preview, tweet count, and relative time; clicking one navigates to `/x/<handle>` and renders the tweet stream with correct type-specific structure (compare visually against `.hskill/sync-design/html/drafts/x-timeline-detail-web-design.html`).
- The back arrow on the detail page returns to `/x`.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd web && npm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/_index.tsx
git commit -m "feat: add X tab to home page"
```

---

## Final Verification

- [ ] Run `npm test` from the repo root — all backend suites pass.
- [ ] Run `cd web && npm run build` — TypeScript + Vite build succeeds with no errors.
- [ ] Run `cd web && npm test` — all Vitest suites pass.
- [ ] Manually verify the end-to-end flow described in Task 10, Step 5.
