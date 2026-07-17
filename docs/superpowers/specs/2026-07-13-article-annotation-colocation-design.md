# 文章标注数据与文章文件同目录存放 设计文档

## 概述

文章的 `notes.json`/`highlights.json` 目前存放在 `<work-dir>/article-<slug>/`（`server/paths.js:26-35` 的 `getArticleDirs`），与文章本身所在的 `content-dir`（用户的 Markdown vault）完全分离，违反了"标注应该和它所属的内容放在一起"这一原则。本设计把文章标注改为写入 `content-dir` 内、与文章 `.md` 文件同级的一个同名子目录，文章文件本身的位置/文件名不变。视频的存储模式（`<work-dir>/<taskId>/`，标注与视频资源本就同目录）不受影响。

## 背景

- `server/paths.js:12-35`：`getVideoDirs(workDir, taskId)` 和 `getArticleDirs(workDir, slug)` 都是纯字符串拼接，不碰文件系统。视频的 `taskId` 目录是 Scholia 自己创建和管理的（下载器写入），标注文件放进去符合"同目录"原则；文章没有这样一个"属于 Scholia、属于这篇文章"的目录，`getArticleDirs` 只是在 `work-dir` 里用 slug 现造了一个位置，物理上和文章文件（在 `content-dir`）毫无关系。
- `server/index.js:36-38`：`getPaths(taskId, workDir)` 按 `isArticleId` 分流到两个纯函数，供 4 个 notes 路由（`server/index.js:205-250`）和 3 个 highlights 路由（`server/index.js:172-203`）调用。
- `server/article-source.js:43-47`：`resolveArticleFile(contentDir, slug)` 通过递归扫描 `content-dir`、对每个 `.md` 文件重新计算 slug（`slugFromFilePath`，第 5-7 行）来找到 slug 对应的真实文件路径，目前未导出，只在模块内部使用（`articleFileExists`、`getArticleTask`、`getArticleContent`）。
- 实测环境核查（`~/.config/scholia/settings.conf`）：`content-dir` 与 `work-dir` 分别指向同一 Obsidian vault 下的不同子树。`work-dir` 下现存的唯一 `article-*` 目录（`article-intro/`）是早期测试留下的空壳，`notes.json`/`highlights.json` 均为 `[]`，vault 里也不存在能 slugify 成 `intro` 的文件——**没有真实数据需要迁移**，因此本设计不包含自动迁移逻辑。
- 已核查 `content-dir`（`~/Vault/Product/Reading`）内所有 `.md` 文件，当前没有任何一个与"同名子目录"方案产生命名冲突；但 Obsidian 有"附件保存在与笔记同名子文件夹"的常见默认行为，未来不能排除冲突，设计需要显式处理。

## 目标 / 非目标

**目标**
- 文章的 `notes.json`/`highlights.json` 物理上与该文章的 `.md` 文件同目录（同级子目录）。
- 文章文件本身的路径、文件名、内容完全不受影响。
- 视频的标注存储行为不变。

**非目标**
- 不做旧数据（`work-dir/article-*/`）的自动迁移——已确认无真实数据。
- 不处理"用户在 vault 外部重命名/移动文章文件"后标注目录自动跟随——与现状一致（无状态、不监听 vault），不在本次范围内。
- 不新增针对目录名冲突的用户可见提示/警告 UI。

## 架构设计

### 1. `server/paths.js` — 保留纯函数职责

- 新增纯函数，输入文章文件的绝对路径，输出其标注目录（不做任何 fs 访问）：
  ```js
  function articleAnnotationDir(articleFilePath) {
    const { dir, name } = path.parse(articleFilePath);
    return path.join(dir, name);
  }
  ```
  例：`<content-dir>/2024/react-tips.md` → `<content-dir>/2024/react-tips/`。
- 删除 `getArticleDirs(workDir, slug)`（不再需要，`work-dir` 与文章标注位置无关）。
- `getVideoDirs` 不变。
- `getArticleDirs` 的调用方（`server/index.js`）同步移除。

### 2. `server/article-source.js` — 导出文件解析能力

- 将 `resolveArticleFile(contentDir, slug)` 加入 `module.exports`（第 87 行），供 `server/index.js` 复用，不再是模块私有函数。
- 其余逻辑不变。

### 3. `server/index.js` — `getPaths` 改为异步

```js
const { articleAnnotationDir } = require('./paths');
const { isArticleId, slugFromId, resolveArticleFile, /* ...既有导入 */ } = require('./article-source');

async function getPaths(taskId, workDir, contentDir) {
  if (isArticleId(taskId)) {
    const filePath = await resolveArticleFile(contentDir, slugFromId(taskId));
    if (!filePath) return null;
    const base = articleAnnotationDir(filePath);
    return { base, notes: path.join(base, 'notes.json'), highlights: path.join(base, 'highlights.json') };
  }
  return getVideoDirs(workDir, taskId);
}
```

- 所有调用点（`server/index.js:175/185/197/209/218/233/245`）加 `await`，并传入 `CONTENT_DIR`。
- `getPaths` 对文章返回 `null` 视为「文章不存在」，直接 404——这一步天然覆盖了原本 `assertItemExists` 对文章分支做的存在性检查（`articleFileExists` 内部同样调用 `resolveArticleFile`）。为避免同一个请求内对 `content-dir` 扫描两次，notes/highlights 路由的存在性检查与路径解析合并为一次 `getPaths` 调用：`getPaths` 返回 `null` 即 404，返回非 `null` 即存在，不再对文章分支单独调用 `assertItemExists`。视频分支的 `assertItemExists` 调用方式不变。

### 4. 数据流

```
POST /api/tasks/article-<slug>/notes
        │
        ▼
resolveArticleFile(contentDir, slug)   ← 递归扫描 content-dir，找到 <slug> 对应的 .md 文件
        │
        ▼
articleAnnotationDir(filePath)         ← 纯路径计算，不碰 fs
        │
        ▼
<content-dir>/.../<article-name>/notes.json
        │
        ▼
fs.promises.mkdir(base, {recursive:true})   ← 目录已存在（如 Obsidian 附件目录）时幂等，直接复用
        │
        ▼
writeJson(notes, [...])   ← 原子写：先写 .tmp 再 rename，不变
```

## 边界情况与错误处理

- **标注目录与已有目录同名**（如 Obsidian 附件文件夹）：直接复用该目录，只创建/读写 `notes.json`、`highlights.json` 这两个固定文件名，不遍历、不删除、不修改目录内其他任何文件。
- **同名路径已被一个非目录文件占用**（如 vault 中恰好存在一个无扩展名、名为 `react-tips` 的文件）：`fs.promises.mkdir` 会抛出异常，本设计不做专门捕获/提示，按现有代码风格作为未处理异常向上抛出（500）——与代码库现有的 fs 错误处理方式一致，不为小概率场景新增分支。
- **文章在 vault 中被重命名或删除**：`resolveArticleFile` 找不到匹配文件，`getPaths` 返回 `null`，对应 API 404；旧标注目录变成孤儿，但物理上仍留在 vault 里文章原来的位置附近，用户手动改回文件名即可找回——相比现状（孤儿数据藏在 `work-dir` 里、用户不可见）是行为上的改善，不需要新增检测/迁移代码。
- **性能**：每次文章 notes/highlights 请求仍需要一次 `content-dir` 递归扫描（`resolveArticleFile` 内部的 `findMdFiles`），与现状（`assertItemExists` 已经做这个扫描）持平，通过第 3 节的调用合并避免请求内重复扫描两次。
- **`work-dir` 下的旧 `article-*` 目录**：不再被任何代码路径引用。实现时手动删除现存的 `article-intro/` 空壳测试目录，不写通用清理逻辑。

## 测试策略

- `tests/server.test.js` 现有 fixture（`intro.md` 位于 `contentDir` 根目录，taskId 为 `article-intro`）：
  - 补齐文章 notes CRUD 用例（POST/PATCH/DELETE `/api/tasks/article-intro/notes`），仿照现有视频 notes 用例（第 158-177 行），目前只有文章 highlights CRUD（第 180-188 行），文章 notes 无覆盖。
  - 新增物理位置断言：创建笔记/高亮后，用 `fs.existsSync` 断言文件落在 `path.join(contentDir, 'intro', 'notes.json')`，同时断言 `path.join(workDir, 'article-intro', 'notes.json')` **不**被写入。
  - 新增嵌套路径 fixture（如 `contentDir/2024/react-tips.md`），断言标注目录落在 `contentDir/2024/react-tips/`，与根目录下可能重名的文章互不冲突。
  - 断言创建笔记前后 `intro.md` 文件内容与路径未被改动。
- 视频 notes/highlights 现有用例保持不变，作为"视频行为零回归"对照。
- 均在 `fs.mkdtempSync` 临时目录中运行，不触碰真实 vault。
- `npm test` 作为最终回归验证。

## 风险和缓解

- **风险**：`getPaths` 从同步变异步是一处有一定范围的改动，7 个路由 handler 都要改调用方式。
  **缓解**：改动模式统一（加 `await`、传 `CONTENT_DIR`、`null` 归一到 404），机械且可测试覆盖，风险可控。
- **风险**：Obsidian"附件同名子文件夹"是真实存在的功能，未来可能出现标注目录与用户附件目录同名的情况。
  **缓解**：设计上已明确"只写固定文件名、不碰其他文件"，即使目录被复用也不会破坏用户附件；已核查当前 vault 无此冲突。
- **风险**：不做旧数据迁移，如果之后发现 `work-dir` 下其实还有别的机器/账号写过真实文章标注数据，会造成数据丢失（不可见，非物理删除）。
  **缓解**：本项目是单用户本地工具（配置在 `~/.config/scholia/`），已直接核查当前唯一环境的 `work-dir`，确认只有一个空壳测试目录；旧目录本身不会被删除，只是不再被读取，后续如发现遗漏可手动把 JSON 文件挪到新位置，不需要为此预先写自动化代码。
