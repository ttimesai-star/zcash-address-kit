import { ZcashAddressError, fail, type ZcashAddressErrorCode } from './errors.js';
import { bech32Decode, bech32SplitHrp, wordsToBytes } from './bech32.js';
import { base58CheckDecode, isBase58 } from './base58.js';
import { saplingDiversifierIsValid, saplingPkdIsValid } from './jubjub.js';
import {
  UNIFIED_HRPS,
  decodeUnifiedPayload,
  type UnifiedMetadataItem,
  type UnifiedReceiver,
  type UnifiedRevision,
} from './unified.js';
import type { ZcashAddressType, ZcashNetwork } from './types.js';

const SAPLING_HRPS: Readonly<Record<string, ZcashNetwork>> = {
  zs: 'mainnet',
  ztestsapling: 'testnet',
  zregtestsapling: 'regtest',
};

const TEX_HRPS: Readonly<Record<string, ZcashNetwork>> = {
  tex: 'mainnet',
  textest: 'testnet',
  texregtest: 'regtest',
};

interface Base58Prefix {
  type: 'p2pkh' | 'p2sh' | 'sprout';
  network: ZcashNetwork;
  payloadLength: number;
}

// Two-byte Base58Check version prefixes. Testnet and regtest share them.
const BASE58_PREFIXES: Readonly<Record<string, Base58Prefix>> = {
  '1cb8': { type: 'p2pkh', network: 'mainnet', payloadLength: 20 }, // t1
  '1cbd': { type: 'p2sh', network: 'mainnet', payloadLength: 20 }, // t3
  '169a': { type: 'sprout', network: 'mainnet', payloadLength: 64 }, // zc
  '1d25': { type: 'p2pkh', network: 'testnet', payloadLength: 20 }, // tm
  '1cba': { type: 'p2sh', network: 'testnet', payloadLength: 20 }, // t2
  '16b6': { type: 'sprout', network: 'testnet', payloadLength: 64 }, // zt
};

/** Default cap on input length (characters). Real addresses are far shorter; see README. */
export const DEFAULT_MAX_LENGTH = 4096;

export interface ParseOptions {
  /** Reject inputs longer than this many characters (default 4096). Use Infinity for no limit. */
  maxLength?: number;
  /** Validate Sapling/Orchard receivers as curve points (default true). */
  checkPoints?: boolean;
}

export interface ParsedZcashAddress {
  type: ZcashAddressType;
  network: ZcashNetwork;
  /**
   * True for Base58 (transparent, Sprout) testnet addresses: regtest uses the same prefixes,
   * so the string is also valid on regtest.
   */
  networkAmbiguous: boolean;
  /** Canonical string: lower-case for Bech32/Bech32m types, unchanged for Base58. */
  address: string;
  /**
   * Raw payload: 20-byte key/script hash (p2pkh, p2sh, tex), 43-byte raw address (sapling),
   * 64-byte raw address (sprout). Absent for unified addresses (see `receivers`).
   */
  payload?: Uint8Array;
  /** True if funds sent here can land in a shielded pool. */
  shielded: boolean;
  /** Unified only: 0 for `u`, 2 for `zu`/`tu` addresses. */
  revision?: UnifiedRevision;
  /** Unified only: receivers in encoding order (ascending typecode), unknown typecodes included. */
  receivers?: UnifiedReceiver[];
  /** Unified only: metadata items. */
  metadata?: UnifiedMetadataItem[];
  /** Unified only: Address Expiry Height (ZIP 316 Revision 2). */
  expiryHeight?: number;
  /** Unified only: Address Expiry Time, Unix seconds (ZIP 316 Revision 2). */
  expiryTime?: bigint;
}

function checkInput(s: unknown, maxLength: number): asserts s is string {
  if (typeof s !== 'string') fail('NOT_A_STRING', 'address must be a string');
  if (s.length === 0) fail('EMPTY', 'address is empty');
  if (s.length > maxLength) fail('TOO_LONG', `address longer than ${maxLength} characters`);
  if (/\s/.test(s)) fail('WHITESPACE', 'address contains whitespace (trim user input first)');
}

/**
 * Parse a Zcash address string. Throws ZcashAddressError (with a `code`) if it is not a
 * well-formed Zcash address on some network. Does not apply any acceptance policy; see
 * validateZcashAddress() for that.
 */
export function parseZcashAddress(input: string, options: ParseOptions = {}): ParsedZcashAddress {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const checkPoints = options.checkPoints ?? true;
  checkInput(input, maxLength);

  const hrp = bech32SplitHrp(input);
  if (hrp !== null) {
    const unified = UNIFIED_HRPS[hrp];
    const saplingNet = SAPLING_HRPS[hrp];
    const texNet = TEX_HRPS[hrp];
    if (unified !== undefined || saplingNet !== undefined || texNet !== undefined) {
      const dec = bech32Decode(input);
      const address = input.toLowerCase();

      if (unified !== undefined) {
        if (dec.variant !== 'bech32m') fail('WRONG_VARIANT', 'Unified Addresses use Bech32m, not Bech32');
        const u = decodeUnifiedPayload(dec.hrp, wordsToBytes(dec.words), { checkPoints });
        const shielded = u.receivers.some((r) => r.kind === 'sapling' || r.kind === 'orchard');
        const out: ParsedZcashAddress = {
          type: 'unified',
          network: unified.network,
          networkAmbiguous: false,
          address,
          shielded,
          revision: u.revision,
          receivers: u.receivers,
          metadata: u.metadata,
        };
        if (u.expiryHeight !== undefined) out.expiryHeight = u.expiryHeight;
        if (u.expiryTime !== undefined) out.expiryTime = u.expiryTime;
        return out;
      }

      if (saplingNet !== undefined) {
        if (dec.variant !== 'bech32') fail('WRONG_VARIANT', 'Sapling addresses use Bech32, not Bech32m');
        const payload = wordsToBytes(dec.words);
        if (payload.length !== 43) fail('BAD_LENGTH', `Sapling address must be 43 bytes, got ${payload.length}`);
        if (checkPoints) {
          if (!saplingDiversifierIsValid(payload.subarray(0, 11))) {
            fail('INVALID_SAPLING_DIVERSIFIER', 'Sapling address has an invalid diversifier');
          }
          if (!saplingPkdIsValid(payload.subarray(11, 43))) {
            fail('INVALID_SAPLING_PK_D', 'Sapling address pk_d is not a valid prime-order point');
          }
        }
        return { type: 'sapling', network: saplingNet, networkAmbiguous: false, address, payload, shielded: true };
      }

      // TEX (ZIP 320)
      if (dec.variant !== 'bech32m') fail('WRONG_VARIANT', 'TEX addresses use Bech32m, not Bech32');
      const payload = wordsToBytes(dec.words);
      if (payload.length !== 20) fail('BAD_LENGTH', `TEX address must be 20 bytes, got ${payload.length}`);
      return { type: 'tex', network: texNet!, networkAmbiguous: false, address, payload, shielded: false };
    }
  }

  if (isBase58(input) && input.length <= 128) {
    const decoded = base58CheckDecode(input);
    if (decoded.length < 2) fail('BAD_LENGTH', 'Base58Check payload too short');
    const key = decoded[0]!.toString(16).padStart(2, '0') + decoded[1]!.toString(16).padStart(2, '0');
    const prefix = BASE58_PREFIXES[key];
    if (prefix === undefined) fail('UNKNOWN_FORMAT', 'Base58Check version prefix is not a Zcash prefix');
    const payload = decoded.slice(2);
    if (payload.length !== prefix.payloadLength) {
      fail('BAD_LENGTH', `${prefix.type} address payload must be ${prefix.payloadLength} bytes, got ${payload.length}`);
    }
    return {
      type: prefix.type,
      network: prefix.network,
      networkAmbiguous: prefix.network === 'testnet',
      address: input,
      payload,
      shielded: prefix.type === 'sprout',
    };
  }

  fail('UNKNOWN_FORMAT', 'not a Zcash address');
}

/** What a service is willing to accept. 'transparent' is shorthand for p2pkh + p2sh. */
export type AcceptType = ZcashAddressType | 'transparent';

export const DEFAULT_ACCEPT: readonly AcceptType[] = ['p2pkh', 'p2sh', 'sapling', 'unified', 'tex'];

export interface ValidateOptions extends ParseOptions {
  /** Network(s) the address must belong to (default 'mainnet'). */
  network?: ZcashNetwork | readonly ZcashNetwork[];
  /** Address types to accept (default p2pkh, p2sh, sapling, unified, tex; Sprout is not accepted by default). */
  accept?: readonly AcceptType[];
  /** Unified only: require a Sapling or Orchard receiver (default false). */
  requireShieldedReceiver?: boolean;
  /** Unified only: reject addresses whose expiry metadata has passed (default true). */
  rejectExpired?: boolean;
  /** Current time in milliseconds, for Address Expiry Time (default Date.now()). */
  now?: number;
  /** Current chain height, for Address Expiry Height (not checked if omitted). */
  currentHeight?: number;
}

export type ValidationResult =
  | { valid: true; address: ParsedZcashAddress }
  | { valid: false; code: ZcashAddressErrorCode; message: string };

function policyCheck(p: ParsedZcashAddress, options: ValidateOptions): void {
  const networks: readonly ZcashNetwork[] =
    options.network === undefined ? ['mainnet'] : typeof options.network === 'string' ? [options.network] : options.network;
  const netOk = networks.includes(p.network) || (p.networkAmbiguous && networks.includes('regtest'));
  if (!netOk) fail('NETWORK_MISMATCH', `${p.network} address, expected ${networks.join(' or ')}`);

  const accept = options.accept ?? DEFAULT_ACCEPT;
  const typeOk =
    accept.includes(p.type) || (accept.includes('transparent') && (p.type === 'p2pkh' || p.type === 'p2sh'));
  if (!typeOk) fail('TYPE_NOT_ACCEPTED', `${p.type} addresses are not accepted`);

  if (p.type === 'unified') {
    if (options.requireShieldedReceiver && !p.shielded) {
      fail('NO_SHIELDED_RECEIVER', 'Unified Address has no Sapling or Orchard receiver');
    }
    if (options.rejectExpired ?? true) {
      const nowSec = BigInt(Math.floor((options.now ?? Date.now()) / 1000));
      if (p.expiryTime !== undefined && nowSec > p.expiryTime) fail('EXPIRED', 'Unified Address has expired (time)');
      if (p.expiryHeight !== undefined && options.currentHeight !== undefined && options.currentHeight > p.expiryHeight) {
        fail('EXPIRED', 'Unified Address has expired (height)');
      }
    }
  }
}

/** Parse and apply an acceptance policy. Never throws for bad input. */
export function validateZcashAddress(input: string, options: ValidateOptions = {}): ValidationResult {
  try {
    const address = parseZcashAddress(input, options);
    policyCheck(address, options);
    return { valid: true, address };
  } catch (e) {
    if (e instanceof ZcashAddressError) return { valid: false, code: e.code, message: e.message };
    throw e;
  }
}

/** True if `input` is a valid Zcash address that passes the acceptance policy (default: mainnet, all but Sprout). */
export function isValidZcashAddress(input: string, options: ValidateOptions = {}): boolean {
  return validateZcashAddress(input, options).valid;
}
