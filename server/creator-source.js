'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function normalizeHandle(handle) {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase();
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
//
// A channel added via a /channel/UC.../, /c/Name/, or /user/Name/ URL may
// have its raw channel_id (or a path-derived string) stored in `handle`
// instead of a proper @handle, so it can never match by normalized-handle
// comparison. Falls back to a raw comparison against the creator's
// channel_id (already a stable, case-sensitive UCxxxxx identifier — no
// normalization needed).
function resolveRegistryMatch(key, channelId) {
  const registry = readJsonSync(registryPath());
  if (!registry || !Array.isArray(registry.creators)) return null;
  for (const creator of registry.creators) {
    const youtubeChannels = (creator.channels || []).filter((c) => c.platform === 'youtube');
    const youtubeHandles = youtubeChannels.map((c) => normalizeHandle(c.handle));
    const matchesByChannelId = Boolean(channelId) && youtubeChannels.some((c) => c.handle === channelId);
    if (youtubeHandles.includes(key) || matchesByChannelId) {
      return { creatorId: creator.id, youtubeHandles };
    }
  }
  return null;
}

async function getCreator(key, workDir) {
  const normalizedKey = normalizeHandle(key);
  const index = readJsonSync(creatorsIndexPath(workDir));
  if (!index || !Array.isArray(index.creators)) return null;

  const byKey = new Map(index.creators.map((c) => [c.key, c]));
  const primary = byKey.get(normalizedKey);
  if (!primary) return null;

  const match = resolveRegistryMatch(normalizedKey, primary.channel_id);
  let videos = (primary.videos || []).slice();
  let channelId = primary.channel_id;
  let uploaderUrl = primary.uploader_url;

  if (match) {
    for (const handle of match.youtubeHandles) {
      if (handle === normalizedKey) continue;
      const other = byKey.get(handle);
      if (!other) continue;
      videos = videos.concat(other.videos);
      if (!channelId) channelId = other.channel_id;
      if (!uploaderUrl) uploaderUrl = other.uploader_url;
    }
  }

  // Concatenation order otherwise depends on which merged handle happens to
  // be primary, so sort newest-first by upload_date (a plain ISO
  // YYYY-MM-DD string — a straight string comparison sorts it correctly).
  // Missing/empty upload_date sorts last.
  videos.sort((a, b) => {
    const da = (a && a.upload_date) || '';
    const db = (b && b.upload_date) || '';
    if (da === db) return 0;
    return da < db ? 1 : -1;
  });

  return {
    key: normalizedKey,
    display_name: primary.display_name,
    channel_id: channelId,
    uploader_url: uploaderUrl,
    videos,
    watched: Boolean(match),
    creator_id: match ? match.creatorId : null,
  };
}

module.exports = { getCreator, normalizeHandle };
