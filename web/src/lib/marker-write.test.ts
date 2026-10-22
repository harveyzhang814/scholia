import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, type Note } from './api';
import { sha256Hex } from './sha256';
import { writeMarker } from './marker-write';

const note: Note = { id: 'n', anchor: '', prefix: '第一段', suffix: '文字。', position: 3, body: 'b', createdAt: 0, updatedAt: 0 };
const stale = () => new Error('HTTP 409: {"error":"stale"}');

afterEach(() => vi.restoreAllMocks());

describe('writeMarker', () => {
  it('writes a marker for an exact anchor', async () => {
    const add = vi.spyOn(api, 'addMarker').mockResolvedValue({ markerId: 'aaaaaaaa', hash: 'h' });
    expect(await writeMarker('article-x', note, '第一段文字。')).toBe(true);
    expect(add).toHaveBeenCalledWith('article-x', 'n', { baseHash: await sha256Hex('第一段文字。'), insertions: [{ offset: 3, edge: 'point' }] });
  });

  it('skips when there is no exact source position', async () => {
    const add = vi.spyOn(api, 'addMarker');
    expect(await writeMarker('article-x', note, '完全不同的内容')).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('retries once after 409 with fresh content', async () => {
    const add = vi.spyOn(api, 'addMarker')
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce({ markerId: 'aaaaaaaa', hash: 'h' });
    const get = vi.spyOn(api, 'getContent').mockResolvedValue('前言。\n\n第一段文字。');
    expect(await writeMarker('article-x', note, '第一段文字。')).toBe(true);
    expect(get).toHaveBeenCalledWith('article-x', 'article');
    expect(add).toHaveBeenLastCalledWith('article-x', 'n', expect.objectContaining({
      baseHash: await sha256Hex('前言。\n\n第一段文字。'),
      insertions: [{ offset: 8, edge: 'point' }],  // 前言。(3) + \n\n(2) + 第一段(3)
    }));
  });

  it('refetches the document the note belongs to', async () => {
    vi.spyOn(api, 'addMarker')
      .mockRejectedValueOnce(stale())
      .mockResolvedValueOnce({ markerId: 'aaaaaaaa', hash: 'h' });
    const get = vi.spyOn(api, 'getContent').mockResolvedValue('第一段文字。');
    expect(await writeMarker('task-1', { ...note, doc: 'summary' }, '第一段文字。')).toBe(true);
    expect(get).toHaveBeenCalledWith('task-1', 'summary');
  });

  it('gives up after a second failure', async () => {
    const add = vi.spyOn(api, 'addMarker').mockRejectedValue(stale());
    const get = vi.spyOn(api, 'getContent').mockResolvedValue('第一段文字。');
    expect(await writeMarker('article-x', note, '第一段文字。')).toBe(false);
    expect(add).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('gives up when the fresh content no longer has an exact position', async () => {
    const add = vi.spyOn(api, 'addMarker').mockRejectedValue(stale());
    vi.spyOn(api, 'getContent').mockResolvedValue('完全不同的内容');
    expect(await writeMarker('article-x', note, '第一段文字。')).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('gives up when refetching throws', async () => {
    const add = vi.spyOn(api, 'addMarker').mockRejectedValue(stale());
    vi.spyOn(api, 'getContent').mockRejectedValue(new Error('network'));
    expect(await writeMarker('article-x', note, '第一段文字。')).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('other errors give up without retry', async () => {
    const add = vi.spyOn(api, 'addMarker').mockRejectedValue(new Error('HTTP 400: {"error":"bad"}'));
    const get = vi.spyOn(api, 'getContent');
    expect(await writeMarker('article-x', note, '第一段文字。')).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });
});
