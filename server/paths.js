'use strict';
const path = require('path');
const os = require('os');

function expandPath(value) {
  let out = String(value).trim();
  if (out === '~') return os.homedir();
  if (out.startsWith('~/')) return path.join(os.homedir(), out.slice(2));
  return out;
}

function getVideoDirs(workDir, taskId) {
  if (!taskId || typeof taskId !== 'string') throw new Error('taskId required');
  const base = path.join(workDir, taskId);
  return {
    base,
    media:      path.join(base, 'media'),
    transcript: path.join(base, 'transcript'),
    writing:    path.join(base, 'writing'),
    notes:      path.join(base, 'notes.json'),
    highlights: path.join(base, 'highlights.json'),
  };
}

function getArticleDirs(workDir, slug) {
  if (!slug || typeof slug !== 'string') throw new Error('slug required');
  if (/[/\\]/.test(slug) || slug.includes('..')) throw new Error(`Invalid article slug: ${slug}`);
  const base = path.join(workDir, `article-${slug}`);
  return {
    base,
    notes:      path.join(base, 'notes.json'),
    highlights: path.join(base, 'highlights.json'),
  };
}

module.exports = { expandPath, getVideoDirs, getArticleDirs };
