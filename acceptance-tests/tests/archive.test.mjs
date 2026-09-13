import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import C from '../contracts.cjs';
import {candidateZip} from '../archive.cjs';
import {selection} from './support.mjs';

function zip(names = C.FILES, unixMode = 0, method = 8) {
  const local = [], central = []; let offset = 0;
  for (const name of names) {
    const source = Buffer.from(name.slice(0, 3)), content = method === 8 ? deflateRawSync(source) : source, n = Buffer.from(name);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(method, 8); header.writeUInt32LE(content.length, 18); header.writeUInt32LE(source.length, 22); header.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(method, 10); c.writeUInt32LE(content.length, 20); c.writeUInt32LE(source.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE((unixMode << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    local.push(header, n, content); central.push(c, n); offset += header.length + n.length + content.length;
  }
  const end = Buffer.alloc(22), c = Buffer.concat(central); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
}
test('only three selected byte-verified candidate files are decompressed', () => {
  for (const method of [0, 8]) { const bytes = zip(C.FILES, 0, method), s = selection(); s.artifactZipSha256 = C.hash(bytes); const result = candidateZip(bytes, s); assert.deepEqual([...result.keys()], C.FILES); assert.equal(result.get('main.js').toString(), 'mai'); }
});
test('ZIP traversal, duplicates and symlinks are rejected before extraction', () => {
  for (const bytes of [zip(['../main.js', 'manifest.json', 'styles.css']), zip(['main.js', 'main.js', 'styles.css']), zip(C.FILES, 0xa000)]) {
    const s = selection(); s.artifactZipSha256 = C.hash(bytes); assert.throws(() => candidateZip(bytes, s), /zip-path/);
  }
});
test('right archive hash cannot hide mismatched file hashes or oversized output', () => {
  const bytes = zip(), s = selection(); s.artifactZipSha256 = C.hash(bytes); s.files['main.js'].sha256 = '0'.repeat(64); assert.throws(() => candidateZip(bytes, s), /zip-file-identity/);
  s.files['main.js'].size = 2; assert.throws(() => candidateZip(bytes, s), /zip-format/);
});
