'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

function waitForServer(url, timeout, resolve, reject, start = Date.now()) {
  http.get(url, (res) => {
    if (res.statusCode === 200) resolve();
    else if (Date.now() - start > timeout) reject(new Error('server timeout'));
    else setTimeout(() => waitForServer(url, timeout, resolve, reject, start), 200);
  }).on('error', () => {
    if (Date.now() - start > timeout) reject(new Error('server timeout'));
    else setTimeout(() => waitForServer(url, timeout, resolve, reject, start), 200);
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-int-'));
  const cfgPath = path.join(tmp, 'settings.conf');
  const workDir = path.join(tmp, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const CLI = path.join(__dirname, '..', 'cli', 'index.js');

  await test('scholia config set and get', async () => {
    const set = spawn(process.execPath, [CLI, 'config', 'set', 'work-dir', workDir], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    const setCode = await new Promise(r => set.on('close', r));
    assert.equal(setCode, 0, 'config set should exit 0');
    const get = spawn(process.execPath, [CLI, 'config', 'get', 'work-dir'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    let out = '';
    get.stdout.on('data', d => { out += d; });
    await new Promise(r => get.on('close', r));
    assert.equal(out.trim(), workDir);
  });

  await test('scholia serve starts and responds to /healthz', async () => {
    const srv = spawn(process.execPath, [CLI, 'serve', '--port', '17654'], {
      env: { ...process.env, SCHOLIA_CONFIG_FILE: cfgPath },
    });
    try {
      await new Promise((resolve, reject) =>
        waitForServer('http://127.0.0.1:17654/healthz', 5000, resolve, reject)
      );
      const res = await fetch('http://127.0.0.1:17654/healthz');
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
    } finally {
      srv.kill();
    }
  });

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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
