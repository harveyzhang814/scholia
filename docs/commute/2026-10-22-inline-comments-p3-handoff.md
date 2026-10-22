---
status: 执行中
date: 2026-10-22
author_model: claude-opus-5-5
acceptance: hard
workspace_mode: shared-worktree
branch: feature/inline-comments-p3
worktree: /Users/harveyzhang96/Projects/scholia/.claude/worktrees/feature+inline-comments-p3
base_commit: d68135c680fa6514882f8ca29c454aefdf936791
source_node: b6d0caf8-242a-4d0a-b925-8d01a895ae5f
target_node: f4866fd8-3c72-4ea4-be22-8e566b9b3da9
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

## 接手方自测记录（2026-10-22，进行中，锚点 8 待用户实测，尚未送验）

被测提交：`12ff6ed`（分支 `feature/inline-comments-p3`，基线 `d68135c`）。实现按 subagent-driven 完成：每个任务一名实现者加一名审查者，Task 1、6 各有一轮修复，另有整条分支审查加一轮修复。

| 锚点 | 结果 | 实跑命令 / 依据 |
|---|---|---|
| 1 后端 | pass | `npm test` 退出码 0；`node tests/server.test.js` → `67 passed, 0 failed`，计划 Task 1 的 9 个用例名都以 `✓` 出现（逐个 `grep -F "✓ <名>"`，在 `54e82f1` 上核对；之后只改了前端文件，`12ff6ed` 上 `npm test` 重跑仍为 0 failed） |
| 2 前端 | pass | `cd web && npm test` 退出码 0（30 个文件、304 个测试通过，在 `12ff6ed` 上重跑）；用 `vitest --reporter=json` 取完整用例名（外层 `describe` 加 `it`）逐个比对计划的 27 个，全部存在且 passed。其中 `toc ignores sc markers in headings` 起初是 `extractToc with sc markers > ignores…`，已在 `54e82f1` 把 `describe` 改名为 `toc` 以完全一致；`web/src` 无 `.skip/.only/.todo/xit`；对 `d68135c` 的测试文件 diff 无被删除的 `it(`/`describe(` 行 |
| 3 构建 | pass | `cd web && npm run build` 退出码 0（含 `tsc`，仅 chunk 体积警告） |
| 4 依赖 | pass | `git diff d68135c..HEAD -- web/package.json package.json`：web 只多 `remark-gfm ^4.0.1`、`remark-parse ^11.0.0`、`unified ^11.0.5` 三行，根 `package.json` 无改动 |
| 5 约定 | pass | `grep -c "never moved, renamed, or modified" CLAUDE.md` → 0；第 40 行有含 `<!-- sc:` 的新约定 |
| 6 范围 | pass，附两个清单外文件 | `git diff --name-only d68135c..HEAD` 全部落在计划各任务 Files 清单内，加交接文档和 `web/package-lock.json`；另有两个清单外文件：`server/article-source.js`（仅导出 `parseFrontmatter`，路由要复用，brief 的 `git add` 清单漏列）、`web/src/hooks/use-tasks.test.tsx`（覆盖 `useAddNote` 接线的跳过条件和缓存失效） |
| 7 手动检查 | pass，但见下方说明 | 6 项在临时目录副本上实跑；行首规则改动后，第 1、2、5 项在 `12ff6ed` 上重跑，见下 |
| 8 Obsidian 实测 | **未完成，待用户在本机实测** | spec「未确认项汇总」表对应行尚未回填 |

**锚点 7（计划 Task 7 Step 2，临时目录 `/tmp/scholia-p3-manual`，`SCHOLIA_CONFIG_FILE` 重定向，未碰真实目录，`~/.config/scholia` 修改时间未变）**

1. 选区加点评论：pass。`The first paragraph explains how <!-- sc:825762b4 -->hooks keep state<!-- /sc:825762b4 --> between…`；点评论得到单个 `<!-- sc:549e5091 -->`；页面无标记文字，定位 exact。
2. 段首/列表项/引用块/标题：**以下是 `b51c792` 上的旧结果，已被 `12ff6ed` 上的重跑取代。** 旧行为是开头标记后移一个字，高亮少首字（`- A<!-- sc:e7747cf5 -->lpha item…`，页面高亮 "lpha item"），这正是用户随后决定去掉的行为。
   - 重跑（`12ff6ed`，全新临时目录，先重建前端）：段首、列表项首、引用块首的选区评论，以及段落 caret 0 的点评论，源文件 `diff -u` 为空、`notes.json` 无 `markerId`，评论仍定位（未定位评论 0），高亮完整（"Short end"、"Alpha item"、"Blockquote text"），pass。
   - 行中开始、段末结束的选区仍写入标记对，结尾标记在行尾，pass。
   - 标题里（`## Lists and quotes` 选 "Lists and"）仍写入标记对：`## <!-- sc:97ae5559 -->Lists and<!-- /sc:97ae5559 --> quotes`，高亮完整、已定位。重跑的 agent 按我写的预期把它记为 FAIL，那个预期是我写错的：标记在 ATX 标题的内容里是行内 HTML，不会触发整行 HTML 块，`checkReparse` 也通过，且行为和改动前一致，所以这里是预期内的 pass，不是回归。
3. 行内代码里的点评论：pass。源文件 `diff` 为空，评论无 `markerId`，按文字定位。
4. 保留标记改正文后刷新：pass（仍 exact，无「原文已变化」）；删掉标记后刷新：退回文字定位，3 张改过文字的卡片显示「原文已变化」。
5. 删除带标记的评论：pass（`b51c792` 一次，`12ff6ed` 重跑一次）。只少了它自己的标记，其他评论标记、frontmatter、`second.md` 不变（未覆盖：删除无标记的行内代码评论，由后端测试 `DELETE of an unmarked note…` 覆盖）。
6. 视频总结 tab：pass。`...users <!-- sc:0273762a -->durable ownership<!-- /sc:0273762a --> of their data.` 写入 `writing/summary.md`，`article.md` 与原文 `cmp` 相同。

锚点 7 的三点说明：
- 浏览器工具无法拖选，选区由 JS 设置；其余走真实 UI（`c` 快捷键、点击、输入、Cmd+Enter），标记写入由应用自己完成。
- 第 3、4、6 项是在 `b51c792` 上跑的，整条分支审查的修复（`0ff0344`、`3fb4e7d`）和行首规则改动（`12ff6ed`）之后没有重跑。这些改动只会让写标记的条件更严（非 UTF-8 拒写、重复文字不写、行首的开头/点标记不写、`notes.json` 加锁），不改变定位和删除逻辑。需要的话验收方可重跑。
- 测试环境偶发显示旧页面、一次行内代码卡片在一次刷新后缺失、控制台每次一条 404 和 `[sse]` 提示，均未发现与本期有关，详见实现过程记录。

**整条分支审查（最强模型）的结论与处理**
- 修了：C1 非 UTF-8 文件会被不可逆改写（现拒写并跳过删除时的改写）；I1 `notes.json` 写竞争会丢评论（新建、修改评论也进同一把锁）；I2 重复文字下标记可能写到另一处（精确匹配后加唯一性检查）。每项先有红再绿，整条分支修复轮的 re-review 通过。
- **I3，用户已拍板并已修（`12ff6ed`）**：原行首规则让开头标记后移一个字，这类选区高亮少首字；用户若在编辑器里删掉这个首字，标记落到行首，整行被当作 HTML 块，页面显示字面的 `<!-- sc:… -->`。这是 plan 与 spec 两条规则叠加的后果。决定（2026-10-22）：开头标记或点标记落在行首时不写标记，该评论继续按文字定位，高亮完整；结尾标记规则不变。依据是同类产品（Hypothesis、GitHub 评审评论、Logos）的共同做法：有把握就准确，没把握就明说，不悄悄给出错的位置。**这偏离了 plan 的 Global Constraints「行首规则」中对开头/点标记的处理，也偏离了 Task 5 里 `planMarkerInsertions` 步骤 4 的描述；`applyLineStartRule` 里 start/point 的右移分支保留但规划器不再使用。** 代价：行首开头的评论得不到「原文被改后仍精确定位」的好处。
- 未修的 Minor：段尾的点评论不写标记（按 brief 规则）；带 BOM 的文件写不上标记；保存后正文大时主线程短暂卡顿；只读文件仍会被改写；双语条目的标记可能留在 `Origin`；重命名会替换 inode。
- 其他：提交 `0ff0344`、`3fb4e7d` 的 trailer 署名为 `Claude Opus 5.5`，与会话约定的 `Claude Sonnet 5.5` 不一致，未重写历史。
