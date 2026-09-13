'use strict';
const {inflateRawSync} = require('node:zlib');
const {FILES, LIMITS, check, hash} = require('./contracts.cjs');

/** Only the ordinary three-file Actions ZIP shape; reject ZIP64, links and directories. */
function candidateZip(bytes, selection) {
  check(bytes.length <= LIMITS.bytes && hash(bytes) === selection.artifactZipSha256, 'archive-identity');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  check(end >= 0 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length, 'zip-end');
  check(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 8) === 3 && bytes.readUInt16LE(end + 10) === 3, 'zip-count');
  let at = bytes.readUInt32LE(end + 16); const centralEnd = at + bytes.readUInt32LE(end + 12), files = new Map(), ranges = [];
  check(centralEnd === end, 'zip-central');
  for (let i = 0; i < 3; i++) {
    check(at + 46 <= centralEnd && bytes.readUInt32LE(at) === 0x02014b50, 'zip-entry');
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), packed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const names = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), offset = bytes.readUInt32LE(at + 42);
    check(at + 46 + names + extra + comment <= centralEnd && bytes.readUInt16LE(at + 34) === 0, 'zip-entry-bounds');
    const name = bytes.subarray(at + 46, at + 46 + names).toString('utf8');
    const unixMode = bytes.readUInt32LE(at + 38) >>> 16;
    check(FILES.includes(name) && !files.has(name) && (unixMode & 0xf000) !== 0xa000 && (unixMode & 0xf000) !== 0x4000, 'zip-path');
    check((flags & ~0x808) === 0 && [0, 8].includes(method) && size === selection.files[name].size && packed <= LIMITS.bytes, 'zip-format');
    check(offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50 && bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method, 'zip-local');
    const localNames = bytes.readUInt16LE(offset + 26), start = offset + 30 + localNames + bytes.readUInt16LE(offset + 28), finish = start + packed;
    check(bytes.subarray(offset + 30, offset + 30 + localNames).toString('utf8') === name && finish <= bytes.readUInt32LE(end + 16), 'zip-data');
    check(ranges.every(([a, b]) => finish <= a || offset >= b), 'zip-overlap'); ranges.push([offset, finish]);
    const packedBytes = bytes.subarray(start, finish), unpacked = method === 0 ? packedBytes : inflateRawSync(packedBytes, {maxOutputLength: size + 1});
    check(unpacked.length === size && hash(unpacked) === selection.files[name].sha256, 'zip-file-identity'); files.set(name, unpacked);
    at += 46 + names + extra + comment;
  }
  check(at === centralEnd, 'zip-central-size'); return files;
}
module.exports = {candidateZip};
