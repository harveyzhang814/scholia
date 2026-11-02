import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type NoteAnchor, type VoiceOutcome, type VoicePhase } from '@/lib/api';
import { afterNoteCreated } from './use-tasks';

export interface VoicePending {
  id: string;                 // 'voice:<session id>'
  anchor: NoteAnchor;
  durationSec: number;        // round((now - startedAt) / 1000) at stop
  phase: VoicePhase | 'failed';
  failure?: { code: string; canRetry: boolean; taskId: string | null };
}

type Recording = { id: string; anchor: NoteAnchor; startedAt: number };

// Pseudo-note id prefixes the detail page adds to the Reader's notes. globals.css selects `[data-note-id^="voice-rec:"]`, so keep that value in sync.
export const VOICE_PREFIX = 'voice:';
export const VOICE_REC_PREFIX = 'voice-rec:';

const HINT_KEY = 'voice-hint-dismissed';
const UNAVAILABLE = 'CocoScribe 未运行，语音评论暂不可用';
const TOAST_MS = 2600;
const SAVED_MS = 1400;

export function useVoiceComments(taskId: string, enabled: boolean) {
  const qc = useQueryClient();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState<VoicePending[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem(HINT_KEY) === '1');

  // Refs are the synchronous guards: two calls in the same tick see each other's writes,
  // which React state would not show until the next render.
  const startingRef = useRef(false);
  const recordingRef = useRef<Recording | null>(null);
  const inFlightRef = useRef(new Set<string>());  // pending ids with a stop/retry stream open
  const genRef = useRef(0);                       // bumped on taskId change/unmount; stale callbacks compare against it
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void api.voiceStatus().then((ok) => { if (live) setAvailable(ok); });
    return () => { live = false; };
  }, [enabled]);

  useEffect(() => () => {
    genRef.current++;
    const rec = recordingRef.current;
    recordingRef.current = null;
    startingRef.current = false;
    inFlightRef.current.clear();
    if (rec) void api.cancelVoice(rec.id);
    clearTimeout(toastTimer.current);
    clearTimeout(savedTimer.current);
    setStarting(false);
    setRecording(null);
    setPending([]);
    setToast(null);
    setJustSavedId(null);
  }, [taskId]);

  function showToast(msg: string) {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  function follow(id: string, call: (onPhase: (p: VoicePhase) => void) => Promise<VoiceOutcome>) {
    const gen = genRef.current;
    const tid = taskId;
    inFlightRef.current.add(id);
    void call((phase) => {
      if (gen === genRef.current) setPending((list) => list.map((p) => (p.id === id ? { ...p, phase } : p)));
    }).then((outcome) => {
      if (gen !== genRef.current) {
        // Task switched: the server saved the note anyway; refresh that task's cache, touch nothing here.
        if (outcome.ok) afterNoteCreated(qc, tid, outcome.note);
        return;
      }
      inFlightRef.current.delete(id);
      if (outcome.ok) {
        setPending((list) => list.filter((p) => p.id !== id));
        afterNoteCreated(qc, tid, outcome.note);
        clearTimeout(savedTimer.current);
        setJustSavedId(outcome.note.id);
        savedTimer.current = setTimeout(() => setJustSavedId(null), SAVED_MS);
      } else {
        const failure = { code: outcome.code, canRetry: outcome.canRetry, taskId: outcome.taskId };
        setPending((list) => list.map((p) => (p.id === id ? { ...p, phase: 'failed', failure } : p)));
      }
    });
  }

  function start(anchor: NoteAnchor) {
    if (!enabled || startingRef.current || recordingRef.current || available === false) return;
    startingRef.current = true;
    setStarting(true);
    const gen = genRef.current;
    void api.startVoice(taskId, anchor).then((res) => {
      if (gen !== genRef.current) {
        if (res.ok) void api.cancelVoice(res.id);  // started for a task we already left
        return;
      }
      startingRef.current = false;
      setStarting(false);
      if (res.ok) {
        const rec = { id: res.id, anchor, startedAt: Date.now() };
        recordingRef.current = rec;
        setRecording(rec);
      } else if (res.code === 'app_not_running' || res.code === 'unavailable') {
        setAvailable(false);
        showToast(UNAVAILABLE);
      } else {
        showToast(res.code === 'busy' ? 'CocoScribe 正在录音' : '无法开始录音');
      }
    });
  }

  function stop() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    setRecording(null);
    const id = `${VOICE_PREFIX}${rec.id}`;
    const durationSec = Math.round((Date.now() - rec.startedAt) / 1000);
    setPending((list) => [...list, { id, anchor: rec.anchor, durationSec, phase: 'transcribing' }]);
    follow(id, (onPhase) => api.stopVoice(rec.id, onPhase));
  }

  function cancel() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    setRecording(null);
    void api.cancelVoice(rec.id);
  }

  function retry(id: string) {
    if (inFlightRef.current.has(id)) return;
    const item = pending.find((p) => p.id === id);
    const cocoTaskId = item?.failure?.canRetry ? item.failure.taskId : null;
    if (!item || item.phase !== 'failed' || !cocoTaskId) return;
    setPending((list) => list.map((p) => (p.id === id ? { id, anchor: p.anchor, durationSec: p.durationSec, phase: 'transcribing' } : p)));
    follow(id, (onPhase) => api.retryVoice(taskId, item.anchor, cocoTaskId, onPhase));
  }

  function discard(id: string) {
    setPending((list) => list.filter((p) => !(p.id === id && p.phase === 'failed')));
  }

  function dismissHint() {
    localStorage.setItem(HINT_KEY, '1');
    setHintDismissed(true);
  }

  return {
    available,
    busy: starting || recording !== null,
    recording,
    pending,
    toast,
    showHint: recording !== null && !hintDismissed,
    justSavedId,
    start,
    stop,
    cancel,
    retry,
    discard,
    dismissHint,
    notifyUnavailable: () => showToast(UNAVAILABLE),
  };
}
