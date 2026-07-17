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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
