// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- web has no @types/node; the test itself runs in the node environment.
import { createHash } from 'node:crypto';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('hashes utf-8 text the same way as the server', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('中文\n正文')).toBe(createHash('sha256').update('中文\n正文', 'utf8').digest('hex'));
  });
});
