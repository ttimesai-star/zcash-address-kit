// Base58 and Base58Check (double SHA-256 checksum), as used by Zcash transparent and Sprout addresses.

import { sha256 } from '@noble/hashes/sha2.js';
import { fail } from './errors.js';
import { concatBytes, equalBytes } from './bytes.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_REV: Record<string, number> = Object.fromEntries(
  [...ALPHABET].map((c, i) => [c, i]),
);

export function isBase58(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) if (ALPHABET_REV[c] === undefined) return false;
  return true;
}

export function base58Decode(s: string): Uint8Array {
  if (!isBase58(s)) fail('BAD_ENCODING', 'invalid Base58 string');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHABET_REV[c]!);
  const body: number[] = [];
  while (n > 0n) {
    body.push(Number(n & 0xffn));
    n >>= 8n;
  }
  body.reverse();
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)]! + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

function checksum(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload)).subarray(0, 4);
}

/** Decode Base58Check and return the payload (version bytes included, checksum removed). */
export function base58CheckDecode(s: string): Uint8Array {
  const raw = base58Decode(s);
  if (raw.length < 5) fail('BAD_LENGTH', 'Base58Check string too short');
  const payload = raw.subarray(0, raw.length - 4);
  if (!equalBytes(checksum(payload), raw.subarray(raw.length - 4))) {
    fail('BAD_CHECKSUM', 'Base58Check checksum mismatch');
  }
  return payload;
}

export function base58CheckEncode(payload: Uint8Array): string {
  return base58Encode(concatBytes(payload, checksum(payload)));
}
