'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-xs-'));
  const xDir = path.join(tmp, 'tweets');
  fs.mkdirSync(xDir, { recursive: true });

  const { listXTimelines, getXTimeline } = require('../server/x-source');

  // Real-magnitude 19-digit snowflake IDs — deliberately beyond
  // Number.MAX_SAFE_INTEGER (16 digits) to catch precision-loss bugs.
  const trqTweets = [
    {
      tweet_id: '2087258093499695106', url: 'https://x.com/trq212/status/2087258093499695106',
      text: 'oldest post', timestamp: '2026-08-11T19:21:23.000Z', author_handle: '@trq212',
      type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最旧的一条',
    },
    {
      tweet_id: '2088049989306192106', url: 'https://x.com/trq212/status/2088049989306192106',
      text: 'everything truly is code', timestamp: '2026-08-13T23:48:06.000Z', author_handle: '@trq212',
      type: 'quote', reply_to_handle: null, quoted_author: '@mannay',
      quoted_text: 'draw faces with js', quoted_timestamp: '2026-08-12T12:50:11.000Z', translated: '一切终究都是代码',
    },
    {
      tweet_id: '2088298127346536578', url: 'https://x.com/lydiahallie/status/2088298127346536578',
      text: 'newest repost content', timestamp: '2026-08-14T16:14:06.000Z', author_handle: '@lydiahallie',
      type: 'repost', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '最新的转推内容',
    },
    {
      tweet_id: '2088100000000000001', url: 'https://x.com/trq212/status/2088100000000000001',
      text: 'replying to openai', timestamp: '2026-08-14T01:00:00.000Z', author_handle: '@trq212',
      type: 'reply', reply_to_handle: '@openai', quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: '回复 openai',
    },
  ];
  fs.writeFileSync(path.join(xDir, 'trq212.json'), JSON.stringify(trqTweets));
  fs.writeFileSync(path.join(xDir, 'broken.json'), '{not valid json');
  fs.writeFileSync(path.join(xDir, 'empty.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(xDir, 'not-a-tweet-file.txt'), 'ignore me');
  fs.writeFileSync(path.join(xDir, 'partially-broken.json'), JSON.stringify([
    {
      tweet_id: '2088298127346536578', url: 'https://x.com/partially-broken/status/1',
      text: 'valid tweet', timestamp: '2026-08-14T16:14:06.000Z', author_handle: '@partially-broken',
      type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: null,
    },
    {
      tweet_id: null, url: 'https://x.com/partially-broken/status/2',
      text: 'tweet with missing tweet_id', timestamp: '2026-08-14T17:00:00.000Z', author_handle: '@partially-broken',
      type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
      quoted_timestamp: null, translated: null,
    },
  ]));

  await test('listXTimelines returns one summary per valid handle file, skipping corrupt JSON', async () => {
    const summaries = await listXTimelines(xDir);
    const handles = summaries.map((s) => s.handle).sort();
    assert.deepEqual(handles, ['empty', 'trq212']);
  });

  await test('listXTimelines summary uses the newest tweet by tweet_id, not by array order', async () => {
    const summaries = await listXTimelines(xDir);
    const trq = summaries.find((s) => s.handle === 'trq212');
    assert.equal(trq.tweetCount, 4);
    // Newest by tweet_id is the repost (2088298127346536578), which sits third
    // in the source array — proves this isn't just "last element wins".
    assert.equal(trq.latestAt, '2026-08-14T16:14:06.000Z');
    assert.equal(trq.latestPreview, '最新的转推内容');
  });

  await test('listXTimelines includes zero-tweet handles without latestAt/latestPreview', async () => {
    const summaries = await listXTimelines(xDir);
    const empty = summaries.find((s) => s.handle === 'empty');
    assert.equal(empty.tweetCount, 0);
    assert.equal(empty.latestAt, undefined);
    assert.equal(empty.latestPreview, undefined);
  });

  await test('listXTimelines returns [] for a missing directory', async () => {
    const summaries = await listXTimelines(path.join(tmp, 'does-not-exist'));
    assert.deepEqual(summaries, []);
  });

  await test('listXTimelines skips a handle whose array contains a tweet with a missing tweet_id, without crashing the whole list', async () => {
    const summaries = await listXTimelines(xDir);
    const handles = summaries.map((s) => s.handle).sort();
    assert.ok(!handles.includes('partially-broken'), 'the malformed handle should be skipped, not crash the whole call');
    assert.ok(handles.includes('trq212'), 'other valid handles must still be present');
  });

  await test('getXTimeline sorts tweets by tweet_id descending using BigInt precision', async () => {
    const timeline = await getXTimeline('trq212', xDir);
    assert.ok(timeline);
    assert.deepEqual(timeline.tweets.map((t) => t.tweet_id), [
      '2088298127346536578', // repost, newest
      '2088100000000000001', // reply
      '2088049989306192106', // quote
      '2087258093499695106', // post, oldest
    ]);
  });

  await test('getXTimeline preserves quote-specific fields untouched', async () => {
    const timeline = await getXTimeline('trq212', xDir);
    const quote = timeline.tweets.find((t) => t.type === 'quote');
    assert.equal(quote.quoted_author, '@mannay');
    assert.equal(quote.quoted_text, 'draw faces with js');
    assert.equal(quote.quoted_timestamp, '2026-08-12T12:50:11.000Z');
  });

  await test('getXTimeline returns null for a corrupt JSON file', async () => {
    assert.equal(await getXTimeline('broken', xDir), null);
  });

  await test('getXTimeline returns null for a handle with no archive file', async () => {
    assert.equal(await getXTimeline('nobody', xDir), null);
  });

  await test('getXTimeline returns null for a handle containing path separators', async () => {
    assert.equal(await getXTimeline('../broken', xDir), null);
    assert.equal(await getXTimeline('sub/dir', xDir), null);
  });

  await test('getXTimeline returns an empty tweets array for a handle with zero tweets', async () => {
    const timeline = await getXTimeline('empty', xDir);
    assert.deepEqual(timeline, { handle: 'empty', tweets: [] });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
