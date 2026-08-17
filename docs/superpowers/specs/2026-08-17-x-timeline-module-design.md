# X 时间线模块 设计文档

## 概述

Scholia 目前支持两种内容类型：视频（VDL 格式）和文章（Markdown）。本设计新增第三种内容类型——**X（Twitter）时间线**，数据来源是 `sync-xtimeline` skill 产出的按 handle 分文件归档（`<handle>.json`，格式规范见 `~/.hskill/sync-xtimeline/tweets/<handle>.json` 及交接文档 `docs/commute/2026-08-17-sync-xtimeline-data-format-handoff.md`）。

X 时间线模块**完全独立**于现有 `/api/tasks/:taskId` 统一分发体系：不复用 `isArticleId` 这套 discriminator，不接入高亮/笔记基础设施。新增一套平行的自包含模块：后端 `server/x-source.js` + 路由 `/api/x-timelines*` + 前端 `/x`、`/x/:handle` 页面。原因是 X 时间线的内容形状（推文流）和交互模型（纯浏览，不标注）与 video/article 差异太大，硬塞进统一 dispatcher 只会让 `server/index.js` 里每个 `/api/tasks/*` handler 都多一个不适用的分支。

## 背景

- 归档数据是"按 handle 分文件、JSON 数组、只增不改、按 `tweet_id` 去重、落盘顺序=到达顺序（不保证时间倒序）"的只读数据源，由外部 skill（`sync-xtimeline`）独立维护，scholia 只读不写。
- 归档条目统一 11 个字段（`tweet_id`/`url`/`text`/`timestamp`/`author_handle`/`type`/`reply_to_handle`/`quoted_author`/`quoted_text`/`quoted_timestamp`/`translated`），四种 `type`（`post`/`repost`/`quote`/`reply`）字段集合完全一致，不适用的值是 `null`。
- 没有独立的 schema version 字段，消费方应按"未知字段容忍"方式解析。
- `tweet_id` 是 19 位雪花 ID（如 `2088298127346536578`），超过 `Number.MAX_SAFE_INTEGER`（16 位），必须用 `BigInt` 比较排序，否则精度丢失导致排序错乱。
- `author_handle` 字段语义在不同 `type` 下不一致（详见"数据语义"一节），这是渲染时最容易出错的点。

## 目标 / 非目标

**目标**
- 用户可以在 scholia 里浏览已归档的 X 时间线：列表页看到所有被追踪的 handle，详情页看到某个 handle 的完整推文流（倒序，最新在前）。
- 原文与中文翻译（`translated`）并排显示。
- 四种推文类型（原创/转推/引用/回复）有清晰、语义正确的视觉呈现，尤其是转推/引用的归属关系。
- 数据源路径可配置（`x-dir`），不写死到某个特定 skill 的目录结构。

**非目标**
- 不支持高亮/笔记（本次范围内纯展示）。
- 不支持在 scholia 里发起新的抓取/追更（那是 `sync-xtimeline` skill 的职责，scholia 只读归档产物）。
- 不做归档文件的写入、去重、修复——scholia 信任归档文件已经满足格式规范里的持久化契约。
- 不提供按 type 筛选、搜索等交互（YAGNI，一次性推文流已经是主要使用场景；后续如有需要再加）。
- 不处理归档文件的 schema 版本迁移（当前无版本机制，按未知字段容忍解析即可覆盖）。

## 数据语义：`author_handle` 的归属反转

这是渲染逻辑里最容易出 bug 的地方，必须显式设计：

| type | `author_handle` 含义 | 附加字段 |
|---|---|---|
| `post` | 归档文件所属 handle 本人 | 无 |
| `reply` | 归档文件所属 handle 本人 | `reply_to_handle` = 被回复的对象 |
| `quote` | 归档文件所属 handle 本人（引用别人发了条新推文） | `quoted_author`/`quoted_text`/`quoted_timestamp` = 被引用的原推文 |
| `repost` | **被转推的原推文作者**，不是文件所属 handle | 无（转推没有独立正文，`text`/`url` 都是原推文的） |

也就是说，`repost` 类型下"是谁转推的"这个信息**不在推文对象本身里**，而是由归档文件的归属（即当前浏览的 handle）隐式决定。因此推文卡片组件必须额外接收一个 `ownerHandle` prop（详情页当前浏览的 handle），`repost` 渲染为"`ownerHandle` 转推了"的外层框 + 内层显示 `author_handle` 的原推文内容；`quote` 渲染为 `author_handle`（=owner）的引用 + 内嵌 `quoted_author`/`quoted_text` 的被引用小卡片。

## 架构设计

### 1. `server/x-source.js`（新文件，data source 层，仿 `article-source.js`/`video-source.js` 的角色）

```js
function isValidHandle(handle) // 目录穿越防护：/[/\\]/.test(handle) || handle.includes('..') → false

async function listXTimelines(xDir)
// 扫描 xDir 下的 *.json 文件（文件名去掉 .json 后缀 = handle）
// 每个文件 try/catch 解析：损坏 JSON → 跳过该 handle（不影响其它 handle、不 500）
// 每个 handle 返回：
//   { handle, tweetCount, latestAt, latestPreview }
// latestAt/latestPreview 取该 handle 推文里 tweet_id（BigInt 比较）最大的一条：
//   latestAt = 该条的 timestamp
//   latestPreview = 该条的 translated ?? text（截断由前端负责，源数据不截断）
// 列表按 latestAt 降序（Date.parse，与 sortArticles 的 date 字段处理方式一致）

async function getXTimeline(handle, xDir)
// 读取 <xDir>/<handle>.json，不存在或解析失败 → 返回 null（路由层转 404）
// 返回 { handle, tweets } ，tweets 按 tweet_id BigInt 降序排列
// 排序实现：tweets.slice().sort((a, b) => {
//   const diff = BigInt(b.tweet_id) - BigInt(a.tweet_id);
//   return diff > 0n ? 1 : diff < 0n ? -1 : 0;
// })
// 未知字段容忍：整个 tweet 对象原样透传（不做字段白名单过滤），只依赖 tweet_id 排序和文档里已知的 11 个字段渲染
```

- 不做去重：交接文档保证归档文件本身按 `tweet_id` 去重，scholia 作为纯消费方信任这个契约。
- 不校验 `type` 取值范围：未知 `type` 值透传给前端，前端按"未知类型"兜底渲染（见前端章节）。

### 2. 路由（`server/index.js` 新增，独立于现有 `/api/tasks/*`）

```js
const { listXTimelines, getXTimeline } = require('./x-source');

router.get('/x-timelines', async (ctx) => {
  if (!X_DIR) { ctx.body = []; return; }
  ctx.body = await listXTimelines(X_DIR);
});

router.get('/x-timelines/:handle', async (ctx) => {
  const { handle } = ctx.params;
  if (!X_DIR || !isValidHandle(handle)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
  const timeline = await getXTimeline(handle, X_DIR);
  if (!timeline) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
  ctx.body = timeline;
});
```

- `createApp(options)` 新增 `xDir` 参数，赋值给闭包内 `X_DIR`（与 `WORK_DIR`/`CONTENT_DIR` 同种写法）。
- 鉴权：这两个路由落在现有 `router`（`/api` 前缀）下，自动被已有的 Bearer token 中间件覆盖，无需额外处理（不是媒体流路由，不需要 `?token=` 例外）。

### 3. 配置（`cli/config.js`、`cli/index.js`）

- `cli/config.js`：`readConfig()` 新增读取 `X_DIR` → `xDir`（同 `expandPath` 展开 `~`），**不设默认值**——和 `workDir`/`contentDir` 行为一致，未配置时功能为空，不隐式假设 `sync-xtimeline` 的默认路径（避免把 scholia 和某个特定 skill 的目录结构耦合死）。
- `cli/index.js`：
  - `config` 子命令的 `KEY_MAP` 新增 `'x-dir': 'X_DIR'`，usage 提示串同步加上 `x-dir`。
  - `serve`/`start` 路径下 `createApp({...})` 调用新增 `xDir: config.xDir`。

### 4. 前端

**类型与 API（`web/src/lib/api.ts`）**

```ts
export interface XTweet {
  tweet_id: string; url: string; text: string; timestamp: string;
  author_handle: string; type: string; // 'post' | 'repost' | 'quote' | 'reply'，但保留 string 做未知类型兜底
  reply_to_handle: string | null;
  quoted_author: string | null; quoted_text: string | null; quoted_timestamp: string | null;
  translated: string | null;
}
export interface XTimelineSummary {
  handle: string; tweetCount: number; latestAt?: string; latestPreview?: string;
}
export interface XTimeline { handle: string; tweets: XTweet[]; }
```

字段名保持归档原始的 snake_case（不转 camelCase）——这是外部数据格式的字段名，转换只会增加一层无意义的映射代码，且与"数据格式文档是唯一权威来源"的原则一致。

```ts
listXTimelines: () => request<XTimelineSummary[]>('/api/x-timelines'),
getXTimeline: (handle: string) => request<XTimeline>(`/api/x-timelines/${handle}`),
```

**Hooks（新文件 `web/src/hooks/use-x-timelines.ts`）**

```ts
export function useXTimelines() // useQuery(['x-timelines'], ..., staleTime: 60_000) — 同 useTasks/useArticles 的量级
export function useXTimeline(handle: string | undefined) // useQuery(['x-timeline', handle], ..., enabled: !!handle)
```

**路由（`web/src/main.tsx` 新增两条）**

```tsx
{ path: '/x', element: <Home /> },
{ path: '/x/:handle', element: <XTimelineDetail /> },
```

- `/x` 复用现有 `_index.tsx`（`Home` 组件）的 tab 骨架，tab 从"视频/文章"扩展为"视频/文章/X"，`useLocation().pathname` 判定加一支 `=== '/x'`。搜索框过滤逻辑加一支：按 handle 或 latestPreview 文本过滤。排序沿用 `SortSelect`，`X_SORT_FIELDS` 只提供 `date`（按 latestAt）与自定义的按 handle 名称排序（复用 `compareBy`，无需新增排序 field 类型，直接传 `getValue` 闭包）。
- `/x/:handle` 是**独立组件** `web/src/routes/x.$handle.tsx`（新文件），不接入 `tasks.$id.tsx`：一个简单的 header（返回按钮 + handle 标题）+ 纵向滚动的推文流，用 `useXTimeline(handle)` 拉数据，`tweets.map` 渲染 `TweetCard`。

**组件**

- `web/src/components/x-card.tsx`（新文件，列表卡片，仿 `article-card.tsx` 的结构）：显示 handle、`latestPreview`（`line-clamp-2`）、`tweetCount`、相对时间（复用 `formatRelativeTime`）。`Link to={`/x/${handle}`}`。
- `web/src/components/tweet-card.tsx`（新文件）：
  - props：`tweet: XTweet`、`ownerHandle: string`。
  - **四种 type 不设文字标签/徽标区分，完全靠卡片结构本身自证**（已通过设计稿 `.hskill/sync-design/html/drafts/x-timeline-detail-web-design.html` 验证）：
    - `post`：无附加结构的基础卡片，其余三种都是在它上面叠加出来的。
    - `reply`：卡片**内部**、头像行之上新增一行"回复 @xxx"（`reply_to_handle`），不产生任何卡片外元素——和 `quote` 一样属于"卡片内部结构"。
    - `quote`：主卡片内嵌一层视觉上次级的子卡片（左侧色块边框 + 次级背景），展示 `quoted_author`/`quoted_text`/`quoted_timestamp`，同样不越出卡片边界。
    - `repost`：**唯一越出卡片边界的类型**——整张卡片外面包一层浅底外框，外框顶部一行说明文字"`{ownerHandle}` 转推了"，内层是普通卡片、展示 `author_handle`（原作者，不是 `ownerHandle`）的内容。这行说明文字不是类型标签，是转发关系本身的必要信息（归档数据里推不出"谁转的"，删掉就无法还原）。
    - 未知 `type` 值兜底为按 `post` 处理（保守降级，不隐藏内容）。
  - 原文 `text` 与 `translated` 并排显示（原文正常字重、译文次级颜色 + 顶部虚线分隔，不用左边框——左边框留给 `quote` 的嵌套块，避免同一视觉元素承担两种语义），`translated` 为 `null` 时只显示原文。
  - `url` 渲染为外链（新标签页打开 x.com 原帖），不做站内跳转。

**主页 tab 导航（`web/src/routes/_index.tsx`）**：`nav` 数组从两项扩展为三项，新增 `{ to: '/x', label: 'X' }`；空状态文案新增"暂无 X 时间线 / 配置数据目录：`scholia config set x-dir ~/.hskill/sync-xtimeline/tweets`"（此处提示命令里出现 sync-xtimeline 的默认路径纯粹是给用户的示例文案，不代表代码里有该路径的默认值假设）。

## 数据流

```
GET /api/x-timelines
        │
        ▼
listXTimelines(X_DIR)
        │  fs.readdir(X_DIR) → *.json 文件名
        │  逐个 try/catch 解析 + BigInt 排序取最新一条
        ▼
[{ handle, tweetCount, latestAt, latestPreview }, ...]  ← 按 latestAt 降序
        │
        ▼
前端 /x 列表页 → XCard 网格

GET /api/x-timelines/:handle
        │
        ▼
getXTimeline(handle, X_DIR)
        │  fs.readFile(<X_DIR>/<handle>.json)
        │  tweets.sort by BigInt(tweet_id) desc
        ▼
{ handle, tweets: [...] }
        │
        ▼
前端 /x/:handle 详情页 → tweets.map(TweetCard, ownerHandle=handle)
```

## 边界情况与错误处理

- **`x-dir` 未配置**：`/api/x-timelines` 返回 `[]`（不是 404/500），与 `work-dir`/`content-dir` 未配置时的现有行为一致；前端展示空状态 + 配置命令提示。
- **单个 handle 文件 JSON 损坏**：`listXTimelines` 里 try/catch 跳过该文件，不影响其它 handle 的列表展示；不向前端暴露哪个文件损坏（与现有 `readJson` 的静默 fallback 风格一致，问题留给用户直接检查归档文件）。
- **`GET /api/x-timelines/:handle` 请求一个不存在的 handle**：404。
- **`handle` 路径参数包含 `/`、`..`**：判定为非法，直接 404，防止目录穿越读到 `xDir` 之外的文件（同 `server/paths.js` 里 `getVideoDirs` 对 `taskId` 的校验方式）。
- **推文数组为空**（合法但罕见，如 skill 刚初始化还未抓到内容）：详情页展示空态文案，不报错。
- **`tweet_id` 缺失或非数字字符串**：属于数据契约之外的情况（格式文档保证该字段必为字符串数字），若真的出现，`BigInt(tweet_id)` 会抛异常——不做额外防御，遵循"信任已声明的数据契约，只在系统边界做校验"的原则；这不是 scholia 需要处理的输入边界（数据来自本机文件系统，不是不可信的外部请求）。
- **`type` 出现文档四种之外的值**：前端 `TweetCard` 兜底按 `post` 渲染（保守降级），不隐藏整条推文。

## 测试策略

- **后端** `tests/x-source.test.js`（新文件，风格仿 `tests/server.test.js`，plain Node `assert`）：
  - fixture 覆盖四种 `type`（`post`/`repost`/`quote`/`reply`，`reply` 用构造数据，因为交接文档指出本地真实归档没有 `reply` 样例）。
  - 排序正确性：用真实量级（19 位）`tweet_id` 断言 `getXTimeline` 返回顺序是 BigInt 降序，不因 `Number` 精度丢失而错乱（这是本设计最关键的正确性点，必须有专门断言，不能只测小数字 id）。
  - 损坏 JSON 文件：`listXTimelines` 跳过该文件、其余 handle 正常返回。
  - 空 `xDir` / 不存在的 `xDir`：返回 `[]` 而非抛异常。
- **后端路由** `tests/server.test.js` 追加 `/api/x-timelines`、`/api/x-timelines/:handle` 用例：未配置 `xDir` 返回空、非法 handle 404、正常 handle 返回完整 tweets。
- **前端** `tweet-card.test.tsx`（新文件）：四种 type 各一个用例，重点断言 `repost` 场景下"转推框架 + 原作者内容"的归属渲染正确（这是设计里唯一有语义反转的地方，最容易回归）；`translated` 为 `null` 时只渲染原文。
- `x-card.test.tsx`：基本渲染 + 空 `latestPreview` 时的降级展示。
- `npm test`（根目录）+ `cd web && npm test` 作为最终回归验证。

## 风险和缓解

- **风险**：`tweet_id` 的 BigInt 排序是本设计里最容易被后续维护者不小心改回 `Number` 比较、悄悄引入精度 bug 的地方。
  **缓解**：测试用真实量级 ID 显式断言排序结果，而不是用小数字 fixture "凑合过测试"；`x-source.js` 里排序函数加一行注释说明为什么必须用 BigInt。
- **风险**：`repost` 类型的 `author_handle` 归属反转容易被忽略，导致渲染成"某人转推了自己"这种语义错误的 UI。
  **缓解**：设计文档和代码注释里都显式记录这张归属表；`tweet-card.test.tsx` 专门覆盖这个场景。
- **风险**：外部 skill（`sync-xtimeline`）未来给归档格式加新字段，scholia 解析逻辑可能因为做了严格字段校验而报错。
  **缓解**：设计上明确"未知字段容忍"——不做 schema 校验，不做字段白名单过滤，只依赖已知的 11 个字段渲染，新增字段会被安全忽略。
