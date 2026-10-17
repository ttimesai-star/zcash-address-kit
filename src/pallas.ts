// Pallas (Orchard) point decoding. An Orchard raw address is d (11 bytes) || repr_P(pk_d) (32 bytes).
// Every diversifier is valid (Orchard's DiversifyHash never returns the identity); pk_d must be the
// canonical encoding of a non-identity Pallas point (same rule as orchard::Address::from_raw_address_bytes).

import { PrimeField } from './field.js';
import { leBytesToBigInt } from './bytes.js';

/** Base field modulus of Pallas. */
export const PALLAS_P = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
const F = new PrimeField(PALLAS_P);
const B = 5n; // y^2 = x^3 + 5

export type PallasDecodeResult = 'point' | 'identity' | 'invalid';

/** Decode 32 bytes (x little-endian, sign of y in the top bit); the all-zero string is the identity. */
export function pallasDecode(bytes: Uint8Array): PallasDecodeResult {
  if (bytes.length !== 32) return 'invalid';
  if (bytes.every((b) => b === 0)) return 'identity';
  const xBytes = Uint8Array.from(bytes);
  xBytes[31]! &= 0x7f;
  const x = leBytesToBigInt(xBytes);
  if (x >= PALLAS_P) return 'invalid';
  const y = F.sqrt(F.mod(x * x * x + B));
  // y = 0 cannot occur: Pallas has prime order, so it has no point of order 2.
  if (y === null) return 'invalid';
  return 'point';
}

export function orchardPkdIsValid(pkd: Uint8Array): boolean {
  return pallasDecode(pkd) === 'point';
}
