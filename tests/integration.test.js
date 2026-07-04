'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    await new Promise(r => set.on('close', r));
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
    // Give it 2 seconds to start
    await sleep(2000);
    try {
      const res = await fetch('http://127.0.0.1:17654/healthz');
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
    } finally {
      srv.kill();
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
