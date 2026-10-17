// Unified Addresses (ZIP 316, Revision 0 and Revision 2).
//
// Decoding, as the ZIP requires of a Consumer:
//  1. Bech32m decode (no length limit), reject a bad checksum.
//  2. F4Jumble^-1 (input length 38..4194368 bytes).
//  3. The last 16 bytes must be the HRP padded with zero bytes.
//  4. Parse (typecode, length, value) items, typecode and length as canonical compactSize <= 0x2000000.
// Then the structural rules of ZIP 316 / librustzcash are enforced: ascending typecodes without duplicates,
// not both P2PKH and P2SH, at least one data item, a Revision 0 UA needs a non-transparent item, a `zu` UA
// has no transparent receiver, MUST-understand metadata (0xE0..0xFC) is rejected unless understood (0xE0/0xE1
// in Revision 2), and every known receiver must be valid for its pool.
//
// NU6.3 (Ironwood) does not add a typecode: ZIP 229 states "The addition of the Ironwood pool does not change
// address structures or encodings"; Orchard receivers (0x03) are reused. Checked against zcash/zips @ a34cfc0.

import { fail } from './errors.js';
import { asciiBytes, concatBytes, equalBytes, leBytesToBigInt } from './bytes.js';
import { bytesToWords, bech32Encode } from './bech32.js';
import { f4jumble, f4jumbleInv, isValidF4JumbleLength } from './f4jumble.js';
import { saplingDiversifierIsValid, saplingPkdIsValid } from './jubjub.js';
import { orchardPkdIsValid } from './pallas.js';
import type { ZcashNetwork } from './types.js';

export const TYPECODE_P2PKH = 0x00;
export const TYPECODE_P2SH = 0x01;
export const TYPECODE_SAPLING = 0x02;
export const TYPECODE_ORCHARD = 0x03;
export const TYPECODE_EXPIRY_HEIGHT = 0xe0;
export const TYPECODE_EXPIRY_TIME = 0xe1;
const METADATA_MIN = 0xc0;
const METADATA_MAX = 0xfc;
const MUST_UNDERSTAND_MIN = 0xe0;
const MAX_COMPACT_SIZE = 0x2000000;
const PADDING_LEN = 16;

export type UnifiedRevision = 0 | 2;

export interface UnifiedHrpInfo {
  network: ZcashNetwork;
  revision: UnifiedRevision;
  /** 'u' = Revision 0, 'zu' = shielded-only Revision 2, 'tu' = transparent-enabled Revision 2. */
  prefix: 'u' | 'zu' | 'tu';
}

export const UNIFIED_HRPS: Readonly<Record<string, UnifiedHrpInfo>> = {
  u: { network: 'mainnet', revision: 0, prefix: 'u' },
  utest: { network: 'testnet', revision: 0, prefix: 'u' },
  uregtest: { network: 'regtest', revision: 0, prefix: 'u' },
  zu: { network: 'mainnet', revision: 2, prefix: 'zu' },
  zutest: { network: 'testnet', revision: 2, prefix: 'zu' },
  zuregtest: { network: 'regtest', revision: 2, prefix: 'zu' },
  tu: { network: 'mainnet', revision: 2, prefix: 'tu' },
  tutest: { network: 'testnet', revision: 2, prefix: 'tu' },
  turegtest: { network: 'regtest', revision: 2, prefix: 'tu' },
};

export type ReceiverKind = 'p2pkh' | 'p2sh' | 'sapling' | 'orchard' | 'unknown';

export interface UnifiedReceiver {
  typecode: number;
  kind: ReceiverKind;
  /** Receiver encoding (20 bytes for transparent, 43 bytes for Sapling and Orchard). */
  data: Uint8Array;
}

export type MetadataKind = 'expiryHeight' | 'expiryTime' | 'unknown';

export interface UnifiedMetadataItem {
  typecode: number;
  kind: MetadataKind;
  data: Uint8Array;
}

export interface DecodedUnified {
  revision: UnifiedRevision;
  /** Data items (receivers) in encoding order, including unknown typecodes. */
  receivers: UnifiedReceiver[];
  /** Metadata items in encoding order. */
  metadata: UnifiedMetadataItem[];
  /** Address Expiry Height (typecode 0xE0), if present. */
  expiryHeight?: number;
  /** Address Expiry Time in Unix seconds (typecode 0xE1), if present. */
  expiryTime?: bigint;
}

export interface UnifiedDecodeOptions {
  /** Check that Sapling/Orchard receivers are valid curve points (default true). */
  checkPoints?: boolean;
}

function readCompactSize(buf: Uint8Array, pos: number): [number, number] {
  const first = buf[pos];
  if (first === undefined) fail('TRUNCATED', 'unexpected end of Unified Address data');
  if (first < 0xfd) return [first, pos + 1];
  const width = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  if (pos + 1 + width > buf.length) fail('TRUNCATED', 'unexpected end of Unified Address data');
  const value = leBytesToBigInt(buf.subarray(pos + 1, pos + 1 + width));
  const min = first === 0xfd ? 0xfdn : first === 0xfe ? 0x10000n : 0x100000000n;
  if (value < min) fail('BAD_COMPACT_SIZE', 'non-canonical compactSize');
  if (value > BigInt(MAX_COMPACT_SIZE)) fail('BAD_COMPACT_SIZE', 'compactSize value above 0x2000000');
  return [Number(value), pos + 1 + width];
}

export function hrpPadding(hrp: string): Uint8Array {
  if (hrp.length > PADDING_LEN) throw new RangeError('HRP longer than 16 bytes');
  const p = new Uint8Array(PADDING_LEN);
  p.set(asciiBytes(hrp));
  return p;
}

function receiverKind(typecode: number): ReceiverKind {
  switch (typecode) {
    case TYPECODE_P2PKH:
      return 'p2pkh';
    case TYPECODE_P2SH:
      return 'p2sh';
    case TYPECODE_SAPLING:
      return 'sapling';
    case TYPECODE_ORCHARD:
      return 'orchard';
    default:
      return 'unknown';
  }
}

const RECEIVER_LENGTH: Partial<Record<ReceiverKind, number>> = {
  p2pkh: 20,
  p2sh: 20,
  sapling: 43,
  orchard: 43,
};

function validateReceiver(r: UnifiedReceiver, checkPoints: boolean): void {
  const expected = RECEIVER_LENGTH[r.kind];
  if (expected !== undefined && r.data.length !== expected) {
    fail('BAD_RECEIVER_LENGTH', `${r.kind} receiver must be ${expected} bytes, got ${r.data.length}`);
  }
  if (!checkPoints) return;
  if (r.kind === 'sapling') {
    if (!saplingDiversifierIsValid(r.data.subarray(0, 11))) {
      fail('INVALID_SAPLING_DIVERSIFIER', 'Sapling receiver has an invalid diversifier');
    }
    if (!saplingPkdIsValid(r.data.subarray(11, 43))) {
      fail('INVALID_SAPLING_PK_D', 'Sapling receiver pk_d is not a valid prime-order point');
    }
  } else if (r.kind === 'orchard') {
    if (!orchardPkdIsValid(r.data.subarray(11, 43))) {
      fail('INVALID_ORCHARD_PK_D', 'Orchard receiver pk_d is not a valid non-identity Pallas point');
    }
  }
}

/**
 * Decode the Bech32m payload of a Unified Address (already checksum-verified) for a known HRP.
 * Throws ZcashAddressError on any violation.
 */
export function decodeUnifiedPayload(
  hrp: string,
  jumbled: Uint8Array,
  options: UnifiedDecodeOptions = {},
): DecodedUnified {
  const info = UNIFIED_HRPS[hrp];
  if (info === undefined) fail('UNKNOWN_FORMAT', `'${hrp}' is not a Unified Address HRP`);
  const checkPoints = options.checkPoints ?? true;
  if (!isValidF4JumbleLength(jumbled.length)) {
    fail('BAD_LENGTH', `Unified Address payload of ${jumbled.length} bytes is outside 38..4194368`);
  }
  const raw = f4jumbleInv(jumbled);
  if (!equalBytes(raw.subarray(raw.length - PADDING_LEN), hrpPadding(hrp))) {
    fail('BAD_PADDING', 'Unified Address padding does not match its HRP');
  }
  const body = raw.subarray(0, raw.length - PADDING_LEN);

  const result: DecodedUnified = { revision: info.revision, receivers: [], metadata: [] };
  let pos = 0;
  let prev = -1;
  let hasP2pkh = false;
  let hasP2sh = false;
  let hasData = false;
  let onlyTransparent = true;
  while (pos < body.length) {
    let typecode: number;
    let length: number;
    [typecode, pos] = readCompactSize(body, pos);
    [length, pos] = readCompactSize(body, pos);
    if (pos + length > body.length) fail('TRUNCATED', 'Unified Address item extends past the end of the data');
    const data = body.slice(pos, pos + length);
    pos += length;

    if (typecode < prev) fail('BAD_TYPECODE_ORDER', 'Unified Address items are not in ascending typecode order');
    if (typecode === prev) fail('DUPLICATE_TYPECODE', `typecode 0x${typecode.toString(16)} appears more than once`);
    prev = typecode;

    if (typecode >= METADATA_MIN && typecode <= METADATA_MAX) {
      if (typecode >= MUST_UNDERSTAND_MIN) {
        if (info.revision === 0) {
          fail('METADATA_NOT_IN_REVISION', `Revision 0 UA must not contain MUST-understand metadata 0x${typecode.toString(16)}`);
        }
        if (typecode === TYPECODE_EXPIRY_HEIGHT) {
          if (data.length !== 4) fail('BAD_METADATA_LENGTH', 'Address Expiry Height must be 4 bytes');
          result.expiryHeight = Number(leBytesToBigInt(data));
          result.metadata.push({ typecode, kind: 'expiryHeight', data });
        } else if (typecode === TYPECODE_EXPIRY_TIME) {
          if (data.length !== 8) fail('BAD_METADATA_LENGTH', 'Address Expiry Time must be 8 bytes');
          result.expiryTime = leBytesToBigInt(data);
          result.metadata.push({ typecode, kind: 'expiryTime', data });
        } else {
          fail('MUST_UNDERSTAND_METADATA', `unrecognised MUST-understand metadata typecode 0x${typecode.toString(16)}`);
        }
      } else {
        // 0xC0..0xDF: metadata a Consumer may ignore.
        result.metadata.push({ typecode, kind: 'unknown', data });
      }
      continue;
    }

    const kind = receiverKind(typecode);
    const receiver: UnifiedReceiver = { typecode, kind, data };
    validateReceiver(receiver, checkPoints);
    hasData = true;
    if (kind === 'p2pkh') hasP2pkh = true;
    else if (kind === 'p2sh') hasP2sh = true;
    else onlyTransparent = false;
    if (hasP2pkh && hasP2sh) fail('BOTH_P2PKH_AND_P2SH', 'UA contains both P2PKH and P2SH receivers');
    result.receivers.push(receiver);
  }

  if (!hasData) fail('NO_DATA_ITEMS', 'UA contains no receivers');
  if (info.revision === 0 && onlyTransparent) {
    fail('ONLY_TRANSPARENT', 'Revision 0 UA must contain a non-transparent receiver');
  }
  if (info.prefix === 'zu' && (hasP2pkh || hasP2sh)) {
    fail('TRANSPARENT_IN_ZU', "a 'zu' UA must not contain transparent receivers");
  }
  return result;
}

export interface RawItem {
  typecode: number;
  data: Uint8Array;
}

function writeCompactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >>> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24);
}

/**
 * Low-level encoder used by the tests: writes items in the given order with no validation.
 * Do not use it to produce addresses for users.
 */
export function encodeUnifiedRaw(hrp: string, items: RawItem[]): string {
  const parts: Uint8Array[] = [];
  for (const it of items) parts.push(writeCompactSize(it.typecode), writeCompactSize(it.data.length), it.data);
  parts.push(hrpPadding(hrp));
  return bech32Encode(hrp, bytesToWords(f4jumble(concatBytes(...parts))), 'bech32m');
}
