import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, type Note, type NoteAnchor, type VoiceOutcome, type VoicePhase } from '@/lib/api';
import * as tasks from './use-tasks';
import { useVoiceComments } from './use-voice-comments';

const anchor: NoteAnchor = { anchor: '选中文字', prefix: '前', suffix: '后' };
const note: Note = { id: 'n1', anchor: '选中文字', prefix: '前', suffix: '后', body: '语音评论', createdAt: 0, updatedAt: 0 };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// A stopVoice/retryVoice mock that hands the test its onPhase callback and a resolver for the outcome.
function streamMock() {
  const d = deferred<VoiceOutcome>();
  const phases: Array<(p: VoicePhase) => void> = [];
  const fn = vi.fn((...args: unknown[]) => {
    phases.push(args[args.length - 1] as (p: VoicePhase) => void);
    return d.promise;
  });
  return { fn, d, phase: (p: VoicePhase) => phases.forEach((cb) => cb(p)) };
}

const flush = () => act(async () => {});

async function setup(enabled = true, taskId = 'article-x') {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook((p: { taskId: string; enabled: boolean }) => useVoiceComments(p.taskId, p.enabled), {
    wrapper, initialProps: { taskId, enabled },
  });
  await flush();  // let the mount-time voiceStatus() settle inside act
  return { qc, ...hook };
}

async function startRecording(result: { current: ReturnType<typeof useVoiceComments> }) {
  await act(async () => { result.current.start(anchor); });
}

let afterNoteCreated: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'voiceStatus').mockResolvedValue(true);
  vi.spyOn(api, 'startVoice').mockResolvedValue({ ok: true, id: 's1' });
  vi.spyOn(api, 'cancelVoice').mockResolvedValue(undefined);
  afterNoteCreated = vi.spyOn(tasks, 'afterNoteCreated').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useVoiceComments', () => {
  it('double start while the start request is in flight sends one request', async () => {
    const d = deferred<{ ok: true; id: string }>();
    const start = vi.spyOn(api, 'startVoice').mockReturnValue(d.promise);
    const { result } = await setup();
    act(() => {
      result.current.start(anchor);
      result.current.start(anchor);  // same tick, same closure: only a ref can stop this one
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    expect(result.current.recording).toBeNull();
    await act(async () => { d.resolve({ ok: true, id: 's1' }); });
    expect(result.current.recording).toMatchObject({ id: 's1', anchor });
    act(() => { result.current.start(anchor); });  // already recording
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('start failure app_not_running marks unavailable and sets toast', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'startVoice').mockResolvedValue({ ok: false, code: 'app_not_running' });
    const { result } = await setup();
    expect(result.current.available).toBe(true);
    await startRecording(result);
    expect(result.current.available).toBe(false);
    expect(result.current.toast).toBe('CocoScribe 未运行，语音评论暂不可用');
    expect(result.current.busy).toBe(false);
    act(() => { vi.advanceTimersByTime(2600); });
    expect(result.current.toast).toBeNull();
  });

  it('stop turns recording into a transcribing pending and follows phases', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const stop = streamMock();
    vi.spyOn(api, 'stopVoice').mockImplementation(stop.fn);
    const { result } = await setup();
    await startRecording(result);
    now.mockReturnValue(4_400);
    act(() => { result.current.stop(); });
    expect(stop.fn).toHaveBeenCalledWith('s1', expect.any(Function));
    expect(result.current.recording).toBeNull();
    expect(result.current.pending).toEqual([{ id: 'voice:s1', anchor, durationSec: 3, phase: 'transcribing' }]);
    act(() => stop.phase('refining'));
    expect(result.current.pending[0].phase).toBe('refining');
  });

  it('success removes the pending, calls afterNoteCreated and sets justSavedId', async () => {
    vi.useFakeTimers();
    const stop = streamMock();
    vi.spyOn(api, 'stopVoice').mockImplementation(stop.fn);
    const { qc, result } = await setup();
    await startRecording(result);
    act(() => { result.current.stop(); });
    await act(async () => { stop.d.resolve({ ok: true, note }); });
    expect(result.current.pending).toEqual([]);
    expect(afterNoteCreated).toHaveBeenCalledWith(qc, 'article-x', note);
    expect(result.current.justSavedId).toBe('n1');
    act(() => { vi.advanceTimersByTime(1400); });
    expect(result.current.justSavedId).toBeNull();
  });

  it('failure keeps the pending as failed with code and retry info', async () => {
    const stop = streamMock();
    vi.spyOn(api, 'stopVoice').mockImplementation(stop.fn);
    const retry = streamMock();
    vi.spyOn(api, 'retryVoice').mockImplementation(retry.fn);
    const { result } = await setup();
    await startRecording(result);
    act(() => { result.current.stop(); });
    await act(async () => {
      stop.d.resolve({ ok: false, code: 'refine_failed', message: 'x', taskId: 'coco-1', canRetry: true });
    });
    expect(result.current.pending).toEqual([{
      id: 'voice:s1', anchor, durationSec: 0, phase: 'failed',
      failure: { code: 'refine_failed', canRetry: true, taskId: 'coco-1' },
    }]);
    expect(afterNoteCreated).not.toHaveBeenCalled();
    // The retry info is usable: retry goes back to transcribing with the CocoScribe task id, once.
    act(() => {
      result.current.retry('voice:s1');
      result.current.retry('voice:s1');
    });
    expect(retry.fn).toHaveBeenCalledTimes(1);
    expect(retry.fn).toHaveBeenCalledWith('article-x', anchor, 'coco-1', expect.any(Function));
    expect(result.current.pending).toEqual([{ id: 'voice:s1', anchor, durationSec: 0, phase: 'transcribing' }]);
  });

  it('retry is ignored when the failure cannot be retried', async () => {
    const stop = streamMock();
    vi.spyOn(api, 'stopVoice').mockImplementation(stop.fn);
    const retry = vi.spyOn(api, 'retryVoice');
    const { result } = await setup();
    await startRecording(result);
    act(() => { result.current.stop(); });
    await act(async () => {
      stop.d.resolve({ ok: false, code: 'connection_lost', message: '', taskId: null, canRetry: false });
    });
    act(() => { result.current.retry('voice:s1'); });
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.pending[0]).toMatchObject({ phase: 'failed', failure: { code: 'connection_lost' } });
    act(() => { result.current.discard('voice:s1'); });
    expect(result.current.pending).toEqual([]);
  });

  it('unmount while recording cancels the session', async () => {
    const { result, unmount } = await setup();
    await startRecording(result);
    expect(api.cancelVoice).not.toHaveBeenCalled();
    unmount();
    expect(api.cancelVoice).toHaveBeenCalledTimes(1);
    expect(api.cancelVoice).toHaveBeenCalledWith('s1');
  });

  it('showHint is false after dismissHint and stays false on next recording', async () => {
    vi.spyOn(api, 'startVoice')
      .mockResolvedValueOnce({ ok: true, id: 's1' })
      .mockResolvedValueOnce({ ok: true, id: 's2' });
    const { result } = await setup();
    expect(result.current.showHint).toBe(false);  // no recording yet
    await startRecording(result);
    expect(result.current.showHint).toBe(true);
    act(() => { result.current.dismissHint(); });
    expect(result.current.showHint).toBe(false);
    expect(localStorage.getItem('voice-hint-dismissed')).toBe('1');
    act(() => { result.current.cancel(); });
    expect(api.cancelVoice).toHaveBeenCalledWith('s1');
    expect(result.current.recording).toBeNull();
    await startRecording(result);
    expect(result.current.recording).toMatchObject({ id: 's2' });
    expect(result.current.showHint).toBe(false);
  });

  it('stop is idempotent: a second stop or a cancel after stop sends nothing more', async () => {
    const stop = streamMock();
    vi.spyOn(api, 'stopVoice').mockImplementation(stop.fn);
    const { result } = await setup();
    await startRecording(result);
    act(() => {
      result.current.stop();
      result.current.stop();  // e.g. key + button in the same tick
    });
    act(() => {
      result.current.stop();
      result.current.cancel();
    });
    expect(stop.fn).toHaveBeenCalledTimes(1);
    expect(api.cancelVoice).not.toHaveBeenCalled();
    expect(result.current.pending).toHaveLength(1);
  });

  it('taskId change cancels the recording and keeps previous-task outcomes out of the new task', async () => {
    vi.spyOn(api, 'startVoice')
      .mockResolvedValueOnce({ ok: true, id: 's1' })
      .mockResolvedValueOnce({ ok: true, id: 's2' });
    const stop = streamMock();
    vi.spyOn(api, 'stopVoice').mockImplementation(stop.fn);
    const { qc, result, rerender } = await setup();
    await startRecording(result);
    act(() => { result.current.stop(); });     // s1 is processing
    await startRecording(result);              // s2 is recording
    rerender({ taskId: 'article-y', enabled: true });
    expect(api.cancelVoice).toHaveBeenCalledWith('s2');
    expect(result.current.recording).toBeNull();
    expect(result.current.pending).toEqual([]);
    expect(result.current.busy).toBe(false);
    act(() => stop.phase('refining'));
    await act(async () => { stop.d.resolve({ ok: true, note }); });
    expect(result.current.pending).toEqual([]);
    expect(result.current.justSavedId).toBeNull();
    // The note was saved for the previous task: refresh that task, not the new one.
    expect(afterNoteCreated).toHaveBeenCalledWith(qc, 'article-x', note);
  });

  it('enabled=false does nothing: no status check, no start, no cancel on unmount', async () => {
    const { result, unmount } = await setup(false);
    expect(api.voiceStatus).not.toHaveBeenCalled();
    expect(result.current.available).toBeNull();
    act(() => { result.current.start(anchor); });
    expect(api.startVoice).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    unmount();
    expect(api.cancelVoice).not.toHaveBeenCalled();
  });
});
