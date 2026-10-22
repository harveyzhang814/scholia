---
status: 已验收
date: 2026-10-22
author_model: claude-opus-5-5
acceptance: hard
workspace_mode: shared-worktree
branch: feature/inline-comments-p2
worktree: /Users/harveyzhang96/Projects/scholia/.claude/worktrees/feature+inline-comments-p2
base_commit: 3d449a0d0a8097f1865e2c8cbf319e5e758164aa
source_node: b6d0caf8-242a-4d0a-b925-8d01a895ae5f
target_node: 3b27cb4a-5455-416e-872d-ab9779743465
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

## 接手方自测记录（2026-10-22）

自测对象：`feature/inline-comments-p2` 的 HEAD `4dc9939`（基线 `3d449a0`，相对基线共 10 个提交，不含本记录自身的提交）。判成败的命令都没有接管道（输出重定向到文件，另取退出码）。

### 最小验收锚点

| # | 判据 | 结果 | 实跑命令 / 证据 |
|---|---|---|---|
| 1 | 后端测试全绿 | **pass** | `npm test`：退出码 0，`8 passed, 0 failed` |
| 2 | 前端测试全绿，计划用例都在 | **pass** | `cd web && npm test`：退出码 0，25 个文件 / 245 个用例。脚本从计划 Task 1–5 的代码块提取出 36 个 `it('…')` 用例名，逐个在 `web/src/**/*.test.ts(x)` 中查找，缺失 0 个。`grep -rnE "\.(skip\|only\|todo)\(\|\bxit\(\|\bxdescribe\("  web/src` 无输出。对 `3d449a0..HEAD` 的测试文件 diff 过滤被删除的 `it(`/`describe(` 行，只有 `NoteItem isLinked/editing interaction` 的 describe 和它下面两个用例（已迁到 `note-card.test.tsx`）。`tasks.$id.test.tsx` 的 3 个已有用例只在开头加了 `commentView: 'sidebar'`，断言没变 |
| 3 | 前端构建通过 | **pass** | `cd web && npm run build`：退出码 0（含 `tsc`）。只有 bundle 大小提示，没有错误 |
| 4 | 旧组件和类型图标已清除 | **pass** | `grep -rn "NoteItem" web/src` 与 `grep -rn "❝" web/src`：都无输出（grep 退出码 1） |
| 5 | 没有新依赖 | **pass** | `git diff --name-only 3d449a0..HEAD -- package.json web/package.json package-lock.json web/package-lock.json`：无输出。（过程中 `npm install` 把两个 `package-lock.json` 的版本号从 0.3.0 改成 0.6.0，已在提交前 `git checkout` 还原，从未提交） |
| 6 | 改动没有超出计划 | **pass** | `git diff --name-only 3d449a0..HEAD` 共 20 个文件：计划 Task 1–5 的 Files 清单里的 18 个源码/测试文件，加上本交接文档和计划文档两个允许的例外。`web/src/styles/globals.css` 在 Task 2 的清单里；Task 4 和一次后续修复也改了它（见下方偏差说明） |
| 7 | 手动检查已逐项记录 | **pass**（见下） | 见「手动检查」 |

### 手动检查（Task 6 Step 2）

做法：在 `/tmp/scholia-p2-manual/` 下建临时文章和视频任务，用 `SCHOLIA_CONFIG_FILE` 把配置、`running.json` 和 `read-state.json` 重定向到该目录，端口 7777，没有碰 `~/.config/scholia`，也没有运行 `scholia config set`。用 gstack `browse`（无头 Chromium）驱动，视口 1440 宽。视频页的 Mode A 用了本机生成的真实 mp4。以下 6 项在 HEAD `03be3d6` 上逐项做完；之后的两个提交（`7ad4e54` 只改 CSS，`4dc9939` 只改 `reader.tsx` 一行依赖和测试）只重新核对了 CSS 的宽度/字体，没有把 6 项重跑一遍。

1. **默认内嵌视图：pass。** 段落、列表项、表格、代码块下方各有一张卡片，右栏不出现。截图 `/tmp/scholia-p2-shots/01-article-inline-tall.png`（另有 `01b-card-zoom.png`）。与设计稿默认态（`draft-article-default.png`）对照：卡片结构、间距、信息行一致。差异三处：(a) 未定位区比正文宽（1168px 对 680px），这一条已在 `7ad4e54` 修掉，修后默认主题下区和 `.prose-cn` 同为 680.27px、左缘对齐；(b) 设计稿的模型正文约 1070px 宽，没有应用它自己说明里提到的 72ch 上限，真实页面是 680px 居中，属于预期；(c) 设计稿里是 `+ 添加评论`，实现按计划固定文案写 `添加评论`，没有 `+`，卡片箭头字号也略小。(c) 是纯外观差异。
2. **收起和展开：pass。** 点卡片箭头、点正文标记、点气泡图标都能切换单张卡片；`全部收起` / `全部展开` 生效，未定位区的卡片也跟着收起；刷新后全部展开。截图 `/tmp/scholia-p2-shots/02-all-collapsed.png`（单张收起见 `02a-one-collapsed.png`）。与设计稿 `#state=all-collapsed`（`draft-task-detail-article-web-design.html-state=all-collapsed.png`）一致：一行预览加右侧 `▸`，按钮变为 `全部展开`。（设计稿并不识别交接文档里写的 `#state=collapsed`，实际支持的是 `all-collapsed`，改 hash 后要刷新页面才生效。）
3. **新建：pass。** 选区气泡、右键「在此处评论」、`c` 键各建一条；草稿卡片出现在所在块下方（段落、列表项、表格后、代码块后、标题后都试了）；⌘↵ 保存后变成正常卡片（用 API 确认），Esc 放弃后消失。同时打开一张卡片的编辑和一个草稿，在草稿里 ⌘↵ 保存，另一张卡片里已输入的文字没丢。截图 `03a-bubble.png`、`03b-draft.png`、`03c-saved.png`、`03d-ctxmenu.png`、`03e-draft-ctx.png`、`03f-draft-c.png`。
4. **未定位区：pass。** 无锚点评论、改原文后找不到的评论、视频页另一个 tab 的评论都在这里；`添加评论` 能建无锚点评论；视频播放中添加的评论带 `mediaTimestamp: 3`。截图 `04a-add-comment-zone.png`、`04b-zone-saved.png`、`04c-video-article-tab.png`。
5. **视图切换：pass。** 切到右栏后与第 1 期行为一致，刷新后仍是右栏（`localStorage comment-view=sidebar`），切回内嵌恢复。Mode A：内嵌视图下三个入口（气泡 `评论`、`c`、右键自定义菜单）可用，左栏列表仍在；右栏视图下气泡只有 4 个颜色按钮，`c` 无反应，右键不出自定义菜单，与第 1 期相同。截图 `05a-sidebar-article.png`、`05b-sidebar-draft.png`、`05c-video-sidebar.png`、`06a-video-default.png`。
6. **卡片里选字、右键、`c`：pass，有一处方法上的限制。** 卡片内选字不出气泡，`c` 不产生草稿；在卡片内派发 `contextmenu` 事件后 `defaultPrevented === false` 且没有「在此处评论」菜单。限制：这一项是靠派发合成事件完成的，没有看到浏览器原生右键菜单本身，只确认了页面没有拦截。

手动检查中顺带发现、没有改的几点：
- 未定位区在首次加载时，所有评论会先进入区里再移入槽位，这个状态只在 DOM 里存在 2–5ms；10 次加载加一次切 tab 都没有任何一帧画出来，肉眼看不到。
- 正在编辑的卡片失焦即自动保存（`onBlur={onSave}`）。文字不丢，但半截编辑会被当作确认提交。这与第 1 期 `NoteItem` 的规则相同，计划写明「规则与现在的 `NoteItem` 相同」。
- 未定位区里新建的评论没有 `doc` 字段，所以在视频页的两个 tab 都会出现在区里。
- 控制台只有 `/api/events` 404 和 SSE 提示，是第 1 期已有的。
- 右栏视图卡片间的空隙（右栏卡片整体偏低约 190px）是第 1 期验收时记录过的问题，不在本期范围。

### 偏差与裁决（由接手方做出，原 session 可推翻）

- **`slotHost` 对表格单元格的处理**：计划约束的字面规则是「从块元素起往上找第一个属于集合的元素」。实现里，只要在 `td/th` 内，host 一律取外层 `TABLE`。依据：计划意图是「不放进单元格」，GFM 单元格里没有 `<p>`，只有原始 HTML 的单元格与字面规则不同。若不接受，后果是这种单元格里的槽位落在 `<p>` 后而不是表格后。
- **Mode A 内嵌视图保留左栏 `NotesPanel`**：评论会在左栏和正文各出现一次。依据：计划 Task 6 Step 2 第 5 项明写「左栏列表仍在」。
- **Task 4 额外改了 `globals.css` 并给未定位区折叠按钮用了 `收起区域` / `展开区域` 的 aria-label**：待写卡片绿色描边、未定位区等样式原本不存在，取值照设计稿；区按钮的 label 为了和卡片按钮（`收起` / `展开`）区分，不是计划固定文案。
- **手动检查后追加的两处 CSS 修复（`7ad4e54`）**：未定位区宽度与正文对齐（设计稿优先于计划文字）；`.sc-note-card` 加 `font-family: var(--font-sans)`，学术主题下正文里的卡片原本继承衬线字体，与未定位区不一致。修后学术主题下区与 `.prose-cn` 同为 565.03px。因 jsdom 不加载 `globals.css`，这两处没有新增自动测试，是在浏览器里量的。
- **最终整分支审查后的修复（`4dc9939`）**：重写了一个原本断言恒成立的 Reader 测试（改完后临时去掉槽位的 `data-sc-ui`，测试失败在 `reader.test.tsx:265`，已还原），悬停同步 effect 的依赖补上 `draft` 和 `hasInline`，跨块删除用例补了槽位与卡片的同一对象断言。

### 未修复、留给后续的已知小问题

- 写草稿时去点另一段再按 `c` 或右键「在此处评论」，草稿换到另一个槽位，已输入的文字会被清空（第 1 期右栏的输入框文字与锚点是分开存的，会保留）。
- 内嵌视图下，若草稿的锚点定位不到（文件被改、跨任务残留的草稿），草稿还在页面状态里但界面上看不到；右栏视图下总是可见。
- 选区跨过卡片时，加的高亮存不进正文（`reader.tsx` 用 `sel.toString()` 做高亮锚点，是第 1 期的逻辑）。
- `.sc-card-actions` 只在 `:hover` 时显示，键盘聚焦时仍透明（第 1 期就是这样）；`CommentViewToggle` 没有 `role="group"` / `aria-label`。
- `DraftCard` 在 `mutate()` 后立刻 `onDone()`，保存失败时草稿文字会丢（与第 1 期 `NotesPanel` 的提交方式相同，计划如此规定）。
- 正在编辑时被收起，或在已收起的卡片上自动进入编辑，文本框不可见（`autoEdit` 只在右栏发生，而右栏卡片不能收起，所以实际触发不到）。

### 执行过程说明

按文档要求使用 `superpowers:subagent-driven-development`：每个任务一个新实现者、一轮任务审查，Task 2 有 1 轮修复，最后对整条分支做了一次审查（结论「With fixes」，无 Critical，1 个 Important 已修）并对修复做了范围限定的复审（全部已处理）。**没有**执行该 skill 末尾的 `finishing-a-development-branch`（合并/推送/清理），因为文档要求不合并、不推送，交回原 session 验收。

## 原 session 验收记录（2026-10-22）

在本工作区（分支 `feature/inline-comments-p2`，HEAD `f5f19ca`，merge-base `3d449a0`）逐条重跑，不采信接手方结论。判成败的命令输出重定向到文件后取退出码，不接管道。

| # | 锚点 | 结果 | 实跑证据 |
|---|---|---|---|
| 1 | 后端测试 | pass | `npm test` 退出码 0；7 个套件全部 `0 failed` |
| 2 | 前端测试 + 计划用例 | pass | `cd web && npm test` 退出码 0，25 个文件 245 个用例。脚本从计划 Task 1–5 取出 36 个 `it('…')` 名，在 `web/src/**/*.test.ts(x)` 中缺失 0 个；`.skip/.only/.todo/xit/xdescribe` 无。测试文件 diff 中被删除的 `it/describe` 只有 `NoteItem isLinked/editing interaction` 及其两个用例（已迁到 `note-card.test.tsx`）；`tasks.$id.test.tsx` 的三个已有用例只在 `setState` 里加了 `commentView: 'sidebar'`，断言未变 |
| 3 | 前端构建 | pass | `cd web && npm run build` 退出码 0（含 `tsc`） |
| 4 | 旧组件与类型图标清除 | pass | `grep -rn "NoteItem" web/src`、`grep -rn "❝" web/src` 均无输出（退出码 1） |
| 5 | 没有新依赖 | pass | 四个 package 文件的 diff 无输出 |
| 6 | 改动范围 | pass | 共 20 个文件：18 个均在计划各 Task 的 Files 清单内（`globals.css` 在 Task 2 清单内，Task 4 和 `7ad4e54` 也改了它，属同一文件）；另两个是本交接文档和计划文档（计划只有交接时改的那 1 行） |
| 7 | 手动检查记录 | pass | 6 项均有 pass/fail 与说明；第 1、2 项附了截图路径并与设计稿对照，截图文件在 `/tmp/scholia-p2-shots/` 下实际存在，抽看了 `01-article-inline.png`、`02-all-collapsed.png`：卡片在段落、列表项内、表格后、代码块后，收起后为一行预览加右侧按钮，与设计稿一致 |

**回归面核对**：改动面只有 `web/src` 下的组件、lib、路由、store 和样式，以及两份文档。被波及组件的既有测试就是锚点 2 已跑的前端全集；后端未改动，锚点 1 已全跑。没有遗漏的其他回归测试。

**对接手方偏差的裁决**：
- `slotHost` 对 `td/th` 一律取外层 `TABLE`：接受，符合计划「不放进单元格」的意图。
- Mode A 内嵌视图保留左栏列表：接受，这是计划和用户确认过的行为。
- Task 4 额外改 `globals.css`、未定位区按钮用 `收起区域` / `展开区域`：接受。
- `7ad4e54` 的两处 CSS 修复（未定位区与正文同宽、卡片用无衬线字体）：接受，设计稿优先。

**记录给后续的观察（不影响本次结论）**：
- `01-article-inline.png` 是修复前的截图，未定位区比正文宽；接手方已说明在 `7ad4e54` 修掉，本次没有在浏览器里复看修复后的样子。
- 截图里收起按钮 `▾` / `▸` 渲染得很小，接近一个点，比设计稿的 11px 箭头更不显眼，建议后续单独调大。
- 接手方列出的「未修复、留给后续的已知小问题」6 条照录，其中「写草稿时换位置会清空已输入文字」和「草稿锚点定位不到时界面上看不到」两条对用户最可感知，建议作为第 2 期后续修复。

**结论：达成。** `status` 置为 `已验收`。
