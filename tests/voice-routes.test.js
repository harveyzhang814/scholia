'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createApp } = require('../server/index');

const TOKEN = 'voice-routes-test-token';

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// A crash in a late stream write or an unobserved rejection is a server bug.
process.on('unhandledRejection', (e) => {
  console.error(`  ✗ unhandled rejection: ${e && e.message}`);
  process.exit(1);
});
process.on('uncaughtException', (e) => {
  console.error(`  ✗ uncaught exception: ${e && e.message}`);
  process.exit(1);
});

class FakeSession extends EventEmitter {
  constructor() { super(); this.stopCalls = 0; this.cancelCalls = 0; }
  async stop() { this.stopCalls++; }
  async cancel() { this.cancelCalls++; }
}

class FakeClient {
  constructor() {
    this.last = null;
    this.lastRetry = null;
    this.statusError = null;
    // Runs right after the session is handed to the voice module (listeners attached).
    this.onStart = (session) => session.emit('phase', 'recording');
  }
  startSession() {
    const session = new FakeSession();
    this.last = session;
    setImmediate(() => this.onStart(session));
    return session;
  }
  retryTask(taskId, opts) {
    const session = new FakeSession();
    this.lastRetry = [taskId, opts];
    this.last = session;
    return session;
  }
  async status() { if (this.statusError) throw this.statusError; return { phase: 'idle' }; }
}

async function makeServer(voiceClient) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scholia-voice-'));
  const contentDir = path.join(tmp, 'content');
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'intro.md'), '---\ntitle: Intro\n---\n\n# Hello world');
  const { app } = createApp({ contentDir, token: TOKEN, voiceClient, readStatePath: path.join(tmp, 'read-state.json') });
  const server = http.createServer(app.callback());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const close = () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); };
  return { port, close, contentDir };
}

function rawFetch(port, method, urlPath, body, extra = {}) {
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const opts = { method, headers, ...extra };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`http://127.0.0.1:${port}${urlPath}`, opts);
}

async function req(port, method, urlPath, body) {
  const res = await rawFetch(port, method, urlPath, body);
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  return { status: res.status, body: json };
}

const parseLines = (text) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Bounded poll (<= 1s): resolves as soon as cond() is truthy, rejects on timeout.
async function waitFor(cond, what) {
  const deadline = Date.now() + 1000;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

const ANCHOR = { taskId: 'article-intro', anchor: 'Hello world', prefix: '# ', suffix: '', position: 2 };

async function startSession(port, body = ANCHOR) {
  const r = await req(port, 'POST', '/api/voice/sessions', body);
  assert.equal(r.status, 201);
  assert.ok(r.body.id);
  return r.body.id;
}

(async () => {
  await test('status reports availability from client', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      assert.deepEqual((await req(s.port, 'GET', '/api/voice/status')).body, { available: true });
      fake.statusError = new Error('app not running');
      const r = await req(s.port, 'GET', '/api/voice/status');
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { available: false });
    } finally { await s.close(); }
  });

  await test('start rejects video ids with 400', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const r = await req(s.port, 'POST', '/api/voice/sessions', { ...ANCHOR, taskId: 'abc123def456' });
      assert.equal(r.status, 400);
      assert.equal(fake.last, null);
      const r2 = await req(s.port, 'POST', '/api/voice/sessions', { ...ANCHOR, taskId: 'article-missing' });
      assert.equal(r2.status, 404);
      assert.equal(fake.last, null);
    } finally { await s.close(); }
  });

  await test('start rejects bad prefix like notes POST does', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const bad = { ...ANCHOR, prefix: 'x'.repeat(33) };
      const r = await req(s.port, 'POST', '/api/voice/sessions', bad);
      assert.equal(r.status, 400);
      const manual = await req(s.port, 'POST', '/api/tasks/article-intro/notes', { body: 'b', anchor: 'a', prefix: bad.prefix });
      assert.equal(manual.status, 400);
      assert.equal(r.body.error, manual.body.error);
      assert.equal(fake.last, null);
    } finally { await s.close(); }
  });

  await test('start maps app_not_running to 503 and busy to 409', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      fake.onStart = (session) => session.emit('error', Object.assign(new Error('x'), { code: 'app_not_running' }));
      let r = await req(s.port, 'POST', '/api/voice/sessions', ANCHOR);
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { error: 'app_not_running' });

      fake.onStart = (session) => session.emit('failed', { code: 'busy', message: 'busy' });
      r = await req(s.port, 'POST', '/api/voice/sessions', ANCHOR);
      assert.equal(r.status, 409);
      assert.deepEqual(r.body, { error: 'busy' });

      fake.onStart = (session) => session.emit('failed', { code: 'weird', message: 'w' });
      r = await req(s.port, 'POST', '/api/voice/sessions', ANCHOR);
      assert.equal(r.status, 502);
      assert.deepEqual(r.body, { error: 'weird' });
    } finally { await s.close(); }
  });

  await test('stop streams phases then the saved note', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const id = await startSession(s.port);
      const session = fake.last;
      const resP = rawFetch(s.port, 'POST', `/api/voice/sessions/${id}/stop`);
      await waitFor(() => session.stopCalls === 1, 'stop to reach the session');
      session.emit('phase', 'transcribing');
      session.emit('phase', 'refining');
      session.emit('completed', { text: '说的话' });
      const res = await resP;
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^application\/x-ndjson/);
      const lines = parseLines(await res.text());
      assert.equal(lines.length, 3);
      assert.deepEqual(lines[0], { type: 'phase', phase: 'transcribing' });
      assert.deepEqual(lines[1], { type: 'phase', phase: 'refining' });
      assert.equal(lines[2].type, 'note');
      assert.equal(lines[2].note.body, '说的话');
      assert.equal(lines[2].note.anchor, ANCHOR.anchor);
      assert.equal(lines[2].note.prefix, ANCHOR.prefix);
      assert.equal(lines[2].note.position, ANCHOR.position);
      assert.equal(session.stopCalls, 1);
      const notes = await req(s.port, 'GET', '/api/tasks/article-intro/notes');
      assert.ok(notes.body.some((n) => n.id === lines[2].note.id && n.body === '说的话'));
    } finally { await s.close(); }
  });

  await test('stop streams failed with retry info', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const id = await startSession(s.port);
      const session = fake.last;
      const resP = rawFetch(s.port, 'POST', `/api/voice/sessions/${id}/stop`);
      await waitFor(() => session.stopCalls === 1, 'stop to reach the session');
      session.emit('phase', 'transcribing');
      session.emit('failed', { code: 'transcription_failed', message: 'nope', taskId: 't1', canRetry: true });
      const res = await resP;
      assert.equal(res.status, 200);
      const lines = parseLines(await res.text());
      assert.deepEqual(lines[0], { type: 'phase', phase: 'transcribing' });
      assert.deepEqual(lines[lines.length - 1], {
        type: 'failed', code: 'transcription_failed', message: 'nope', taskId: 't1', canRetry: true,
      });
      const notes = await req(s.port, 'GET', '/api/tasks/article-intro/notes');
      assert.deepEqual(notes.body, []);
    } finally { await s.close(); }
  });

  await test('stop on unknown id is 404 json', async () => {
    const s = await makeServer(new FakeClient());
    try {
      const res = await rawFetch(s.port, 'POST', '/api/voice/sessions/nope/stop');
      assert.equal(res.status, 404);
      assert.match(res.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await res.json(), { error: 'not found' });
    } finally { await s.close(); }
  });

  await test('note is saved even if the client disconnects after stop', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const id = await startSession(s.port);
      const session = fake.last;
      const ac = new AbortController();
      const resP = rawFetch(s.port, 'POST', `/api/voice/sessions/${id}/stop`, undefined, { signal: ac.signal });
      await waitFor(() => session.stopCalls === 1, 'stop to reach the session');
      session.emit('phase', 'transcribing');
      const res = await resP; // headers arrive with the first line
      const reader = res.body.getReader();
      const first = await reader.read();
      assert.deepEqual(parseLines(Buffer.from(first.value).toString('utf8'))[0], { type: 'phase', phase: 'transcribing' });
      ac.abort();
      await reader.read().catch(() => {});
      // Give the server a moment to see the socket close, so the late writes
      // below hit a destroyed stream (their outcome is covered by "no crash").
      await new Promise((r) => setTimeout(r, 30));
      session.emit('phase', 'refining');
      session.emit('completed', { text: '断线也要存' });
      const note = await waitFor(async () => {
        const r = await req(s.port, 'GET', '/api/tasks/article-intro/notes');
        return r.body.find((n) => n.body === '断线也要存');
      }, 'the note to reach disk');
      assert.equal(note.anchor, ANCHOR.anchor);
    } finally { await s.close(); }
  });

  await test('voice save and manual note POST at once both persist', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const id = await startSession(s.port);
      const session = fake.last;
      const stopP = rawFetch(s.port, 'POST', `/api/voice/sessions/${id}/stop`);
      await waitFor(() => session.stopCalls === 1, 'stop to reach the session');
      // Fire both in the same tick: the emit starts the voice save, the POST is in flight.
      const manualP = req(s.port, 'POST', '/api/tasks/article-intro/notes', { anchor: 'm', body: '手写' });
      session.emit('completed', { text: '语音' });
      const [manual, stopRes] = await Promise.all([manualP, stopP]);
      assert.equal(manual.status, 201);
      const lines = parseLines(await stopRes.text());
      assert.equal(lines[lines.length - 1].type, 'note');
      const notes = (await req(s.port, 'GET', '/api/tasks/article-intro/notes')).body;
      assert.equal(notes.length, 2);
      assert.deepEqual(notes.map((n) => n.body).sort(), ['手写', '语音'].sort());
    } finally { await s.close(); }
  });

  await test('retry streams like stop and saves', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      let r = await req(s.port, 'POST', '/api/voice/retry', ANCHOR);
      assert.equal(r.status, 400);
      r = await req(s.port, 'POST', '/api/voice/retry', { ...ANCHOR, cocoTaskId: '' });
      assert.equal(r.status, 400);
      assert.equal(fake.lastRetry, null);

      const resP = rawFetch(s.port, 'POST', '/api/voice/retry', { ...ANCHOR, cocoTaskId: 't1' });
      await waitFor(() => fake.lastRetry, 'retry to reach the client');
      assert.equal(fake.lastRetry[0], 't1');
      const session = fake.last;
      session.emit('phase', 'transcribing');
      session.emit('phase', 'refining');
      session.emit('completed', { text: '重试成功' });
      const res = await resP;
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^application\/x-ndjson/);
      const lines = parseLines(await res.text());
      assert.equal(lines.length, 3);
      assert.equal(lines[2].type, 'note');
      assert.equal(lines[2].note.body, '重试成功');
      assert.equal(lines[2].note.anchor, ANCHOR.anchor);
      const notes = await req(s.port, 'GET', '/api/tasks/article-intro/notes');
      assert.ok(notes.body.some((n) => n.body === '重试成功'));
    } finally { await s.close(); }
  });

  await test('voiceClient null makes status false and start 503 unavailable', async () => {
    const s = await makeServer(null);
    try {
      assert.deepEqual((await req(s.port, 'GET', '/api/voice/status')).body, { available: false });
      const r = await req(s.port, 'POST', '/api/voice/sessions', ANCHOR);
      assert.equal(r.status, 503);
      assert.deepEqual(r.body, { error: 'unavailable' });
    } finally { await s.close(); }
  });

  // Extras beyond the brief's 11.
  await test('voice routes require the bearer token', async () => {
    const s = await makeServer(new FakeClient());
    try {
      const res = await fetch(`http://127.0.0.1:${s.port}/api/voice/status`);
      assert.equal(res.status, 401);
      const res2 = await fetch(`http://127.0.0.1:${s.port}/api/voice/sessions/x`, { method: 'DELETE' });
      assert.equal(res2.status, 401);
    } finally { await s.close(); }
  });

  await test('delete cancels a session and 404s on unknown id', async () => {
    const fake = new FakeClient();
    const s = await makeServer(fake);
    try {
      const id = await startSession(s.port);
      const res = await rawFetch(s.port, 'DELETE', `/api/voice/sessions/${id}`);
      assert.equal(res.status, 204);
      assert.equal(fake.last.cancelCalls, 1);
      const res2 = await rawFetch(s.port, 'DELETE', '/api/voice/sessions/nope');
      assert.equal(res2.status, 404);
    } finally { await s.close(); }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
