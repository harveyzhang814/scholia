import { describe, it, expect } from 'vitest';
import { readNdjson } from './ndjson';

function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  await readNdjson(body, (v) => out.push(v));
  return out;
}

describe('readNdjson', () => {
  it('joins a line split across chunks', async () => {
    const out = await collect(streamOf(['{"type":"pha', 'se","phase":"refining"}\n']));
    expect(out).toEqual([{ type: 'phase', phase: 'refining' }]);
  });

  it('decodes a CJK character split across chunk bytes', async () => {
    const bytes = new TextEncoder().encode('{"type":"note","note":{"body":"你好"}}\n');
    const cut = bytes.indexOf(0xe4) + 1; // inside the 3-byte "你"
    const out = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]));
    expect(out).toEqual([{ type: 'note', note: { body: '你好' } }]);
  });

  it('handles a final line without trailing newline', async () => {
    const out = await collect(streamOf(['{"a":1}\n{"b":2}']));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips blank lines', async () => {
    const out = await collect(streamOf(['\n{"a":1}\n\n   \n{"b":2}\n\n']));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
