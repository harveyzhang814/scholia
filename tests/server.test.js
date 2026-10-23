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

  // Creator index + registry fixtures for /api/creator/:key. creators.json
  // lives as a sibling of workDir (creator-source.js's creatorsIndexPath),
  // and the registry is resolved via ~/.hskill/roster, so HOME is pointed
  // at a scratch dir for the duration of this process (mirrors
  // tests/creator-source.test.js).
  const creatorHome = path.join(tmp, 'creator-home');
  fs.mkdirSync(path.join(creatorHome, '.hskill', 'roster'), { recursive: true });
  process.env.HOME = creatorHome;
  fs.writeFileSync(path.join(tmp, 'creators.json'), JSON.stringify({
    schema_version: 1, built_at: 'x', scanned: { entities: 0 },
    creators: [
      { key: 'creator_one', display_name: 'Creator One', channel_id: 'UC1', uploader_url: 'https://youtube.com/@creator_one',
        videos: [{ task_id: 'cv1', title: 'Creator Video', upload_date: '2026-01-01', duration: '100' }] },
    ],
    unresolved: [],
  }));
  fs.writeFileSync(path.join(creatorHome, '.hskill', 'roster', 'registry.json'), JSON.stringify({
    schema_version: 1,
    creators: [
      { id: 'creator_one', display_name: 'Creator One', aliases: [], placeholder: false, added_at: '2026-09-15',
        channels: [{ platform: 'youtube', handle: '@creator_one', key: 'creator_one', url: 'https://youtube.com/@creator_one' }] },
    ],
  }));
  fs.writeFileSync(path.join(creatorHome, '.hskill', 'roster', 'config.json'), JSON.stringify({
    DATA_DIR: path.join(creatorHome, '.hskill', 'roster'),
  }));

  const xDir = path.join(tmp, 'tweets');
  fs.mkdirSync(xDir, { recursive: true });
  fs.writeFileSync(path.join(xDir, 'trq212.json'), JSON.stringify([
    {
      tweet_id: '2087258093499695106', url: 'https://x.com/trq212/status/2087258093499695106',
      text: 'oldest post', timestamp: '2026-08-11T19:21:23.000Z', author_handle: '@trq212',
      type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最旧的一条',
    },
    {
      tweet_id: '2088298127346536578', url: 'https://x.com/lydiahallie/status/2088298127346536578',
      text: 'newest repost content', timestamp: '2026-08-14T16:14:06.000Z', author_handle: '@lydiahallie',
      type: 'repost', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最新的转推内容',
    },
  ]));

  const readStatePath = path.join(tmp, 'read-state.json');
  const { createApp } = require('../server');
  const { app, token: _t } = createApp({ workDir, contentDir, xDir, token: TOKEN, readStatePath });
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

  await test('notes: POST stores anchor context fields', async () => {
    const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`,
      { anchor: '', prefix: '前文', suffix: '后文', position: 12, doc: 'article', body: 'point' });
    assert.equal(r.status, 201);
    assert.equal(r.body.prefix, '前文');
    assert.equal(r.body.suffix, '后文');
    assert.equal(r.body.position, 12);
    assert.equal(r.body.doc, 'article');
    await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${r.body.id}`);
  });

  await test('notes: POST without new fields stores none of them', async () => {
    const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`, { anchor: 'x', body: 'legacy' });
    assert.equal(r.status, 201);
    for (const k of ['prefix', 'suffix', 'position', 'doc']) assert.ok(!(k in r.body), k);
    await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${r.body.id}`);
  });

  await test('notes: POST rejects invalid anchor fields', async () => {
    const bad = [
      { prefix: 'x'.repeat(33) }, { suffix: 5 }, { position: -1 }, { position: 1.5 }, { doc: 'other' },
    ];
    for (const extra of bad) {
      const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`, { anchor: '', body: 'b', ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
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

  // Inline-comment markers (phase 3): the only code path that rewrites source files.
  const { sha256Hex } = require('../server/markers');
  const MARKED_SRC = '---\ntitle: M\n---\n\n第一段文字。\n\n第二段文字。\n';
  fs.writeFileSync(path.join(contentDir, 'marked.md'), MARKED_SRC);
  const markerRe = /<!-- \/?sc:[0-9a-f]{8} -->/g;
  const getBody = async (id, q = '') => (await req(port, 'GET', `/api/tasks/${id}/result/content${q}`)).body;
  const addNote = async (id, extra) => (await req(port, 'POST', `/api/tasks/${id}/notes`, { anchor: '', body: 'p', ...extra })).body;
  const mark = (id, noteId, body) => req(port, 'POST', `/api/tasks/${id}/notes/${noteId}/marker`, body);
  const makeArticle = (name, raw) => { fs.writeFileSync(path.join(contentDir, `${name}.md`), raw); return `article-${name}`; };

  await test('marker: writes a point marker into an article, keeps frontmatter', async () => {
    const note = await addNote('article-marked', { prefix: '第一段', suffix: '文字。', position: 3 });
    const body = await getBody('article-marked');
    const offset = body.indexOf('第一段') + 3;
    const r = await mark('article-marked', note.id, { baseHash: sha256Hex(body), insertions: [{ offset, edge: 'point' }] });
    assert.equal(r.status, 200);
    assert.match(r.body.markerId, /^[0-9a-f]{8}$/);
    const id = r.body.markerId;
    const expected = `---\ntitle: M\n---\n\n第一段<!-- sc:${id} -->文字。\n\n第二段文字。\n`;
    assert.equal(fs.readFileSync(path.join(contentDir, 'marked.md'), 'utf8'), expected);
    const notes = (await req(port, 'GET', '/api/tasks/article-marked/notes')).body;
    assert.equal(notes.find((n) => n.id === note.id).markerId, id);
    assert.equal(r.body.hash, sha256Hex(await getBody('article-marked')));
    assert.equal(r.body.hash, sha256Hex(expected.slice('---\ntitle: M\n---\n'.length)));
  });

  await test('marker: writes start/end markers into the video doc named by note.doc', async () => {
    const summary = path.join(workDir, taskId, 'writing', 'summary.md');
    fs.writeFileSync(summary, '# S\n\n总结正文。\n');
    const articleBefore = fs.readFileSync(path.join(workDir, taskId, 'writing', 'article.md'), 'utf8');
    const note = await addNote(taskId, { anchor: '总结正文', doc: 'summary' });
    const body = await getBody(taskId, '?type=summary');
    const s = body.indexOf('总结正文');
    const r = await mark(taskId, note.id, { baseHash: sha256Hex(body), insertions: [{ offset: s, edge: 'start' }, { offset: s + 4, edge: 'end' }] });
    assert.equal(r.status, 200);
    const id = r.body.markerId;
    assert.equal(fs.readFileSync(summary, 'utf8'), `# S\n\n<!-- sc:${id} -->总结正文<!-- /sc:${id} -->。\n`);
    assert.equal(fs.readFileSync(path.join(workDir, taskId, 'writing', 'article.md'), 'utf8'), articleBefore);
    assert.equal(r.body.hash, sha256Hex(fs.readFileSync(summary, 'utf8')));
  });

  await test('marker: stale baseHash returns 409 and leaves the file untouched', async () => {
    const aid = makeArticle('marked-stale', MARKED_SRC);
    const file = path.join(contentDir, 'marked-stale.md');
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const r = await mark(aid, note.id, { baseHash: sha256Hex(body + 'x'), insertions: [{ offset: 0, edge: 'point' }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'stale');
    assert.equal(fs.readFileSync(file, 'utf8'), MARKED_SRC);
    const notes = (await req(port, 'GET', `/api/tasks/${aid}/notes`)).body;
    assert.equal(notes[0].markerId, undefined);
  });

  await test('marker: invalid insertions return 400', async () => {
    const aid = makeArticle('marked-invalid', MARKED_SRC);
    const file = path.join(contentDir, 'marked-invalid.md');
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const baseHash = sha256Hex(body);
    const cases = [
      [{ offset: body.length + 1, edge: 'point' }],
      [{ offset: -1, edge: 'point' }],
      [{ offset: 1.5, edge: 'point' }],
      [{ offset: 1, edge: 'point' }, { offset: 2, edge: 'point' }],
      [{ offset: 1, edge: 'start' }],
      [{ offset: 5, edge: 'start' }, { offset: 5, edge: 'end' }],
      [{ offset: 6, edge: 'start' }, { offset: 5, edge: 'end' }],
      [{ offset: 1, edge: 'x' }],
      [],
      'nope',
      undefined,
    ];
    for (const insertions of cases) {
      const r = await mark(aid, note.id, { baseHash, insertions });
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(insertions)}`);
      assert.equal(fs.readFileSync(file, 'utf8'), MARKED_SRC);
    }
    // boundary offsets (0 and bodyLength) are valid
    const ok = await mark(aid, note.id, { baseHash, insertions: [{ offset: 0, edge: 'start' }, { offset: body.length, edge: 'end' }] });
    assert.equal(ok.status, 200);
    assert.notEqual(fs.readFileSync(file, 'utf8'), MARKED_SRC);
  });

  await test('marker: a lone end insertion writes only the closing marker, keeps frontmatter', async () => {
    const aid = makeArticle('marked-end', MARKED_SRC);
    const file = path.join(contentDir, 'marked-end.md');
    const note = await addNote(aid, { anchor: '第一段' });
    const body = await getBody(aid);
    const offset = body.indexOf('第一段') + 3;
    const r = await mark(aid, note.id, { baseHash: sha256Hex(body), insertions: [{ offset, edge: 'end' }] });
    assert.equal(r.status, 200);
    const id = r.body.markerId;
    assert.match(id, /^[0-9a-f]{8}$/);
    const expected = `---\ntitle: M\n---\n\n第一段<!-- /sc:${id} -->文字。\n\n第二段文字。\n`;
    assert.equal(fs.readFileSync(file, 'utf8'), expected);
    assert.equal((expected.match(markerRe) || []).length, 1);
    const notes = (await req(port, 'GET', `/api/tasks/${aid}/notes`)).body;
    assert.equal(notes.find((n) => n.id === note.id).markerId, id);
    assert.equal(r.body.hash, sha256Hex(await getBody(aid)));
  });

  await test('notes: DELETE removes a lone end marker and leaves the rest byte-identical', async () => {
    const aid = makeArticle('marked-end-del', MARKED_SRC);
    const file = path.join(contentDir, 'marked-end-del.md');
    const note = await addNote(aid, { anchor: '第二段' });
    const body = await getBody(aid);
    const r = await mark(aid, note.id, { baseHash: sha256Hex(body), insertions: [{ offset: body.indexOf('第二段') + 3, edge: 'end' }] });
    assert.equal(r.status, 200);
    assert.notEqual(fs.readFileSync(file, 'utf8'), MARKED_SRC);
    const d = await req(port, 'DELETE', `/api/tasks/${aid}/notes/${note.id}`);
    assert.equal(d.status, 204);
    assert.equal(fs.readFileSync(file, 'utf8'), MARKED_SRC);
  });

  await test('marker: a lone start, or an end with anything else, returns 400', async () => {
    const aid = makeArticle('marked-end-invalid', MARKED_SRC);
    const file = path.join(contentDir, 'marked-end-invalid.md');
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const baseHash = sha256Hex(body);
    const cases = [
      [{ offset: 1, edge: 'start' }],
      [{ offset: 1, edge: 'end' }, { offset: 2, edge: 'point' }],
      [{ offset: 1, edge: 'point' }, { offset: 2, edge: 'end' }],
      [{ offset: 1, edge: 'end' }, { offset: 2, edge: 'end' }],
    ];
    for (const insertions of cases) {
      const r = await mark(aid, note.id, { baseHash, insertions });
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(insertions)}`);
      assert.equal(fs.readFileSync(file, 'utf8'), MARKED_SRC);
    }
  });

  await test('marker: marker text is generated by the server', async () => {
    const aid = makeArticle('marked-text', MARKED_SRC);
    const file = path.join(contentDir, 'marked-text.md');
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const r = await mark(aid, note.id, {
      baseHash: sha256Hex(body), insertions: [{ offset: 2, edge: 'point', text: '<script>y</script>' }],
      text: '<script>x</script>', id: 'deadbeef', markerId: 'cafebabe',
    });
    assert.equal(r.status, 200);
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(!after.includes('script'));
    assert.ok(!after.includes('deadbeef') && !after.includes('cafebabe'));
    assert.equal(after.replace(markerRe, ''), MARKED_SRC);
    assert.equal((after.match(markerRe) || []).length, 1);
  });

  await test('marker: a second write for the same note returns 409', async () => {
    const aid = makeArticle('marked-twice', MARKED_SRC);
    const file = path.join(contentDir, 'marked-twice.md');
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const first = await mark(aid, note.id, { baseHash: sha256Hex(body), insertions: [{ offset: 1, edge: 'point' }] });
    assert.equal(first.status, 200);
    const written = fs.readFileSync(file, 'utf8');
    const second = await mark(aid, note.id, { baseHash: first.body.hash, insertions: [{ offset: 1, edge: 'point' }] });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'already marked');
    assert.equal(fs.readFileSync(file, 'utf8'), written);
  });

  await test('marker: unknown note returns 404', async () => {
    const r = await mark('article-marked', 'no-such-note', { baseHash: 'x', insertions: [] });
    assert.equal(r.status, 404);
  });

  await test('marker: video note without doc returns 400', async () => {
    const note = await addNote(taskId, {});
    const r = await mark(taskId, note.id, { baseHash: sha256Hex('x'), insertions: [{ offset: 0, edge: 'point' }] });
    assert.equal(r.status, 400);
    await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${note.id}`);
  });

  await test('notes: DELETE removes only this note\'s markers', async () => {
    const aid = makeArticle('marked-two', MARKED_SRC);
    const file = path.join(contentDir, 'marked-two.md');
    const n1 = await addNote(aid, {});
    const n2 = await addNote(aid, {});
    let body = await getBody(aid);
    const i1 = body.indexOf('第一段');
    const r1 = await mark(aid, n1.id, { baseHash: sha256Hex(body), insertions: [{ offset: i1, edge: 'start' }, { offset: i1 + 3, edge: 'end' }] });
    assert.equal(r1.status, 200);
    body = await getBody(aid);
    const i2 = body.indexOf('第二段');
    const r2 = await mark(aid, n2.id, { baseHash: r1.body.hash, insertions: [{ offset: i2 + 3, edge: 'point' }] });
    assert.equal(r2.status, 200);
    const d = await req(port, 'DELETE', `/api/tasks/${aid}/notes/${n1.id}`);
    assert.equal(d.status, 204);
    assert.equal(fs.readFileSync(file, 'utf8'), `---\ntitle: M\n---\n\n第一段文字。\n\n第二段<!-- sc:${r2.body.markerId} -->文字。\n`);
    const notes = (await req(port, 'GET', `/api/tasks/${aid}/notes`)).body;
    assert.deepEqual(notes.map((n) => n.id), [n2.id]);
  });

  await test('notes: DELETE removes markers whose inner whitespace was altered', async () => {
    const aid = makeArticle('marked-ws', MARKED_SRC);
    const file = path.join(contentDir, 'marked-ws.md');
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const i = body.indexOf('第一段');
    const r = await mark(aid, note.id, { baseHash: sha256Hex(body), insertions: [{ offset: i, edge: 'start' }, { offset: i + 3, edge: 'end' }] });
    assert.equal(r.status, 200);
    const id = r.body.markerId;
    const edited = fs.readFileSync(file, 'utf8').replace(`<!-- sc:${id} -->`, `<!--sc:${id}-->`).replace(`<!-- /sc:${id} -->`, `<!--  /sc:${id}\t-->`);
    assert.ok(edited.includes(`<!--sc:${id}-->`) && edited.includes(`<!--  /sc:${id}\t-->`));
    fs.writeFileSync(file, edited);
    const d = await req(port, 'DELETE', `/api/tasks/${aid}/notes/${note.id}`);
    assert.equal(d.status, 204);
    assert.equal(fs.readFileSync(file, 'utf8'), MARKED_SRC);
  });

  await test('notes: DELETE of a marked video note removes markers from its doc', async () => {
    const summary = path.join(workDir, taskId, 'writing', 'summary.md');
    const notes = (await req(port, 'GET', `/api/tasks/${taskId}/notes`)).body;
    const marked = notes.find((n) => n.markerId && n.doc === 'summary');
    assert.ok(marked);
    const d = await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${marked.id}`);
    assert.equal(d.status, 204);
    assert.equal(fs.readFileSync(summary, 'utf8'), '# S\n\n总结正文。\n');
  });

  await test('notes: DELETE of a marked video note whose doc file is gone still deletes the note', async () => {
    const summary = path.join(workDir, taskId, 'writing', 'summary.md');
    const note = await addNote(taskId, { anchor: '总结正文', doc: 'summary' });
    const r = await mark(taskId, note.id, { baseHash: sha256Hex(await getBody(taskId, '?type=summary')), insertions: [{ offset: 1, edge: 'point' }] });
    assert.equal(r.status, 200);
    fs.unlinkSync(summary);
    const d = await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${note.id}`);
    assert.equal(d.status, 204);
    assert.ok(!fs.existsSync(summary));
    const notes = (await req(port, 'GET', `/api/tasks/${taskId}/notes`)).body;
    assert.ok(!notes.some((n) => n.id === note.id));
  });

  await test('notes: DELETE of an unmarked note does not touch the source file', async () => {
    const aid = makeArticle('marked-untouched', MARKED_SRC);
    const file = path.join(contentDir, 'marked-untouched.md');
    const note = await addNote(aid, {});
    const before = { text: fs.readFileSync(file, 'utf8'), mtimeMs: fs.statSync(file).mtimeMs };
    await new Promise((resolve) => setTimeout(resolve, 20));
    const d = await req(port, 'DELETE', `/api/tasks/${aid}/notes/${note.id}`);
    assert.equal(d.status, 204);
    assert.equal(fs.readFileSync(file, 'utf8'), before.text);
    assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  });

  // A stray Windows-1252 byte (0x93) at the end makes the file invalid UTF-8.
  const nonUtf8 = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0x93, 0x0a])]);

  await test('marker: a non-UTF-8 source file is refused and left byte-identical', async () => {
    const file = path.join(contentDir, 'marked-latin.md');
    const bytes = nonUtf8(MARKED_SRC);
    fs.writeFileSync(file, bytes);
    const aid = 'article-marked-latin';
    const note = await addNote(aid, {});
    const body = await getBody(aid);
    const r = await mark(aid, note.id, { baseHash: sha256Hex(body), insertions: [{ offset: 0, edge: 'point' }] });
    assert.equal(r.status, 422);
    assert.ok(fs.readFileSync(file).equals(bytes));
    const notes = (await req(port, 'GET', `/api/tasks/${aid}/notes`)).body;
    assert.equal(notes.find((n) => n.id === note.id).markerId, undefined);
  });

  await test('notes: DELETE of a marked note on a non-UTF-8 file leaves the file and deletes the note', async () => {
    const aid = makeArticle('marked-latin-del', MARKED_SRC);
    const file = path.join(contentDir, 'marked-latin-del.md');
    const note = await addNote(aid, {});
    const r = await mark(aid, note.id, { baseHash: sha256Hex(await getBody(aid)), insertions: [{ offset: 0, edge: 'point' }] });
    assert.equal(r.status, 200);
    const bytes = nonUtf8(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, bytes);
    const d = await req(port, 'DELETE', `/api/tasks/${aid}/notes/${note.id}`);
    assert.equal(d.status, 204);
    assert.ok(fs.readFileSync(file).equals(bytes));
    const notes = (await req(port, 'GET', `/api/tasks/${aid}/notes`)).body;
    assert.ok(!notes.some((n) => n.id === note.id));
  });

  await test('notes: concurrent marker write and note creation lose nothing', async () => {
    const aid = makeArticle('marked-race', MARKED_SRC);
    const errors = [];
    for (let round = 0; round < 10; round++) {
      const a = await addNote(aid, { body: `a${round}` });
      const body = await getBody(aid);
      const results = await Promise.all([
        mark(aid, a.id, { baseHash: sha256Hex(body), insertions: [{ offset: round, edge: 'point' }] }),
        ...[0, 1, 2].map((k) => req(port, 'POST', `/api/tasks/${aid}/notes`, { anchor: '', body: `b${round}-${k}` })),
      ]);
      for (const r of results) if (r.status >= 500) errors.push(`round ${round}: ${r.status}`);
      const notes = (await req(port, 'GET', `/api/tasks/${aid}/notes`)).body;
      if (!notes.find((n) => n.id === a.id)?.markerId) errors.push(`round ${round}: note A lost its markerId`);
      for (const r of results.slice(1)) {
        if (r.status === 201 && !notes.some((n) => n.id === r.body.id)) errors.push(`round ${round}: created note lost`);
      }
    }
    assert.deepEqual(errors, []);
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

  await test('GET /api/x-timelines returns a summary per handle', async () => {
    const r = await req(port, 'GET', '/api/x-timelines');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].handle, 'trq212');
    assert.equal(r.body[0].tweetCount, 2);
    assert.equal(r.body[0].latestAt, '2026-08-14T16:14:06.000Z');
  });

  await test('GET /api/x-timelines/:handle returns tweets sorted newest-first', async () => {
    const r = await req(port, 'GET', '/api/x-timelines/trq212');
    assert.equal(r.status, 200);
    assert.equal(r.body.handle, 'trq212');
    assert.deepEqual(r.body.tweets.map((t) => t.tweet_id), ['2088298127346536578', '2087258093499695106']);
  });

  await test('GET /api/x-timelines/:handle 404s for an unknown handle', async () => {
    const r = await req(port, 'GET', '/api/x-timelines/nobody');
    assert.equal(r.status, 404);
  });

  await test('GET /api/x-timelines/:handle 404s for a handle with path separators', async () => {
    const r = await req(port, 'GET', `/api/x-timelines/${encodeURIComponent('../trq212')}`);
    assert.equal(r.status, 404);
  });

  await test('GET /api/x-timelines requires auth like other routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/x-timelines`);
    assert.equal(res.status, 401);
  });

  await test('GET /api/creator/:key returns the creator with videos and watch status', async () => {
    const r = await req(port, 'GET', '/api/creator/creator_one');
    assert.equal(r.status, 200);
    assert.equal(r.body.key, 'creator_one');
    assert.equal(r.body.display_name, 'Creator One');
    assert.equal(r.body.watched, true);
    assert.equal(r.body.creator_id, 'creator_one');
    assert.equal(r.body.videos.length, 1);
    assert.equal(r.body.videos[0].task_id, 'cv1');
  });

  await test('GET /api/creator/:key 404s for an unknown key', async () => {
    const r = await req(port, 'GET', '/api/creator/nobody');
    assert.equal(r.status, 404);
  });

  await test('GET /api/creator/:key requires auth like other routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/creator/creator_one`);
    assert.equal(res.status, 401);
  });

  // Read state
  await test('GET /api/read-state starts empty', async () => {
    const r = await req(port, 'GET', '/api/read-state');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  });

  await test('GET /api/x-timelines reports hasUnread before anything is marked read', async () => {
    const r = await req(port, 'GET', '/api/x-timelines');
    assert.equal(r.body[0].hasUnread, true);
  });

  await test('POST /api/read-state/:id marks an id read', async () => {
    const r = await req(port, 'POST', `/api/read-state/${encodeURIComponent(taskId)}`);
    assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', '/api/read-state');
    assert.ok(r2.body.includes(taskId));
  });

  await test('marking every tweet in a handle read flips hasUnread to false', async () => {
    await req(port, 'POST', `/api/read-state/${encodeURIComponent('tweet-2087258093499695106')}`);
    await req(port, 'POST', `/api/read-state/${encodeURIComponent('tweet-2088298127346536578')}`);
    const r = await req(port, 'GET', '/api/x-timelines');
    assert.equal(r.body[0].hasUnread, false);
  });

  await test('DELETE /api/read-state/:id unmarks an id, flipping hasUnread back to true', async () => {
    const r = await req(port, 'DELETE', `/api/read-state/${encodeURIComponent('tweet-2087258093499695106')}`);
    assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', '/api/read-state');
    assert.ok(!r2.body.includes('tweet-2087258093499695106'));
    const r3 = await req(port, 'GET', '/api/x-timelines');
    assert.equal(r3.body[0].hasUnread, true);
  });

  await test('concurrent POSTs to /api/read-state all succeed and persist (no lost updates)', async () => {
    const ids = ['tweet-race-1', 'tweet-race-2', 'tweet-race-3', 'tweet-race-4', 'tweet-race-5'];
    const results = await Promise.all(ids.map((id) => req(port, 'POST', `/api/read-state/${id}`)));
    for (const r of results) assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', '/api/read-state');
    for (const id of ids) assert.ok(r2.body.includes(id), `expected ${id} to be persisted`);
  });

  await test('read-state routes require auth like other routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/read-state`);
    assert.equal(res.status, 401);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
