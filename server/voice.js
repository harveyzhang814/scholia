'use strict';
const crypto = require('crypto');

// Fixed for every Scholia voice comment: refine the transcript, hide CocoScribe's
// own UI, and never pause for editing (the note is saved as soon as it completes).
const SESSION_OPTS = { mode: 'comprehend', silent: true, awaitEdit: false };
const RETRY_OPTS = { awaitEdit: false };

function fail(code, message, taskId = null, canRetry = false) {
  return { ok: false, code, message, taskId, canRetry };
}

// Session registry over a CocoScribe-SDK-shaped client. Every session gets all
// listeners attached up front and a "done" promise that resolves (never rejects)
// to an Outcome on the first terminal event, so a result is persisted and the
// registry entry removed whether or not anyone is awaiting stop().
function createVoice({ getClient, saveNote }) {
  const registry = new Map();

  function track(session, taskId, anchor, onPhase) {
    const id = crypto.randomUUID();
    const entry = { session, onPhase, done: null, whenRecording: null };
    let resolveRecording;
    entry.whenRecording = new Promise((resolve) => { resolveRecording = resolve; });
    registry.set(id, entry);

    entry.done = new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        registry.delete(id);
        // No-op once recording has resolved; before that, a terminal outcome is a start error.
        resolveRecording({ error: outcome.code });
        resolve(outcome);
      };

      session.on('phase', (phase) => {
        if (settled) return;
        if (phase === 'recording') resolveRecording({ id });
        else if ((phase === 'transcribing' || phase === 'refining') && entry.onPhase) {
          try { entry.onPhase(phase); } catch { /* a bad callback must not break the session */ }
        }
      });

      session.on('completed', async (result) => {
        if (settled) return;
        settled = true; // claim it now: saveNote is async and later events must be ignored
        registry.delete(id);
        const text = result && typeof result.text === 'string' ? result.text.trim() : '';
        let outcome;
        if (!text) {
          outcome = fail('empty', 'Transcription produced no text');
        } else {
          try {
            const note = await saveNote(taskId, { ...anchor, body: text });
            outcome = note ? { ok: true, note } : fail('save_failed', 'Note could not be saved');
          } catch (err) {
            outcome = fail('save_failed', err && err.message ? err.message : 'Note could not be saved');
          }
        }
        resolveRecording({ error: outcome.code });
        resolve(outcome);
      });

      session.on('failed', (err) => {
        const e = err || {};
        finish(fail(e.code || 'error', e.message || '', e.taskId || null, Boolean(e.canRetry)));
      });

      session.on('error', (err) => {
        const e = err || {};
        const code = e.code === 'app_not_running' ? 'app_not_running' : 'transport';
        finish(fail(code, e.message || ''));
      });
    });

    return { id, entry };
  }

  async function status() {
    const client = getClient();
    if (!client) return false;
    try { await client.status(); return true; } catch { return false; }
  }

  async function start(taskId, anchor) {
    const client = getClient();
    if (!client) return { error: 'unavailable' };
    let session;
    try { session = client.startSession({ ...SESSION_OPTS }); } catch { return { error: 'transport' }; }
    const { entry } = track(session, taskId, anchor, null);
    return entry.whenRecording;
  }

  function stop(id, onPhase) {
    const entry = registry.get(id);
    if (!entry) return null;
    entry.onPhase = onPhase; // before session.stop(), so no phase is missed
    // A rejected stop() is not handled on its own: the terminal event decides the outcome.
    try { Promise.resolve(entry.session.stop()).catch(() => {}); } catch { /* same */ }
    return entry.done;
  }

  async function cancel(id) {
    const entry = registry.get(id);
    if (!entry) return false;
    try { await entry.session.cancel(); return true; } catch { return false; }
  }

  async function retry(taskId, anchor, cocoTaskId, onPhase) {
    const client = getClient();
    if (!client) return fail('unavailable', 'CocoScribe is unavailable');
    let session;
    try { session = client.retryTask(cocoTaskId, { ...RETRY_OPTS }); } catch (err) {
      return fail('transport', err && err.message ? err.message : '');
    }
    return track(session, taskId, anchor, onPhase).entry.done;
  }

  return { status, start, stop, cancel, retry, size: () => registry.size };
}

module.exports = { createVoice };
