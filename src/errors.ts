/** Machine-readable reason why an address string was rejected. */
export type ZcashAddressErrorCode =
  // input shape
  | 'NOT_A_STRING'
  | 'EMPTY'
  | 'WHITESPACE'
  | 'TOO_LONG'
  | 'UNKNOWN_FORMAT'
  // string encodings (Bech32 / Bech32m / Base58Check)
  | 'BAD_ENCODING'
  | 'MIXED_CASE'
  | 'BAD_CHECKSUM'
  | 'WRONG_VARIANT'
  | 'BAD_LENGTH'
  // Unified Address container (ZIP 316)
  | 'BAD_PADDING'
  | 'BAD_COMPACT_SIZE'
  | 'TRUNCATED'
  | 'BAD_TYPECODE_ORDER'
  | 'DUPLICATE_TYPECODE'
  | 'BOTH_P2PKH_AND_P2SH'
  | 'NO_DATA_ITEMS'
  | 'ONLY_TRANSPARENT'
  | 'TRANSPARENT_IN_ZU'
  | 'METADATA_NOT_IN_REVISION'
  | 'MUST_UNDERSTAND_METADATA'
  | 'BAD_METADATA_LENGTH'
  | 'BAD_RECEIVER_LENGTH'
  // receiver contents (Zcash protocol specification)
  | 'INVALID_SAPLING_DIVERSIFIER'
  | 'INVALID_SAPLING_PK_D'
  | 'INVALID_ORCHARD_PK_D'
  // policy checks done by validateZcashAddress()
  | 'NETWORK_MISMATCH'
  | 'TYPE_NOT_ACCEPTED'
  | 'NO_SHIELDED_RECEIVER'
  | 'EXPIRED';

export class ZcashAddressError extends Error {
  readonly code: ZcashAddressErrorCode;

  constructor(code: ZcashAddressErrorCode, message: string) {
    super(message);
    this.name = 'ZcashAddressError';
    this.code = code;
  }
}

export function fail(code: ZcashAddressErrorCode, message: string): never {
  throw new ZcashAddressError(code, message);
}
