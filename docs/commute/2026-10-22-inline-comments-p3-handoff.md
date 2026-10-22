---
status: 待执行
date: 2026-10-22
author_model: claude-opus-5-5
acceptance: hard
workspace_mode: shared-worktree
branch: feature/inline-comments-p3
worktree: /Users/harveyzhang96/Projects/scholia/.claude/worktrees/feature+inline-comments-p3
base_commit: d68135c680fa6514882f8ca29c454aefdf936791
source_node: b6d0caf8-242a-4d0a-b925-8d01a895ae5f
target_node:
---

# 交接：实施正文内嵌评论第 3 期（原文标记）

**交接目的**：接手方按已批准的实施计划，在本分支上完成第 3 期的 7 个任务，然后交回原 session 验收。原 session 负责设计，不参与实现。

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

- **第 1、2 期已完成并合入 `staging`**：统一锚点模型与定位函数（`web/src/lib/anchor.ts`、`web/src/lib/text-index.ts`）、三个创建入口、内嵌卡片视图与右栏视图。本工作区从合入第 3 期计划后的 `staging`（`d68135c`）切出。
- **本期目标**：新建评论保存成功后，在 Markdown 原文的锚点处写入不可见的注释标记（`<!-- sc:<id> -->`，选区再加 `<!-- /sc:<id> -->`）；渲染时标记变成看不见的占位元素；定位优先按标记（第 0 步）；删除评论时删掉原文里的标记。标记丢失时退回文字定位。
- **这是三期里唯一会改写用户原文文件的一期**，风险最高。
- **计划已经用户确认**（2026-10-22），计划的「Global Constraints」「关键决定」两节是确认后的结论。原 session 已用项目里的实际库验证过三点：sc 标记能被插件转成空 `span`、其他 HTML 注释不受影响；行首的标记会让整行变成 HTML 块；转义符处节点文字与源文件片段不一致。
- **执行方式**：用户选择 subagent-driven，使用 `superpowers:subagent-driven-development`：每个任务由一个新的实现者完成，再由一个新的审查者检查，全部做完后再对整条分支做一次审查。

## 关键决定（别改动）

计划「Global Constraints」和「关键决定」两节全部是定稿，这里只列最容易被改动的几条。实现中发现走不通，停下来回报原 session，不要自行换方案。

- **前端算位置、后端只按指令写**：后端自己生成编号和标记文本，不接受客户端传来的任意字符串；写入前核对正文哈希，不一致返回 409。
- **只有精确档才写标记**；落在行内代码、代码块、转义符等不能逐字对应的位置时放弃。插入后必须重新解析校验，结构变了就放弃。
- **先存评论、再写标记**，成功失败都不提示用户；只给本次新建的评论写，不回填旧评论。
- **写标记的触发点在 `useAddNote` 的 `onSuccess`**，正文从 React Query 缓存取。
- **同一条评论重复写标记返回 409**；视频评论没有 `doc` 时不写。
- **目录（TOC）和复制按钮使用去掉标记后的正文。**
- **测试和手动检查绝不能指向用户的真实内容目录或视频工作目录**：本期代码会改写原文。手动检查一律用临时目录里的副本，并用 `SCHOLIA_CONFIG_FILE` 把配置重定向到临时目录（第 2 期接手方的做法见其交接文档的自测记录），不要运行 `scholia config set`。

## 范围铁律

- **做（In）**：计划 Task 1–7，以及计划里为每个任务列出的文件。
- **不做（Out）**：
  - 给已有评论回填标记；把近似找回的位置写回 `notes.json`。
  - 高亮改用标记定位；其他 HTML 注释被转义显示的已有问题。
  - 写标记成功后在卡片上显示「已锚定到原文」之类的提示。
  - 第 2 期验收时记录的后续问题（收起按钮过小、草稿换位置清空文字、草稿定位不到时不可见等），除非计划的任务直接要求。
  - 修改设计稿和 `.hskill/sync-design/`。
  - 顺手重构计划之外的代码。
- **不合并、不推送**：只在 `feature/inline-comments-p3` 上提交。

## 相关文档索引

- 实施计划（逐任务的接口、测试、命令）：`docs/superpowers/plans/2026-10-22-inline-comments-p3.md`
- 设计依据：`docs/superpowers/specs/2026-10-22-inline-comments-design.md` 第 1.2 节第 0 步、第 5 节全部、第 6.1 节「源文件映射与插入」、第 6.3、6.4 节。计划与 spec 有出入时以计划为准。
- 第 2 期交接与验收记录（临时目录做手动检查的方法、已知问题）：`docs/commute/2026-10-22-inline-comments-p2-handoff.md`
- 分支规范：`docs/reference/git-workflow.md`；项目约定：`CLAUDE.md`（本期 Task 1 会修改其中关于原文文件的约定）

## 工作流约定

- **工作区里还没有 `node_modules`**：开工前先在工作区根目录和 `web/` 下各执行一次 `npm install`。安装可能顺手改动 `package-lock.json` 里的项目版本号，与本期无关的改动不要提交（第 2 期接手方遇到过，提交前还原）。
- **提交信息首行不超过 80 个字符**（commit-msg 钩子会拦）。
- **`staging` 和 `master` 禁止直接提交**（pre-commit 钩子会拦）。
- **Task 7 Step 3 需要用户配合**：Obsidian 并发编辑只能由用户在本机实测，做不了时向用户要结果，不要跳过。

## 最小验收锚点

以下全部为硬判据，在本工作区里逐条实跑，任何一条不满足就算未达成。

1. **后端测试全绿，计划用例都在**：`npm test` 退出码为 0；`node tests/server.test.js` 的输出里，计划 Task 1 列出的 9 个 `test('…')` 用例名都以 `✓` 出现。
2. **前端测试全绿，计划用例都在**：`cd web && npm test` 退出码为 0；计划 Task 3–6 测试代码块里列出的 27 个 `it('…')` 用例名都能在 `web/src/**/*.test.ts(x)` 里找到并通过；`web/src` 下没有 `.skip` / `.only` / `.todo` / `xit`；对 merge-base 的测试文件 diff 里没有被删除的 `it(` / `describe(` 行。
3. **前端构建通过**：`cd web && npm run build` 退出码为 0，包括 `tsc`。
4. **依赖只加了这三个**：`web/package.json` 的 `dependencies` 里有 `unified`（`^11.0.5`）、`remark-parse`（`^11.0.0`）、`remark-gfm`（`^4.0.1`）；与 merge-base 相比，`web/package.json` 只多了这三行，根目录 `package.json` 没有改动。
5. **项目约定已更新**：`CLAUDE.md` 里不再出现 `never moved, renamed, or modified`，并且出现含 `<!-- sc:` 的新约定。
6. **改动没有超出计划**：`git diff --name-only $(git merge-base staging HEAD)..HEAD` 列出的文件都在计划各任务的 Files 清单里；例外只有本交接文档和 `web/package-lock.json`。
7. **手动检查已逐项记录**：计划 Task 7 Step 2 的 6 项，每项在自测记录里写 pass 或 fail 并附简短说明；第 1、2、5、6 项要附原文文件改动前后的实际 diff（`diff` 或 `git diff --no-index` 的输出）作为证据。某项在本机无法完成的，写明原因，不能空着。
8. **Obsidian 实测结论已写回**：spec「未确认项汇总」表里「Obsidian 对外部修改的合并行为」一行写上了实测结论和日期（计划 Task 7 Step 3）。

### 原 session 写交接时的门禁核对（2026-10-22）

- 机器校验：`validate-handoff.sh` 通过。
- 冷读：分支、工作区、基线都已建好；计划里 Task 1 的 9 个后端用例名、Task 3–6 的 27 个前端用例名都可逐条核对；锚点 4–6 都是可直接判对错的命令。
