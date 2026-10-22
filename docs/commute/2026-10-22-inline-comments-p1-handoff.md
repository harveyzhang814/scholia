---
status: 已验收
date: 2026-10-22
author_model: claude-opus-5-5
acceptance: hard
workspace_mode: shared-worktree
branch: feature/inline-comments-p1
worktree: /Users/harveyzhang96/Projects/scholia/.claude/worktrees/feature+inline-comments-p1
base_commit: 817494d911a9e6534b64bb164f5bc2d5e4dbf649
source_node: b6d0caf8-242a-4d0a-b925-8d01a895ae5f
target_node: 817aa4af-5c84-4459-9c71-b5e6d451bf20
---

# 交接：实施正文内嵌评论第 1 期（统一锚点 + 点评论）

**交接目的**：接手方按已批准的实施计划，在本分支上完成第 1 期的 8 个任务，然后交回原 session 验收。原 session 负责设计，不参与实现。

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

- **现在的评论**：评论（代码里叫 note）只能先选中文字再写，写完排在右栏里。锚点只存选中文字的前 200 字，显示时按"第一次出现"在正文里定位。
- **目标**：用户要的是评论以卡片形式嵌进正文、可以不选文字直接插入评论、原文被编辑后评论仍能找回。设计已经分成三期，本次只做**第 1 期**：建立统一的锚点模型和定位函数，加上点评论的三个创建入口。本期不做内嵌卡片，也不往原文里写标记。
- **已批准的文档**：spec 和实施计划都经过用户逐节确认，已合并进 `staging`（`817494d`）。本工作区就是从这个提交切出来的，分支上目前还没有任何实现。
- **执行方式**：用户选择用 subagent-driven 方式执行，即使用 `superpowers:subagent-driven-development`：每个任务由一个新的实现者完成，再由一个新的审查者检查，全部做完后再对整条分支做一次审查。

## 关键决定（别改动）

以下每一条都是用户亲自拍板的，接手方不要改。实现中发现走不通，就停下来回报原 session，不要自行换方案。

- **前后文不跨段落**：前后文碰到段落级元素的边界就停止截取。前文和后文**各自独立匹配**，不拼接成一个整串去查（spec 第 1.1、1.2 节）。
- **文字都找不到时按位置放**：位置还在全文范围内就放过去，档位标为"近似"，界面上显示"原文已变化"。超出全文长度时返回"未定位"。
- **点评论的入口**：右键菜单里的"在此处评论"，以及快捷键 `c`。按住 Shift 右键时，弹出浏览器原生菜单。
- **右栏保留**，第 2 期才加"内嵌 / 右栏"切换开关。卡片的折叠状态不保存。
- **不做数据迁移**：`notes.json` 只新增可选字段，旧评论保持原样即可工作。
- **段落间统一插一个换行**：文字索引在段落级元素之间统一插入一个 `'\n'`。原文和前后文都从索引里截取，**不用** `selection.toString()`。
- **两处会改变现有行为，属于有意为之**：
  - Mode A 左栏的评论从"叠在位置 0"改为正常列表排列，PR 描述里要写明。
  - 以前跨段落写的旧评论会重新标得出来。

## 范围铁律

- **做（In）**：实施计划里的 Task 1–8，以及计划里为每个任务列出的文件。
- **不做（Out）**：
  - 第 2 期的内嵌卡片、视图切换、未定位区。
  - 第 3 期的原文标记写入、`sc` 标记渲染插件、修改 `CLAUDE.md` 里"文章文件不修改"的约定。
  - 改动高亮的匹配逻辑（必须保持"第一处出现"）。
  - 卡片里的 AI、回复、标签、Markdown 渲染。
  - 顺手重构计划之外的代码。
- **不合并、不推送**：只在 `feature/inline-comments-p1` 上提交。合并进 `staging` 由原 session 在验收通过后处理。

## 相关文档索引

- 实施计划（逐任务的接口、测试、命令）：`docs/superpowers/plans/2026-10-22-inline-comments-p1.md`
- 设计依据：`docs/superpowers/specs/2026-10-22-inline-comments-design.md`，本期涉及第 1.1、1.2、2、3.1、3.2 节。计划与 spec 有出入时，以**计划**为准，因为计划是在 spec 定稿之后细化的。
- 分支规范：`docs/reference/git-workflow.md`
- 项目约定：`CLAUDE.md`

## 工作流约定

- **提交信息首行不超过 80 个字符**：仓库的 commit-msg 钩子会拦超长的首行。计划里给的提交信息都满足这个要求，自己另写的要注意。
- **`staging` 和 `master` 禁止直接提交**（pre-commit 钩子会拦）。本工作区所在的 feature 分支不受限制。
- **Task 1 需要用户配合**：Safari 的验证可能没法自动化。做不了时向用户要实测结果，不要跳过。Chrome 可以用 gstack 的 `browse` skill 或 `run` skill 来验证。
- **跑 `web` 的测试或开发服务器前**：工作区如果没有 `node_modules`，先在工作区根目录和 `web/` 下各执行一次 `npm install`。
- **Task 7 的测试**：计划允许把路由级测试改成测试一个从页面里抽出来的小 hook。如果选了这条路，要在自测记录里说明。

## 最小验收锚点

以下全部为硬判据，在本工作区里逐条实跑，任何一条不满足就算未达成。

1. **后端测试全绿**：`npm test` 退出码为 0，并且 `node tests/server.test.js` 的输出里有计划 Task 2 的三个用例，都是 `✓`：
   - `notes: POST stores anchor context fields`
   - `notes: POST without new fields stores none of them`
   - `notes: POST rejects invalid anchor fields`
2. **前端测试全绿，且计划里的用例都在**：`cd web && npm test` 退出码为 0。计划 Task 3–7 的测试代码块里列出的每个 `it(...)` 用例名，都能在对应的测试文件里找到，并且通过。计划允许替换的两处，按替换后的用例名核对，并在自测记录里注明：
   - Task 1 的结论如果要求替换 `c with caret creates point draft`
   - Task 7 如果改测 hook
   已有的高亮、评论标记和 mermaid 用例不能删改，必须继续通过。
3. **前端构建通过**：`cd web && npm run build` 退出码为 0，包括 `tsc` 类型检查。
4. **旧接口已清除**：`grep -rn "onAnchorSelect\|resolveAnchorY" web/src` 没有任何输出。
5. **新依赖已加入**：`web/package.json` 的 `dependencies` 里有 `approx-string-match`，版本是 `^2.0.1`。
6. **改动没有超出计划**：`git diff --name-only $(git merge-base staging HEAD)..HEAD` 列出的文件，都在计划各任务的 Files 清单里。允许的例外只有三类：`web/package-lock.json`、本交接文档、计划允许新建的 `web/src/routes/tasks.$id.test.tsx`（或抽出 hook 后对应的源文件和测试文件）。
7. **未确认项已记录**：spec 的"未确认项汇总"表里，"单击后是否留下可读取的光标"这一行写上了 Chrome 和 Safari 的实测结论；"定位的性能"这一行写上了实测耗时（计划 Task 8 Step 3）。
8. **手动检查已逐项记录**：计划 Task 8 Step 2 的 5 项检查，每一项的结果都写在自测记录里（pass 或 fail，附简短说明）。如果某项无法在本机环境完成（比如手头没有视频任务），写明原因，不能空着。

## 接手方自测记录（2026-10-22）

在最终提交 `b83d02a` 上逐条实跑最小验收锚点全集。判成败的命令都没有接管道（输出重定向到文件后取退出码）。

| # | 锚点 | 结果 | 命令与证据 |
|---|---|---|---|
| 1 | 后端测试全绿 + 3 个用例 | pass | `npm test` 退出码 0，7 个测试文件全部 `0 failed`（server 套件 51 passed）。`notes: POST stores anchor context fields`、`notes: POST without new fields stores none of them`、`notes: POST rejects invalid anchor fields` 三条均为 `✓` |
| 2 | 前端测试全绿 + 计划用例都在 | pass | `cd web && npm test` 退出码 0，21 个文件 188 个用例通过。用脚本从计划 Task 3–7 的代码块里取出 39 个 `it(...)` 用例名，逐个在 `web/src/**/*.test.ts(x)` 中查找：缺失 0 个。替换项：Task 1 的结论没有要求替换 `c with caret creates point draft`（Chrome 可用，Safari 见下方红项）；Task 7 的 `switching tab clears draft` 做成了路由级测试 `web/src/routes/tasks.$id.test.tsx`，没有抽 hook。已有的高亮、评论标记、mermaid 用例没有删改 |
| 3 | 前端构建通过 | pass | `cd web && npm run build` 退出码 0（含 `tsc`），`built in 3.32s` |
| 4 | 旧接口已清除 | pass | `grep -rn "onAnchorSelect\|resolveAnchorY" web/src` 无输出（grep 退出码 1） |
| 5 | 新依赖已加入 | pass | `web/package.json:17` `"approx-string-match": "^2.0.1"`，在 `dependencies` 里；`web/package-lock.json` 的改动只有新增依赖的 7 行 |
| 6 | 改动没有超出计划 | pass | `git diff --name-only 817494d..HEAD` 的 19 个文件：全部在计划各任务的 Files 清单内，或属于允许的例外（`web/package-lock.json`、本交接文档、`web/src/routes/tasks.$id.test.tsx`）。另外改了 spec 文档（Task 1 / Task 8 要求写回实测结论）。`web/src/lib/text-index.ts` 属于 Task 3 的文件，Task 6 的修复轮里改过它，见下方裁决 |
| 7 | 未确认项已记录 | **红：带着这条红送验** | spec "未确认项汇总" 表里，性能行已写入实测耗时（24.0 / 25.05 / 25.3 ms，160 KB 文章、30 条评论）。光标行已写入 Chrome 实测结论（`["Caret", true, "#text", 59]`，可用），**Safari 的实测结论还没有**：Safari 无法在本机自动化，已向用户要结果，截至交接时还没收到。表里目前写的是"Safari 待用户实测"。收到结果后补进该行即可；若 Safari 不可用，按计划把 `c with caret creates point draft` 换成 `c with collapsed selection does nothing`（`c` 键在选区不在正文内时本来就不响应，不会出错） |
| 8 | 手动检查已逐项记录 | pass（有说明） | 见下 |

### Task 8 Step 2 的 5 项手动检查

第一轮在 `ab6bff8` 上跑，随后发现并修复了一个图标换行的 bug；最后一轮改动之后，在 `b83d02a` 上又复跑了一遍（报告：`.superpowers/sdd/2026-10-22-inline-comments-p1/task-8-report.md`、`task-8-recheck-report.md`，git 忽略，不在仓库里）。全部用 gstack browse 在无头 Chromium 里跑，用的是临时目录里的文章和视频任务副本，没有碰真实数据。选区和右键手势是合成事件，点击和 `c` 键是真实输入。

1. 选区评论（气泡）：**pass**。创建、保存后标记和卡片都在，卡片按所在段落排布。
2. 点评论：**pass**。右键"在此处评论"和单击后按 `c` 各创建一条，正文里出现 `span.vdl-note-point`，卡片在右栏。复跑里图标是行内的（段落不被拆开，图标宽 12px）。链接末尾的图标，点击不跳转且仍会聚焦卡片。
3. Shift+右键：**pass（只能验证到"不拦截"）**。带 `shiftKey` 的 `contextmenu` 事件 `defaultPrevented === false` 且没有自定义菜单；无头环境看不到浏览器原生菜单本身。
4. 改原文后刷新：**pass**。改评论所在句子，该卡片显示"原文已变化"；只改相邻段落，评论保持精确定位、没有提示。
5. 视频页：**pass**。总结和文章两个 tab 的评论只在各自 tab 里出现标记；没有 `doc` 的旧评论在含有其文字的 tab 里出现；带未保存草稿切换 tab 后草稿清空。复跑里还验证了 Mode A（给临时视频任务放了一个占位的假媒体文件才出现布局切换）：气泡里没有评论按钮、右键保留原生菜单、`c` 键不响应、左栏的评论列表正常排开不叠在一起，切回有右栏的布局后三个入口恢复。

**没有验证的**：Safari 单击后的光标（上面的红项）；macOS 上右键是否真的得到点评论而不是单词范围评论（浏览器先选词的行为只能真机验，代码按"右键按下时先快照选区"处理）；Mac 上 Ctrl+点击；真实的鼠标拖选和原生右键菜单。建议接手验收的人（或用户）在 macOS 的 Chrome/Safari 里手点一次右键。

### 手动检查中发现、不是本分支引入、没有修的问题

- 右栏卡片整体比对应段落低约 190px（有草稿标签时约 226px）。右栏定位的几何代码与基线 `817494d` 逐行相同，是已有行为。
- 文章视图里，右栏卡片区的高度会不断增长（约每帧 +190px）：`articleRef` 指向被撑开的 `.article-col`，`ResizeObserver` 加 `setArticleHeight(scrollHeight)` 形成反馈。基线上有同样的 `articleHeight` 逻辑，几何未改，推测是已有问题，没有在基线上实测对比。
- 从任务 A 切到任务 B 时，没保存的草稿会保留（路由元素没有 `key`）。

### 过程中的裁决（每条都记录在控制者的台账里）

- Task 3：把"块与块之间的空白跳过"规则收窄到只在相邻是块级元素或没有相邻元素时才跳过，行内元素之间的空格保留（否则 `- **a** *b*` 会被索引成 "ab"）。选区终点落在元素上会多带一个分隔符，不改，由 Task 4 的 `captureAnchor` 修剪。
- Task 4：近似查找改成逐块搜索（库只返回误差最低的一档，整篇搜索再丢跨块匹配会漏掉块内合格的匹配）；边界加分只在该侧吻合时才算。
- Task 5：`onNotesLocated` 改用 ref 存回调，不放进注入 effect 的依赖。
- Task 6：`boundaryToOffset` 对落在被跳过子树（图标）里的边界，改成取同块内前一个节点的末尾，保证偏移等于图标位置（这需要改 Task 3 的 `text-index.ts`）；右键按下时先快照选区，避免 macOS 先选词。
- 最终评审：Mode A 下不传 `onCommentDraft`（否则右键和 `c` 的草稿进了看不见的右栏，还会丢掉原生右键菜单；代价是 Mode A 里原本就没用的气泡评论按钮消失）；图标点击 `preventDefault`（防止链接末尾的图标触发跳转）；旧评论定位先查原文再查规整形式（防止多行代码锚点回归）；右栏位置计算复用 `text-index` 的块级标签集合。
- 部分提交（由 Opus 子 agent 完成的几个）的署名行写的是实际运行的模型（`Claude Opus 5.5`），不是系统要求的 `Claude Sonnet 5.5`。需要统一的话可以 amend。

### 两处有意改变的现有行为（交接文档已列，PR 描述里要写）

- Mode A 左栏的评论从"叠在位置 0"改为正常列表排列。
- 以前跨段落写的旧评论，现在能标出来。

## 原 session 验收记录（2026-10-22）

在本工作区（分支 `feature/inline-comments-p1`，HEAD `70a68b4`）逐条重跑，不采信接手方结论。判成败的命令输出重定向到文件后取退出码，不接管道。

| # | 锚点 | 结果 | 实跑证据 |
|---|---|---|---|
| 1 | 后端测试 | pass | `npm test` 退出码 0；7 个套件全部 `0 failed`（server 51 passed）；Task 2 三个用例均为 `✓` |
| 2 | 前端测试 + 计划用例 | pass | `cd web && npm test` 退出码 0，21 个文件 188 个用例通过。脚本从计划 Task 3–7 取出 39 个 `it(...)` 名，在 `web/src/**/*.test.ts(x)` 中缺失 0 个；`web/src` 下没有 `.skip`/`.only`/`.todo`/`xit` |
| 3 | 前端构建 | pass | `cd web && npm run build` 退出码 0（含 `tsc`） |
| 4 | 旧接口清除 | pass | `grep -rn "onAnchorSelect\|resolveAnchorY" web/src` 无输出，退出码 1 |
| 5 | 新依赖 | pass | `web/package.json` 的 `dependencies["approx-string-match"]` 为 `^2.0.1` |
| 6 | 改动范围 | pass | `git diff --name-only 817494d..HEAD`（merge-base 即 `817494d`）共 19 个文件，逐个对照计划各 Task 的 Files 清单：均在清单内或属允许的例外；spec 的改动是 Task 1/8 要求的写回 |
| 7 | 未确认项记录 | pass（验收时补齐） | 送验时 Safari 一栏缺失（接手方已如实标红送验）。验收时由用户在 Safari 里实测：单击不可编辑段落后 `getSelection().type` 为 `"Caret"`。已写入 spec 未确认项表。两个浏览器都可用，`c with caret creates point draft` 无需替换。性能一栏已有实测值（约 25 ms，低于 100 ms） |
| 8 | 手动检查记录 | pass | 5 项均有结果与说明；第 3 项只验证到"不拦截原生菜单"，接手方已写明无头环境的限制 |

**回归面核对**：改动面是 `server/index.js` 与 `web/src` 下的 reader、notes-panel、tasks.$id、lib、hooks、样式。被波及组件的既有测试就是锚点 1、2 已跑的后端全集和前端全集，没有遗漏的其他回归测试。

**接手方报告的"右栏卡片区高度不断增长"**：对比分叉点 `817494d` 的 `notes-panel.tsx`，`ResizeObserver` + `setArticleHeight(el.scrollHeight)` 以及 `height: articleHeight` 容器逐行相同，本分支只在定位 effect 的依赖里加了 `located`。判断为既有问题，不打回。依据是代码对比，没有在分叉点上实测。建议另开 fix 分支处理；卡片整体偏低约 190px、跨任务草稿残留同属既有问题。

**未在本轮验证、建议上线前手点**：macOS 真机右键是否得到点评论（而不是先选中单词）、Ctrl+点击。

**结论：达成。** `status` 置为 `已验收`。
