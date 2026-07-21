# Scholia

本地优先的知识注解工具。在你已有的内容（VDL 视频、Obsidian 文章）上直接高亮和做笔记，注解与原文绑定，永远存在本地。

## 安装

未发布到 npm registry，从源码仓库打包安装（安装后是独立副本，仓库目录可以删除/移动，不影响运行）：

```bash
cd ~/Projects/scholia
npm install
npm run release:local   # npm pack + 全局安装 tarball，装完自动清理 .tgz
```

之后改了代码想更新全局安装，重新执行 `npm run release:local` 即可。

本地开发（不打包，直接跑仓库里的代码，改代码后端立即生效）：

```bash
cd ~/Projects/scholia
npm install
npm link   # 将 scholia 命令软链接到 $PATH，指向本仓库
```

## 快速开始

```bash
# 配置视频目录（VDL 的 work 目录）
scholia config set work-dir ~/vdl-work

# 配置文章目录（Obsidian vault 或任意 Markdown 目录）
scholia config set content-dir ~/notes/articles

# 启动，浏览器自动打开
scholia serve --open
```

打开 `http://localhost:7654` 即可使用。

## 命令参考

### `scholia serve`

启动本地 HTTP 服务器并提供 Web UI。

```
scholia serve [--port <N>] [--open]
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--port <N>` | `7654` | 监听端口 |
| `--open` | 关 | 启动后自动打开浏览器 |

启动后终端会打印带 token 的访问地址：

```
Scholia running at http://localhost:7654?token=<token>
```

指定端口已被占用时不会报错退出，会自动改用 OS 分配的空闲端口，并打印提示：

```
Port 7654 was in use; using 65243 instead.
```

### `scholia start`

在后台启动，不占用当前终端 —— 关闭终端窗口不会停止服务。参数、端口占用后的自动改端口行为都和 `scholia serve` 一致。

```
scholia start [--port <N>] [--open]
```

标准输出/错误重定向到 `~/.config/scholia/scholia.log`，启动确认后打印：

```
Scholia started (pid <pid>, port <port>). Logs: ~/.config/scholia/scholia.log
```

用 `scholia stop` 停止。

### `scholia stop`

停止正在运行的 scholia 实例。

```
scholia stop
```

- 未运行：打印 `Scholia is not running.`
- 已运行：发送 `SIGTERM` 后打印 `Stopped scholia (pid <pid>, port <port>).`
- 标记文件过期（进程已不存在）：清理后打印 `Scholia is not running (stale PID file removed).`

### `scholia config`

读写配置项，配置持久化到 `~/.config/scholia/settings.conf`。

```bash
scholia config set work-dir <path>      # 设置视频目录
scholia config set content-dir <path>   # 设置文章目录
scholia config get work-dir             # 查看当前值
scholia config get content-dir
```

支持的配置键：

| 键 | 说明 |
|----|------|
| `work-dir` | VDL work 目录路径（包含各 taskId 子目录） |
| `content-dir` | Markdown 文章目录路径 |

## 内容协议

Scholia 消费两种内容格式，不负责生产内容。

### 视频 — VDL 格式

由 [VDL](../Video-Learner/) 的 `vdl <url>` 生产。Scholia 读取：

```
<work-dir>/
  <taskId>/
    meta.json        # 标题、来源 URL、时长
    article.md       # AI 生成的文章（可选）
    subtitles.json   # 字幕（可选）
```

Scholia 写入（不干扰 VDL）：

```
<work-dir>/
  <taskId>/
    highlights.json  # 高亮记录
    notes.json       # 笔记记录
```

### 文章 — Obsidian vault 格式

任意来源的 Markdown 文件，支持子目录：

```
<content-dir>/
  intro.md
  deep-dive.md
  2024/react-tips.md   # slug: "2024-react-tips"
```

frontmatter 可选：

```markdown
---
title: React 并发模式深度解析
date: 2024-03-15
---
```

注解与文章文件同级存放，不污染 vault 其他内容：

```
<content-dir>/
  2024/
    react-tips.md
    react-tips/            # Scholia 自动创建的同名目录
      highlights.json
      notes.json
```

Scholia 只在这个目录里创建/读写 `highlights.json`、`notes.json` 这两个文件名，目录里已有的其他内容（比如 Obsidian 附件文件夹）一律不动。

#### 双语抓取目录（如 extract-url 生成的内容）

`content-dir` 下若某个目录包含 `meta.json`，会被当作一整篇文章，不按普通 Markdown 递归展开：

```
<content-dir>/
  <hash>/
    meta.json             # title、source_url、fetched_at 等
    Origin/<标题>.md       # 原文
    Translation/<标题>.md  # 译文
    Image/*.png
```

- 只暴露 `Translation/*.md`；还没翻译完成时回退用 `Origin/*.md`，`Origin` 不会和 `Translation` 同时列出。
- slug 直接用 `<hash>` 目录名，不拼接文件路径。
- 文章正文 frontmatter 缺 `title`/日期时，回退读 `meta.json` 的 `title`/`fetched_at`。
- 注解按上面同样的规则，落在实际被选中的那个 `.md` 文件同级（例如 `<hash>/Translation/<标题>/{highlights.json,notes.json}`）。

## 架构

```
scholia serve
  └── Koa HTTP Server (127.0.0.1:<port>)
        ├── GET  /healthz
        ├── GET  /api/tasks              # 视频列表
        ├── GET  /api/articles           # 文章列表
        ├── GET  /api/tasks/:id          # 详情
        ├── GET  /api/tasks/:id/media/:kind
        ├── GET  /api/tasks/:id/subtitles
        ├── GET  /api/tasks/:id/result/content
        ├── GET|POST|DELETE /api/tasks/:id/highlights
        ├── GET|POST|PATCH|DELETE /api/tasks/:id/notes
        └── static → web/dist (React SPA)
```

- 零 SQLite 依赖，零 orchestrator 依赖
- 所有数据来自文件系统直读
- Bearer token 认证（每次启动随机生成）

## 开发

```bash
npm install
npm test        # 49 个测试，无外部依赖

# 单独运行某个测试文件
node tests/server.test.js
```

前端（如需修改）：

```bash
cd web
npm install
npm run dev     # 开发服务器
npm run build   # 生产构建 → web/dist/
```

## 非目标

- 不下载视频、不转录、不调用 AI（那是 VDL 的工作）
- 不云同步、不多设备
- 不全文检索
- 不是笔记编辑器
