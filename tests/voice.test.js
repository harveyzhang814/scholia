'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVoice } = require('../server/voice');

let passed = 0; let failed = 0;
// If a promise never settles the event loop drains and Node exits 0 with no summary;
// treat that as a failure instead of a silent pass.
let finished = false;
process.on('exit', () => {
  if (!finished && !process.exitCode) {
    console.error('  ✗ suite did not finish (a promise never settled)');
    process.exitCode = 1;
  }
});
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

// A rejection nobody observed is a bug in voice.js, not in the test.
process.on('unhandledRejection', (e) => {
  console.error(`  ✗ unhandled rejection: ${e && e.message}`);
  process.exit(1);
});

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.stopCalls = 0;
    this.cancelCalls = 0;
    this.stopError = null;
  }
  async stop() { this.stopCalls++; if (this.stopError) throw this.stopError; }
  async cancel() { this.cancelCalls++; }
}

class FakeClient {
  constructor() {
    this.last = null; this.lastOpts = null; this.lastRetry = null;
    this.statusError = null;
  }
  startSession(opts) { this.lastOpts = opts; this.last = new FakeSession(); return this.last; }
  retryTask(taskId, opts) { this.lastRetry = [taskId, opts]; this.last = new FakeSession(); return this.last; }
  async status() { if (this.statusError) throw this.statusError; return { phase: 'idle' }; }
}

function setup(opts = {}) {
  const fake = new FakeClient();
  const saved = [];
  const saveNote = opts.saveNote || (async (taskId, fields) => { saved.push([taskId, fields]); return { id: 'n1', ...fields }; });
  const voice = createVoice({ getClient: opts.getClient || (() => fake), saveNote, startTimeoutMs: opts.startTimeoutMs });
  return { fake, voice, saved };
}

async function startRecording(voice, fake, taskId = 'article-a', anchor = { anchor: 'x' }) {
  const p = voice.start(taskId, anchor);
  fake.last.emit('phase', 'starting');
  fake.last.emit('phase', 'recording');
  return p;
}

const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  await test('start passes fixed session options and resolves on recording', async () => {
    const { voice, fake } = setup();
    const p = voice.start('article-a', { anchor: 'x' });
    fake.last.emit('phase', 'starting'); fake.last.emit('phase', 'recording');
    const r = await p;
    assert.ok(r.id);
    assert.deepEqual(fake.lastOpts, { mode: 'comprehend', silent: true, awaitEdit: false });
    assert.equal(voice.size(), 1);
  });

  await test('start maps transport error to app_not_running', async () => {
    const { voice, fake } = setup();
    const p = voice.start('article-a', { anchor: 'x' });
    fake.last.emit('error', Object.assign(new Error('x'), { code: 'app_not_running' }));
    assert.deepEqual(await p, { error: 'app_not_running' });
    assert.equal(voice.size(), 0);

    const p2 = voice.start('article-a', { anchor: 'x' });
    fake.last.emit('error', new Error('connection closed'));
    assert.deepEqual(await p2, { error: 'transport' });
  });

  await test('start maps failed busy to busy', async () => {
    const { voice, fake } = setup();
    const p = voice.start('article-a', { anchor: 'x' });
    fake.last.emit('failed', { code: 'busy', message: 'm', canRetry: false });
    assert.deepEqual(await p, { error: 'busy' });
    assert.equal(voice.size(), 0);
  });

  await test('start without client is unavailable', async () => {
    const { voice } = setup({ getClient: () => null });
    assert.deepEqual(await voice.start('article-a', { anchor: 'x' }), { error: 'unavailable' });
    assert.equal(voice.size(), 0);
  });

  await test('stop forwards phases then saves trimmed text', async () => {
    const { voice, fake, saved } = setup();
    const { id } = await startRecording(voice, fake);
    const phases = [];
    const outcomeP = voice.stop(id, (ph) => phases.push(ph));
    assert.equal(fake.last.stopCalls, 1);
    fake.last.emit('phase', 'transcribing');
    fake.last.emit('phase', 'refining');
    fake.last.emit('phase', 'completed');
    fake.last.emit('completed', { text: '  你好  ', rawTranscript: 'raw' });
    const outcome = await outcomeP;
    assert.deepEqual(phases, ['transcribing', 'refining']);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], ['article-a', { anchor: 'x', body: '你好' }]);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.note.body, '你好');
    assert.equal(voice.size(), 0);
  });

  await test('completed with blank text fails as empty', async () => {
    const { voice, fake, saved } = setup();
    const { id } = await startRecording(voice, fake);
    const outcomeP = voice.stop(id, () => {});
    fake.last.emit('completed', { text: '  \n ', rawTranscript: 'raw' });
    const outcome = await outcomeP;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'empty');
    assert.equal(outcome.canRetry, false);
    assert.equal(saved.length, 0);
    assert.equal(voice.size(), 0);
  });

  await test('failed passes code, taskId and canRetry through', async () => {
    const { voice, fake, saved } = setup();
    const { id } = await startRecording(voice, fake);
    const outcomeP = voice.stop(id, () => {});
    fake.last.emit('failed', { code: 'transcription_failed', message: 'm', taskId: 't1', canRetry: true });
    assert.deepEqual(await outcomeP, {
      ok: false, code: 'transcription_failed', message: 'm', taskId: 't1', canRetry: true,
    });
    assert.equal(saved.length, 0);
    assert.equal(voice.size(), 0);
  });

  await test('unknown id stop returns null', async () => {
    const { voice } = setup();
    assert.equal(voice.stop('nope', () => {}), null);
  });

  await test('terminal event without stop still cleans up', async () => {
    const { voice, fake } = setup();
    const { id } = await startRecording(voice, fake);
    assert.equal(voice.size(), 1);
    fake.last.emit('failed', { code: 'timeout', message: 'm', canRetry: false });
    await tick();
    assert.equal(voice.size(), 0);
    assert.equal(voice.stop(id, () => {}), null);
  });

  await test('completed without anyone awaiting still saves', async () => {
    const { voice, fake, saved } = setup();
    const { id } = await startRecording(voice, fake);
    voice.stop(id, () => {}); // result deliberately not awaited
    fake.last.emit('completed', { text: ' 备注 ' });
    await tick();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], ['article-a', { anchor: 'x', body: '备注' }]);
    assert.equal(voice.size(), 0);
  });

  await test('cancel calls session.cancel', async () => {
    const { voice, fake } = setup();
    const { id } = await startRecording(voice, fake);
    assert.equal(await voice.cancel(id), true);
    assert.equal(fake.last.cancelCalls, 1);
    fake.last.emit('failed', { code: 'cancelled', message: 'm', canRetry: false });
    await tick();
    assert.equal(voice.size(), 0);
    assert.equal(await voice.cancel('nope'), false);
  });

  await test('retry uses retryTask and saves on completed', async () => {
    const { voice, fake, saved } = setup();
    const phases = [];
    const outcomeP = voice.retry('article-a', { anchor: 'x' }, 't1', (ph) => phases.push(ph));
    assert.deepEqual(fake.lastRetry, ['t1', { awaitEdit: false }]);
    fake.last.emit('phase', 'retrying');
    fake.last.emit('phase', 'transcribing');
    fake.last.emit('phase', 'refining');
    fake.last.emit('completed', { text: ' 重试 ' });
    const outcome = await outcomeP;
    assert.equal(outcome.ok, true);
    assert.deepEqual(phases, ['transcribing', 'refining']);
    assert.deepEqual(saved[0], ['article-a', { anchor: 'x', body: '重试' }]);
    assert.equal(voice.size(), 0);
  });

  await test('status false when client status rejects', async () => {
    const { voice, fake } = setup();
    assert.equal(await voice.status(), true);
    fake.statusError = new Error('down');
    assert.equal(await voice.status(), false);
    assert.equal(await setup({ getClient: () => null }).voice.status(), false);
  });

  // Extra cases for failure paths the 13 plan tests above do not pin down.
  await test('saveNote rejection surfaces as save_failed outcome', async () => {
    const { voice, fake } = setup({ saveNote: async () => { throw new Error('disk full'); } });
    const { id } = await startRecording(voice, fake);
    const outcomeP = voice.stop(id, () => {});
    fake.last.emit('completed', { text: 'hi' });
    assert.deepEqual(await outcomeP, {
      ok: false, code: 'save_failed', message: 'disk full', taskId: null, canRetry: false,
    });
    assert.equal(voice.size(), 0);
  });

  await test('session.stop rejection is left to the terminal event', async () => {
    const { voice, fake } = setup();
    const { id } = await startRecording(voice, fake);
    fake.last.stopError = Object.assign(new Error('not recording'), { code: 'not_recording' });
    const outcomeP = voice.stop(id, () => {});
    await tick(); // let the rejected stop() settle; must not escape or resolve the outcome
    assert.equal(voice.size(), 1);
    fake.last.emit('failed', { code: 'timeout', message: 'm', canRetry: false });
    const outcome = await outcomeP;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'timeout');
    assert.equal(voice.size(), 0);
  });

  // Start time limit: CocoScribe may accept a session but never report `recording`.
  await test('start times out when the SDK never reports recording', async () => {
    const { voice, fake } = setup({ startTimeoutMs: 30 });
    const r = await voice.start('article-a', { anchor: 'x' });
    assert.deepEqual(r, { error: 'timeout' });
    assert.equal(voice.size(), 0);
    assert.equal(fake.last.cancelCalls, 1);
  });

  await test('late recording after a start timeout cancels the session again', async () => {
    const { voice, fake } = setup({ startTimeoutMs: 30 });
    assert.deepEqual(await voice.start('article-a', { anchor: 'x' }), { error: 'timeout' });
    fake.last.emit('phase', 'recording');
    await tick();
    assert.equal(fake.last.cancelCalls, 2);
    assert.equal(voice.size(), 0);
    // a cancel that rejects or throws must stay swallowed
    fake.last.cancel = async () => { throw new Error('gone'); };
    fake.last.emit('phase', 'recording');
    fake.last.cancel = () => { throw new Error('sync gone'); };
    fake.last.emit('phase', 'recording');
    await tick();
    assert.equal(voice.size(), 0);
  });

  await test('late completed after a start timeout is not saved', async () => {
    const { voice, fake, saved } = setup({ startTimeoutMs: 30 });
    assert.deepEqual(await voice.start('article-a', { anchor: 'x' }), { error: 'timeout' });
    fake.last.emit('completed', { text: 'x' });
    fake.last.emit('failed', { code: 'error', message: 'm' });
    fake.last.emit('error', new Error('late'));
    await tick();
    assert.equal(saved.length, 0);
    assert.equal(voice.size(), 0);
  });

  await test('start timer is cleared once recording arrives', async () => {
    const { voice, fake } = setup({ startTimeoutMs: 30 });
    const p = voice.start('article-a', { anchor: 'x' });
    fake.last.emit('phase', 'recording');
    const r = await p;
    await new Promise((res) => setTimeout(res, 80));
    assert.ok(r.id);
    assert.equal(fake.last.cancelCalls, 0);
    assert.equal(voice.size(), 1);
  });

  finished = true;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
