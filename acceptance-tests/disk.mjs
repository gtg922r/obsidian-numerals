import fs from 'node:fs/promises';
import C from './contracts.cjs';

/** Preserve exact original/saved bytes, including BOM/CRLF, independently of editor strings. */
export class DiskEvidence {
  constructor(root, paths, assertOwned) { this.root = root; this.paths = paths; this.assertOwned = assertOwned; this.blobs = Object.create(null); this.size = 0; }
  async capture() {
    this.assertOwned(); const inventory = Object.create(null);
    for (const relative of this.paths) {
      C.check(C.notePath(relative) || relative === '.obsidian/plugins/numerals/data.json', 'disk-path');
      const dest = C.within(this.root, relative);
      let bytes;
      try { bytes = await fs.readFile(dest); }
      catch (error) { if (error.code === 'ENOENT') { inventory[relative] = {exists: false}; continue; } throw error; }
      this.assertOwned(); C.check(bytes.length <= C.LIMITS.text, 'disk-file-limit');
      const sha256 = C.hash(bytes);
      if (!Object.hasOwn(this.blobs, sha256)) { this.size += bytes.length; C.check(this.size <= C.LIMITS.bytes, 'disk-evidence-limit'); this.blobs[sha256] = bytes.toString('base64'); }
      inventory[relative] = {exists: true, size: bytes.length, sha256};
    }
    this.assertOwned(); return inventory;
  }
}
