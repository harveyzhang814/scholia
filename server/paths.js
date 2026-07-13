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
  if (/[/\\]/.test(taskId) || taskId.includes('..')) throw new Error(`Invalid taskId: ${taskId}`);
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

function getArticleAnnotationDirs(articleFilePath) {
  const { dir, name } = path.parse(articleFilePath);
  const base = path.join(dir, name);
  return {
    base,
    notes:      path.join(base, 'notes.json'),
    highlights: path.join(base, 'highlights.json'),
  };
}

module.exports = { expandPath, getVideoDirs, getArticleAnnotationDirs };
