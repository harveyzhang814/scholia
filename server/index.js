'use strict';
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { getVideoDirs, getArticleDirs } = require('./paths');
const { listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent } = require('./video-source');
const { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent } = require('./article-source');
const { createStaticServe } = require('./static-serve');

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

function getPaths(taskId, workDir) {
  if (isArticleId(taskId)) return getArticleDirs(workDir, slugFromId(taskId));
  return getVideoDirs(workDir, taskId);
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
    const bearer = (ctx.get('Authorization') || '').replace(/^Bearer /, '');
    if (!bearer || bearer !== token) { ctx.status = 401; ctx.body = { error: 'UNAUTHORIZED' }; return; }
    return next();
  });

  // List videos (same shape as VDL's /api/tasks for frontend compatibility)
  router.get('/tasks', async (ctx) => {
    if (!WORK_DIR) { ctx.body = []; return; }
    ctx.body = await listVideos(WORK_DIR);
  });

  // List articles
  router.get('/articles', async (ctx) => {
    if (!CONTENT_DIR) { ctx.body = []; return; }
    try { ctx.body = await listArticles(CONTENT_DIR); }
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

  // Highlights
  router.get('/tasks/:taskId/highlights', async (ctx) => {
    const { taskId } = ctx.params;
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { highlights } = getPaths(taskId, WORK_DIR);
    ctx.body = await readJson(highlights, []);
  });

  router.post('/tasks/:taskId/highlights', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', color = 'yellow' } = ctx.request.body || {};
    if (!anchor || typeof anchor !== 'string' || !anchor.trim()) { ctx.status = 400; ctx.body = { error: 'anchor required' }; return; }
    if (!['yellow', 'green', 'red', 'blue'].includes(color)) { ctx.status = 400; ctx.body = { error: 'invalid color' }; return; }
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { base, highlights } = getPaths(taskId, WORK_DIR);
    await fs.promises.mkdir(base, { recursive: true });
    const hls = await readJson(highlights, []);
    const hl = { id: crypto.randomUUID(), anchor: anchor.trim(), color, createdAt: Date.now() };
    hls.unshift(hl);
    await writeJson(highlights, hls);
    ctx.status = 201; ctx.body = hl;
  });

  router.delete('/tasks/:taskId/highlights/:hlId', async (ctx) => {
    const { taskId, hlId } = ctx.params;
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { highlights } = getPaths(taskId, WORK_DIR);
    const hls = await readJson(highlights, []);
    const filtered = hls.filter((h) => h.id !== hlId);
    if (filtered.length === hls.length) { ctx.status = 404; ctx.body = { error: 'highlight not found' }; return; }
    await writeJson(highlights, filtered);
    ctx.status = 204;
  });

  // Notes
  router.get('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { notes } = getPaths(taskId, WORK_DIR);
    ctx.body = await readJson(notes, []);
  });

  router.post('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', mediaTimestamp, body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) { ctx.status = 400; ctx.body = { error: 'body required' }; return; }
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { base, notes } = getPaths(taskId, WORK_DIR);
    await fs.promises.mkdir(base, { recursive: true });
    const ns = await readJson(notes, []);
    const now = Date.now();
    const note = { id: crypto.randomUUID(), anchor: anchor || '', ...(mediaTimestamp != null ? { mediaTimestamp: Number(mediaTimestamp) } : {}), body: body.trim(), createdAt: now, updatedAt: now };
    ns.unshift(note);
    await writeJson(notes, ns);
    ctx.status = 201; ctx.body = note;
  });

  router.patch('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    const { body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) { ctx.status = 400; ctx.body = { error: 'body required' }; return; }
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { notes } = getPaths(taskId, WORK_DIR);
    const ns = await readJson(notes, []);
    const idx = ns.findIndex((n) => n.id === noteId);
    if (idx === -1) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    ns[idx] = { ...ns[idx], body: body.trim(), updatedAt: Date.now() };
    await writeJson(notes, ns);
    ctx.body = ns[idx];
  });

  router.delete('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    if (!await assertItemExists(taskId, WORK_DIR, CONTENT_DIR)) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const { notes } = getPaths(taskId, WORK_DIR);
    const ns = await readJson(notes, []);
    const filtered = ns.filter((n) => n.id !== noteId);
    if (filtered.length === ns.length) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    await writeJson(notes, filtered);
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
