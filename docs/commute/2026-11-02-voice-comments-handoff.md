---
status: 执行中
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
