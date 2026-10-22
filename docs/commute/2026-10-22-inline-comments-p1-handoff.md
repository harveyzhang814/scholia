---
status: 执行中
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
