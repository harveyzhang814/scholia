# CLI `stop` 命令 设计文档

## 概述

`scholia serve` 目前是纯前台进程：启动后阻塞终端，唯一的关闭方式是 Ctrl+C 或手动 `kill`。本设计为 CLI 新增 `scholia stop` 命令，配合 `serve` 启动时写入的 PID 标记文件，实现"从任意终端可靠关闭正在运行的 scholia 实例"。

## 背景

- `cli/index.js:19-44` 的 `serve` 子命令用 `http.createServer(app.callback())` 监听端口，进程本身不做任何后台化（daemonize）处理，也不记录自己的 PID。
- `cli/config.js` 已有读写 `~/.config/scholia/settings.conf` 的模式（`getConfigPath()`、`readValue`/`writeValue`），可以复用同一个配置目录存放运行时标记文件。
- 项目定位是本地个人工具（CLAUDE.md: "local-first annotation tool"），不需要支持多实例并发或跨机器场景，设计以单实例为前提。

## 用户故事

- 作为用户，`scholia serve --open` 跑起来之后，我想在另一个终端标签执行 `scholia stop` 就能关掉它，不用切回原终端按 Ctrl+C。
- 作为用户，如果我没有在跑 scholia，执行 `scholia stop` 应该明确告诉我"没有在运行"，而不是报错或者误杀无关进程。
- 作为用户，如果 scholia 进程是被 `kill -9` 之类的方式异常终止的（标记文件没来得及清理），下次 `scholia stop` 或 `scholia serve` 不应该被这个过期文件卡住。

## 架构设计

### 1. 标记文件（`cli/config.js`）

新增两个函数，与现有 `getConfigPath()` 并列：

```js
function getRunningFilePath() {
  return path.join(path.dirname(getConfigPath()), 'running.json');
}

function readRunningInfo() {
  try {
    return JSON.parse(fs.readFileSync(getRunningFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeRunningInfo(info) {
  fs.mkdirSync(path.dirname(getRunningFilePath()), { recursive: true });
  fs.writeFileSync(getRunningFilePath(), JSON.stringify(info), 'utf8');
}

function clearRunningInfo() {
  try { fs.unlinkSync(getRunningFilePath()); } catch {}
}
```

- 文件路径固定为 `~/.config/scholia/running.json`（与 `settings.conf` 同目录，支持 `SCHOLIA_CONFIG_FILE` 环境变量间接改变目录的场景，因为两者都基于 `getConfigPath()` 派生目录）。
- 内容格式：`{ "pid": 12345, "port": 7654, "startedAt": "<ISO 时间戳>" }`。
- `module.exports` 新增导出 `getRunningFilePath`、`readRunningInfo`、`writeRunningInfo`、`clearRunningInfo`。

### 2. `serve` 启动流程改动（`cli/index.js`）

在 `server.listen` 的成功回调里，写入标记文件之前先检查是否已有实例在跑：

```js
server.listen(port, '127.0.0.1', () => {
  const existing = readRunningInfo();
  if (existing && isProcessAlive(existing.pid)) {
    console.error(`Scholia is already running (pid ${existing.pid}, port ${existing.port}). Run "scholia stop" first.`);
    process.exit(1);
  }
  writeRunningInfo({ pid: process.pid, port, startedAt: new Date().toISOString() });
  const url = `http://localhost:${port}?token=${token}`;
  console.log(`Scholia running at ${url}`);
  if (shouldOpen) openBrowser(url);
});

function shutdown() {
  clearRunningInfo();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

- `isProcessAlive(pid)` 是一个小helper：`try { process.kill(pid, 0); return true; } catch { return false; }`。
- 这个检查发生在 `listen` 成功之后：如果确实已有实例占着这个端口，`server.listen` 本身会先触发 `EADDRINUSE`（已有的 `server.on('error', ...)` 处理），不会走到这里；这里额外处理的是"两个实例监听不同端口，但标记文件指向另一个仍存活的实例"这种情况，避免同一份 `workDir`/`contentDir` 数据被两个进程同时读写。
- 如果标记文件存在但对应进程已死（过期）→ 不报错，直接覆盖写入新文件，正常启动。
- Ctrl+C（SIGINT）或 `kill <pid>`（SIGTERM，`stop` 命令使用的信号）都会先清理标记文件再退出，行为对用户透明——原有的 Ctrl+C 关闭方式不受影响，只是多了清理这一步。

### 3. `stop` 命令（`cli/index.js`）

```js
} else if (cmd === 'stop') {
  const info = readRunningInfo();
  if (!info) {
    console.log('Scholia is not running.');
    process.exit(0);
  }
  if (!isProcessAlive(info.pid)) {
    clearRunningInfo();
    console.log('Scholia is not running (stale PID file removed).');
    process.exit(0);
  }
  process.kill(info.pid, 'SIGTERM');
  clearRunningInfo();
  console.log(`Stopped scholia (pid ${info.pid}, port ${info.port}).`);
  process.exit(0);
}
```

- 加入顶层 `cmd` 分支（与现有 `serve`/`config` 并列），并同步更新 `else` 分支里的 usage 提示文本（`cli/index.js:68`），加上 `scholia stop`。
- `stop` 命令本身不需要知道端口，完全依赖标记文件里记录的 PID。
- 由 `stop` 主动删除标记文件（而不是等 `serve` 进程收到 SIGTERM 后自己清理），因为 `stop` 无法确定 `serve` 进程会在多久之内响应信号并完成清理；`stop` 删除后 `serve` 进程退出时的 `clearRunningInfo()` 是幂等操作（文件不存在时静默忽略），不会冲突。

## 数据流

```
scholia serve
   │ server.listen 成功
   ▼
检查 running.json 是否指向存活进程 → 是：报错退出 / 否（不存在或已死）：继续
   │
   ▼
writeRunningInfo({pid, port, startedAt}) → ~/.config/scholia/running.json
   │
   │ (SIGINT/SIGTERM)
   ▼
clearRunningInfo() → 删除 running.json → process.exit(0)

scholia stop
   │
   ▼
readRunningInfo() → null？→ "not running" 提示，退出
   │ 存在
   ▼
isProcessAlive(pid)？→ 否 → 清理文件，"stale" 提示
   │ 是
   ▼
process.kill(pid, 'SIGTERM') → clearRunningInfo() → "Stopped" 提示
```

## 错误处理

- `readRunningInfo()` 遇到文件不存在或 JSON 解析失败（比如文件被手动改坏）→ 统一按 `null` 处理，等同于"未运行"，不抛异常。
- `process.kill(pid, 'SIGTERM')` 如果目标 PID 在读取和发送信号之间的极短时间窗口内退出（TOCTOU）→ Node 会抛 `ESRCH`，本设计不特殊捕获，属于可接受的边界情况（发生概率极低，且即使报错、下次 `serve` 启动时也会因为标记文件仍指向死进程而被判定为过期并正常覆盖）。
- `serve` 启动时检查到已有存活实例 → 明确报错退出（`process.exit(1)`），不静默覆盖，避免同一份数据被两个进程同时读写。

## 测试策略

- `tests/config.test.js` 新增用例：
  - `writeRunningInfo` / `readRunningInfo` / `clearRunningInfo` 的读写往返：写入后读出内容一致，`clearRunningInfo` 后 `readRunningInfo` 返回 `null`。
  - `readRunningInfo` 对不存在文件、损坏 JSON 文件均返回 `null`（不抛异常）。
- CLI 集成层面手动验证（`npm link` 后）：
  - `scholia serve --port 7655` 启动后，另开终端 `scholia stop`，确认原终端进程退出、打印 `Stopped scholia`，`running.json` 被删除。
  - 未启动任何实例时执行 `scholia stop`，确认打印 `Scholia is not running.`。
  - 手动伪造一个指向不存在 PID 的 `running.json`，执行 `scholia stop`，确认打印 stale 提示并清理文件。
  - `serve` 启动一个实例后，在另一个终端再次 `scholia serve --port 7656`（不同端口），确认第二个实例因检测到已有存活实例而报错退出。
  - Ctrl+C 关闭 `serve` 后确认 `running.json` 已被删除。

## 风险和缓解

- **风险**：`process.kill(pid, signal)` 和 PID 存活性探测（`process.kill(pid, 0)`）都依赖 POSIX 信号语义，Windows 上行为不完全一致（`process.kill` 在 Windows 上不支持除 `SIGKILL`/`SIGTERM` 之外的大部分信号语义，但这两个恰好是本设计用到的）。
  **缓解**：项目当前 `cli/index.js:10-12` 的 `openBrowser` 已经区分了 `darwin`/`win32`/其他平台，说明项目本身考虑跨平台；`process.kill` 和存活探测在 Node 官方文档中对 Windows 有明确支持（`SIGTERM`/信号 0 均可用），不需要额外的平台分支。
- **风险**：如果操作系统在 scholia 进程退出后很快把同一个 PID 复用给另一个无关进程，且用户在这个窗口内执行 `scholia stop`，理论上可能误杀无关进程。
  **缓解**：这个窗口极短（PID 复用通常需要重启大量进程才会发生），且是本设计明确接受的权衡（用户在"验证方式"环节已确认不需要额外的进程身份校验，PID 标记文件本身视为足够可靠的凭证）。
