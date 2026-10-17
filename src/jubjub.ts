// Jubjub (Sapling) point decoding and the checks a Sapling payment address must pass:
//  - the diversifier d must be valid: DiversifyHash(d) = GroupHash^J("Zcash_gd", d) != bottom
//  - pk_d must decode canonically to a point of the prime-order subgroup, other than the identity
// (Zcash protocol specification, sections 5.4.9.3 and 5.6.3.1; same rules as sapling-crypto).

import { blake2s } from '@noble/hashes/blake2.js';
import { PrimeField } from './field.js';
import { bigIntToLeBytes, concatBytes, leBytesToBigInt } from './bytes.js';

/** Base field modulus of Jubjub (= BLS12-381 scalar field). */
export const JUBJUB_Q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
/** Order of the prime-order subgroup. */
export const JUBJUB_R = 0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

const F = new PrimeField(JUBJUB_Q);
/** Twisted Edwards parameter d = -10240/10241; a = -1. */
export const JUBJUB_D = F.mod(-10240n * F.inv(10241n));

/** Extended twisted Edwards coordinates: u = X/Z, v = Y/Z, T = XY/Z. */
export interface JubjubPoint {
  X: bigint;
  Y: bigint;
  Z: bigint;
  T: bigint;
}

export const JUBJUB_IDENTITY: JubjubPoint = { X: 0n, Y: 1n, Z: 1n, T: 0n };

/**
 * abst_J: decode 32 bytes (v little-endian, sign of u in the top bit).
 * Returns null for non-canonical v, for v with no matching u, and for u = 0 with the sign bit set
 * (as the jubjub crate does).
 */
export function jubjubDecode(bytes: Uint8Array): JubjubPoint | null {
  if (bytes.length !== 32) return null;
  const sign = bytes[31]! >> 7;
  const vBytes = Uint8Array.from(bytes);
  vBytes[31]! &= 0x7f;
  const v = leBytesToBigInt(vBytes);
  if (v >= JUBJUB_Q) return null;
  const vv = F.mod(v * v);
  // a*u^2 + v^2 = 1 + d*u^2*v^2 with a = -1  =>  u^2 = (v^2 - 1) / (d*v^2 + 1)
  const u2 = F.mod((vv - 1n) * F.inv(JUBJUB_D * vv + 1n));
  let u = F.sqrt(u2);
  if (u === null) return null;
  if (u === 0n && sign === 1) return null;
  if (Number(u & 1n) !== sign) u = JUBJUB_Q - u;
  return { X: u, Y: v, Z: 1n, T: F.mod(u * v) };
}

export function jubjubEncode(p: JubjubPoint): Uint8Array {
  const zInv = F.inv(p.Z);
  const u = F.mod(p.X * zInv);
  const v = F.mod(p.Y * zInv);
  const out = bigIntToLeBytes(v, 32);
  if (u & 1n) out[31]! |= 0x80;
  return out;
}

/** Complete addition for a = -1 twisted Edwards curves (Hisil-Wong-Carter-Dawson). */
export function jubjubAdd(p: JubjubPoint, q: JubjubPoint): JubjubPoint {
  const A = F.mod(p.X * q.X);
  const B = F.mod(p.Y * q.Y);
  const C = F.mod(JUBJUB_D * F.mod(p.T * q.T));
  const D = F.mod(p.Z * q.Z);
  const E = F.mod((p.X + p.Y) * (q.X + q.Y) - A - B);
  const Fv = F.mod(D - C);
  const G = F.mod(D + C);
  const H = F.mod(B + A); // B - a*A with a = -1
  return { X: F.mod(E * Fv), Y: F.mod(G * H), T: F.mod(E * H), Z: F.mod(Fv * G) };
}

export function jubjubMul(p: JubjubPoint, k: bigint): JubjubPoint {
  let acc = JUBJUB_IDENTITY;
  for (let i = BigInt(k.toString(2).length) - 1n; i >= 0n; i--) {
    acc = jubjubAdd(acc, acc);
    if ((k >> i) & 1n) acc = jubjubAdd(acc, p);
  }
  return acc;
}

export function jubjubIsIdentity(p: JubjubPoint): boolean {
  return F.mod(p.X) === 0n && F.mod(p.Y - p.Z) === 0n;
}

export function jubjubInPrimeOrderSubgroup(p: JubjubPoint): boolean {
  return jubjubIsIdentity(jubjubMul(p, JUBJUB_R));
}

/** First 64 bytes of the BLAKE2s input of the Sapling group hash (URS). */
const URS = new TextEncoder().encode('096b36a5804bfacef1691e173c366a47ff5ba84a44f26ddd7e8d9f79d5b42df0');

/** GroupHash^J(D, M): BLAKE2s-256 personalised by D, decode, multiply by the cofactor 8. Null for bottom. */
export function jubjubGroupHash(personalization: Uint8Array, message: Uint8Array): JubjubPoint | null {
  const h = blake2s(concatBytes(URS, message), { dkLen: 32, personalization });
  const p = jubjubDecode(h);
  if (p === null) return null;
  const q = jubjubMul(p, 8n);
  return jubjubIsIdentity(q) ? null : q;
}

const GD_PERS = new TextEncoder().encode('Zcash_gd');

/** True if the 11-byte Sapling diversifier has DiversifyHash(d) != bottom. */
export function saplingDiversifierIsValid(d: Uint8Array): boolean {
  if (d.length !== 11) return false;
  return jubjubGroupHash(GD_PERS, d) !== null;
}

/** True if pk_d decodes to a non-identity point of the prime-order subgroup. */
export function saplingPkdIsValid(pkd: Uint8Array): boolean {
  const p = jubjubDecode(pkd);
  if (p === null) return false;
  if (jubjubIsIdentity(p)) return false;
  return jubjubInPrimeOrderSubgroup(p);
}
