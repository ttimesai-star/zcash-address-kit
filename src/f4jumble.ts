// F4Jumble, the unkeyed 4-round Feistel permutation of ZIP 316 ("Jumbling").
// H_i(u) = BLAKE2b-(8*l_L)("UA_F4Jumble_H" || [i, 0, 0], u)
// G_i(u) = first l_R bytes of BLAKE2b-512("UA_F4Jumble_G" || [i] || I2LEOSP_16(j), u), j = 0..ceil(l_R/64)-1

import { blake2b } from '@noble/hashes/blake2.js';

const L_H = 64;
/** Shortest message F4Jumble accepts (bytes). */
export const F4JUMBLE_MIN_LENGTH = 38;
/** Longest message F4Jumble accepts: (2^16 + 1) * 64 bytes. */
export const F4JUMBLE_MAX_LENGTH = (2 ** 16 + 1) * L_H;

const H_PERS = new TextEncoder().encode('UA_F4Jumble_H');
const G_PERS = new TextEncoder().encode('UA_F4Jumble_G');

function personal(prefix: Uint8Array, tail: number[]): Uint8Array {
  const p = new Uint8Array(16);
  p.set(prefix, 0);
  p.set(tail, prefix.length);
  return p;
}

/** XOR H_i(u) into target (length l_L). */
function xorH(i: number, u: Uint8Array, target: Uint8Array): void {
  const h = blake2b(u, { dkLen: target.length, personalization: personal(H_PERS, [i, 0, 0]) });
  for (let k = 0; k < target.length; k++) target[k]! ^= h[k]!;
}

/** XOR G_i(u) into target (length l_R). */
function xorG(i: number, u: Uint8Array, target: Uint8Array): void {
  const blocks = Math.ceil(target.length / L_H);
  for (let j = 0; j < blocks; j++) {
    const h = blake2b(u, { dkLen: L_H, personalization: personal(G_PERS, [i, j & 0xff, j >>> 8]) });
    const off = j * L_H;
    const end = Math.min(L_H, target.length - off);
    for (let k = 0; k < end; k++) target[off + k]! ^= h[k]!;
  }
}

export function isValidF4JumbleLength(len: number): boolean {
  return Number.isInteger(len) && len >= F4JUMBLE_MIN_LENGTH && len <= F4JUMBLE_MAX_LENGTH;
}

function split(len: number): number {
  if (!isValidF4JumbleLength(len)) {
    throw new RangeError(`F4Jumble input length ${len} outside ${F4JUMBLE_MIN_LENGTH}..${F4JUMBLE_MAX_LENGTH}`);
  }
  return Math.min(L_H, Math.floor(len / 2));
}

export function f4jumble(message: Uint8Array): Uint8Array {
  const lL = split(message.length);
  const out = Uint8Array.from(message);
  const a = out.subarray(0, lL); // becomes y, then c
  const b = out.subarray(lL); // becomes x, then d
  xorG(0, a, b); // x = b ^ G0(a)
  xorH(0, b, a); // y = a ^ H0(x)
  xorG(1, a, b); // d = x ^ G1(y)
  xorH(1, b, a); // c = y ^ H1(d)
  return out;
}

export function f4jumbleInv(message: Uint8Array): Uint8Array {
  const lL = split(message.length);
  const out = Uint8Array.from(message);
  const c = out.subarray(0, lL); // becomes y, then a
  const d = out.subarray(lL); // becomes x, then b
  xorH(1, d, c); // y = c ^ H1(d)
  xorG(1, c, d); // x = d ^ G1(y)
  xorH(0, d, c); // a = y ^ H0(x)
  xorG(0, c, d); // b = x ^ G0(a)
  return out;
}
