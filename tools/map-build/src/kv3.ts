// Binary KeyValues3 reader (versions 2-5) and Source 2 resource blocks, ported from
// ValveResourceFormat's BinaryKV3.cs (MIT). Enough for entity lumps, model physics and nav metadata.

import zlib from 'node:zlib';

export type KV = null | boolean | number | string | Buffer | KV[] | { [key: string]: KV };

/** LZ4 block decode into `out` starting at `o`; back-references may reach earlier output (chained frames). */
function lz4Into(src: Buffer, out: Buffer, o: number): number {
  let i = 0;
  while (i < src.length) {
    const tok = src[i++]!;
    let lit = tok >> 4;
    if (lit === 15) { let b: number; do { b = src[i++]!; lit += b; } while (b === 255); }
    src.copy(out, o, i, i + lit);
    i += lit; o += lit;
    if (i >= src.length) break;
    const off = src[i]! | (src[i + 1]! << 8);
    i += 2;
    let len = tok & 15;
    if (len === 15) { let b: number; do { b = src[i++]!; len += b; } while (b === 255); }
    len += 4;
    for (let k = 0; k < len; k++, o++) out[o] = out[o - off]!;
  }
  return o;
}

const align = (n: number, a: number) => (n + a - 1) & ~(a - 1);

interface Lanes { b1: Buffer; b2: Buffer; b4: Buffer; b8: Buffer; p1: number; p2: number; p4: number; p8: number; end: number }

function lanes(buf: Buffer, start: number, n1: number, n2: number, n4: number, n8: number, v5: boolean): Lanes {
  let o = start;
  const empty = buf.subarray(0, 0);
  const b1 = buf.subarray(o, o + n1); o += n1;
  let b2 = empty, b4 = empty, b8 = empty;
  if (n2) { o = align(o, 2); b2 = buf.subarray(o, o + n2 * 2); o += n2 * 2; }
  if (n4) { o = align(o, 4); b4 = buf.subarray(o, o + n4 * 4); o += n4 * 4; }
  if (n8) { o = align(o, 8); b8 = buf.subarray(o, o + n8 * 8); o += n8 * 8; } else if (!v5) o = align(o, 8);
  return { b1, b2, b4, b8, p1: 0, p2: 0, p4: 0, p8: 0, end: o };
}

export interface KV3Result { value: KV; end: number }

/** Decode a binary KV3 document at `start`. Returns the root value and the offset just after it. */
export function readKV3(b: Buffer, start = 0): KV3Result {
  let p = start;
  const u32 = () => { const v = b.readUInt32LE(p); p += 4; return v; };
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const u16 = () => { const v = b.readUInt16LE(p); p += 2; return v; };
  const magic = u32();
  const version = magic & 0xff;
  if ((magic & 0xffffff00) >>> 0 !== 0x4b563300) throw new Error(`not a KV3 document (0x${magic.toString(16)})`);
  if (version < 2 || version > 5) throw new Error(`KV3 v${version} not supported`);
  p += 16; // format GUID
  const method = u32();
  u16(); u16(); // dictionary id, frame size
  const c1 = i32(), c4 = i32(), c8 = i32(), countTypes = i32();
  u16(); u16(); // object/array counts (hints)
  const sizeUnc = i32(), sizeCmp = i32(), countBlocks = i32(), sizeBlobs = i32();
  let c2 = 0;
  if (version >= 4) { c2 = i32(); i32(); }
  let unc1 = sizeUnc, cmp1 = sizeCmp, unc2 = 0, cmp2 = 0, c1b = 0, c2b = 0, c4b = 0, c8b = 0, objs2 = 0;
  if (version >= 5) { unc1 = i32(); cmp1 = i32(); unc2 = i32(); cmp2 = i32(); c1b = i32(); c2b = i32(); c4b = i32(); c8b = i32(); i32(); objs2 = i32(); i32(); i32(); }

  const take = (cmp: number, unc: number): Buffer => {
    if (method === 0) { const r = b.subarray(p, p + unc); p += unc; return r; }
    const src = b.subarray(p, p + cmp); p += cmp;
    if (method === 1) { const out = Buffer.alloc(unc); if (lz4Into(src, out, 0) !== unc) throw new Error('LZ4 size mismatch'); return out; }
    if (method === 2) return zlib.zstdDecompressSync(src);
    throw new Error(`KV3 compression ${method} not supported`);
  };

  const buf1 = take(cmp1, version < 5 && method === 2 ? unc1 + sizeBlobs : unc1);
  const aux = lanes(buf1, 0, c1, c2, c4, c8, version >= 5);
  const nStrings = aux.b4.readInt32LE(0);
  aux.p4 = 4;
  const strings: string[] = [];
  let main = aux, types: Buffer, objLens: Buffer | undefined, blobLens: number[] = [], frames: Buffer | undefined;
  if (version >= 5) {
    let sp = 0;
    for (let k = 0; k < nStrings; k++) { const e = aux.b1.indexOf(0, sp); strings.push(aux.b1.toString('utf8', sp, e)); sp = e + 1; }
    aux.p1 = sp;
    const buf2 = take(cmp2, unc2);
    objLens = buf2.subarray(0, objs2 * 4);
    main = lanes(buf2, objs2 * 4, c1b, c2b, c4b, c8b, true);
    types = buf2.subarray(main.end, main.end + countTypes);
    if (countBlocks) {
      let q = main.end + countTypes;
      for (let k = 0; k < countBlocks; k++) { blobLens.push(buf2.readInt32LE(q)); q += 4; }
      q += 4; // trailer
      frames = buf2.subarray(q);
    }
  } else {
    if (countBlocks) throw new Error('KV3 < v5 with binary blobs not supported');
    let o = aux.end;
    for (let k = 0; k < nStrings; k++) { const e = buf1.indexOf(0, o); strings.push(buf1.toString('utf8', o, e)); o = e + 1; }
    types = buf1.subarray(o, o + countTypes - o + aux.end);
  }

  let blobs: Buffer = Buffer.alloc(0);
  if (countBlocks && sizeBlobs > 0) {
    if (method === 0) { blobs = b.subarray(p, p + sizeBlobs); p += sizeBlobs; }
    else if (method === 2) { const n = sizeCmp - cmp1 - cmp2; blobs = zlib.zstdDecompressSync(b.subarray(p, p + n)); p += n; }
    else {
      blobs = Buffer.alloc(sizeBlobs);
      let o = 0, fq = 0;
      for (const len of blobLens) {
        const end = o + len;
        while (o < end) { const cl = frames!.readUInt16LE(fq); fq += 2; o = lz4Into(b.subarray(p, p + cl), blobs, o); p += cl; }
      }
    }
  }
  if (countBlocks) p += 4; // trailer after the blobs

  let tp = 0, op = 0, bl = 0, bp = 0;
  const readType = (): number => {
    let d = types[tp++]!;
    if (version >= 3) { if (d & 0x80) tp++; if (d & 0x40) tp++; d &= 0x3f; } else { if (d & 0x80) tp++; d &= 0x7f; }
    return d;
  };
  const str = (id: number) => (id >= 0 && id < strings.length ? strings[id]! : '');
  const r4i = (L: Lanes) => { const v = L.b4.readInt32LE(L.p4); L.p4 += 4; return v; };
  const value = (t: number, L: Lanes): KV => {
    switch (t) {
      case 1: return null;
      case 13: return true;
      case 14: return false;
      case 15: case 17: case 26: return 0;
      case 16: case 18: case 27: return 1;
      case 2: return L.b1[L.p1++]! !== 0;
      case 22: { const v = L.b1[L.p1++]!; return v > 127 ? v - 256 : v; }
      case 23: return L.b1[L.p1++]!;
      case 20: { const v = L.b2.readInt16LE(L.p2); L.p2 += 2; return v; }
      case 21: { const v = L.b2.readUInt16LE(L.p2); L.p2 += 2; return v; }
      case 11: return r4i(L);
      case 12: { const v = L.b4.readUInt32LE(L.p4); L.p4 += 4; return v; }
      case 19: { const v = L.b4.readFloatLE(L.p4); L.p4 += 4; return v; }
      case 3: { const v = L.b8.readBigInt64LE(L.p8); L.p8 += 8; return Number(v); }
      case 4: { const v = L.b8.readBigUInt64LE(L.p8); L.p8 += 8; return Number(v); }
      case 5: { const v = L.b8.readDoubleLE(L.p8); L.p8 += 8; return v; }
      case 6: return str(r4i(main));
      case 7: { const n = blobLens[bl++] ?? 0; const r = blobs.subarray(bp, bp + n); bp += n; return r; }
      case 8: { const n = r4i(main); const a: KV[] = []; for (let k = 0; k < n; k++) a.push(value(readType(), main)); return a; }
      case 10: case 24: case 25: {
        const n = t === 10 ? r4i(main) : main.b1[main.p1++]!;
        const sub = readType();
        const lane = t === 25 ? aux : main;
        const a: KV[] = [];
        for (let k = 0; k < n; k++) a.push(value(sub, lane));
        return a;
      }
      case 9: {
        const n = version >= 5 ? (() => { const v = objLens!.readInt32LE(op); op += 4; return v; })() : r4i(main);
        const o: { [key: string]: KV } = {};
        for (let k = 0; k < n; k++) { const ty = readType(); const name = str(r4i(main)); o[name] = value(ty, main); }
        return o;
      }
      default: throw new Error(`KV3 value type ${t} not supported`);
    }
  };
  const root = value(readType(), main);
  return { value: root, end: p };
}

/** Block table of a compiled Source 2 resource (`*_c` file): type → offset/size. */
export function resourceBlocks(b: Buffer): Record<string, { off: number; size: number }> {
  const blockOffset = b.readUInt32LE(8), count = b.readUInt32LE(12);
  const out: Record<string, { off: number; size: number }> = {};
  for (let i = 0; i < count; i++) {
    const q = 8 + blockOffset + i * 12;
    out[b.toString('latin1', q, q + 4)] = { off: q + 4 + b.readUInt32LE(q + 4), size: b.readUInt32LE(q + 8) };
  }
  return out;
}

export function readResourceKV3(b: Buffer, block: string): KV {
  const blk = resourceBlocks(b)[block];
  if (!blk) throw new Error(`resource has no ${block} block`);
  return readKV3(b, blk.off).value;
}

// Narrowing helpers for walking KV trees.
export const obj = (v: KV | undefined): { [key: string]: KV } => (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) ? v : {});
export const arr = (v: KV | undefined): KV[] => (Array.isArray(v) ? v : []);
export const num = (v: KV | undefined, d = 0): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
export const strv = (v: KV | undefined): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
