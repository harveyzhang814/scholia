import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api';

function ndjsonResponse(lines: string[], status = 200): Response {
  return new Response(lines.join('\n'), { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}

const LOST = { ok: false, code: 'connection_lost', message: '', taskId: null, canRetry: false };

afterEach(() => vi.unstubAllGlobals());

describe('voice api outcome mapping', () => {
  it('stopVoice reports phases and resolves with the note', async () => {
    const note = { id: 'n1', anchor: 'a', body: 'hi', createdAt: 1, updatedAt: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      '{"type":"phase","phase":"transcribing"}',
      '{"type":"phase","phase":"unknown"}',
      '{"type":"phase","phase":"refining"}',
      JSON.stringify({ type: 'note', note }),
    ])));
    const phases: string[] = [];
    const outcome = await api.stopVoice('s1', (p) => phases.push(p));
    expect(phases).toEqual(['transcribing', 'refining']);
    expect(outcome).toEqual({ ok: true, note });
  });

  it('stopVoice maps a failed line to a failed outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      '{"type":"failed","code":"asr","message":"boom","taskId":"t1","canRetry":true}',
    ])));
    expect(await api.stopVoice('s1', () => {})).toEqual({ ok: false, code: 'asr', message: 'boom', taskId: 't1', canRetry: true });
  });

  it('stopVoice returns connection_lost when the stream ends without a terminal line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse(['{"type":"phase","phase":"transcribing"}'])));
    expect(await api.stopVoice('s1', () => {})).toEqual(LOST);
  });

  it('retryVoice returns connection_lost on non-200 and on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"not found"}', { status: 404 })));
    expect(await api.retryVoice('t', { anchor: 'a' }, 'c', () => {})).toEqual(LOST);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await api.retryVoice('t', { anchor: 'a' }, 'c', () => {})).toEqual(LOST);
  });

  it('startVoice returns the server error code, or error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"busy"}', { status: 409 })));
    expect(await api.startVoice('t', { anchor: 'a' })).toEqual({ ok: false, code: 'busy' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await api.startVoice('t', { anchor: 'a' })).toEqual({ ok: false, code: 'error' });
  });
});
