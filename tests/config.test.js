'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-cfg-'));
  const cfgPath = path.join(tmp, 'settings.conf');

  await test('readValue returns null when file missing', () => {
    const { readValue } = require('../cli/config');
    assert.equal(readValue('WORK_DIR', path.join(tmp, 'absent.conf')), null);
  });

  await test('writeValue creates file and readValue reads it back', () => {
    const { readValue, writeValue } = require('../cli/config');
    writeValue('WORK_DIR', '/tmp/work', cfgPath);
    assert.equal(readValue('WORK_DIR', cfgPath), '/tmp/work');
  });

  await test('writeValue overwrites existing key', () => {
    const { readValue, writeValue } = require('../cli/config');
    writeValue('WORK_DIR', '/tmp/work2', cfgPath);
    assert.equal(readValue('WORK_DIR', cfgPath), '/tmp/work2');
  });

  await test('readConfig returns both keys', () => {
    const { readConfig, writeValue } = require('../cli/config');
    writeValue('CONTENT_DIR', '/tmp/content', cfgPath);
    const cfg = readConfig(cfgPath);
    assert.equal(cfg.workDir, '/tmp/work2');
    assert.equal(cfg.contentDir, '/tmp/content');
  });

  await test('readConfig returns null for missing keys', () => {
    const { readConfig } = require('../cli/config');
    const emptyPath = path.join(tmp, 'empty.conf');
    fs.writeFileSync(emptyPath, '');
    const cfg = readConfig(emptyPath);
    assert.equal(cfg.workDir, null);
    assert.equal(cfg.contentDir, null);
  });

  await test('expandPath expands ~ prefix', () => {
    const { readConfig, writeValue } = require('../cli/config');
    const p = path.join(tmp, 'tilde.conf');
    writeValue('WORK_DIR', '~/myvdl', p);
    const cfg = readConfig(p);
    assert.equal(cfg.workDir, path.join(os.homedir(), 'myvdl'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
