'use strict';
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { getVideoDirs, getArticleAnnotationDirs } = require('./paths');
const { listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent } = require('./video-source');
const { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent, resolveArticleFile } = require('./article-source');
const { createStaticServe } = require('./static-serve');

const ASSET_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.bmp': 'image/bmp',
};

async function readJson(filePath, defaultVal) {
  try { return JSON.parse(await fs.promises.readFile(filePath, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return defaultVal; throw e; }
}

async function writeJson(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, filePath);
}

async function assertItemExists(taskId, workDir, contentDir) {
  if (isArticleId(taskId)) {
    const slug = slugFromId(taskId);
    if (/[/\\]/.test(slug) || slug.includes('..')) return false;
    return contentDir ? articleFileExists(contentDir, slug) : false;
  }
  const metaPath = path.join(workDir || '', taskId, 'meta.json');
  return fs.promises.access(metaPath).then(() => true).catch(() => false);
}

async function getPaths(taskId, workDir, contentDir) {
  if (isArticleId(taskId)) {
    const filePath = await resolveArticleFile(contentDir, slugFromId(taskId));
    if (!filePath) return null;
    return getArticleAnnotationDirs(filePath);
  }
  if (!await assertItemExists(taskId, workDir, contentDir)) return null;
  return getVideoDirs(workDir, taskId);
}

async function countAnnotations(paths) {
  if (!paths) return { highlightCount: 0, noteCount: 0 };
  const [highlights, notes] = await Promise.all([
    readJson(paths.highlights, []),
    readJson(paths.notes, []),
  ]);
  return { highlightCount: highlights.length, noteCount: notes.length };
}

function createApp(options = {}) {
  const WORK_DIR = options.workDir || null;
  const CONTENT_DIR = options.contentDir || null;
  const token = options.token || crypto.randomBytes(24).toString('hex');

  const app = new Koa();
  const rootRouter = new Router();
  const router = new Router({ prefix: '/api' });

  rootRouter.get('/healthz', async (ctx) => { ctx.body = { ok: true }; });
  rootRouter.get('/version', async (ctx) => { ctx.body = { version: '0.1.0' }; });

  // Auth
  router.use(async (ctx, next) => {
    if (/\/tasks\/[^/]+\/media\//.test(ctx.path)) return next();
    if (/\/tasks\/[^/]+\/content\/asset$/.test(ctx.path)) return next();
    const bearer = (ctx.get('Authorization') || '').replace(/^Bearer /, '');
    if (!bearer || bearer !== token) { ctx.status = 401; ctx.body = { error: 'UNAUTHORIZED' }; return; }
    return next();
  });

  // List videos (same shape as VDL's /api/tasks for frontend compatibility)
  router.get('/tasks', async (ctx) => {
    if (!WORK_DIR) { ctx.body = []; return; }
    const tasks = await listVideos(WORK_DIR);
    ctx.body = await Promise.all(tasks.map(async (t) => {
      const paths = await getPaths(t.id, WORK_DIR, CONTENT_DIR);
      return { ...t, ...(await countAnnotations(paths)) };
    }));
  });

  // List articles
  router.get('/articles', async (ctx) => {
    if (!CONTENT_DIR) { ctx.body = []; return; }
    try {
      const articles = await listArticles(CONTENT_DIR);
      ctx.body = await Promise.all(articles.map(async (a) => {
        const paths = await getPaths(a.id, WORK_DIR, CONTENT_DIR);
        return { ...a, ...(await countAnnotations(paths)) };
      }));
    }
    catch (err) { ctx.status = 500; ctx.body = { error: err.message }; }
  });

  // Get task (video or article)
  router.get('/tasks/:taskId', async (ctx) => {
    const { taskId } = ctx.params;
    if (isArticleId(taskId)) {
      if (!CONTENT_DIR) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
      const t = await getArticleTask(taskId, CONTENT_DIR);
      if (!t) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
      ctx.body = t; return;
    }
    if (!WORK_DIR) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const t = await getVideoTask(taskId, WORK_DIR);
    if (!t) { ctx.status = 404; ctx.body = { error: 'task not found' }; return; }
    ctx.body = t;
  });

  // Media info
  router.get('/tasks/:taskId/media', async (ctx) => {
    const { taskId } = ctx.params;
    if (isArticleId(taskId)) {
      ctx.body = { video: { exists: false }, audio: { exists: false } }; return;
    }
    if (!WORK_DIR) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const t = await getVideoTask(taskId, WORK_DIR);
    if (!t) { ctx.status = 404; ctx.body = { error: 'task not found' }; return; }
    ctx.body = await getVideoMediaInfo(taskId, WORK_DIR);
  });

  // Stream media file
  router.get('/tasks/:taskId/media/:kind', async (ctx) => {
    const { taskId, kind } = ctx.params;
    if (kind !== 'video' && kind !== 'audio') { ctx.status = 400; return; }
    const bearer = (ctx.get('Authorization') || '').replace(/^Bearer /, '');
    const qToken = String((ctx.query && ctx.query.token) || '');
    if (bearer !== token && qToken !== token) { ctx.status = 401; return; }
    if (!WORK_DIR) { ctx.status = 404; return; }
    const filename = kind === 'video' ? 'video.mp4' : 'audio.m4a';
    const filePath = path.join(WORK_DIR, taskId, 'media', filename);
    if (!WORK_DIR || !filePath.startsWith(WORK_DIR + path.sep)) { ctx.status = 400; return; }
    if (!fs.existsSync(filePath)) { ctx.status = 404; ctx.body = { error: 'file not found' }; return; }
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const mimeType = kind === 'video' ? 'video/mp4' : 'audio/mp4';
    const rangeHeader = ctx.get('Range');
    if (rangeHeader) {
      const [s, e] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(s, 10);
      const end = e ? parseInt(e, 10) : Math.min(start + 1024 * 1024, total - 1);
      ctx.status = 206;
      ctx.set('Content-Range', `bytes ${start}-${end}/${total}`);
      ctx.set('Accept-Ranges', 'bytes');
      ctx.set('Content-Length', String(end - start + 1));
      ctx.type = mimeType;
      ctx.body = fs.createReadStream(filePath, { start, end });
    } else {
      ctx.set('Accept-Ranges', 'bytes');
      ctx.set('Content-Length', String(total));
      ctx.type = mimeType;
      ctx.body = fs.createReadStream(filePath);
    }
  });

  // Step timing (gantt chart). No per-step timestamp data is recorded in
  // meta.json today, so this always returns an empty list rather than
  // fabricating timing — the frontend already renders a clean empty state.
  router.get('/tasks/:taskId/steps', async (ctx) => {
    const { taskId } = ctx.params;
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    ctx.body = [];
  });

  // Subtitles
  router.get('/tasks/:taskId/subtitles', async (ctx) => {
    const { taskId } = ctx.params;
    if (isArticleId(taskId)) { ctx.body = { tracks: [] }; return; }
    if (!WORK_DIR) { ctx.body = { tracks: [] }; return; }
    ctx.body = await getVideoSubtitles(taskId, WORK_DIR);
  });

  // Content
  router.get('/tasks/:taskId/result/content', async (ctx) => {
    const { taskId } = ctx.params;
    if (isArticleId(taskId)) {
      if (!CONTENT_DIR) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
      const md = await getArticleContent(taskId, CONTENT_DIR);
      if (md === null) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
      ctx.status = 200; ctx.set('Content-Type', 'text/markdown; charset=utf-8'); ctx.body = md; return;
    }
    const type = (ctx.query && ctx.query.type) || '';
    if (type !== 'article' && type !== 'summary') {
      ctx.status = 400; ctx.body = { error: 'type=article|summary required' }; return;
    }
    if (!WORK_DIR) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const md = await getVideoContent(taskId, WORK_DIR, type);
    if (md === null) { ctx.status = 404; ctx.body = { error: 'file not found' }; return; }
    ctx.status = 200; ctx.set('Content-Type', 'text/markdown; charset=utf-8'); ctx.body = md;
  });

  // Article asset (e.g. images under a Translation/Origin dir's sibling
  // Image/ folder, referenced via relative paths like ../Image/img_1.jpg).
  // Resolved relative to the article file's own directory, not CONTENT_DIR
  // root, and must not escape CONTENT_DIR.
  router.get('/tasks/:taskId/content/asset', async (ctx) => {
    const { taskId } = ctx.params;
    const bearer = (ctx.get('Authorization') || '').replace(/^Bearer /, '');
    const qToken = String((ctx.query && ctx.query.token) || '');
    if (bearer !== token && qToken !== token) { ctx.status = 401; return; }
    if (!isArticleId(taskId) || !CONTENT_DIR) { ctx.status = 404; return; }
    const relPath = String((ctx.query && ctx.query.path) || '');
    const ext = path.extname(relPath).toLowerCase();
    if (!relPath || !ASSET_MIME[ext]) { ctx.status = 400; return; }
    const filePath = await resolveArticleFile(CONTENT_DIR, slugFromId(taskId));
    if (!filePath) { ctx.status = 404; return; }
    const contentDirResolved = path.resolve(CONTENT_DIR);
    const target = path.resolve(path.dirname(filePath), relPath);
    if (!target.startsWith(contentDirResolved + path.sep)) { ctx.status = 400; return; }
    if (!fs.existsSync(target)) { ctx.status = 404; return; }
    ctx.type = ASSET_MIME[ext];
    ctx.body = fs.createReadStream(target);
  });

  // Highlights
  router.get('/tasks/:taskId/highlights', async (ctx) => {
    const { taskId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    ctx.body = await readJson(paths.highlights, []);
  });

  router.post('/tasks/:taskId/highlights', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', color = 'yellow' } = ctx.request.body || {};
    if (!anchor || typeof anchor !== 'string' || !anchor.trim()) { ctx.status = 400; ctx.body = { error: 'anchor required' }; return; }
    if (!['yellow', 'green', 'red', 'blue'].includes(color)) { ctx.status = 400; ctx.body = { error: 'invalid color' }; return; }
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    await fs.promises.mkdir(paths.base, { recursive: true });
    const hls = await readJson(paths.highlights, []);
    const hl = { id: crypto.randomUUID(), anchor: anchor.trim(), color, createdAt: Date.now() };
    hls.unshift(hl);
    await writeJson(paths.highlights, hls);
    ctx.status = 201; ctx.body = hl;
  });

  router.delete('/tasks/:taskId/highlights/:hlId', async (ctx) => {
    const { taskId, hlId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const hls = await readJson(paths.highlights, []);
    const filtered = hls.filter((h) => h.id !== hlId);
    if (filtered.length === hls.length) { ctx.status = 404; ctx.body = { error: 'highlight not found' }; return; }
    await writeJson(paths.highlights, filtered);
    ctx.status = 204;
  });

  // Notes
  router.get('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    ctx.body = await readJson(paths.notes, []);
  });

  router.post('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', mediaTimestamp, body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) { ctx.status = 400; ctx.body = { error: 'body required' }; return; }
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    await fs.promises.mkdir(paths.base, { recursive: true });
    const ns = await readJson(paths.notes, []);
    const now = Date.now();
    const note = { id: crypto.randomUUID(), anchor: anchor || '', ...(mediaTimestamp != null ? { mediaTimestamp: Number(mediaTimestamp) } : {}), body: body.trim(), createdAt: now, updatedAt: now };
    ns.unshift(note);
    await writeJson(paths.notes, ns);
    ctx.status = 201; ctx.body = note;
  });

  router.patch('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    const { body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) { ctx.status = 400; ctx.body = { error: 'body required' }; return; }
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const ns = await readJson(paths.notes, []);
    const idx = ns.findIndex((n) => n.id === noteId);
    if (idx === -1) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    ns[idx] = { ...ns[idx], body: body.trim(), updatedAt: Date.now() };
    await writeJson(paths.notes, ns);
    ctx.body = ns[idx];
  });

  router.delete('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const ns = await readJson(paths.notes, []);
    const filtered = ns.filter((n) => n.id !== noteId);
    if (filtered.length === ns.length) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    await writeJson(paths.notes, filtered);
    ctx.status = 204;
  });

  if (options.staticDir) {
    app.use(createStaticServe({ distDir: options.staticDir, token }));
  }

  app.use(bodyParser());
  app.use(rootRouter.routes());
  app.use(rootRouter.allowedMethods());
  app.use(router.routes());
  app.use(router.allowedMethods());

  return { app, token };
}

module.exports = { createApp };
