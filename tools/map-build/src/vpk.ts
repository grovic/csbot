// Read-only access to a single-file VPK v2 (CS2's maps/<map>.vpk). Format: Valve Pak, as documented by
// ValveResourceFormat (MIT). We never write to the game folder.

import fs from 'node:fs';

interface Entry { preload: Buffer; archive: number; offset: number; length: number }

export interface Vpk {
  has(path: string): boolean;
  read(path: string): Buffer;
  list(): string[];
  close(): void;
}

const EMBEDDED = 0x7fff;

export function openVpk(file: string): Vpk {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(28);
  fs.readSync(fd, head, 0, 28, 0);
  if (head.readUInt32LE(0) !== 0x55aa1234) throw new Error(`${file}: not a VPK`);
  const version = head.readUInt32LE(4);
  const treeSize = head.readUInt32LE(8);
  const headerSize = version === 2 ? 28 : 12;
  const tree = Buffer.alloc(treeSize);
  fs.readSync(fd, tree, 0, treeSize, headerSize);

  let o = 0;
  const str = () => { const end = tree.indexOf(0, o); const s = tree.toString('utf8', o, end); o = end + 1; return s; };
  const files = new Map<string, Entry>();
  for (;;) {
    const ext = str();
    if (!ext) break;
    for (;;) {
      const dir = str();
      if (!dir) break;
      for (;;) {
        const name = str();
        if (!name) break;
        const preloadBytes = tree.readUInt16LE(o + 4);
        const entry: Entry = { archive: tree.readUInt16LE(o + 6), offset: tree.readUInt32LE(o + 8), length: tree.readUInt32LE(o + 12), preload: tree.subarray(o + 18, o + 18 + preloadBytes) };
        o += 18 + preloadBytes;
        files.set(`${dir.trim() ? dir + '/' : ''}${name}.${ext}`, entry);
      }
    }
  }
  const dataStart = headerSize + treeSize;
  return {
    has: p => files.has(p),
    list: () => [...files.keys()],
    read(p) {
      const e = files.get(p);
      if (!e) throw new Error(`${file}: no ${p}`);
      if (e.archive !== EMBEDDED) throw new Error(`${file}: ${p} lives in another archive`);
      const data = Buffer.alloc(e.length);
      if (e.length) fs.readSync(fd, data, 0, e.length, dataStart + e.offset);
      return Buffer.concat([e.preload, data]);
    },
    close: () => fs.closeSync(fd),
  };
}
