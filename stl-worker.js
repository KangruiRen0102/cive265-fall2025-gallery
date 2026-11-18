/* Parses only the STL surface triangles. Coordinates stay in the original order. */
self.onmessage = async ({ data }) => {
  try {
    let response = data.localFile
      ? new Response(data.localFile)
      : await fetch(data.local).catch(() => null);
    let reader,
      first,
      expected = data.size || 0;
    if (response?.ok) {
      reader = response.body.getReader();
      first = await reader.read();
      const start = new TextDecoder().decode(first.value?.subarray(0, 100));
      if (/^version https:\/\/git-lfs|^\s*<!doctype html/i.test(start)) {
        expected =
          Number(
            /\bsize (\d+)/.exec(new TextDecoder().decode(first.value))?.[1],
          ) || expected;
        reader.cancel().catch(() => {});
        response = null;
      }
    }
    if (!response?.ok) {
      if (!data.remote) throw new Error('This is not a complete STL file.');
      response = await fetch(data.remote);
      if (!response.ok) throw new Error('The STL download is unavailable.');
      reader = response.body.getReader();
      first = undefined;
    }
    let length = 0;
    let bytes = expected ? new Uint8Array(expected) : null;
    const pieces = [];
    let nextUpdate = 0;
    while (true) {
      const { done, value } = first || (await reader.read());
      first = undefined;
      if (done) break;
      if (bytes) {
        if (length + value.length > bytes.length)
          throw new Error('The STL has changed. Please reload the page.');
        bytes.set(value, length);
      } else pieces.push(value);
      length += value.length;
      if (length >= nextUpdate) {
        postMessage(
          expected
            ? { percent: Math.floor((100 * length) / expected) }
            : { received: length },
        );
        nextUpdate = length + Math.max(300000, expected / 25);
      }
    }
    if (expected && length !== expected)
      throw new Error('The STL download was incomplete.');
    if (!bytes) {
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of pieces) {
        bytes.set(part, offset);
        offset += part.length;
      }
      pieces.length = 0;
    }
    const view = new DataView(bytes.buffer);
    const facets = length >= 84 ? view.getUint32(80, true) : 0;
    let positions;
    if (length === 84 + 50 * facets) {
      positions = new Float32Array(facets * 9);
      for (let t = 0; t < facets; t++)
        for (let n = 0; n < 9; n++)
          positions[t * 9 + n] = view.getFloat32(96 + t * 50 + n * 4, true);
    } else {
      const parser = /\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi;
      const chunks = [];
      let chunk = new Float32Array(65536),
        fill = 0,
        count = 0,
        tail = '';
      for (let offset = 0; offset < bytes.length; offset += 1048576) {
        const end = Math.min(bytes.length, offset + 1048576);
        let lines =
          tail + new TextDecoder('ascii').decode(bytes.subarray(offset, end));
        if (end < bytes.length) {
          const last = Math.max(
            lines.lastIndexOf('\r'),
            lines.lastIndexOf('\n'),
          );
          if (last < 0 && lines.length > 4194304)
            throw new Error('Invalid ASCII STL.');
          tail = lines.slice(last + 1);
          lines = lines.slice(0, last + 1);
        }
        for (const v of lines.matchAll(parser))
          for (let j = 1; j <= 3; j++) {
            if (fill === chunk.length) {
              chunks.push(chunk);
              chunk = new Float32Array(65536);
              fill = 0;
            }
            chunk[fill++] = Number(v[j]);
            count++;
          }
      }
      if (count % 9) throw new Error('The STL has incomplete faces.');
      positions = new Float32Array(count);
      let offset = 0;
      for (const segment of chunks) {
        positions.set(segment, offset);
        offset += segment.length;
      }
      positions.set(chunk.subarray(0, fill), offset);
    }
    if (!positions.length || !positions.every(Number.isFinite))
      throw new Error('The STL contains no usable geometry.');
    postMessage({ positions: positions.buffer }, [positions.buffer]);
  } catch (error) {
    postMessage({ error: error.message });
  }
};
