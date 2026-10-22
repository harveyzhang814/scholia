// Writes a comment's sc markers into the source file after the comment is saved. Best effort:
// any failure just means the comment keeps relying on text-based locating.

import { api, type Note } from './api';
import { planMarkerInsertions } from './source-anchor';
import { sha256Hex } from './sha256';

const isStale = (e: unknown) => e instanceof Error && e.message.startsWith('HTTP 409: {"error":"stale"}');

async function attempt(taskId: string, note: Note, md: string): Promise<void> {
  const insertions = planMarkerInsertions(md, note);
  if (!insertions) throw new Error('no exact source position');
  await api.addMarker(taskId, note.id, { baseHash: await sha256Hex(md), insertions });
}

export async function writeMarker(taskId: string, note: Note, md: string): Promise<boolean> {
  if (!planMarkerInsertions(md, note)) return false;
  try {
    await attempt(taskId, note, md);
    return true;
  } catch (e) {
    if (!isStale(e)) return false;
  }
  // The file changed since we read it: retry once on fresh content.
  try {
    await attempt(taskId, note, await api.getContent(taskId, note.doc ?? 'article'));
    return true;
  } catch {
    return false;
  }
}
