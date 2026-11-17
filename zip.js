/* Small ZIP reader/writer for the demo. Supports UTF-8 names and ZIP store/deflate. */
(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }
  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c >>> 0;
  }

  function concat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
  function u16(view, offset, value) { view.setUint16(offset, value, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }
  async function transform(bytes, format, Constructor) {
    const stream = new Blob([bytes]).stream().pipeThrough(new Constructor(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let compressionUsed = false;
    const stamp = dosDateTime();

    for (const entry of entries) {
      const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
      const nameBytes = encoder.encode(name);
      const original = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || 0);
      let compressed = original;
      let method = 0;
      if (original.length > 0) {
        try {
          compressed = await transform(original, 'deflate-raw', CompressionStream);
          method = 8;
          compressionUsed = true;
        } catch (_) {
          compressed = original;
          method = 0;
        }
      }
      const checksum = crc32(original);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, method);
      u16(lv, 10, stamp.time); u16(lv, 12, stamp.date); u32(lv, 14, checksum);
      u32(lv, 18, compressed.length); u32(lv, 22, original.length);
      u16(lv, 26, nameBytes.length); u16(lv, 28, 0); local.set(nameBytes, 30);
      localParts.push(local, compressed);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, method);
      u16(cv, 12, stamp.time); u16(cv, 14, stamp.date); u32(cv, 16, checksum);
      u32(cv, 20, compressed.length); u32(cv, 24, original.length);
      u16(cv, 28, nameBytes.length); u16(cv, 30, 0); u16(cv, 32, 0);
      u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length + compressed.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0);
    u16(ev, 8, entries.length); u16(ev, 10, entries.length);
    u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
    return { blob: new Blob([concat([...localParts, ...centralParts, end])], { type: 'application/zip' }), compressionUsed };
  }

  async function readZip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This ZIP archive could not be read.');
    const count = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    const results = [];
    let cursor = centralOffset;
    for (let index = 0; index < count; index++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The ZIP directory is invalid.');
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
      const name = (flags & 0x0800) ? decoder.decode(nameBytes) : new TextDecoder('ibm866').decode(nameBytes);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      const isDirectory = name.endsWith('/');
      let data = new Uint8Array();
      if (!isDirectory) {
        if (method === 0) data = compressed;
        else if (method === 8) data = await transform(compressed, 'deflate-raw', DecompressionStream);
        else throw new Error(`ZIP compression method ${method} is not supported.`);
        if (data.length !== uncompressedSize) throw new Error(`Could not verify ${name}.`);
      }
      results.push({ name, data, isDirectory });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return results;
  }

  window.PocketZip = { createZip, readZip, crc32 };
})();
