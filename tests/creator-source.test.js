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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-cs-'));
  const knowledgeRoot = path.join(tmp, 'knowledge');
  const workDir = path.join(knowledgeRoot, 'videos', 'work');
  fs.mkdirSync(workDir, { recursive: true });

  const rosterHome = path.join(tmp, 'home');
  fs.mkdirSync(path.join(rosterHome, '.hskill', 'roster'), { recursive: true });
  process.env.HOME = rosterHome; // creator-source.js resolves ~/.hskill/roster via os.homedir()

  function writeCreatorsIndex(creators) {
    fs.writeFileSync(
      path.join(knowledgeRoot, 'videos', 'creators.json'),
      JSON.stringify({ schema_version: 1, built_at: 'x', scanned: { entities: 0 }, creators, unresolved: [] })
    );
  }

  function writeRegistry(creators) {
    fs.writeFileSync(
      path.join(rosterHome, '.hskill', 'roster', 'registry.json'),
      JSON.stringify({ schema_version: 1, creators })
    );
    fs.writeFileSync(
      path.join(rosterHome, '.hskill', 'roster', 'config.json'),
      JSON.stringify({ DATA_DIR: path.join(rosterHome, '.hskill', 'roster') })
    );
  }

  const { getCreator, normalizeHandle } = require('../server/creator-source');

  await test('normalizeHandle strips @ and lowercases', () => {
    assert.equal(normalizeHandle('@Alejandro_AO'), 'alejandro_ao');
    assert.equal(normalizeHandle('alejandro_ao'), 'alejandro_ao');
  });

  await test('getCreator is case-insensitive on the incoming key (mirrors a mixed-case lookup)', async () => {
    writeCreatorsIndex([
      { key: 'mattpockuk', display_name: 'Matt Pocock', channel_id: 'UC_MP', uploader_url: 'https://youtube.com/@mattpockuk',
        videos: [{ task_id: 'm1', title: 'MV1', upload_date: '2026-05-01', duration: '150' }] },
    ]);
    writeRegistry([]);
    const lower = await getCreator('mattpockuk', workDir);
    const mixed = await getCreator('MattPockUK', workDir);
    assert.ok(lower);
    assert.deepEqual(mixed, lower);
    assert.equal(mixed.key, 'mattpockuk');
  });

  await test('getCreator returns null when the key is not in the index', async () => {
    writeCreatorsIndex([]);
    writeRegistry([]);
    const result = await getCreator('nobody', workDir);
    assert.equal(result, null);
  });

  await test('getCreator returns watched=false when not in the registry', async () => {
    writeCreatorsIndex([
      { key: 'alejandro_ao', display_name: 'Alejandro AO', channel_id: 'UC1', uploader_url: 'https://youtube.com/@alejandro_ao',
        videos: [{ task_id: 't1', title: 'V1', upload_date: '2026-06-01', duration: '120' }] },
    ]);
    writeRegistry([]);
    const result = await getCreator('alejandro_ao', workDir);
    assert.equal(result.watched, false);
    assert.equal(result.creator_id, null);
    assert.equal(result.videos.length, 1);
  });

  await test('getCreator returns watched=true immediately after a registry add (no rebuild needed)', async () => {
    writeCreatorsIndex([
      { key: 'alejandro_ao', display_name: 'Alejandro AO', channel_id: 'UC1', uploader_url: 'https://youtube.com/@alejandro_ao',
        videos: [{ task_id: 't1', title: 'V1', upload_date: '2026-06-01', duration: '120' }] },
    ]);
    writeRegistry([
      { id: 'alejandro_ao', display_name: 'Alejandro AO', aliases: [], placeholder: false, added_at: '2026-09-15',
        channels: [{ platform: 'youtube', handle: '@alejandro_ao', url: 'https://youtube.com/@alejandro_ao' }] },
    ]);
    const result = await getCreator('alejandro_ao', workDir);
    assert.equal(result.watched, true);
    assert.equal(result.creator_id, 'alejandro_ao');
  });

  await test('getCreator folds a merged handle\'s videos into the surviving id (criterion #6)', async () => {
    // Two separate creators.json entries — same person, two different YouTube
    // handles over time — get merged in the registry into one record whose
    // channels[] lists both.
    writeCreatorsIndex([
      { key: 'old_handle', display_name: 'Old Name', channel_id: 'UC_OLD', uploader_url: 'https://youtube.com/@old_handle',
        videos: [{ task_id: 't1', title: 'Old Video', upload_date: '2025-01-01', duration: '100' }] },
      { key: 'new_handle', display_name: 'New Name', channel_id: 'UC_NEW', uploader_url: 'https://youtube.com/@new_handle',
        videos: [{ task_id: 't2', title: 'New Video', upload_date: '2026-01-01', duration: '200' }] },
    ]);
    writeRegistry([
      { id: 'new_handle', display_name: 'New Name', aliases: ['old_handle'], placeholder: false, added_at: '2026-09-15',
        channels: [
          { platform: 'youtube', handle: '@new_handle', url: 'https://youtube.com/@new_handle' },
          { platform: 'youtube', handle: '@old_handle', url: 'https://youtube.com/@old_handle' },
        ] },
    ]);

    const viaSurvivingKey = await getCreator('new_handle', workDir);
    assert.equal(viaSurvivingKey.watched, true);
    assert.equal(viaSurvivingKey.creator_id, 'new_handle');
    assert.deepEqual(new Set(viaSurvivingKey.videos.map((v) => v.task_id)), new Set(['t1', 't2']));

    const viaOldKey = await getCreator('old_handle', workDir);
    assert.equal(viaOldKey.watched, true);
    assert.equal(viaOldKey.creator_id, 'new_handle');
    assert.deepEqual(new Set(viaOldKey.videos.map((v) => v.task_id)), new Set(['t1', 't2']));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
