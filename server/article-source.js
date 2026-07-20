'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function slugFromPath(entryPath, contentDir) {
  return path.relative(contentDir, entryPath).replace(/\.md$/i, '').replace(/[/\\]/g, '-');
}

function titleFromSlug(slug) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: content };
  let frontmatter = {};
  try {
    const parsed = yaml.load(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed;
  } catch { /* 解析失败按无 frontmatter 处理 */ }
  return { frontmatter, body: content.slice(m[0].length) };
}

// A directory containing meta.json is a bilingual reading entry (e.g. from
// the extract-url skill): {meta.json, Origin/*.md, Translation/*.md, Image/}.
// Only the Translation article is exposed, falling back to Origin if no
// translation exists yet — Origin is never listed alongside it.
async function firstMdFile(dir) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
  const md = entries.find((e) => e.isFile() && /\.md$/i.test(e.name));
  return md ? path.join(dir, md.name) : null;
}

async function findArticleEntries(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === 'meta.json')) {
    const file = (await firstMdFile(path.join(dir, 'Translation'))) || (await firstMdFile(path.join(dir, 'Origin')));
    return file ? [{ file, slugPath: dir, metaPath: path.join(dir, 'meta.json') }] : [];
  }
  const results = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Skip dotfolders (.obsidian, .trash, .git, ...) so vault internals never surface as articles.
    if (e.isDirectory() && e.name.startsWith('.')) continue;
    if (e.isDirectory()) results.push(...await findArticleEntries(full));
    else if (e.isFile() && /\.md$/i.test(e.name)) results.push({ file: full, slugPath: full, metaPath: null });
  }
  return results;
}

async function readMetaJson(metaPath) {
  if (!metaPath) return {};
  try { return JSON.parse(await fs.promises.readFile(metaPath, 'utf8')); } catch { return {}; }
}

// meta.json (written by the fetching tool) is the fallback source for
// title/date when the article's own frontmatter doesn't carry them.
async function resolveTitleAndDate(frontmatter, metaPath) {
  let title = frontmatter.title;
  let date = frontmatter.date;
  let fetchDate = frontmatter.fetch_date;
  if (metaPath && (!title || (!date && !fetchDate))) {
    const meta = await readMetaJson(metaPath);
    if (!title) title = meta.title;
    if (!date && !fetchDate) fetchDate = meta.fetched_at;
  }
  return { title, date, fetchDate };
}

function isArticleId(id) {
  return typeof id === 'string' && id.startsWith('article-');
}

function slugFromId(id) {
  return id.slice('article-'.length);
}

async function resolveArticleEntry(contentDir, slug) {
  let entries;
  try { entries = await findArticleEntries(contentDir); } catch { return null; }
  return entries.find(e => slugFromPath(e.slugPath, contentDir) === slug) ?? null;
}

async function resolveArticleFile(contentDir, slug) {
  const entry = await resolveArticleEntry(contentDir, slug);
  return entry ? entry.file : null;
}

async function articleFileExists(contentDir, slug) {
  return (await resolveArticleFile(contentDir, slug)) !== null;
}

async function listArticles(contentDir) {
  let entries;
  try { entries = await findArticleEntries(contentDir); } catch { return []; }
  const articles = await Promise.all(entries.map(async (entry) => {
    const slug = slugFromPath(entry.slugPath, contentDir);
    const stat = await fs.promises.stat(entry.file).catch(() => null);
    let frontmatter = {};
    try { const raw = await fs.promises.readFile(entry.file, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
    const { title, date, fetchDate } = await resolveTitleAndDate(frontmatter, entry.metaPath);
    const fallbackMs = stat ? stat.mtimeMs : Date.now();
    const parsedFetchDate = fetchDate ? Date.parse(fetchDate) : NaN;
    const sortKey = Number.isNaN(parsedFetchDate) ? fallbackMs : parsedFetchDate;
    return { slug, id: `article-${slug}`, title: title || titleFromSlug(slug), date: date || undefined, updatedAt: fallbackMs, sortKey };
  }));
  return articles.sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey, ...rest }) => rest);
}

async function getArticleTask(taskId, contentDir) {
  const slug = slugFromId(taskId);
  const entry = await resolveArticleEntry(contentDir, slug);
  if (!entry) return null;
  const stat = await fs.promises.stat(entry.file).catch(() => null);
  let frontmatter = {};
  try { const raw = await fs.promises.readFile(entry.file, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
  const { title } = await resolveTitleAndDate(frontmatter, entry.metaPath);
  const ts = stat ? stat.mtime.toISOString() : new Date().toISOString();
  return { task_id: taskId, status: 'completed', meta: { title: title || titleFromSlug(slug), url: '', mode: 'media', ts, created_at: ts, frontmatter } };
}

async function getArticleContent(taskId, contentDir) {
  const filePath = await resolveArticleFile(contentDir, slugFromId(taskId));
  if (!filePath) return null;
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return parseFrontmatter(raw).body;
  } catch { return null; }
}

module.exports = { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent, resolveArticleFile };
