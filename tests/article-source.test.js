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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-as-'));
  const contentDir = path.join(tmp, 'content');
  fs.mkdirSync(path.join(contentDir, '2024'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'intro.md'),
    '---\ntitle: Introduction\ndate: 2024-01-01\n---\n\n# Hello');
  fs.writeFileSync(path.join(contentDir, 'deep-dive.md'),
    '# Deep Dive\n\nNo frontmatter here.');
  fs.writeFileSync(path.join(contentDir, '2024', 'tips.md'),
    '---\ntitle: Tips 2024\n---\n\n# Tips');

  const {
    isArticleId, slugFromId, listArticles,
    articleFileExists, getArticleTask, getArticleContent,
  } = require('../server/article-source');

  await test('isArticleId', () => {
    assert.equal(isArticleId('article-intro'), true);
    assert.equal(isArticleId('abc123'), false);
    assert.equal(isArticleId(''), false);
  });

  await test('slugFromId strips prefix', () => {
    assert.equal(slugFromId('article-deep-dive'), 'deep-dive');
    assert.equal(slugFromId('article-2024-tips'), '2024-tips');
  });

  await test('listArticles returns 3 files sorted by mtime', async () => {
    const articles = await listArticles(contentDir);
    assert.equal(articles.length, 3);
    // All have id prefixed
    assert.ok(articles.every(a => a.id.startsWith('article-')));
    // Frontmatter title extracted
    const intro = articles.find(a => a.slug === 'intro');
    assert.equal(intro.title, 'Introduction');
    assert.equal(intro.date, '2024-01-01');
    // Slug from subdirectory
    const tips = articles.find(a => a.slug === '2024-tips');
    assert.ok(tips);
    assert.equal(tips.title, 'Tips 2024');
    // No frontmatter → title from slug
    const dive = articles.find(a => a.slug === 'deep-dive');
    assert.equal(dive.title, 'Deep Dive');
  });

  await test('listArticles sorts by fetch_date, falling back to mtime', async () => {
    // Written last (newest mtime) but has the oldest fetch_date
    fs.writeFileSync(path.join(contentDir, 'old-fetch.md'),
      '---\ntitle: Old Fetch\nfetch_date: 2020-01-01\n---\n\n# Old');
    const articles = await listArticles(contentDir);
    assert.equal(articles.length, 4);
    assert.equal(articles[articles.length - 1].slug, 'old-fetch');
    fs.rmSync(path.join(contentDir, 'old-fetch.md'));
  });

  await test('listArticles returns [] for missing dir', async () => {
    const r = await listArticles('/nonexistent');
    assert.deepEqual(r, []);
  });

  await test('articleFileExists true/false', async () => {
    assert.equal(await articleFileExists(contentDir, 'intro'), true);
    assert.equal(await articleFileExists(contentDir, 'nonexistent'), false);
    assert.equal(await articleFileExists(contentDir, '2024-tips'), true);
  });

  await test('getArticleTask returns BackendTask shape', async () => {
    const t = await getArticleTask('article-intro', contentDir);
    assert.ok(t);
    assert.equal(t.task_id, 'article-intro');
    assert.equal(t.status, 'completed');
    assert.equal(t.meta.title, 'Introduction');
    assert.equal(t.meta.url, '');
    assert.equal(t.meta.mode, 'media');
  });

  await test('getArticleTask returns null for missing slug', async () => {
    const t = await getArticleTask('article-nonexistent', contentDir);
    assert.equal(t, null);
  });

  await test('getArticleContent returns markdown', async () => {
    const md = await getArticleContent('article-intro', contentDir);
    assert.ok(md.includes('# Hello'));
  });

  await test('getArticleContent returns null for missing slug', async () => {
    const md = await getArticleContent('article-nonexistent', contentDir);
    assert.equal(md, null);
  });

  await test('getArticleAnnotationDirs computes sibling directory next to the article file', () => {
    const { getArticleAnnotationDirs } = require('../server/paths');
    const dirs = getArticleAnnotationDirs(path.join(contentDir, '2024', 'tips.md'));
    assert.equal(dirs.base, path.join(contentDir, '2024', 'tips'));
    assert.equal(dirs.notes, path.join(contentDir, '2024', 'tips', 'notes.json'));
    assert.equal(dirs.highlights, path.join(contentDir, '2024', 'tips', 'highlights.json'));
  });

  await test('path traversal slug rejected by getArticleDirs', () => {
    const { getArticleDirs } = require('../server/paths');
    assert.throws(() => getArticleDirs('/some/dir', '../evil'), /Invalid article slug/);
    assert.throws(() => getArticleDirs('/some/dir', 'foo/bar'), /Invalid article slug/);
  });

  await test('resolveArticleFile resolves nested slug to its file path', async () => {
    const { resolveArticleFile } = require('../server/article-source');
    const filePath = await resolveArticleFile(contentDir, '2024-tips');
    assert.equal(filePath, path.join(contentDir, '2024', 'tips.md'));
  });

  await test('resolveArticleFile returns null for unmatched or path-traversal-like slugs', async () => {
    const { resolveArticleFile } = require('../server/article-source');
    assert.equal(await resolveArticleFile(contentDir, 'nonexistent'), null);
    assert.equal(await resolveArticleFile(contentDir, '../evil'), null);
    assert.equal(await resolveArticleFile(contentDir, 'foo/bar'), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
