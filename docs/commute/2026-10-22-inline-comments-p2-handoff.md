---
status: 待执行
date: 2026-10-22
author_model: claude-opus-5-5
acceptance: hard
workspace_mode: shared-worktree
branch: feature/inline-comments-p2
worktree: /Users/harveyzhang96/Projects/scholia/.claude/worktrees/feature+inline-comments-p2
base_commit: 3d449a0d0a8097f1865e2c8cbf319e5e758164aa
source_node: b6d0caf8-242a-4d0a-b925-8d01a895ae5f
target_node:
---

# 交接：实施正文内嵌评论第 2 期（内嵌卡片视图）

**交接目的**：接手方按已批准的实施计划和设计稿，在本分支上完成第 2 期的 6 个任务，然后交回原 session 验收。原 session 负责设计，不参与实现。

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

- **第 1 期已完成并合入 `staging`**（`a173763`）：统一锚点模型、定位函数、三个创建入口（选区气泡、右键「在此处评论」、`c` 键）、点评论图标；右栏改用新定位结果。本工作区从合入后的 `staging`（`3d449a0`）切出。
- **本期目标**：评论以横向长卡片的形式插在锚点所在段落下方（「内嵌」视图，默认），可单卡或全部收起/展开；正文开头有「未定位评论」区；「内嵌 / 右栏」两种视图可切换，选择存在浏览器本地。两种视图共用一个「外壳 + 条目」结构的卡片组件。只改前端，不改后端，不加依赖。
- **计划和设计稿都已经用户逐项确认**（2026-10-22），计划里的「关键决定」一节是确认后的结论。
- **执行方式**：用户选择 subagent-driven，使用 `superpowers:subagent-driven-development`：每个任务由一个新的实现者完成，再由一个新的审查者检查，全部做完后再对整条分支做一次审查。

## 关键决定（别改动）

计划「关键决定」一节全部是用户拍板的，这里只列最容易被改动的几条。实现中发现走不通，停下来回报原 session，不要自行换方案。

- **卡片布局**：评论正文在最上 → 近似快照 → 最底部信息行（时间点、「原文已变化」、相对时间、编辑/删除）。收起按钮在正文首行**最右侧**。**不显示类型图标**。
- **引用原文只在右栏卡片显示**（首行，最多两行，超出省略）；内嵌卡片和草稿卡片都不显示锚点原文或锚点标签。
- **内嵌视图不渲染右栏**，正文列占满空出的宽度（设计稿的「宽度方案 A」，已选定；不实现 B）。
- **Mode A + 内嵌视图打开三个评论入口**；Mode A + 右栏视图维持第 1 期的行为（不传 `onCommentDraft`）。
- **点正文标记或图标**：内嵌视图切换卡片收起；右栏视图保持第 1 期的「聚焦并编辑」。
- **收起状态不持久化**；视图选择存 `localStorage` 键 `comment-view`，默认 `inline`。
- **槽位元素按段落复用**，不在每次注入时重建（否则正在编辑的卡片会丢字）。

## 范围铁律

- **做（In）**：计划 Task 1–6，以及计划里为每个任务列出的文件。
- **不做（Out）**：
  - 第 3 期的原文标记写入、`sc` 标记渲染插件、后端 marker 接口。
  - 设计稿里的「宽度方案 B」。
  - 右栏卡片的收起；收起状态持久化；卡片里的 AI、回复、标签、Markdown 渲染。
  - 第 1 期验收时记录的已有问题（右栏卡片区高度持续增长、右栏卡片整体偏低约 190px、跨任务草稿残留），除非计划的任务直接要求。
  - 修改设计稿和 `.hskill/sync-design/manifest.json`（设计稿到完成稿的同步由原 session 在验收后做）。
  - 顺手重构计划之外的代码。
- **不合并、不推送**：只在 `feature/inline-comments-p2` 上提交。

## 相关文档索引

- 实施计划（逐任务的接口、测试、命令）：`docs/superpowers/plans/2026-10-22-inline-comments-p2.md`
- 设计稿（视觉依据，浏览器直接打开；URL 加 `#state=draft`、`#view=sidebar`、`#state=collapsed` 等可直达某个状态）：
  - `.hskill/sync-design/html/drafts/task-detail-article-web-design.html`
  - `.hskill/sync-design/html/drafts/task-detail-video-web-design.html`
  - 尺寸、颜色、间距以设计稿 CSS 为准；计划文字与设计稿冲突时以设计稿为准。
- 设计依据：`docs/superpowers/specs/2026-10-22-inline-comments-design.md` 第 2.1（内嵌部分）、3.1 步骤 4、3.3、3.4、4 节。spec 第 4.1 节的卡片头部描述已被计划和设计稿取代（类型图标、锚点摘录已去掉），以计划为准。
- 第 1 期交接与验收记录（了解现有代码的约定和已知问题）：`docs/commute/2026-10-22-inline-comments-p1-handoff.md`
- 分支规范：`docs/reference/git-workflow.md`；项目约定：`CLAUDE.md`

## 工作流约定

- **工作区里还没有 `node_modules`**：开工前先在工作区根目录和 `web/` 下各执行一次 `npm install`。
- **提交信息首行不超过 80 个字符**（commit-msg 钩子会拦）。计划里给的提交信息都满足；自己另写的要注意。
- **`staging` 和 `master` 禁止直接提交**（pre-commit 钩子会拦）。本 feature 分支不受限制。
- 手动检查（Task 6 Step 2）用临时目录里的文章和视频任务副本，不碰真实数据。第 1 期的做法可参考其交接文档的自测记录（gstack `browse`，无头 Chromium）。

## 最小验收锚点

以下全部为硬判据，在本工作区里逐条实跑，任何一条不满足就算未达成。

1. **后端测试全绿**：`npm test` 退出码为 0（本期不改后端，用作回归）。
2. **前端测试全绿，且计划里的用例都在**：`cd web && npm test` 退出码为 0。计划 Task 1–5 测试代码块里列出的每个 `it('…')` 用例名，都能在 `web/src/**/*.test.ts(x)` 里找到，并且通过；`web/src` 下没有 `.skip` / `.only` / `.todo` / `xit`。第 1 期已有的用例不能删除；允许的改动只有两类：
   - `notes-panel.test.tsx` 里 `NoteItem` 的两个用例按计划迁到 `note-card.test.tsx`（用例名按计划）。
   - `tasks.$id.test.tsx` 的三个已有用例按计划在开头固定 `commentView: 'sidebar'`，断言不变。
3. **前端构建通过**：`cd web && npm run build` 退出码为 0，包括 `tsc` 类型检查。
4. **旧组件和类型图标已清除**：`grep -rn "NoteItem" web/src` 与 `grep -rn "❝" web/src` 都没有任何输出。
5. **没有新依赖**：`git diff --name-only $(git merge-base staging HEAD)..HEAD -- package.json web/package.json package-lock.json web/package-lock.json` 没有输出。
6. **改动没有超出计划**：`git diff --name-only $(git merge-base staging HEAD)..HEAD` 列出的文件，都在计划各任务的 Files 清单里；例外只有本交接文档和计划文档本身（原 session 交接时改过计划里的一个用例名）。
7. **手动检查已逐项记录**：计划 Task 6 Step 2 的 6 项检查，每项在自测记录里写 pass 或 fail 并附简短说明；第 1、2 项（默认内嵌视图、收起/展开）还要附截图路径，并说明与设计稿对应状态是否一致。某项在本机无法完成的，写明原因，不能空着。

### 原 session 写交接时的门禁核对（2026-10-22）

- 机器校验：`validate-handoff.sh` 通过。
- 冷读：分支、工作区、基线都已建好；计划 Task 1–5 的每个用例名都在计划代码块里，锚点 2 可逐条核对；锚点 4–6 都是可直接判对错的命令。
