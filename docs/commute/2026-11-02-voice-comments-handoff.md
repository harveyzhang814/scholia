---
status: 待验收
date: 2026-11-02
author_model: claude-opus-5-5
acceptance: hard
workspace_mode: shared-worktree
branch: feature/voice-comments
worktree: /Users/harveyzhang96/Projects/scholia/.claude/worktrees/feature+voice-comments
base_commit: 33c9dbc5a5d36d20bc0be70e161ce65ad9379714
source_node: 7102e7ee-fd13-46d3-abea-1539cb897b85
target_node: 17b5355d-5814-4421-97a4-98ceb6b643f8
---

# 交接：实施语音评论第一期

**交接目的**：接手方按已写好的实施计划，在本分支上完成语音评论第一期的 9 个任务，然后交回原 session 验收。原 session 负责设计，不参与实现。

> **接手方须知**：你正在接手一个任务。本文档是完整交接与唯一权威入口：从头读到尾，若文档里有「工作流约定」章节按其开工，没有就直接开工。
>
> **完成后不是直接推状态，先自测**（skill 的 Phase 2.5）：逐条实跑「最小验收锚点」**全集**（不是只跑你改动相关的那几条），外加文档点名要复跑的既有资产；判成败的命令不接管道（`| tail` 的退出码是 `tail` 的，恒为 0）。把结果写成**独立小节**，标题里必须有「自测」二字（如「接手方自测记录（日期）」），逐条列 pass/fail 并附实际命令——写你自己这一节，别混进原 session 的验收记录。**有红就别推状态**：要么修到绿，要么在那一条旁边写出归因证据并显式声明「带着这条红送验」，不许沉默推上来。`validate-handoff.sh` 会拦：`status` 是「待验收」而正文没有含「自测」的小节直接 exit 1。
>
> 自测过了，才把 frontmatter 的 `status` 置为「待验收」并**停在这里**——`已验收` / `打回` 由原 session 按「最小验收锚点」判定后写，不要代填。
>
> **被打回之后同理，而且默认跑全集**：打回轮范围小、容易觉得「就改一行」，恰恰是二次打回最常见的来源。复修完重新走一遍自测才能再置回「待验收」；要只跑子集，必须在记录里附改动范围证据（`git diff --name-only <打回点提交>..HEAD`）和「其余条目不可能被波及」的论证。复修记录另起一节（如「接手方复修自测记录（第 N 轮）」，同样含「自测」二字），不覆盖前几轮。
>
> **开工前**：若 frontmatter 有 `source_node`、且你也在 Agent Canvas 画布节点里，先建一条 `hands-off-to` 关系（`agent-canvas-ctl whoami` 取自己的 id，核对 `node-relations` 里没有后 `link-nodes --from <source_node> --to <自己> --type hands-off-to`），建完把自己的 id 填进 `target_node`。**只建这一条**——别建 `implements`、别另立需求节点。
>
> **在哪开工**：frontmatter 有 `worktree` 时，进那个工作区干活，核对当前分支与 `branch` 一致。**怎么进按你所在平台来**（Claude Code 用 `EnterWorktree(path: <worktree>)` 的 `path` 模式；Codex 从该路径启动/绑定 workspace，或用 `codex -C <worktree>`；没有这类能力就每条命令自带限定 `git -C <worktree>`，读写文件用绝对路径，别靠裸 `cd`——它只在单条命令内有效）。判据只有一条：后续命令的工作目录确实是那个工作区。**不要自己 `git worktree add` 或用 Codex `--worktree`**（那会另建工作区；原 session 验收时回的是 author 建的那一个，看不到替代工作区里的改动），**也绝不要销毁它**（`git worktree remove`，或平台的"退出并删除"）——验收还要用。路径不存在就打回原 session 重建，别自己挑地方。

---

## 背景与现状

- **功能**：文章页选中文字（或在光标处）按 `v` 开始录音，再按 `v` 停止，CocoScribe 转写并用 Ollama 整理后的文字自动存成锚定在那段文字上的评论。它是现有三个评论入口（选区气泡、`c` 键、右键菜单）之外的第四个入口，锚点、存储、原文标记、卡片展示都沿用现有机制。
- **CocoScribe** 是本机常驻的 macOS 语音转文字 App，Scholia 通过它的 Node SDK `@harveyzhang814/host-client`（GitHub Packages 私有包）经本机 Unix socket 驱动它。SDK 只能用在 Scholia 服务端。
- **已完成并合入 `staging`**：spec、定位 ADR、设计稿、实施计划。本工作区从合入后的 `staging`（`33c9dbc`）切出，还没有任何实现代码。
- **计划已经用户确认**（2026-11-02）。用户选择由另一个 session 执行，执行方式沿用前几期的 subagent-driven：使用 `superpowers:subagent-driven-development`，每个任务由一个新的实现者完成，再由一个新的审查者检查，全部做完后再对整条分支做一次审查。

## 关键决定（别改动）

计划的「Global Constraints」和「计划内新定的实现决定」两节全部是定稿。这里只列最容易被改动的几条。实现中发现走不通，停下来回报原 session，不要自行换方案。

- **阶段推送只用"停止 / 重试"请求的流式响应**（换行分隔 JSON，最后一行是评论或失败）。不要顺手建全局 SSE / WebSocket 通道，也不要改用轮询。
- **评论在服务端落盘**：SDK 发出 `completed` 时由服务端语音模块调用共用的评论落盘函数，不依赖浏览器还在等。浏览器只在拿到评论后写原文标记（复用现有逻辑）。
- **会话参数固定** `{ mode: 'comprehend', silent: true, awaitEdit: false }`；只存整理后的文字，不存原始转写、不存音频、评论数据不加字段，卡片不区分语音和手写。
- **前端不新建 store**；占位卡片以 `voice:` / `voice-rec:` 前缀的伪评论交给 Reader 定位，复用内嵌槽位和右栏定位。
- **阶段色沿用 CocoScribe 的颜色**（四个 token 值见计划），只用于圆点、边框、图标、转圈，不用于文字；失败用 `--status-err`；录音条不画波形。
- **单页内切走页面或切换文章时，正在录音的会话主动取消**；已停止的照常落盘。
- **测试和手动检查绝不能指向用户的真实内容目录或视频工作目录**：评论会写进内容目录旁的 `notes.json`，原文标记会改写 Markdown 原文。手动检查一律用临时目录里的副本，并用 `SCHOLIA_CONFIG_FILE` 环境变量把配置重定向到临时文件，不要运行 `scholia config set`。

## 范围铁律

- **做（In）**：计划 Task 1–9，以及计划里为每个任务列出的文件。
- **不做（Out）**：
  - 视频页的语音评论；保留音频；存原始转写；保存前的草稿确认（SDK 的 `awaitEdit`）。
  - 全局服务端推送通道；录音波形；逐字转写预览；进度百分比。
  - 第二期"持续监听"。
  - 设计稿里右栏卡片整体偏低的问题（设计稿布局脚本的既有问题，与本期无关）；控制台 `/api/events` 的 404 循环。
  - 修改设计稿和 `.hskill/sync-design/`。
  - 顺手重构计划之外的代码。
- **不合并、不推送**：只在 `feature/voice-comments` 上提交。

## 相关文档索引

- 实施计划（逐任务的接口、测试名、命令）：`docs/superpowers/plans/2026-11-02-voice-comments.md`
- 设计依据：`docs/superpowers/specs/2026-11-02-voice-comments-design.md`。计划与 spec 有出入时以计划为准，并在自测记录里点名出入处。
- 设计稿（视觉、文案、样式类名的依据，Task 7 要从里面搬样式）：`.hskill/sync-design/html/drafts/task-detail-article-web-design.html`，浏览器直接打开，页面顶部有"语音评论（本稿新增）"一排状态按钮。
- 定位与"为什么不另起项目"：`docs/adr/2026-11-02-scholia-positioning.md`
- SDK 接入指南：装好依赖后在 `node_modules/@harveyzhang814/host-client/README.md`（CocoScribe 仓库规定它是外部接入的唯一指南）。
- 上一次交接的做法（临时目录手动检查、提交钩子的坑）：`docs/commute/2026-10-22-inline-comments-p3-handoff.md`
- 分支规范：`docs/reference/git-workflow.md`；项目约定：`CLAUDE.md`

## 工作流约定

- **工作区里还没有 `node_modules`**：开工前在工作区根目录和 `web/` 下各执行一次 `npm install`。根目录安装私有 SDK 需要用户级 `~/.npmrc` 里已有的 `//npm.pkg.github.com/:_authToken=` 行，本机已配好；报 401/403/404 时停下来问用户，不要自己改 `~/.npmrc`。安装可能顺手改动 `package-lock.json` 里的项目版本号，与本期无关的改动不要提交。
- **提交信息首行不超过 80 个字符**（commit-msg 钩子会拦）。
- **`staging` 和 `master` 禁止直接提交**（pre-commit 钩子会拦）。
- **Task 1 Step 4 的全局安装核对**只装到 `mktemp -d` 建的临时前缀里，不要装到全局默认位置，不要运行 `npm run release:local`（那会覆盖用户正在用的全局 scholia）。
- **真机验收需要用户配合**：计划 Task 9 写进 `docs/acceptance-testing.md` 的语音评论步骤，要在真实 CocoScribe.app（≥ 7.1.0、已配置 Ollama 理解模型）运行时做，Ollama 的停启也要用户来。开始前先问用户 CocoScribe 是否在运行、版本多少；做不了的步骤向用户要结果，不要跳过。

## 最小验收锚点

以下全部为硬判据，在本工作区里逐条实跑，任何一条不满足就算未达成。

1. **后端测试全绿，计划用例都在**：`npm test` 退出码为 0；`node tests/voice.test.js` 的输出里，计划 Task 3 测试代码块列出的 13 个 `test('…')` 用例名都以 `✓` 出现；`node tests/voice-routes.test.js` 的输出里，计划 Task 4 列出的 11 个用例名都以 `✓` 出现；`package.json` 的 `scripts.test` 包含这两个文件。
2. **前端测试全绿，计划用例都在**：`cd web && npm test` 退出码为 0；计划 Task 5–9 测试代码块里列出的 31 个 `it('…')` 用例名都能在 `web/src/**/*.test.ts(x)` 里找到并通过；`web/src` 下没有 `.skip` / `.only` / `.todo` / `xit`；对 merge-base 的测试文件 diff 里没有被删除的 `it(` / `describe(` 行。
3. **前端构建通过**：`cd web && npm run build` 退出码为 0，包括 `tsc`。
4. **依赖只加了 SDK**：与 merge-base 相比，根目录 `package.json` 的 `dependencies` 只多了 `@harveyzhang814/host-client`（`^0.3.x`）；`web/package.json` 的 `dependencies` 没有变化；根目录新增的 `.npmrc` 只有一行 `@harveyzhang814:registry=https://npm.pkg.github.com`，不含 token。
5. **分发已核对**：二选一并在自测记录里附命令与输出。(a) `package.json` 有 `"bundleDependencies": ["@harveyzhang814/host-client"]`，`npm pack` 产物里列出 `package/node_modules/@harveyzhang814/host-client/package.json`，且装到临时前缀后能 `require` 到 SDK；或 (b) 打包方案失败（附失败输出），`bundleDependencies` 已去掉，README 写明用户需在 `~/.npmrc` 加 `@harveyzhang814:registry=https://npm.pkg.github.com`。
6. **阶段色 token 准确**：`web/src/styles/globals.css` 与 `DESIGN.md` 都出现 `#FF6B47`、`#20D5C4`、`#8B5CF6`、`#34D399`；`globals.css` 里有 `--coco-recording`、`--coco-transcribing`、`--coco-refining`、`--coco-done` 四个变量定义；`DESIGN.md` 写明了靛紫只作为"整理中"阶段色的例外。
7. **README 已写明 CocoScribe 要求**：`README.md` 出现 `7.1.0`、`转录完成后弹出编辑窗口`、`Copy transcript to clipboard` 三处文字。
8. **改动没有超出计划**：`git diff --name-only $(git merge-base staging HEAD)..HEAD` 列出的文件都在计划各任务的 Files 清单里；例外只有本交接文档、`package-lock.json`、`web/package-lock.json`。清单外的文件要在自测记录里逐个说明理由。
9. **真机验收已逐项记录**：`docs/acceptance-testing.md` 新增的语音评论各步骤，每步在自测记录里写 pass 或 fail 并附简短说明。其中"SDK 开始录音时先发出 `recording` 阶段"一步要附实际观察到的阶段事件顺序作为证据。某步本机无法完成的写明原因，不能空着。

### 原 session 写交接时的门禁核对（2026-11-02）

- 机器校验：见提交前的 `validate-handoff.sh` 结果。
- 冷读：分支、工作区、基线已建好并进过；计划 Task 3 的 13 个、Task 4 的 11 个后端用例名，Task 5–9 共 31 个前端用例名都可逐条核对；锚点 4–8 都是可直接判对错的命令或文本检查；锚点 9 依赖用户配合，已在工作流约定里写明先问用户。

## 接手方自测记录（2026-11-02）

执行方式：`superpowers:subagent-driven-development`，9 个任务逐个「实现者 + 任务审查」，全部完成后整分支审查一次（结论 With fixes，0 Critical），再做一轮统一修复并复审。审查过程的裁定与遗留项记录在工作区的 `.superpowers/sdd/2026-11-02-voice-comments/progress.md`（git 忽略，不进仓库）。分支 `feature/voice-comments`，基线 `33c9dbc`，真机验收与锚点 3–8 自测时 HEAD 为 `60d927e`；之后补了 start 超时（`accc033`、`8d7427b`）和 8.1 脚本修正，只涉及 `server/voice.js`、两个后端测试文件和 `docs/acceptance-testing.md`，后端测试已复跑，前端未受影响。工作区自测前后 `git status` 干净。

环境说明：`~/.npmrc` 里有 `allow-scripts = ["scholia"]`，npm 11.19 在项目级安装里会拒绝它，根目录 `npm install` 因 postinstall 里嵌套的 `npm install` 报 `EALLOWSCRIPTS`。本分支未改动这件事，依赖用 `npm install --ignore-scripts` 装，`web/` 单独 `npm install`。`npm run release:local` 在本机同样会失败（既有问题）。

### 锚点逐条

1. **后端测试** — pass。`npm test`（不接管道）退出码 0；`node tests/voice.test.js` 输出 `19 passed, 0 failed`（含 start 超时补的 4 个）、`node tests/voice-routes.test.js` 输出 `13 passed, 0 failed`。计划 Task 3 的 13 个、Task 4 的 11 个用例名用脚本从计划里抽出，在这两个文件的输出里逐个核对，全部以 `✓` 出现；`package.json` 的 `scripts.test` 含这两个文件，且在 `server.test.js` 前。多出的 8 个用例：`saveNote rejection surfaces as save_failed outcome`、`session.stop rejection is left to the terminal event`、start 超时的 4 个（`start times out when the SDK never reports recording`、`late recording after a start timeout cancels the session again`、`late completed after a start timeout is not saved`、`start timer is cleared once recording arrives`）（voice.test.js）、`voice routes require the bearer token`、DELETE 的 204/404（voice-routes.test.js）。后端自测在 start 超时补丁之后复跑过一次：`npm test` 退出码 0，计划用例名仍全部以 `✓` 出现。
2. **前端测试** — pass。`cd web && npm test` 退出码 0，`35 passed (35)` 个文件、`355 passed (355)` 个用例。计划 Task 5–9 列出的 31 个 `it('…')` 用例名都能在 `web/src/**/*.test.ts(x)` 里找到；`web/src` 下没有 `.skip` / `.only` / `.todo` / `xit`。对 merge-base 的测试文件 diff 里被删除的行只有 `web/src/routes/tasks.$id.test.tsx` 的三条 import 行（改写为带上新增的具名导入 `useState`、`useNavigate` 等），没有被删除的 `it(` / `describe(` 行。该文件对 `use-voice-comments` 的 mock 工厂还补了两个导出常量（`VOICE_PREFIX`、`VOICE_REC_PREFIX`），断言没有改动。
3. **前端构建** — pass。`cd web && npm run build` 退出码 0，`tsc` 与 `vite build` 均通过。
4. **依赖只加了 SDK** — pass。`git diff 33c9dbc..HEAD -- package.json web/package.json .npmrc`：根目录 `dependencies` 只多 `@harveyzhang814/host-client: ^0.3.0`；`web/package.json` 无变化；新增 `.npmrc` 一行 `@harveyzhang814:registry=https://npm.pkg.github.com`，不含 token。
5. **分发已核对** — pass，选 (a)。`package.json` 有 `"bundleDependencies": ["@harveyzhang814/host-client"]`。自测时我重新跑了一遍：`npm pack --pack-destination <临时目录>` → `tar -tzf scholia-0.6.0.tgz | grep host-client/package.json` 输出 `package/node_modules/@harveyzhang814/host-client/package.json`（tarball 里共 14 个 `node_modules` 条目；`npm pack` 的统计行写 `bundled files: 0` 是 npm 的统计口径，不代表没打进去）；`npm install -g --ignore-scripts --prefix <临时目录>/prefix scholia-0.6.0.tgz` 输出 `added 83 packages`；在该前缀下 `require` 到 `scholia/node_modules/@harveyzhang814/host-client` 得到 `CocoScribeClient,Session,CocoScribeConnectionError,SessionError`。安装用了 `--ignore-scripts`，原因同上方环境说明（scholia 自己的 postinstall 在本机会撞 `EALLOWSCRIPTS`），所以 postinstall 的 web 构建这一段没有端到端跑。Task 1 实现者的原始证据在 `task-1-report.md`。临时目录未能删除（`rm -rf` 被拒），在系统临时目录下，不影响仓库。
6. **阶段色 token** — pass。`#FF6B47`、`#20D5C4`、`#8B5CF6`、`#34D399` 在 `web/src/styles/globals.css` 与 `DESIGN.md` 里都出现；`globals.css` 第 27–30 行有 `--coco-recording`、`--coco-transcribing`、`--coco-refining`、`--coco-done` 四个定义；`DESIGN.md` 第 39 行和 AI Slop Check 一节（第 92 行）都写明靛紫只作为「整理中」阶段色的例外。
7. **README 要求** — pass。`7.1.0`、`转录完成后弹出编辑窗口`、`Copy transcript to clipboard` 各出现一次。
8. **改动没有超出计划** — pass，有一处需说明。`git diff --name-only 33c9dbc..HEAD` 共 31 个文件，除本交接文档与 `package-lock.json` 外都在计划各任务的 Files 清单内；`web/package-lock.json` 未改动。清单外的文件只有一个：`web/src/lib/api-voice.test.ts`。理由：Task 5 实现者补的 api 层映射测试（5 个用例，覆盖 `stopVoice`/`retryVoice`/`startVoice` 的结果映射、`connection_lost`、未知阶段被忽略等），计划给的测试块只覆盖 `readNdjson`；整分支审查认为应保留。`package-lock.json` 里根项目 `version` 由 0.3.0 变成 0.6.0 是 npm 在安装时把过期 lock 对齐到 `package.json` 里本来就是 0.6.0 的版本号，非本期改动。
9. **真机验收** — 见下表。CocoScribe 7.2.0（≥ 7.1.0）、Ollama 已配好；自测开始时 CocoScribe.app 实际没有在运行（只剩一个孤儿 helper 进程、`cli.sock` 是旧的），我用 `open -a CocoScribe` 启动后再测。测试全部用 `/tmp` 下的文章副本和 `SCHOLIA_CONFIG_FILE` 重定向到临时配置，端口 7777；没有触碰真实内容目录，没有运行 `scholia config set`。浏览器用无头 Chromium（gstack browse）驱动，选区用脚本设置，语音用 macOS `say` 朗读给麦克风。

### 锚点 9：docs/acceptance-testing.md 模块八逐步结果

| # | 结果 | 说明 |
|---|------|------|
| 8.1 | pass | 阶段顺序原样：`664 phase recording` → `6686 phase transcribing` → `6769 phase refining` → `10919 phase completed`，最后文字 `"我觉得这一段需要再补充一个例子。"`。`recording` 先于 `transcribing`，之前没有出现 `starting`。会话参数与 Scholia 一致。 |
| 8.2 | pass（指示灯未观察） | 按 `v` 后录音条出现：`录音中 0:00 · 评论「里面有一句话可以被选中」`、`结束并保存 v`、`取消 Esc`，计时在走；工具条麦克风置灰。macOS 麦克风指示灯我从命令行看不到，未确认。 |
| 8.3 | pass | 再按 `v` 后录音条消失；占位卡片依次读到 `transcribing`（`转写中… → 整理`）、`refining`（`转写 → 整理中…`，右侧时长），随后变成普通评论卡片，没有残留占位卡。绿色闪烁和配色的视觉效果未人工目测。 |
| 8.4 | pass | `notes.json` 新增一条，`body` 为整理后的文字、`anchor` 为所选原文、带 `markerId`；`diff -u` 只多出包住所选文字的一对 `<!-- sc:5a3e161f -->` / `<!-- /sc:5a3e161f -->`。 |
| 8.5 | pass | 在第二段中间放下光标（折叠选区）按 `v`：录音条显示 `评论「插入点」`，正文出现 `span.vdl-note-point[data-note-id^="voice-rec:"]`；说话后结束，卡片经阶段变成普通评论。 |
| 8.6 | pass | 新评论 `anchor` 为空、带 `prefix`/`suffix`/`position`/`markerId`；`diff -u` 只在光标处多出一个 `<!-- sc:bfee75f5 -->`。 |
| 8.7 | 未能触发整理失败 | 我经你同意停 Ollama：`osascript` 退出被拒（`User canceled (-128)`，授权后重试仍是），改由你从菜单栏退出，`curl localhost:11434` 退出码 7 确认已停。做选区语音评论后，「整理中…」持续约 5.5 秒，随后评论成功保存（`body` 为整理后的文字）。事后 `ps` 显示 Ollama 在 09:31:51 重新启动、紧接着加载了模型：CocoScribe 发现 Ollama 不在会自动把它拉起来，所以整理成功而不是失败。属于被测环境的行为，不是 Scholia 缺陷；因此本机造不出「整理失败 + 可重试」。 |
| 8.8 | 未执行 | 依赖 8.7 先出现失败态。Ollama 已被 CocoScribe 拉起，当前是运行状态，和测试前一致，无需我再启动。 |
| 补充 | pass | 为验证失败卡片的渲染，改录一段没有声音的评论：卡片显示 `没有录到声音` / `检查麦克风后重新录一段`，只有 `丢弃` 没有 `重试`（`no_audio` 不可重试，与 `voiceFailureCopy` 一致）；点 `丢弃` 后卡片消失，`notes.json` 条数不变。`canRetry` 为真时的「重试」按钮只由前端单元测试覆盖，没有真机验证。 |
| 8.9 | pass | `osascript` 退出 CocoScribe（`pgrep -x CocoScribe` 退出码 1 确认），不刷新页面选中文字按 `v`：页面出现轻提示 `CocoScribe 未运行，语音评论暂不可用`，没有录音条；几秒后提示消失。 |
| 8.10 | pass | 刷新后选中文字：工具条麦克风按钮一开始就 `disabled`，提示 `CocoScribe 未运行`；右键菜单里 `语音评论` 置灰并带 `CocoScribe 未运行`；按 `v` 出现同 8.9 的轻提示。 |
| 8.11 | pass | CocoScribe 仍未运行时，用工具条评论按钮和右键「在此处评论」各写一条评论并保存，刷新后两条都在（`notes.json` 里也都有）。 |
| 8.12 | pass | 浏览器里 `voice-hint-dismissed` 为空时开始录音，录音条下方出现一次性提示；点 `知道了` 后提示消失、录音条仍在、`localStorage['voice-hint-dismissed']` 为 `'1'`。 |
| 8.13 | pass | `Esc` 取消后录音条消失，没有占位卡片，没有 `voice-rec:` 锚点，原文改动行数不变；再开一段、以及刷新页面后再开一段，都没有再出现提示。 |
| 8.14 | pass（见 8.15） | 第一次我在按 `v` 后到跳走页面之间隔了几秒，那次评论和标记都已写完，没有真正测到「处理中关页面」，所以重做：把「按 `v` 结束」和「整页导航离开」放在同一个 `chain` 调用里（间隔不到一秒）。 |
| 8.15 | pass | 等 25 秒后 `notes.json` 里有这条，`body` 是整理后的文字、**没有 `markerId`**，原文没有新标记（`<!-- sc:` 总数仍是 3）；重新打开页面，评论卡片在，正文里锚点按文字定位在所选的「第二段正文」上。与清单对这一步的描述一致。 |

### 偏差、裁定与遗留（原样交代，供验收时判断）

- **带着 8.7/8.8 未完成送验。**这两步没有跑通（见上），原因是被测环境（CocoScribe 会自动拉起 Ollama），不是 Scholia 的失败；其余锚点 1–8 和锚点 9 的其他步骤均已实跑通过。「整理失败后点重试」这条路径只有单元测试覆盖，没有真机证据；`canRetry` 为真的失败态在真机上也没有看到过。
- **8.1 脚本的兜底写法已修（验收后补的一轮）**：清单里 8.1 脚本的 15 秒兜底原来写成 `s.cancel().finally(() => process.exit(2))`。SDK 把 `recording` 事件由服务端的 `started` 合成，所以「15 秒内没有 `recording`」时 `cancel()` 会一直排队等 `started`，`.finally` 永远不触发，脚本仍会挂住。现已改成 `s.cancel().catch(() => {}); process.exit(2);`（`docs/acceptance-testing.md`）。我自己跑 8.1 时用的就是这个写法；这个改动没有经过独立审查，只有一行文档。
- **start 超时已补（验收后补的一轮）**：整分支审查指出，若 SDK 收下会话却一直不发 `recording`，界面会停在「正在录音」且没有录音条可取消，直到刷新。现在 `server/voice.js` 的 `start()` 有上限（`createVoice` 的 `startTimeoutMs`，默认 20000 ms）：超时后不等待地取消会话、清掉登记项并返回 `{ error: 'timeout' }`，路由按现有规则返回 `502 { error: 'timeout' }`，前端提示「无法开始录音」并释放忙碌状态；超时后才到的 `recording` 会再取消一次，才到的 `completed` 不保存。提交 `accc033`，并经审查与复审（`8d7427b`）：测试文件加了「没跑完就退出视为失败」的保护（`tests/voice.test.js`、`tests/voice-routes.test.js`），并用临时副本做变异验证——去掉超时机制后测试以退出码 1 结束；`voice.test.js` 现在 19 个 `✓`。没有路由层的超时测试（`createApp` 不能传 `startTimeoutMs`）。**20 秒可能误伤首次使用时的 macOS 麦克风授权弹窗**（用户授权慢了会被取消），本机授权早已给过，没法验证，验收时可在没授权过的环境里手动试一次。
- **其他遗留（不阻塞，已记在 ledger）**：录音中关闭标签页没有主动取消（靠 CocoScribe 的 10 分钟超时，设计里已排除在本期之外，可用 `pagehide` + `keepalive` 的 DELETE 作为后续项）；`stop` 流没有服务端上限；`authHeaders` 与 `request()` 重复了一小段 token 逻辑；`parseVoiceAnchor` 不校验 `anchor` 的类型（与 notes POST 一致）；`voice-bar.tsx` 为复用 `isTypingTarget` 引入了 `reader.tsx`（无循环依赖，耦合偏弱）。
- **提交署名**：`4837390`（Task 6）、`92317c3`、`bfd4b8d`（Task 9）三个提交的 trailer 写的是实际执行模型 `Claude Opus 5.5`，其余是调度方要求的 `Claude Sonnet 5.5`。需要统一的话可由你决定是否 amend。
- **用到的更强模型**：Task 6、8、9 的实现者，以及 Task 3、4、6、8、9 的审查者用了 opus；整分支审查用了更强的 fable。Task 8、9 各经历一轮修复（长按 `v` 的 `e.repeat`、右栏占位卡片高度未上报）。
- **整分支审查指出、已处理的项**：`DESIGN.md` 第 39 行的靛紫例外、验收清单 8.14 的期望结果、`VoiceBar` 的 `Esc` 不应在输入框里取消录音、`unavailable`/`save_failed` 的失败文案、`voice:`/`voice-rec:` 前缀常量、后端路由测试的临时目录清理（提交 `60d927e`）。
