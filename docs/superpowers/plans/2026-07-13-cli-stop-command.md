# CLI Stop Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scholia stop` CLI command that reliably shuts down a running `scholia serve` instance from any terminal, using a PID marker file.

**Architecture:** `serve` writes `{pid, port, startedAt}` to `~/.config/scholia/running.json` on successful startup and deletes it on clean shutdown (SIGINT/SIGTERM). `serve` refuses to start if that file points to a still-alive process. `stop` reads the file, verifies the PID is alive, sends SIGTERM, and cleans up the file.

**Tech Stack:** Node.js `fs`, `process.kill`, `child_process.spawn` (tests only). No new dependencies.

Design spec: `docs/superpowers/specs/2026-07-13-cli-stop-command-design.md`

## Global Constraints

- Marker file path: `~/.config/scholia/running.json`, in the same directory as `settings.conf` (derived from `getConfigPath()`, so it respects the `SCHOLIA_CONFIG_FILE` env var).
- Marker file content: `{ "pid": <number>, "port": <number>, "startedAt": "<ISO 8601 string>" }`.
- Single-instance design only — no support for tracking multiple concurrent `serve` processes.
- Shutdown signal is `SIGTERM`.
- No Windows-specific code paths — Node's `process.kill`/signal-0 probing already works cross-platform per the design spec's risk analysis.

---

### Task 1: Running-file helpers in `cli/config.js`

**Files:**
- Modify: `cli/config.js:55` (before `module.exports`)
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `getRunningFilePath(): string`, `readRunningInfo(runningPath?: string): {pid:number,port:number,startedAt:string}|null`, `writeRunningInfo(info: {pid:number,port:number,startedAt:string}, runningPath?: string): void`, `clearRunningInfo(runningPath?: string): void` — all exported from `cli/config.js`, all default their path argument to `getRunningFilePath()` (mirrors the existing `readValue(key, cfgPath = getConfigPath())` pattern in this file).

- [ ] **Step 1: Write the failing tests**

Open `tests/config.test.js`. Insert the following new `await test(...)` blocks right before the final `console.log(\`\n${passed} passed, ${failed} failed\`);` line:

```js
  await test('writeRunningInfo creates file and readRunningInfo reads it back', () => {
    const { readRunningInfo, writeRunningInfo } = require('../cli/config');
    const runningPath = path.join(tmp, 'running.json');
    writeRunningInfo({ pid: 123, port: 7654, startedAt: '2026-01-01T00:00:00.000Z' }, runningPath);
    assert.deepEqual(readRunningInfo(runningPath), { pid: 123, port: 7654, startedAt: '2026-01-01T00:00:00.000Z' });
  });

  await test('clearRunningInfo removes file, readRunningInfo then returns null', () => {
    const { readRunningInfo, writeRunningInfo, clearRunningInfo } = require('../cli/config');
    const runningPath = path.join(tmp, 'running2.json');
    writeRunningInfo({ pid: 456, port: 7655, startedAt: '2026-01-01T00:00:00.000Z' }, runningPath);
    clearRunningInfo(runningPath);
    assert.equal(readRunningInfo(runningPath), null);
  });

  await test('readRunningInfo returns null when file missing', () => {
    const { readRunningInfo } = require('../cli/config');
    assert.equal(readRunningInfo(path.join(tmp, 'absent-running.json')), null);
  });

  await test('readRunningInfo returns null for corrupted JSON', () => {
    const { readRunningInfo } = require('../cli/config');
    const runningPath = path.join(tmp, 'corrupt-running.json');
    fs.writeFileSync(runningPath, '{not valid json');
    assert.equal(readRunningInfo(runningPath), null);
  });

  await test('getRunningFilePath derives from config path directory', () => {
    process.env.SCHOLIA_CONFIG_FILE = cfgPath;
    const { getRunningFilePath } = require('../cli/config');
    assert.equal(getRunningFilePath(), path.join(path.dirname(cfgPath), 'running.json'));
    delete process.env.SCHOLIA_CONFIG_FILE;
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/config.test.js`
Expected: The 5 new tests FAIL with errors like `readRunningInfo is not a function` (the existing tests above them still pass).

- [ ] **Step 3: Implement the helpers**

In `cli/config.js`, insert this block immediately before the `module.exports` line (currently line 55):

```js
function getRunningFilePath() {
  return path.join(path.dirname(getConfigPath()), 'running.json');
}

function readRunningInfo(runningPath = getRunningFilePath()) {
  try {
    return JSON.parse(fs.readFileSync(runningPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeRunningInfo(info, runningPath = getRunningFilePath()) {
  fs.mkdirSync(path.dirname(runningPath), { recursive: true });
  fs.writeFileSync(runningPath, JSON.stringify(info), 'utf8');
}

function clearRunningInfo(runningPath = getRunningFilePath()) {
  try { fs.unlinkSync(runningPath); } catch {}
}
```

Then update the `module.exports` line to:

```js
module.exports = { readValue, writeValue, readConfig, getConfigPath, DEFAULT_CONFIG_PATH, getRunningFilePath, readRunningInfo, writeRunningInfo, clearRunningInfo };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/config.test.js`
Expected: `11 passed, 0 failed` (6 pre-existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add cli/config.js tests/config.test.js
git commit -m "feat: add running-file helpers to cli/config.js"
```

---

### Task 2: `serve` writes and cleans up the running-file

**Files:**
- Modify: `cli/index.js:1-45`
- Test: `tests/integration.test.js`

**Interfaces:**
- Consumes: `readRunningInfo`, `writeRunningInfo`, `clearRunningInfo` from `./config` (Task 1).
- Produces: `isProcessAlive(pid: number): boolean` (module-local helper in `cli/index.js`, reused by Task 3 and Task 4).

- [ ] **Step 1: Write the failing test**

Open `tests/integration.test.js`. Insert this new `await test(...)` block right before the final `console.log(\`\n${passed} passed, ${failed} failed\`);` line:

```js
  await test('scholia serve writes running.json on start and removes it on SIGTERM', async () => {
    const runningPath = path.join(tmp, 'running.json');
    const srv = spawn(process.execPath, [CLI, 'serve', '--port', '17655'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    try {
      await new Promise((resolve, reject) =>
        waitForServer('http://127.0.0.1:17655/healthz', 5000, resolve, reject)
      );
      const info = JSON.parse(fs.readFileSync(runningPath, 'utf8'));
      assert.equal(info.pid, srv.pid);
      assert.equal(info.port, 17655);
      const exitPromise = new Promise(r => srv.on('close', r));
      srv.kill('SIGTERM');
      await exitPromise;
      assert.equal(fs.existsSync(runningPath), false);
    } finally {
      if (!srv.killed) srv.kill();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration.test.js`
Expected: New test FAILS — `running.json` is never created (`ENOENT` reading it), because `serve` doesn't write it yet.

- [ ] **Step 3: Implement running-file write/cleanup in `serve`**

In `cli/index.js`, change the import line (currently line 6):

```js
const { readConfig, writeValue, readValue } = require('./config');
```

to:

```js
const { readConfig, writeValue, readValue, readRunningInfo, writeRunningInfo, clearRunningInfo } = require('./config');
```

Add this helper right after the `openBrowser` function (currently lines 9-14):

```js
function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
```

Replace the `server.listen(...)` call (currently lines 40-44):

```js
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}?token=${token}`;
    console.log(`Scholia running at ${url}`);
    if (shouldOpen) openBrowser(url);
  });
```

with:

```js
  server.listen(port, '127.0.0.1', () => {
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

(The "refuse to start if another instance is alive" check is added in Task 3 — this task only covers the write-on-start / clean-up-on-signal behavior.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/integration.test.js`
Expected: All tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add cli/index.js tests/integration.test.js
git commit -m "feat: write and clean up running-file in scholia serve"
```

---

### Task 3: `serve` refuses to start when another instance is alive

**Files:**
- Modify: `cli/index.js` (the `server.listen` callback added in Task 2)
- Test: `tests/integration.test.js`

**Interfaces:**
- Consumes: `readRunningInfo`, `isProcessAlive` (both already in scope in `cli/index.js` from Task 2).

- [ ] **Step 1: Write the failing test**

Insert this new `await test(...)` block into `tests/integration.test.js`, right after the test added in Task 2 (and still before the final summary `console.log`):

```js
  await test('scholia serve refuses to start when another instance is already running', async () => {
    const srv1 = spawn(process.execPath, [CLI, 'serve', '--port', '17656'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    try {
      await new Promise((resolve, reject) =>
        waitForServer('http://127.0.0.1:17656/healthz', 5000, resolve, reject)
      );
      const srv2 = spawn(process.execPath, [CLI, 'serve', '--port', '17657'], {
        env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
      });
      let stderr = '';
      srv2.stderr.on('data', d => { stderr += d; });
      const code2 = await new Promise(r => srv2.on('close', r));
      assert.equal(code2, 1);
      assert.match(stderr, /already running/);
    } finally {
      const exitPromise = new Promise(r => srv1.on('close', r));
      srv1.kill();
      await exitPromise;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration.test.js`
Expected: New test FAILS — `srv2` currently starts successfully (exit code from `.kill()`/never checked for 1), because there's no already-running check yet.

- [ ] **Step 3: Implement the already-running check**

In `cli/index.js`, update the `server.listen(...)` callback from Task 2 to check for an existing live instance before writing the new running-file:

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/integration.test.js`
Expected: All tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add cli/index.js tests/integration.test.js
git commit -m "feat: refuse scholia serve startup when another instance is alive"
```

---

### Task 4: `scholia stop` command

**Files:**
- Modify: `cli/index.js:46-70` (insert new branch before the final `else`, update usage text)
- Test: `tests/integration.test.js`

**Interfaces:**
- Consumes: `readRunningInfo`, `clearRunningInfo`, `isProcessAlive` (already in scope in `cli/index.js`).

- [ ] **Step 1: Write the failing tests**

Insert these three new `await test(...)` blocks into `tests/integration.test.js`, right after the test added in Task 3 (still before the final summary `console.log`):

```js
  await test('scholia stop stops a running instance', async () => {
    const runningPath = path.join(tmp, 'running.json');
    const srv = spawn(process.execPath, [CLI, 'serve', '--port', '17658'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    try {
      await new Promise((resolve, reject) =>
        waitForServer('http://127.0.0.1:17658/healthz', 5000, resolve, reject)
      );
      const exitPromise = new Promise(r => srv.on('close', r));
      const stop = spawn(process.execPath, [CLI, 'stop'], {
        env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
      });
      let out = '';
      stop.stdout.on('data', d => { out += d; });
      const stopCode = await new Promise(r => stop.on('close', r));
      assert.equal(stopCode, 0);
      assert.match(out, /Stopped scholia/);
      await exitPromise;
      assert.equal(fs.existsSync(runningPath), false);
    } finally {
      if (!srv.killed) srv.kill();
    }
  });

  await test('scholia stop reports not running when no instance is active', async () => {
    const stop = spawn(process.execPath, [CLI, 'stop'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    let out = '';
    stop.stdout.on('data', d => { out += d; });
    const code = await new Promise(r => stop.on('close', r));
    assert.equal(code, 0);
    assert.match(out, /not running/);
  });

  await test('scholia stop cleans up a stale PID file', async () => {
    const runningPath = path.join(tmp, 'running.json');
    const dead = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = dead.pid;
    await new Promise(r => dead.on('close', r));
    fs.writeFileSync(runningPath, JSON.stringify({ pid: deadPid, port: 17659, startedAt: new Date(0).toISOString() }));
    const stop = spawn(process.execPath, [CLI, 'stop'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    let out = '';
    stop.stdout.on('data', d => { out += d; });
    const code = await new Promise(r => stop.on('close', r));
    assert.equal(code, 0);
    assert.match(out, /stale PID file removed/);
    assert.equal(fs.existsSync(runningPath), false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/integration.test.js`
Expected: The 3 new tests FAIL — `scholia stop` is not a recognized command yet, so they hit the `Unknown command` branch (exit code 1) instead of the expected messages/exit code 0.

- [ ] **Step 3: Implement the `stop` command**

In `cli/index.js`, insert a new `else if` branch between the existing `config` branch and the final `else` (currently around line 66-70):

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

} else {
  console.error(`Unknown command: ${cmd}\nUsage:\n  scholia serve [--port N] [--open]\n  scholia stop\n  scholia config set <key> <value>\n  scholia config get <key>`);
  process.exit(1);
}
```

(This replaces the existing final `else` block — the usage text gains the `scholia stop` line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/integration.test.js`
Expected: All tests pass.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: All test files pass (config, video-source, article-source, server, integration).

- [ ] **Step 6: Commit**

```bash
git add cli/index.js tests/integration.test.js
git commit -m "feat: add scholia stop command"
```
