// Lines that are not valid JSON are skipped; stream read errors propagate to the caller.
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onLine: (value: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emit = (line: string) => {
    if (!line.trim()) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    onLine(value);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        emit(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();
    emit(buffer);
  } finally {
    reader.releaseLock();
  }
}
