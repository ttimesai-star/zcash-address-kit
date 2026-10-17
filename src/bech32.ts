// Bech32 (BIP 173) and Bech32m (BIP 350) without the 90-character limit.
// ZIP 316 encodes Unified Addresses with Bech32m "ignoring any length restrictions",
// so a generic Bitcoin bech32 library cannot be used as-is.

import { fail } from './errors.js';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHARSET_REV: Record<string, number> = Object.fromEntries(
  [...CHARSET].map((c, i) => [c, i]),
);
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

export type Bech32Variant = 'bech32' | 'bech32m';

export interface Bech32Decoded {
  /** Lower-case human-readable part. */
  hrp: string;
  /** 5-bit data words, checksum removed. */
  words: number[];
  variant: Bech32Variant;
}

function polymod(values: Iterable<number>): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk = (chk ^ GEN[i]!) >>> 0;
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** Split `s` into HRP and data part without verifying the checksum. Returns null if there is no separator. */
export function bech32SplitHrp(s: string): string | null {
  const pos = s.lastIndexOf('1');
  if (pos < 1) return null;
  return s.slice(0, pos).toLowerCase();
}

/**
 * Decode a Bech32 or Bech32m string. Both variants are recognised; the caller checks
 * that the variant is the one its address type requires.
 */
export function bech32Decode(str: string): Bech32Decoded {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 33 || c > 126) fail('BAD_ENCODING', 'character outside the Bech32 range');
  }
  const lower = str.toLowerCase();
  const upper = str.toUpperCase();
  if (str !== lower && str !== upper) fail('MIXED_CASE', 'Bech32 strings must not mix upper and lower case');
  const s = lower;
  const pos = s.lastIndexOf('1');
  if (pos < 1) fail('BAD_ENCODING', 'missing Bech32 separator or empty human-readable part');
  if (pos > 83) fail('BAD_ENCODING', 'human-readable part longer than 83 characters');
  if (pos + 7 > s.length) fail('BAD_ENCODING', 'Bech32 data part shorter than the checksum');
  const hrp = s.slice(0, pos);
  const data: number[] = [];
  for (let i = pos + 1; i < s.length; i++) {
    const v = CHARSET_REV[s[i]!];
    if (v === undefined) fail('BAD_ENCODING', `invalid Bech32 character '${s[i]}'`);
    data.push(v);
  }
  const check = polymod([...hrpExpand(hrp), ...data]);
  let variant: Bech32Variant;
  if (check === BECH32_CONST) variant = 'bech32';
  else if (check === BECH32M_CONST) variant = 'bech32m';
  else fail('BAD_CHECKSUM', 'Bech32/Bech32m checksum mismatch');
  return { hrp, words: data.slice(0, data.length - 6), variant };
}

export function bech32Encode(hrp: string, words: number[], variant: Bech32Variant): string {
  const h = hrp.toLowerCase();
  const values = [...hrpExpand(h), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ (variant === 'bech32' ? BECH32_CONST : BECH32M_CONST);
  let out = h + '1';
  for (const w of words) out += CHARSET[w]!;
  for (let i = 0; i < 6; i++) out += CHARSET[(mod >>> (5 * (5 - i))) & 31]!;
  return out;
}

/** 5-bit words to bytes. Rejects leftover groups of 5+ bits and non-zero padding (BIP 173). */
export function wordsToBytes(words: number[]): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const w of words) {
    acc = ((acc << 5) | w) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5) fail('BAD_ENCODING', 'Bech32 data has an incomplete group of 5 or more bits');
  if ((acc << (8 - bits)) & 0xff) fail('BAD_ENCODING', 'Bech32 data has non-zero padding bits');
  return Uint8Array.from(out);
}

/** Bytes to 5-bit words, zero-padded. */
export function bytesToWords(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0x1fff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}
