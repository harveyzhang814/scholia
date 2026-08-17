'use strict';
const fs = require('fs');
const path = require('path');

function isValidHandle(handle) {
  return typeof handle === 'string' && handle.length > 0 && !/[/\\]/.test(handle) && !handle.includes('..');
}

// tweet_id is a 19-digit snowflake ID, beyond Number.MAX_SAFE_INTEGER
// (16 digits) — comparing as Number silently loses precision and produces
// wrong ordering. BigInt is required here.
function compareTweetIdDesc(a, b) {
  const diff = BigInt(b.tweet_id) - BigInt(a.tweet_id);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

async function readHandleFile(xDir, handle) {
  const filePath = path.join(xDir, `${handle}.json`);
  let raw;
  try { raw = await fs.promises.readFile(filePath, 'utf8'); }
  catch { return null; }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

async function listXTimelines(xDir, readIds = new Set()) {
  let entries;
  try { entries = await fs.promises.readdir(xDir, { withFileTypes: true }); }
  catch { return []; }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
  const summaries = [];
  for (const file of files) {
    const handle = path.basename(file.name, '.json');
    const tweets = await readHandleFile(xDir, handle);
    if (!tweets) continue; // corrupt/non-array JSON — skip this handle, don't fail the whole list
    try {
      const sorted = tweets.slice().sort(compareTweetIdDesc);
      const latest = sorted[0];
      summaries.push({
        handle,
        tweetCount: tweets.length,
        latestAt: latest ? latest.timestamp : undefined,
        latestPreview: latest ? (latest.translated ?? latest.text) : undefined,
        hasUnread: tweets.some((t) => !readIds.has(`tweet-${t.tweet_id}`)),
      });
    } catch {
      continue; // a tweet with a missing/invalid tweet_id shouldn't take down the whole list
    }
  }
  summaries.sort((a, b) => {
    const at = a.latestAt ? Date.parse(a.latestAt) : 0;
    const bt = b.latestAt ? Date.parse(b.latestAt) : 0;
    return bt - at;
  });
  return summaries;
}

async function getXTimeline(handle, xDir) {
  if (!isValidHandle(handle)) return null;
  const tweets = await readHandleFile(xDir, handle);
  if (!tweets) return null;
  return { handle, tweets: tweets.slice().sort(compareTweetIdDesc) };
}

module.exports = { listXTimelines, getXTimeline };
