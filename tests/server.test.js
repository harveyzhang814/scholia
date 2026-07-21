'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TOKEN = 'server-test-token';

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

async function req(port, method, urlPath, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, opts);
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  return { status: res.status, body: json };
}

(async () => {
  // Setup fixtures
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-srv-'));
  const workDir = path.join(tmp, 'work');
  const contentDir = path.join(tmp, 'content');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });

  const taskId = 'abc123def456';
  fs.mkdirSync(path.join(workDir, taskId, 'writing'), { recursive: true });
  fs.mkdirSync(path.join(workDir, taskId, 'media'), { recursive: true });
  fs.mkdirSync(path.join(workDir, taskId, 'transcript'), { recursive: true });
  fs.writeFileSync(path.join(workDir, taskId, 'meta.json'), JSON.stringify({
    id: taskId, url: 'https://yt.com/v', title: 'Test Video', uploader: 'Chan',
    duration: '120', mode: 'media', ts: '2024-01-01T00:00:00.000Z',
  }));
  fs.writeFileSync(path.join(workDir, taskId, 'writing', 'article.md'), '# Article\n\nContent');
  fs.writeFileSync(path.join(workDir, taskId, 'highlights.json'), JSON.stringify([{ id: 'h1' }, { id: 'h2' }]));
  fs.writeFileSync(path.join(workDir, taskId, 'notes.json'), JSON.stringify([{ id: 'n1' }]));

  // Second video task with no annotation files — verifies the zero-fallback.
  // Older timestamp than `taskId` so it still sorts second (list is newest-first).
  const taskId2 = 'noannotations999';
  fs.mkdirSync(path.join(workDir, taskId2), { recursive: true });
  fs.writeFileSync(path.join(workDir, taskId2, 'meta.json'), JSON.stringify({
    id: taskId2, url: 'https://yt.com/v2', title: 'No Annotations Video',
    mode: 'media', ts: '2023-01-01T00:00:00.000Z',
  }));

  fs.writeFileSync(path.join(contentDir, 'intro.md'), '---\ntitle: Intro\n---\n\n# Hello');
  fs.mkdirSync(path.join(contentDir, '2024'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, '2024', 'tips.md'), '---\ntitle: Tips\n---\n\n# Tips');
  // Pre-seed highlights for the "2024-tips" article, not "intro" — "intro" gets
  // highlights/notes POSTed to it later by the existing CRUD tests (further down
  // this file), and pre-seeding it here would make those tests' "starts at length 1
  // after POST" assertions fail (they'd see length 2 instead). "2024-tips" only gets
  // a *note* POSTed to it later (a different file), so seeding its highlights.json
  // here is safe.
  fs.mkdirSync(path.join(contentDir, '2024', 'tips'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, '2024', 'tips', 'highlights.json'), JSON.stringify([{ id: 'ah1' }]));

  // Bilingual reading entry with a sibling Image/ folder
  fs.mkdirSync(path.join(contentDir, 'hash1', 'Translation'), { recursive: true });
  fs.mkdirSync(path.join(contentDir, 'hash1', 'Image'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'hash1', 'meta.json'), JSON.stringify({ title: 'Bilingual' }));
  fs.writeFileSync(path.join(contentDir, 'hash1', 'Translation', 'doc.md'), '# 译文\n\n![](../Image/pic.png)');
  fs.writeFileSync(path.join(contentDir, 'hash1', 'Image', 'pic.png'), 'fake-png-bytes');
  fs.writeFileSync(path.join(tmp, 'outside.png'), 'outside-bytes');

  const { createApp } = require('../server');
  const { app, token: _t } = createApp({ workDir, contentDir, token: TOKEN });
  const server = http.createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  await test('GET /healthz', async () => {
    const r = await req(port, 'GET', '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  await test('GET /api/tasks returns video list', async () => {
    const r = await req(port, 'GET', '/api/tasks');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 2);
    assert.equal(r.body[0].id, taskId);
    assert.equal(r.body[0].title, 'Test Video');
  });

  await test('GET /api/tasks includes highlightCount and noteCount', async () => {
    const r = await req(port, 'GET', '/api/tasks');
    const withAnnotations = r.body.find((t) => t.id === taskId);
    assert.equal(withAnnotations.highlightCount, 2);
    assert.equal(withAnnotations.noteCount, 1);
    const withoutAnnotations = r.body.find((t) => t.id === taskId2);
    assert.equal(withoutAnnotations.highlightCount, 0);
    assert.equal(withoutAnnotations.noteCount, 0);
  });

  await test('GET /api/articles returns article list', async () => {
    const r = await req(port, 'GET', '/api/articles');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 3);
    assert.ok(r.body.some((a) => a.slug === 'intro' && a.title === 'Intro'));
  });

  await test('GET /api/articles includes highlightCount and noteCount', async () => {
    const r = await req(port, 'GET', '/api/articles');
    const intro = r.body.find((a) => a.slug === 'intro');
    assert.equal(intro.highlightCount, 0);
    assert.equal(intro.noteCount, 0);
    const tips = r.body.find((a) => a.slug === '2024-tips');
    assert.equal(tips.highlightCount, 1);
    assert.equal(tips.noteCount, 0);
  });

  await test('GET /api/tasks/:id returns video task', async () => {
    const r = await req(port, 'GET', `/api/tasks/${taskId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.task_id, taskId);
    assert.equal(r.body.status, 'completed');
    assert.equal(r.body.meta.title, 'Test Video');
  });

  await test('GET /api/tasks/article-intro returns article task', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-intro');
    assert.equal(r.status, 200);
    assert.equal(r.body.task_id, 'article-intro');
    assert.equal(r.body.meta.title, 'Intro');
  });

  await test('GET /api/tasks/article-intro includes parsed frontmatter', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-intro');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.meta.frontmatter, { title: 'Intro' });
  });

  await test('GET /api/tasks/:id returns 404 for unknown id', async () => {
    const r = await req(port, 'GET', '/api/tasks/nonexistent');
    assert.equal(r.status, 404);
  });

  await test('GET /api/tasks/:id/media for video', async () => {
    const r = await req(port, 'GET', `/api/tasks/${taskId}/media`);
    assert.equal(r.status, 200);
    assert.equal(r.body.video.exists, false);
    assert.equal(r.body.audio.exists, false);
  });

  await test('GET /api/tasks/:id/media for article returns no-media', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-intro/media');
    assert.equal(r.status, 200);
    assert.equal(r.body.video.exists, false);
    assert.equal(r.body.audio.exists, false);
  });

  await test('GET /api/tasks/:id/result/content for video article type', async () => {
    const r = await req(port, 'GET', `/api/tasks/${taskId}/result/content?type=article`);
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('# Article'));
  });

  await test('GET /api/tasks/:id/result/content for markdown article', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-intro/result/content');
    assert.equal(r.status, 200);
    assert.ok(r.body.includes('# Hello'));
  });

  await test('GET /api/tasks/:id/subtitles returns empty tracks', async () => {
    const r = await req(port, 'GET', `/api/tasks/${taskId}/subtitles`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.tracks, []);
  });

  // Highlights CRUD
  await test('highlights: list includes pre-seeded highlights', async () => {
    const r = await req(port, 'GET', `/api/tasks/${taskId}/highlights`);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 2);
    assert.equal(r.body[0].id, 'h1');
    assert.equal(r.body[1].id, 'h2');
  });

  let hlId;
  await test('highlights: POST creates highlight', async () => {
    const r = await req(port, 'POST', `/api/tasks/${taskId}/highlights`, { anchor: 'p-1', color: 'yellow' });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
    assert.equal(r.body.anchor, 'p-1');
    assert.equal(r.body.color, 'yellow');
    hlId = r.body.id;
  });

  await test('highlights: GET returns posted highlight plus pre-seeded ones', async () => {
    const r = await req(port, 'GET', `/api/tasks/${taskId}/highlights`);
    assert.equal(r.body.length, 3);
    assert.equal(r.body[0].id, hlId);
  });

  await test('highlights: DELETE removes the posted highlight, leaves pre-seeded', async () => {
    const r = await req(port, 'DELETE', `/api/tasks/${taskId}/highlights/${hlId}`);
    assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', `/api/tasks/${taskId}/highlights`);
    assert.equal(r2.body.length, 2);
    assert.deepEqual(r2.body[0].id, 'h1');
    assert.deepEqual(r2.body[1].id, 'h2');
  });

  // Notes CRUD
  let noteId;
  await test('notes: POST creates note', async () => {
    const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`, { anchor: 'p-2', body: 'My note' });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
    assert.equal(r.body.body, 'My note');
    noteId = r.body.id;
  });

  await test('notes: PATCH updates note', async () => {
    const r = await req(port, 'PATCH', `/api/tasks/${taskId}/notes/${noteId}`, { body: 'Updated note' });
    assert.equal(r.status, 200);
    assert.equal(r.body.body, 'Updated note');
  });

  await test('notes: DELETE removes posted note, leaves pre-seeded', async () => {
    const r = await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${noteId}`);
    assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', `/api/tasks/${taskId}/notes`);
    assert.equal(r2.body.length, 1);
    assert.equal(r2.body[0].id, 'n1');
  });

  // Article highlights
  await test('article highlights CRUD, co-located with the article file', async () => {
    const r = await req(port, 'POST', '/api/tasks/article-intro/highlights', { anchor: 'h-1', color: 'green' });
    assert.equal(r.status, 201);
    assert.ok(fs.existsSync(path.join(contentDir, 'intro', 'highlights.json')));
    assert.ok(!fs.existsSync(path.join(workDir, 'article-intro', 'highlights.json')));
    const r2 = await req(port, 'GET', '/api/tasks/article-intro/highlights');
    assert.equal(r2.body.length, 1);
    await req(port, 'DELETE', `/api/tasks/article-intro/highlights/${r.body.id}`);
    const r3 = await req(port, 'GET', '/api/tasks/article-intro/highlights');
    assert.deepEqual(r3.body, []);
  });

  // Article notes
  let articleNoteId;
  await test('article notes: POST creates note co-located with the article file', async () => {
    const r = await req(port, 'POST', '/api/tasks/article-intro/notes', { anchor: 'p-1', body: 'Article note' });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
    articleNoteId = r.body.id;
    assert.ok(fs.existsSync(path.join(contentDir, 'intro', 'notes.json')));
    assert.ok(!fs.existsSync(path.join(workDir, 'article-intro', 'notes.json')));
  });

  await test('article notes: PATCH updates note', async () => {
    const r = await req(port, 'PATCH', `/api/tasks/article-intro/notes/${articleNoteId}`, { body: 'Updated article note' });
    assert.equal(r.status, 200);
    assert.equal(r.body.body, 'Updated article note');
  });

  await test('article notes: DELETE removes note', async () => {
    const r = await req(port, 'DELETE', `/api/tasks/article-intro/notes/${articleNoteId}`);
    assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', '/api/tasks/article-intro/notes');
    assert.deepEqual(r2.body, []);
  });

  await test('article notes: nested article gets its own sibling dir, not the root one', async () => {
    const r = await req(port, 'POST', '/api/tasks/article-2024-tips/notes', { anchor: 'p-1', body: 'Nested note' });
    assert.equal(r.status, 201);
    assert.ok(fs.existsSync(path.join(contentDir, '2024', 'tips', 'notes.json')));
    assert.ok(!fs.existsSync(path.join(contentDir, 'tips', 'notes.json')));
  });

  await test('article notes: the article .md file itself is untouched', async () => {
    const content = fs.readFileSync(path.join(contentDir, 'intro.md'), 'utf8');
    assert.ok(content.includes('# Hello'));
  });

  await test('article notes: 404 for a nonexistent article', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-nonexistent/notes');
    assert.equal(r.status, 404);
  });

  // Article content asset (images relative to the article's own directory)
  await test('content/asset serves an image resolved relative to the article file, not contentDir root', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/article-hash1/content/asset?path=${encodeURIComponent('../Image/pic.png')}&token=${TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(await res.text(), 'fake-png-bytes');
  });

  await test('content/asset rejects paths that escape contentDir', async () => {
    const escapeAttempts = ['../../../outside.png', '../../../../../../../../etc/outside.png'];
    for (const p of escapeAttempts) {
      const res = await fetch(`http://127.0.0.1:${port}/api/tasks/article-hash1/content/asset?path=${encodeURIComponent(p)}&token=${TOKEN}`);
      assert.equal(res.status, 400, `expected 400 for ${p}`);
    }
  });

  await test('content/asset rejects non-image extensions', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/article-hash1/content/asset?path=${encodeURIComponent('../meta.json')}&token=${TOKEN}`);
    assert.equal(res.status, 400);
  });

  await test('content/asset requires a token (bearer or query)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/article-hash1/content/asset?path=${encodeURIComponent('../Image/pic.png')}`);
    assert.equal(res.status, 401);
  });

  await test('401 without token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`);
    assert.equal(res.status, 401);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
