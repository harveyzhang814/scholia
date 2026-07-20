import { api } from './api';

export type SSEEvent =
  | { type: 'task.created'; taskId: string }
  | { type: 'task.update';  taskId: string }
  | { type: 'task.deleted'; taskId: string }
  | { type: 'step.update';  taskId: string; step: string }
  | { type: 'heartbeat' };

export function openEventStream(onEvent: (e: SSEEvent) => void): () => void {
  const token = api.token();
  const url = `/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (m) => {
    try {
      const parsed = JSON.parse(m.data);
      onEvent(parsed as SSEEvent);
    } catch (err) {
      console.warn('[sse] parse error', err);
    }
  };
  es.onerror = () => {
    // No backend event source exists today (server/index.js has no /api/events
    // route) — EventSource retries indefinitely on error by default, which
    // just hammers a 404 forever. Give up after the first failure instead of
    // looping; live task updates degrade to the existing polling/staleTime
    // refetch behavior in use-tasks.ts.
    console.warn('[sse] no event stream available — live updates disabled for this session');
    es.close();
  };
  return () => es.close();
}
