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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-vs-'));
  const workDir = path.join(tmp, 'work');
  fs.mkdirSync(workDir, { recursive: true });

  // Create two video tasks
  const task1 = 'abc123def456';
  const task2 = 'zzz999qqq111';
  for (const [id, meta] of [
    [task1, { id: task1, url: 'https://yt.com/1', title: 'First Video', uploader: 'Chan A', upload_date: '20240101', duration: '300', mode: 'media', ts: '2024-01-01T00:00:00.000Z' }],
    [task2, { id: task2, url: 'https://yt.com/2', title: 'Second Video', uploader: 'Chan B', duration: '600', mode: 'audio', ts: '2024-02-01T00:00:00.000Z' }],
  ]) {
    fs.mkdirSync(path.join(workDir, id, 'writing'), { recursive: true });
    fs.mkdirSync(path.join(workDir, id, 'media'), { recursive: true });
    fs.mkdirSync(path.join(workDir, id, 'transcript'), { recursive: true });
    fs.writeFileSync(path.join(workDir, id, 'meta.json'), JSON.stringify(meta));
  }

  // Add article dir (should be skipped)
  fs.mkdirSync(path.join(workDir, 'article-intro'), { recursive: true });

  // Add content file for task1
  fs.writeFileSync(path.join(workDir, task1, 'writing', 'article.md'), '# Hello\n\nWorld');
  fs.writeFileSync(path.join(workDir, task1, 'writing', 'summary.md'), '# Summary\n\nShort');
  fs.writeFileSync(path.join(workDir, task1, 'transcript', 'original_zh.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello');

  const { isVideoId, listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent } = require('../server/video-source');

  await test('isVideoId rejects article- prefix', () => {
    assert.equal(isVideoId('article-foo'), false);
    assert.equal(isVideoId('abc123def456'), true);
  });

  await test('listVideos returns two entries sorted by updatedAt', async () => {
    const videos = await listVideos(workDir);
    assert.equal(videos.length, 2);
    // task2 has later ts
    assert.equal(videos[0].id, task2);
    assert.equal(videos[1].id, task1);
    assert.equal(videos[1].title, 'First Video');
    assert.equal(videos[1].url, 'https://yt.com/1');
  });

  await test('listVideos sorts by occurrence date, not file mtime', async () => {
    // task3 written last (newest mtime) but has the oldest upload_date-derived date
    const task3 = 'old000video999';
    fs.mkdirSync(path.join(workDir, task3, 'writing'), { recursive: true });
    fs.mkdirSync(path.join(workDir, task3, 'media'), { recursive: true });
    fs.mkdirSync(path.join(workDir, task3, 'transcript'), { recursive: true });
    fs.writeFileSync(path.join(workDir, task3, 'meta.json'), JSON.stringify({
      id: task3, url: 'https://yt.com/3', title: 'Oldest Video', uploader: 'Chan C',
      upload_date: '20200101', duration: '100', mode: 'media',
    }));
    const videos = await listVideos(workDir);
    assert.equal(videos.length, 3);
    assert.equal(videos[0].id, task2); // ts 2024-02-01
    assert.equal(videos[1].id, task1); // ts 2024-01-01
    assert.equal(videos[2].id, task3); // upload_date 2020-01-01, despite newest mtime
    fs.rmSync(path.join(workDir, task3), { recursive: true, force: true });
  });

  await test('listVideos returns empty array for missing workDir', async () => {
    const videos = await listVideos('/nonexistent/path');
    assert.deepEqual(videos, []);
  });

  await test('getVideoTask returns BackendTask shape', async () => {
    const t = await getVideoTask(task1, workDir);
    assert.ok(t);
    assert.equal(t.task_id, task1);
    assert.equal(t.status, 'completed');
    assert.equal(t.meta.title, 'First Video');
    assert.equal(t.meta.url, 'https://yt.com/1');
    assert.equal(t.meta.mode, 'media');
  });

  await test('getVideoTask returns null for missing task', async () => {
    const t = await getVideoTask('nonexistent', workDir);
    assert.equal(t, null);
  });

  await test('getVideoMediaInfo reports existing files', async () => {
    // No files yet
    const info = await getVideoMediaInfo(task1, workDir);
    assert.equal(info.video.exists, false);
    assert.equal(info.audio.exists, false);
    // Create video file
    fs.writeFileSync(path.join(workDir, task1, 'media', 'video.mp4'), 'fake');
    const info2 = await getVideoMediaInfo(task1, workDir);
    assert.equal(info2.video.exists, true);
    assert.equal(info2.audio.exists, false);
  });

  await test('getVideoSubtitles returns VTT track', async () => {
    const result = await getVideoSubtitles(task1, workDir);
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].lang, 'zh');
    assert.ok(result.tracks[0].vtt.includes('WEBVTT'));
  });

  await test('getVideoSubtitles returns empty tracks when none exist', async () => {
    const result = await getVideoSubtitles(task2, workDir);
    assert.equal(result.tracks.length, 0);
  });

  await test('getVideoContent returns article markdown', async () => {
    const md = await getVideoContent(task1, workDir, 'article');
    assert.ok(md.includes('# Hello'));
  });

  await test('getVideoContent returns summary markdown', async () => {
    const md = await getVideoContent(task1, workDir, 'summary');
    assert.ok(md.includes('# Summary'));
  });

  await test('getVideoContent returns null for missing file', async () => {
    const md = await getVideoContent(task2, workDir, 'article');
    assert.equal(md, null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
