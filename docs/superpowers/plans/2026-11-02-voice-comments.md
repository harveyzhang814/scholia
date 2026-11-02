# 语音评论（第一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文章页选中文字（或光标处）按 `v` 录音，再按 `v` 停止，CocoScribe 转写整理后的文字自动存成锚定在那里的评论。

**Architecture:** Scholia 服务端新增语音模块，持有 CocoScribe SDK 客户端、登记进行中的会话，会话成功时复用现有评论落盘逻辑写入 `notes.json`；"停止 / 重试"两个请求用换行分隔 JSON 的流式响应把阶段推给浏览器。前端用一个页面级 hook 管理录音和占位卡片状态，占位卡片作为"伪评论"交给 Reader 定位，从而复用内嵌槽位与右栏定位。

**Tech Stack:** Node（Koa，CommonJS）+ `@harveyzhang814/host-client` SDK；React 19 + TypeScript + vitest。

**Spec:** `docs/superpowers/specs/2026-11-02-voice-comments-design.md`（决策、失败表、边界的唯一依据）。设计稿：`.hskill/sync-design/html/drafts/task-detail-article-web-design.html`（视觉与文案的依据，样式类名直接沿用）。SDK 接入指南：`node_modules/@harveyzhang814/host-client/README.md`（装好依赖后就在本地）。

## Global Constraints

- 只在文章任务（ID 以 `article-` 开头）上提供语音评论；服务端非文章 ID 一律 400，前端视频页不渲染任何语音入口、`v` 不响应。
- SDK 会话参数固定：`{ mode: 'comprehend', silent: true, awaitEdit: false }`；重试 `retryTask(taskId, { awaitEdit: false })`。
- 只存整理后的文字（SDK `completed` 的 `text`，trim 后）；不存 `rawTranscript`、不存音频、评论数据不新增任何字段。整理后为空按失败处理，错误码 `empty`。
- 新建评论必须走与 `POST /api/tasks/:taskId/notes` 同一套校验、同一把 `withMarkerLock`、同样的字段。
- SDK 只在服务端使用；浏览器不直连 CocoScribe。
- 阶段色 token（明暗同值，只用于圆点 / 边框 / 图标 / 转圈，不用于文字）：`--coco-recording: #FF6B47`、`--coco-transcribing: #20D5C4`、`--coco-refining: #8B5CF6`、`--coco-done: #34D399`；失败用现有 `--status-err`。
- 录音条不画波形；不显示逐字转写或百分比进度。
- 首次提示的 localStorage 键：`voice-hint-dismissed`（值 `'1'`）。
- 运行时要求 CocoScribe.app ≥ 7.1.0。
- 所有测试与手动检查不得指向用户真实的内容目录；手动检查用临时目录副本，并用 `SCHOLIA_CONFIG_FILE` 重定向配置，不运行 `scholia config set`。
- 不改设计稿与 `.hskill/sync-design/`。

## 计划内新定的实现决定

spec 没写到、写计划时定下的，执行中不要改：

- **前端不新建 zustand store**：状态集中在 `useVoiceComments` hook（详情页调用一次），通过 props 传给 Reader / InlineCards / NotesPanel / VoiceBar。
- **占位卡片走 Reader 的定位流程**：详情页把"进行中的录音"和"占位卡片"以伪评论形式（`{ id, ...anchor }`）并入传给 Reader 的 `notes`，ID 前缀分别为 `voice-rec:<会话ID>` 与 `voice:<会话ID>`。Reader 不需要知道语音的存在；内嵌槽位和右栏 `noteMarkY` 都按 ID 找到位置。
- **单页应用内切走即取消**：详情页卸载或切换任务时，正在录音的会话主动取消（spec 的"关页面靠超时兜底"只针对真正关掉浏览器页面）；已停止、正在处理的照常在服务端落盘，前端丢弃对应占位卡片。
- **成功时的绿色闪烁**落在新评论卡片上：`NoteCard` 新增 `flash` 属性，hook 在成功后 1.4 秒内返回该评论 ID。

## Review Focus

1. **焦点在输入框里按 `v`**（编辑评论、草稿卡片、右栏输入框）→ 不开始录音，照常输入字母 v。（Task 8 测试）
2. **开始请求还没返回时连按 `v`** → 只发出一次开始请求，不会出现两个会话。（Task 6 测试）
3. **流式响应的一行被拆在两个分块里、或中文字符的 UTF-8 字节被拆开** → 解析出的阶段和评论完整无乱码。（Task 5 测试）
4. **停止之后浏览器断开（关页面 / 刷新）** → 评论仍然写进 `notes.json`。（Task 4 测试）
5. **语音评论落盘与一条手动评论同时发生** → 两条都在，互不覆盖。（Task 4 测试）

---

### Task 1: SDK 依赖与分发

**Files:**
- Modify: `package.json`（`dependencies`、新增 `bundleDependencies`、`scripts.test`）
- Create: `.npmrc`（仓库根目录，提交进 git）
- Modify: `README.md`（安装一节）

**Interfaces:**
- Produces: `require('@harveyzhang814/host-client')` 在开发安装与 `release:local` 全局安装后都能解析。

- [ ] **Step 1: 根目录新建 `.npmrc`，内容只有一行**

```
@harveyzhang814:registry=https://npm.pkg.github.com
```

token 来自用户级 `~/.npmrc`（本机已有 `//npm.pkg.github.com/:_authToken=` 行），不进仓库。

- [ ] **Step 2: 安装依赖**

Run: `npm install @harveyzhang814/host-client@^0.3.0`
Expected: `package.json` 的 `dependencies` 出现该包，`node -e "require('@harveyzhang814/host-client')"` 无报错。

- [ ] **Step 3: 在 `package.json` 加 `"bundleDependencies": ["@harveyzhang814/host-client"]`，打包核对**

Run: `npm pack && tar -tzf scholia-0.6.0.tgz | grep host-client/package.json`
Expected: 输出 `package/node_modules/@harveyzhang814/host-client/package.json`。

- [ ] **Step 4: 隔离前缀全局安装核对**

Run: `npm install -g --prefix "$(mktemp -d)" ./scholia-0.6.0.tgz` 后，在该前缀的 `lib/node_modules/scholia` 目录里 `node -e "require('@harveyzhang814/host-client')"`；结束后 `rm scholia-*.tgz`。
Expected: 安装成功、require 无报错。
**若失败**：按 spec「安装与分发」的退路，去掉 `bundleDependencies`，改为在 README 要求用户在 `~/.npmrc` 加 `@harveyzhang814:registry=https://npm.pkg.github.com`，并把两种尝试的命令与输出记进交接文档的自测记录。

- [ ] **Step 5: README 安装一节补三条**：语音评论需要 CocoScribe.app ≥ 7.1.0 且在运行；建议关闭 CocoScribe 设置里的「转录完成后弹出编辑窗口」和「Copy transcript to clipboard」（理由一句：否则每条语音评论都会弹窗、覆盖剪贴板）；语音评论也会出现在 CocoScribe 的任务历史里。

- [ ] **Step 6: Commit**

```bash
git add .npmrc package.json package-lock.json README.md
git commit -m "chore: add CocoScribe host-client SDK as bundled dependency"
```

---

### Task 2: 抽出评论校验与落盘

**Files:**
- Modify: `server/index.js:372-400`（`POST /tasks/:taskId/notes`）

**Interfaces:**
- Produces（均在 `createApp` 闭包内）：
  - `validateAnchorFields({ prefix, suffix, position, doc }) -> string | null` —— 返回现有的错误文案（`'prefix/suffix must be a string of at most 32 chars'` 等），合法返回 `null`。
  - `insertNote(taskId, { anchor, prefix, suffix, position, doc, mediaTimestamp, body }) -> Promise<Note | null>` —— 在 `withMarkerLock` 内读改写 `notes.json`，找不到任务返回 `null`；`body` 由调用方保证非空且已 trim。

- [ ] **Step 1: 跑现有测试作基线**

Run: `node tests/server.test.js`
Expected: `0 failed`

- [ ] **Step 2: 把路由里的校验与落盘分别移进上面两个函数，路由改为调用它们**，返回体与状态码不变。

- [ ] **Step 3: 复跑**

Run: `npm test`
Expected: 全部通过，无一条测试被修改。

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "refactor(server): extract note anchor validation and insertion"
```

---

### Task 3: 服务端语音模块

**Files:**
- Create: `server/voice.js`
- Test: `tests/voice.test.js`（沿用 `tests/server.test.js` 的 `test()` 计数写法，文件末尾 `failed > 0` 时 `process.exit(1)`）
- Modify: `package.json` 的 `scripts.test`，在 `server.test.js` 前加 `node tests/voice.test.js &&`

**Interfaces:**
- Consumes: 一个 SDK 形状的客户端（`startSession(opts) -> Session`、`retryTask(taskId, opts) -> Session`、`status() -> Promise`）；`Session` 是 EventEmitter，事件 `phase`/`completed`/`failed`/`error`，方法 `stop()`/`cancel()`。
- Produces:
  - `createVoice({ getClient, saveNote })`，`getClient: () => client | null`，`saveNote: (taskId, fields) => Promise<Note | null>`。返回：
    - `status() -> Promise<boolean>`：无客户端或 `status()` 拒绝 → `false`。
    - `start(taskId, anchor) -> Promise<{ id: string } | { error: string }>`：收到 `phase === 'recording'` 时以 `{ id }` 兑现（`id` 用 `crypto.randomUUID()`）；`failed` → `{ error: err.code }`；`error` 事件 → `{ error: err.code === 'app_not_running' ? 'app_not_running' : 'transport' }`；无客户端 → `{ error: 'unavailable' }`。
    - `stop(id, onPhase) -> Promise<Outcome> | null`：未登记的 ID 返回 `null`。
    - `cancel(id) -> Promise<boolean>`。
    - `retry(taskId, anchor, cocoTaskId, onPhase) -> Promise<Outcome>`。
    - `size() -> number`：当前登记数，测试用。
  - `Outcome = { ok: true, note } | { ok: false, code, message, taskId, canRetry }`；`taskId` 无则 `null`，`canRetry` 为布尔。
  - `onPhase(phase)` 只会收到 `'transcribing'` 或 `'refining'`。

设计要点（测试未必能约束的部分）：每个会话在开始时就挂好全部监听器，登记项里放一个"终止结果"Promise；`completed` 时在模块内调用 `saveNote(taskId, { ...anchor, body: text.trim() })`，所以停止后即使无人等待结果也会落盘；任何终止事件（`completed`/`failed`/`error`）都从登记表删除该项。`stop()` 先登记 `onPhase` 再调用 `session.stop()`；`session.stop()` 拒绝时不单独处理，以终止事件为准。

- [ ] **Step 1: 写失败测试**（测试内自建 `FakeClient` / `FakeSession extends EventEmitter`，记录 `startSession` 收到的参数）

```js
await test('start passes fixed session options and resolves on recording', async () => {
  const p = voice.start('article-a', { anchor: 'x' });
  fake.last.emit('phase', 'starting'); fake.last.emit('phase', 'recording');
  const r = await p;
  assert.ok(r.id);
  assert.deepEqual(fake.lastOpts, { mode: 'comprehend', silent: true, awaitEdit: false });
  assert.equal(voice.size(), 1);
});
await test('start maps transport error to app_not_running', ...);   // emit('error', Object.assign(new Error('x'), { code: 'app_not_running' })) → { error: 'app_not_running' }
await test('start maps failed busy to busy', ...);                   // emit('failed', { code: 'busy', message: 'm', canRetry: false }) → { error: 'busy' }
await test('start without client is unavailable', ...);              // getClient: () => null → { error: 'unavailable' }
await test('stop forwards phases then saves trimmed text', async () => {
  // start → recording；stop(id, ph => phases.push(ph))；emit phase transcribing、refining、completed { text: '  你好  ' }
  // 断言 phases 为 ['transcribing','refining']；saveNote 收到 ('article-a', { anchor: 'x', body: '你好' })；Outcome.ok === true；size() === 0
});
await test('completed with blank text fails as empty', ...);         // Outcome { ok: false, code: 'empty', canRetry: false }，saveNote 未被调用
await test('failed passes code, taskId and canRetry through', ...); // { code: 'transcription_failed', message: 'm', taskId: 't1', canRetry: true }
await test('unknown id stop returns null', ...);
await test('terminal event without stop still cleans up', ...);      // start → recording → emit failed timeout → size() === 0
await test('completed without anyone awaiting still saves', ...);    // stop 后不 await，emit completed → saveNote 被调用
await test('cancel calls session.cancel', ...);
await test('retry uses retryTask and saves on completed', ...);      // fake.lastRetry 参数为 ('t1', { awaitEdit: false })
await test('status false when client status rejects', ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/voice.test.js`
Expected: FAIL（`Cannot find module '../server/voice'`）

- [ ] **Step 3: 实现 `server/voice.js`**

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/voice.test.js`
Expected: `0 failed`

- [ ] **Step 5: Commit**

```bash
git add server/voice.js tests/voice.test.js package.json
git commit -m "feat(server): add voice session module over CocoScribe SDK"
```

---

### Task 4: 语音接口与流式响应

**Files:**
- Modify: `server/index.js`（接入 `createVoice`、新增路由；CLAUDE.md 约定所有 API 路由都在此文件）
- Test: `tests/voice-routes.test.js`；`package.json` 的 `scripts.test` 在 `voice.test.js` 后追加 `node tests/voice-routes.test.js &&`

**Interfaces:**
- Consumes: Task 2 的 `validateAnchorFields`、`insertNote`；Task 3 的 `createVoice`。
- Produces:
  - `createApp` 新选项 `voiceClient`：`undefined` → 首次使用时懒加载 `new (require('@harveyzhang814/host-client').CocoScribeClient)()`，require 失败视为无客户端；`null` → 禁用。
  - `GET /api/voice/status` → `200 { available: boolean }`
  - `POST /api/voice/sessions`，体 `{ taskId, anchor, prefix?, suffix?, position? }` → `201 { id }`；`503 { error: 'app_not_running' | 'unavailable' }`；`409 { error: 'busy' }`；其他会话错误 `502 { error: code }`；非文章 ID 或锚点字段不合法 `400`；文章不存在 `404`。
  - `POST /api/voice/sessions/:id/stop` → 未登记 `404 { error: 'not found' }`；否则 `200`，`Content-Type: application/x-ndjson`，逐行：`{"type":"phase","phase":"transcribing"|"refining"}`，最后一行 `{"type":"note","note":{…}}` 或 `{"type":"failed","code":…,"message":…,"taskId":…,"canRetry":…}`，然后结束响应。
  - `DELETE /api/voice/sessions/:id` → `204`；未登记 `404`。
  - `POST /api/voice/retry`，体 `{ taskId, anchor, prefix?, suffix?, position?, cocoTaskId }` → 校验同开始接口（`cocoTaskId` 必须是非空字符串），之后与停止接口相同的流式响应。

流式写法：`ctx.type = 'application/x-ndjson'; ctx.body = new PassThrough();`，不 await 会话，阶段到达时 `write(JSON.stringify(x) + '\n')`，终止时 `end(...)`。浏览器断开不影响服务端会话继续直到落盘。

- [ ] **Step 1: 写失败测试**（`createApp({ contentDir, token, voiceClient: fake })`，夹具复用 `server.test.js` 的写法建一个 `intro.md` 文章；流式响应用 `fetch` + `res.body` 逐块读取）

```js
await test('status reports availability from client', ...);                 // fake.status 兑现 → { available: true }
await test('start rejects video ids with 400', ...);
await test('start rejects bad prefix like notes POST does', ...);           // prefix 长 33 → 400
await test('start maps app_not_running to 503 and busy to 409', ...);
await test('stop streams phases then the saved note', async () => {
  // start → 201；发起 stop 请求；fake 依次 emit transcribing、refining、completed { text: '说的话' }
  // 断言收到三行：phase transcribing、phase refining、note（note.body === '说的话'、note.anchor 与开始时一致）
  // GET /api/tasks/article-intro/notes 含该 note
});
await test('stop streams failed with retry info', ...);                     // 最后一行 { type: 'failed', code: 'transcription_failed', taskId: 't1', canRetry: true }
await test('stop on unknown id is 404 json', ...);
await test('note is saved even if the client disconnects after stop', async () => {
  // stop 请求用 AbortController，收到第一行 phase 后 abort；随后 emit completed；轮询 notes 直到出现该 note（≤1s）
});
await test('voice save and manual note POST at once both persist', async () => {
  // emit completed 与 POST /api/tasks/article-intro/notes 并发 → notes 同时含两条
});
await test('retry streams like stop and saves', ...);
await test('voiceClient null makes status false and start 503 unavailable', ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/voice-routes.test.js`
Expected: FAIL（`/api/voice/status` 返回 404）

- [ ] **Step 3: 实现路由与 `voiceClient` 懒加载**

- [ ] **Step 4: 跑全部后端测试**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add server/index.js tests/voice-routes.test.js package.json
git commit -m "feat(server): voice comment routes with streamed phases"
```

---

### Task 5: 前端 API 与流式解析

**Files:**
- Create: `web/src/lib/ndjson.ts`
- Modify: `web/src/lib/api.ts`
- Test: `web/src/lib/ndjson.test.ts`

**Interfaces:**
- Produces:
  - `readNdjson(body: ReadableStream<Uint8Array>, onLine: (value: unknown) => void): Promise<void>` —— 用 `TextDecoder` 的 `stream: true` 解码、按 `\n` 切行，空行跳过，流结束时处理残余的最后一行。
  - `api.ts` 新类型与函数：

```ts
export type VoicePhase = 'transcribing' | 'refining';
export type VoiceOutcome =
  | { ok: true; note: Note }
  | { ok: false; code: string; message: string; taskId: string | null; canRetry: boolean };
voiceStatus(): Promise<boolean>
startVoice(taskId: string, anchor: NoteAnchor): Promise<{ ok: true; id: string } | { ok: false; code: string }>
stopVoice(id: string, onPhase: (p: VoicePhase) => void): Promise<VoiceOutcome>
cancelVoice(id: string): Promise<void>
retryVoice(taskId: string, anchor: NoteAnchor, cocoTaskId: string, onPhase: (p: VoicePhase) => void): Promise<VoiceOutcome>
```

  `startVoice` 非 2xx 时读响应体的 `error` 作为 `code`（取不到用 `'error'`）；`stopVoice`/`retryVoice` 遇到网络错误、非 200、或流结束前没有终止行，返回 `{ ok: false, code: 'connection_lost', message: '', taskId: null, canRetry: false }`。所有请求带 Bearer token，沿用 `request()` 的写法。

- [ ] **Step 1: 写失败测试**

```ts
it('joins a line split across chunks', async () => { /* 两块：'{"type":"pha' 与 'se","phase":"refining"}\n' → onLine 收到一次 { type:'phase', phase:'refining' } */ });
it('decodes a CJK character split across chunk bytes', async () => { /* 把 '{"type":"note","note":{"body":"你好"}}\n' 的 UTF-8 字节在"你"中间切开 → body === '你好' */ });
it('handles a final line without trailing newline', async () => {});
it('skips blank lines', async () => {});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/ndjson.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `readNdjson` 与 api 函数**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/lib/ndjson.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/ndjson.ts web/src/lib/ndjson.test.ts web/src/lib/api.ts
git commit -m "feat(web): voice api client with ndjson stream parsing"
```

---

### Task 6: `useVoiceComments` hook

**Files:**
- Create: `web/src/hooks/use-voice-comments.ts`
- Modify: `web/src/hooks/use-tasks.ts`（抽出 `afterNoteCreated`）
- Test: `web/src/hooks/use-voice-comments.test.tsx`

**Interfaces:**
- Consumes: Task 5 的 api 函数。
- Produces:
  - `use-tasks.ts`：`afterNoteCreated(qc: QueryClient, taskId: string, note: Note): void`，内容即现有 `useAddNote` 的 `onSuccess` 主体（失效评论查询 + 写原文标记），`useAddNote` 改为调用它。现有 `use-tasks.test.tsx` 必须原样通过。
  - `use-voice-comments.ts`：

```ts
export interface VoicePending {
  id: string;                 // 'voice:<会话ID>'
  anchor: NoteAnchor;
  durationSec: number;        // 停止时 round((now - startedAt)/1000)
  phase: VoicePhase | 'failed';
  failure?: { code: string; canRetry: boolean; taskId: string | null };
}
export function useVoiceComments(taskId: string, enabled: boolean): {
  available: boolean | null;  // null = 尚未检查
  busy: boolean;              // 开始请求在途或正在录音
  recording: { id: string; anchor: NoteAnchor; startedAt: number } | null;
  pending: VoicePending[];
  toast: string | null;       // 2.6 秒后自动清空
  showHint: boolean;          // recording 存在且 localStorage['voice-hint-dismissed'] !== '1'
  justSavedId: string | null; // 成功后 1.4 秒内为新评论 ID
  start(anchor: NoteAnchor): void;
  stop(): void;
  cancel(): void;
  retry(id: string): void;
  discard(id: string): void;
  dismissHint(): void;
  notifyUnavailable(): void;  // 设 toast 为不可用文案
}
```

  行为：`enabled` 为真时挂载即调 `voiceStatus()`；`start` 在 `busy` 或 `available === false` 时直接返回；开始失败按码设 toast（`app_not_running` / `unavailable` → `available=false` 且 `'CocoScribe 未运行，语音评论暂不可用'`；`busy` → `'CocoScribe 正在录音'`；其他 → `'无法开始录音'`）；`stop` 把录音转成 `phase: 'transcribing'` 的占位项，按阶段回调更新，成功则移除占位、调用 `afterNoteCreated`、设 `justSavedId`，失败则置 `phase: 'failed'` 并记录 `failure`；`retry` 只对 `failure.canRetry && failure.taskId` 的项生效，回到 `transcribing`；卸载或 `taskId` 变化时取消正在录音的会话并清空状态。

- [ ] **Step 1: 写失败测试**（`vi.mock('@/lib/api')`，用 `renderHook` + `QueryClientProvider`）

```ts
it('double start while the start request is in flight sends one request', ...);  // Review Focus 2
it('start failure app_not_running marks unavailable and sets toast', ...);
it('stop turns recording into a transcribing pending and follows phases', ...);
it('success removes the pending, calls afterNoteCreated and sets justSavedId', ...);
it('failure keeps the pending as failed with code and retry info', ...);
it('retry is ignored when the failure cannot be retried', ...);
it('unmount while recording cancels the session', ...);
it('showHint is false after dismissHint and stays false on next recording', ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/hooks/use-voice-comments.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 hook 与 `afterNoteCreated` 抽取**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/hooks/`
Expected: PASS（含原有 `use-tasks.test.tsx`）

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/use-voice-comments.ts web/src/hooks/use-voice-comments.test.tsx web/src/hooks/use-tasks.ts
git commit -m "feat(web): useVoiceComments hook for recording and pending cards"
```

---

### Task 7: 样式 token、占位卡片、录音条

**Files:**
- Modify: `web/src/styles/globals.css`（`:root` 加四个阶段色 token；追加语音相关样式）
- Modify: `DESIGN.md`（Color Palette 一节）
- Create: `web/src/components/voice-pending-card.tsx`
- Create: `web/src/components/voice-bar.tsx`
- Modify: `web/src/components/note-card.tsx`（新增 `flash?: boolean`）
- Test: `web/src/components/voice-pending-card.test.tsx`、`web/src/components/voice-bar.test.tsx`

**Interfaces:**
- Consumes: Task 6 的 `VoicePending`。
- Produces:
  - `VoicePendingCard({ item, variant, onRetry, onDiscard }: { item: VoicePending; variant: CardVariant; onRetry: () => void; onDiscard: () => void })`，根元素 `.sc-note-card[data-variant][data-voice-state=<phase>]`。
  - `voiceFailureCopy(code: string, canRetry: boolean): { reason: string; hint: string }`。
  - `VoiceBar({ startedAt, anchor, showHint, onStop, onCancel, onDismissHint })`：挂载期间监听 document `keydown`，`Escape` → `onCancel`。
  - `VoiceToast({ text }: { text: string })`。
  - `NoteCard` 的 `flash` 为真时根元素带 `data-voice-flash`。

样式：从设计稿 `<style>` 中把以下注释块原样搬进 `globals.css`（类名不改）：「语音评论：录音条」「语音评论：正文锚点」「语音评论占位卡片」「语音评论：CocoScribe 未运行时按 v 出现的轻提示」，以及 `.voice-tip`、`.bubble-btn:disabled` 对应的规则。另加录音中锚点的选择器：`mark.vdl-note-anchor[data-note-id^="voice-rec:"]` 与 `span.vdl-note-point[data-note-id^="voice-rec:"]` 套用设计稿 `.voice-locked` 的样式（点评论图标用 `color: var(--coco-recording)`）。

文案（照抄设计稿）：
- 阶段行：转写中为 `<b>转写中…</b> → 整理`，整理中为 `转写 → <b>整理中…</b>`，右侧时长 `m:ss`（等宽字体）。
- `voiceFailureCopy`：`no_audio` → `没有录到声音` / `检查麦克风后重新录一段`；`empty` → `没有识别出文字` / `重新录一段试试`；`connection_lost`、`transport`、`app_not_running` → `CocoScribe 连接中断` / `''`；其余码 → `转写或整理失败`，`canRetry` 为真时 hint 为 `录音还在 CocoScribe 里，重试不用重录`，否则 `''`。
- 失败卡片按钮：`重试`（仅 `canRetry && taskId` 时渲染）、`丢弃`。右栏变体首行 `.sc-quote` 显示锚点原文，点评论显示 `插入点`。
- 录音条：`录音中`、计时 `m:ss`、`评论「<锚点前 40 字>」`（点评论为 `评论「插入点」`）、按钮 `结束并保存` + `<kbd>v</kbd>`、`取消` + `<kbd>Esc</kbd>`。
- 首次提示：`第一次用语音评论：请在 CocoScribe 设置里关掉 「转录完成后弹出编辑窗口」 和 「Copy transcript to clipboard」，否则每条语音评论结束后 CocoScribe 都会弹出自己的窗口、并覆盖你的剪贴板。Scholia 读不到 CocoScribe 的设置，这条提示只出现一次。`，按钮 `知道了`。

`DESIGN.md`：Color Palette 下新增「语音评论阶段色」小表（四个色值与用途、来源 CocoScribe 悬浮窗、只用于非文字元素）；AI Slop Check 一节里"No purple/violet anywhere"后补一句例外：靛紫 `#8B5CF6` 只作为语音评论"整理中"阶段色出现在占位卡片的边框、图标与转圈上。

- [ ] **Step 1: 写失败测试**

```ts
it('transcribing card shows 转写中 bolded and duration', ...);       // durationSec 74 → '1:14'
it('refining card shows 整理中 bolded', ...);
it('failed retryable card shows reason, hint, 重试 and 丢弃', ...);  // code 'transcription_failed', canRetry true, taskId 't1'
it('failed no_audio card has only 丢弃', ...);
it('sidebar variant shows the anchor quote, 插入点 for point anchors', ...);
it('VoiceBar ticks the timer and Escape calls onCancel', ...);       // vi.useFakeTimers
it('VoiceBar shows the hint only when showHint and 知道了 calls onDismissHint', ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/components/voice-pending-card.test.tsx src/components/voice-bar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现组件、样式、DESIGN.md、`NoteCard.flash`**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/components/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/styles/globals.css DESIGN.md web/src/components/voice-pending-card.tsx web/src/components/voice-pending-card.test.tsx web/src/components/voice-bar.tsx web/src/components/voice-bar.test.tsx web/src/components/note-card.tsx
git commit -m "feat(web): voice pending card, recording bar and phase color tokens"
```

---

### Task 8: Reader 的语音入口

**Files:**
- Modify: `web/src/components/reader.tsx`
- Test: `web/src/components/reader.test.tsx`

**Interfaces:**
- Produces: `ReaderProps` 新增

```ts
voice?: {
  state: 'ready' | 'recording' | 'unavailable';
  onStart: (a: NoteAnchor) => void;
  onStop: () => void;
  onUnavailable: () => void;
};
```

  - `v` 键（无修饰键）：目标是 `INPUT`/`TEXTAREA`/可编辑元素时忽略；`state === 'recording'` → `onStop()`（不看选区与焦点位置）；`'unavailable'` → `onUnavailable()`；`'ready'` → 与 `c` 键完全相同的锚点判定后 `onStart(anchor)`，在槽位内（卡片里）按下时忽略。
  - 选区气泡在评论按钮后加麦克风按钮（`title="语音评论（v）"`，图标用设计稿 `sd-icon-2` 的路径），点击 → `onStart(captureAnchor(...))` 并关闭气泡；`state !== 'ready'` 时 `disabled`，悬停显示 `.voice-tip`：不可用为 `CocoScribe 未运行`，录音中为 `正在录音`。
  - 右键菜单在"在此处评论"后加"语音评论"（右侧 `.ctx-key` 显示 `v`），点击 → `onStart(ctxMenu.draft)`；`state !== 'ready'` 时 `disabled`，用 `.ctx-hint` 显示同样原因。
  - `voice` 未传时，以上全部不渲染、`v` 不响应。

- [ ] **Step 1: 写失败测试**

```ts
it('v with caret calls onStart with a point anchor', ...);
it('v with a selection calls onStart with a range anchor', ...);
it('v inside a textarea does nothing', ...);                         // Review Focus 1
it('v while recording calls onStop', ...);
it('v while unavailable calls onUnavailable', ...);
it('without voice prop v does nothing and no mic button renders', ...);
it('bubble mic button is disabled with 正在录音 when recording', ...);
it('context menu 语音评论 starts with the menu anchor', ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: 新增用例 FAIL，原有用例 PASS

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/reader.tsx web/src/components/reader.test.tsx
git commit -m "feat(web): voice comment entry points in reader"
```

---

### Task 9: 详情页接线与验收清单

**Files:**
- Modify: `web/src/routes/tasks.$id.tsx`
- Modify: `web/src/components/inline-notes.tsx`
- Modify: `web/src/components/notes-panel.tsx`
- Modify: `docs/acceptance-testing.md`
- Test: `web/src/routes/tasks.$id.test.tsx`、`web/src/components/inline-notes.test.tsx`、`web/src/components/notes-panel.test.tsx`

**Interfaces:**
- Consumes: Task 6 hook、Task 7 组件、Task 8 `voice` 属性。
- Produces:
  - `InlineCards` 新增 `voicePending?: VoicePending[]`、`onVoiceRetry?: (id) => void`、`onVoiceDiscard?: (id) => void`、`flashNoteId?: string | null`；`ids` 中 `voice-rec:` 前缀渲染为空，`voice:` 前缀渲染 `VoicePendingCard variant="inline"`。
  - `NotesPanel` 新增同名四个属性；占位卡片与已定位评论一起参与 `computePositions`（高度取 `heights[id] ?? ESTIMATED_HEIGHT`），渲染 `VoicePendingCard variant="sidebar"`；头部计数只数真实评论。

详情页：
- `const voice = useVoiceComments(id, isArticleTask)`。
- 传给 Reader 的 `notes` 改为真实评论 + `pending.map(p => ({ id: p.id, ...p.anchor }))` + 录音中项 `{ id: 'voice-rec:' + recording.id, ...recording.anchor }`（`useMemo`）；`InlineCards`、`UnlocatedZone`、"全部收起"仍只用真实评论。
- Reader 的 `voice` 属性仅文章任务传入：`state` 为 `available === false ? 'unavailable' : busy ? 'recording' : 'ready'`，`onStart`/`onStop`/`onUnavailable` 分别接 `voice.start`/`voice.stop`/`voice.notifyUnavailable`。
- `InlineCards` 与 `NotesPanel` 传入 `voicePending={voice.pending}`、`onVoiceRetry={voice.retry}`、`onVoiceDiscard={voice.discard}`、`flashNoteId={voice.justSavedId}`。
- `VoiceBar` 放在正文滚动容器（`<div className="flex-1 overflow-y-auto">`）的第一个子元素，`recording` 存在时渲染；`onStop`/`onCancel`/`onDismissHint` 接 `voice.stop`/`voice.cancel`/`voice.dismissHint`，`showHint` 接 `voice.showHint`。
- `VoiceToast` 在 `toast` 非空时渲染。

验收清单：在 `docs/acceptance-testing.md` 追加"语音评论"一节，逐条写真机步骤：选区语音评论一次、点评论一次（各自确认卡片阶段依次出现、最终评论正文与原文标记）；停掉 Ollama 触发整理失败后点重试成功；退出 CocoScribe 后入口置灰、按 `v` 出轻提示、手动评论照常；首次提示只出现一次；停止后立即关页面再打开，评论仍在；SDK 开始录音时确实先发出 `recording` 阶段（spec「未确认项」第一条）。

- [ ] **Step 1: 写失败测试**

```ts
// tasks.$id.test.tsx（mock api 与 hook 依赖的 voice 函数）
it('article page shows the voice bar while recording and hides it after stop', ...);
it('video page passes no voice prop and renders no mic button', ...);
// inline-notes.test.tsx
it('renders a VoicePendingCard for voice: ids and nothing for voice-rec: ids', ...);
// notes-panel.test.tsx
it('places a pending voice card and excludes it from the note count', ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/routes src/components/inline-notes.test.tsx src/components/notes-panel.test.tsx`
Expected: 新增用例 FAIL

- [ ] **Step 3: 实现接线，写验收清单**

- [ ] **Step 4: 全量验证**

Run: `npm test && cd web && npm test && npm run build`
Expected: 后端、前端测试全部通过；`tsc --noEmit` 与 `vite build` 成功。

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/tasks.\$id.tsx web/src/routes/tasks.\$id.test.tsx web/src/components/inline-notes.tsx web/src/components/inline-notes.test.tsx web/src/components/notes-panel.tsx web/src/components/notes-panel.test.tsx docs/acceptance-testing.md
git commit -m "feat(web): wire voice comments into the article detail page"
```
