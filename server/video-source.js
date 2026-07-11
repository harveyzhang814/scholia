'use strict';
const fs = require('fs');
const path = require('path');
const { getVideoDirs } = require('./paths');

function isVideoId(id) {
  return typeof id === 'string' && id.length > 0 && !id.startsWith('article-');
}

function occurrenceDate(meta, fallbackMs) {
  for (const candidate of [meta.ts, meta.created_at]) {
    if (candidate) {
      const t = Date.parse(candidate);
      if (!Number.isNaN(t)) return t;
    }
  }
  const m = typeof meta.upload_date === 'string' && /^(\d{4})(\d{2})(\d{2})$/.exec(meta.upload_date);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return fallbackMs;
}

async function listVideos(workDir) {
  let entries;
  try { entries = await fs.promises.readdir(workDir, { withFileTypes: true }); }
  catch { return []; }
  const results = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('article-')) continue;
    const metaPath = path.join(workDir, e.name, 'meta.json');
    try {
      const raw = await fs.promises.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw);
      const stat = await fs.promises.stat(metaPath);
      results.push({
        id: e.name,
        url: meta.url || '',
        title: meta.title,
        uploader: meta.uploader,
        upload_date: meta.upload_date,
        duration: meta.duration != null ? String(meta.duration) : undefined,
        mode: meta.mode,
        output_lang: meta.output_lang,
        created_at: meta.ts || meta.created_at,
        updated_at: meta.ts || meta.created_at,
        updatedAt: occurrenceDate(meta, stat.mtimeMs),
      });
    } catch { /* skip dirs without valid meta.json */ }
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt).map(({ updatedAt, ...rest }) => rest);
}

async function getVideoTask(taskId, workDir) {
  const metaPath = path.join(workDir, taskId, 'meta.json');
  let meta;
  try { meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8')); }
  catch { return null; }
  const ts = meta.ts || meta.created_at || new Date().toISOString();
  return {
    task_id: taskId,
    status: 'completed',
    meta: {
      id: taskId,
      url: meta.url || '',
      title: meta.title,
      uploader: meta.uploader,
      upload_date: meta.upload_date,
      duration: meta.duration != null ? String(meta.duration) : undefined,
      mode: meta.mode || 'media',
      output_lang: meta.output_lang,
      ts,
      created_at: ts,
    },
  };
}

async function getVideoMediaInfo(taskId, workDir) {
  const dirs = getVideoDirs(workDir, taskId);
  const videoPath = path.join(dirs.media, 'video.mp4');
  const audioPath = path.join(dirs.media, 'audio.m4a');
  return {
    video: { path: videoPath, exists: fs.existsSync(videoPath) },
    audio: { path: audioPath, exists: fs.existsSync(audioPath) },
  };
}

async function getVideoSubtitles(taskId, workDir) {
  const transcriptDir = path.join(workDir, taskId, 'transcript');
  const specs = [
    { file: 'original_zh.vtt', id: 'original_zh', lang: 'zh', label: '中文' },
    { file: 'original_en.vtt', id: 'original_en', lang: 'en', label: 'English' },
  ];
  const tracks = [];
  for (const spec of specs) {
    for (const candidate of [
      path.resolve(transcriptDir, spec.file),
      path.resolve(transcriptDir, 'subs', spec.file),
    ]) {
      if (!candidate.startsWith(transcriptDir + path.sep)) continue;
      try {
        const vtt = await fs.promises.readFile(candidate, 'utf8');
        tracks.push({ id: spec.id, lang: spec.lang, label: spec.label, vtt });
        break;
      } catch {}
    }
  }
  return { tracks };
}

async function getVideoContent(taskId, workDir, type) {
  const writingDir = path.join(workDir, taskId, 'writing');
  const filename = type === 'summary' ? 'summary.md' : 'article.md';
  const filePath = path.resolve(writingDir, filename);
  if (!filePath.startsWith(writingDir + path.sep) && filePath !== path.join(writingDir, filename)) {
    return null;
  }
  try { return await fs.promises.readFile(filePath, 'utf8'); }
  catch { return null; }
}

module.exports = { isVideoId, listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent };
