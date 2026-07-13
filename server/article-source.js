'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function slugFromFilePath(filePath, contentDir) {
  return path.relative(contentDir, filePath).replace(/\.md$/i, '').replace(/[/\\]/g, '-');
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

async function findMdFiles(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...await findMdFiles(full));
    else if (e.isFile() && /\.md$/i.test(e.name)) results.push(full);
  }
  return results;
}

function isArticleId(id) {
  return typeof id === 'string' && id.startsWith('article-');
}

function slugFromId(id) {
  return id.slice('article-'.length);
}

async function resolveArticleFile(contentDir, slug) {
  let files;
  try { files = await findMdFiles(contentDir); } catch { return null; }
  return files.find(f => slugFromFilePath(f, contentDir) === slug) ?? null;
}

async function articleFileExists(contentDir, slug) {
  return (await resolveArticleFile(contentDir, slug)) !== null;
}

async function listArticles(contentDir) {
  let files;
  try { files = await findMdFiles(contentDir); } catch { return []; }
  const articles = await Promise.all(files.map(async (f) => {
    const slug = slugFromFilePath(f, contentDir);
    const stat = await fs.promises.stat(f).catch(() => null);
    let frontmatter = {};
    try { const raw = await fs.promises.readFile(f, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
    const title = frontmatter.title;
    const date = frontmatter.date;
    const fetchDate = frontmatter.fetch_date;
    const fallbackMs = stat ? stat.mtimeMs : Date.now();
    const parsedFetchDate = fetchDate ? Date.parse(fetchDate) : NaN;
    const sortKey = Number.isNaN(parsedFetchDate) ? fallbackMs : parsedFetchDate;
    return { slug, id: `article-${slug}`, title: title || titleFromSlug(slug), date: date || undefined, updatedAt: fallbackMs, sortKey };
  }));
  return articles.sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey, ...rest }) => rest);
}

async function getArticleTask(taskId, contentDir) {
  const slug = slugFromId(taskId);
  const filePath = await resolveArticleFile(contentDir, slug);
  if (!filePath) return null;
  const stat = await fs.promises.stat(filePath).catch(() => null);
  let frontmatter = {};
  try { const raw = await fs.promises.readFile(filePath, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
  const ts = stat ? stat.mtime.toISOString() : new Date().toISOString();
  return { task_id: taskId, status: 'completed', meta: { title: frontmatter.title || titleFromSlug(slug), url: '', mode: 'media', ts, created_at: ts, frontmatter } };
}

async function getArticleContent(taskId, contentDir) {
  const slug = slugFromId(taskId);
  const filePath = await resolveArticleFile(contentDir, slug);
  if (!filePath) return null;
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return parseFrontmatter(raw).body;
  } catch { return null; }
}

module.exports = { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent };
