'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function normalizeHandle(handle) {
  return String(handle || '').replace(/^@/, '').trim().toLowerCase();
}

function readJsonSync(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function creatorsIndexPath(workDir) {
  // workDir = <knowledgeRoot>/videos/work; creators.json is its sibling
  // (docs/superpowers/specs/2026-09-15-video-creator-index-design.md §2.4).
  return path.join(path.dirname(workDir), 'creators.json');
}

function registryPath() {
  const rosterConfig = readJsonSync(path.join(os.homedir(), '.hskill', 'roster', 'config.json'));
  const dataDir = (rosterConfig && rosterConfig.DATA_DIR) || path.join(os.homedir(), '.hskill', 'roster');
  return path.join(dataDir, 'registry.json');
}

// Finds the registry record (if any) whose YouTube channels include this
// normalized handle, and returns every other YouTube handle that same
// record owns — covers a merged-handle lookup either way (criterion #6).
function resolveRegistryMatch(key) {
  const registry = readJsonSync(registryPath());
  if (!registry || !Array.isArray(registry.creators)) return null;
  for (const creator of registry.creators) {
    const youtubeHandles = (creator.channels || [])
      .filter((c) => c.platform === 'youtube')
      .map((c) => normalizeHandle(c.handle));
    if (youtubeHandles.includes(key)) {
      return { creatorId: creator.id, youtubeHandles };
    }
  }
  return null;
}

async function getCreator(key, workDir) {
  const index = readJsonSync(creatorsIndexPath(workDir));
  if (!index || !Array.isArray(index.creators)) return null;

  const byKey = new Map(index.creators.map((c) => [c.key, c]));
  const primary = byKey.get(key);
  if (!primary) return null;

  const match = resolveRegistryMatch(key);
  let videos = primary.videos.slice();
  let channelId = primary.channel_id;
  let uploaderUrl = primary.uploader_url;

  if (match) {
    for (const handle of match.youtubeHandles) {
      if (handle === key) continue;
      const other = byKey.get(handle);
      if (!other) continue;
      videos = videos.concat(other.videos);
      if (!channelId) channelId = other.channel_id;
      if (!uploaderUrl) uploaderUrl = other.uploader_url;
    }
  }

  return {
    key,
    display_name: primary.display_name,
    channel_id: channelId,
    uploader_url: uploaderUrl,
    videos,
    watched: Boolean(match),
    creator_id: match ? match.creatorId : null,
  };
}

module.exports = { getCreator, normalizeHandle };
