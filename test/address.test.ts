import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZcashAddressError,
  isValidZcashAddress,
  parseZcashAddress,
  validateZcashAddress,
  type ZcashAddressErrorCode,
} from '../src/index.js';
import { encodeUnifiedRaw } from '../src/unified.js';
import { bytesToHex, hexToBytes } from '../src/bytes.js';
import { officialRows, readVector } from './helpers.js';

const ALL = { accept: ['p2pkh', 'p2sh', 'sapling', 'unified', 'tex', 'sprout'] as const, network: ['mainnet', 'testnet', 'regtest'] as const };

test('official zip_0320.json: transparent and TEX addresses', () => {
  const rows = officialRows('zip_0320.json');
  assert.equal(rows.length, 15);
  for (const r of rows) {
    const t = parseZcashAddress(r['t_addr'] as string);
    const x = parseZcashAddress(r['tex_addr'] as string);
    assert.equal(t.type, 'p2pkh');
    assert.equal(x.type, 'tex');
    assert.equal(t.network, 'mainnet');
    assert.equal(x.network, 'mainnet');
    assert.equal(bytesToHex(t.payload!), r['p2pkh_bytes']);
    assert.equal(bytesToHex(x.payload!), r['p2pkh_bytes']);
    assert.equal(x.shielded, false);
    assert.ok(isValidZcashAddress(r['t_addr'] as string));
    assert.ok(isValidZcashAddress(r['tex_addr'] as string));
  }
});

interface Generated {
  zcash_test_vectors_commit: string;
  valid: { address: string; type: string; network: string; note: string; receivers?: string[] }[];
  invalid: { address: string; code: ZcashAddressErrorCode; note: string }[];
}
const GEN = readVector<Generated>('generated/reference_vectors.json');

test('reference-generated valid vectors parse with the expected type, network and receivers', () => {
  assert.ok(GEN.valid.length >= 25);
  for (const v of GEN.valid) {
    const p = parseZcashAddress(v.address);
    assert.equal(p.type, v.type, v.note);
    assert.equal(p.network, v.network, v.note);
    if (v.receivers) assert.deepEqual(p.receivers!.map((r) => r.kind), v.receivers, v.note);
    assert.equal(validateZcashAddress(v.address, ALL).valid, true, v.note);
  }
});

test('reference-generated invalid vectors are rejected with the expected code', () => {
  assert.ok(GEN.invalid.length >= 45);
  for (const v of GEN.invalid) {
    assert.throws(
      () => parseZcashAddress(v.address),
      (e: unknown) => e instanceof ZcashAddressError && e.code === v.code,
      `${v.note}: expected ${v.code}`,
    );
    assert.equal(isValidZcashAddress(v.address, ALL), false, v.note);
  }
});

const UA = officialRows('unified_address.json')[0]!['unified_addr'] as string;
const ZS = 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya';
const T1 = 't1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdgW';
const ZC = 'zcU1Cd6zYyZCd2VJF8yKgmzjxdiiU1rgTTjEwoN1CGUWCziPkUTXUjXmX7TMqdMNsTfuiGN1jQoVN4kGxUR4sAPN4XZ7pxb';

test('real-world mainnet strings', () => {
  assert.equal(parseZcashAddress(ZS).type, 'sapling');
  assert.equal(parseZcashAddress(ZC).type, 'sprout');
  // The Sapling address quoted in multicoin-address-validator issue #20 lost its last character.
  assert.equal(isValidZcashAddress(ZS.slice(0, -1)), false);
});

test('policy: accepted types, Sprout off by default, transparent alias', () => {
  assert.equal(isValidZcashAddress(ZC), false);
  assert.equal(validateZcashAddress(ZC).valid ? '' : (validateZcashAddress(ZC) as { code: string }).code, 'TYPE_NOT_ACCEPTED');
  assert.equal(isValidZcashAddress(ZC, { accept: ['sprout'] }), true);
  assert.equal(isValidZcashAddress(T1, { accept: ['sapling', 'unified'] }), false);
  assert.equal(isValidZcashAddress(T1, { accept: ['transparent'] }), true);
  assert.equal(isValidZcashAddress(UA, { accept: ['transparent'] }), false);
  assert.equal(isValidZcashAddress(ZS, { accept: ['sapling'] }), true);
});

test('policy: network', () => {
  const tm = GEN.valid.find((v) => v.note.startsWith('testnet P2PKH'))!.address;
  assert.equal(isValidZcashAddress(tm), false);
  assert.equal(isValidZcashAddress(tm, { network: 'testnet' }), true);
  // Base58 testnet prefixes are shared with regtest.
  assert.equal(isValidZcashAddress(tm, { network: 'regtest' }), true);
  assert.equal(parseZcashAddress(tm).networkAmbiguous, true);
  assert.equal(isValidZcashAddress(UA, { network: 'testnet' }), false);
  assert.equal(isValidZcashAddress(UA, { network: ['testnet', 'mainnet'] }), true);
  const r = validateZcashAddress(UA, { network: 'testnet' });
  assert.ok(!r.valid && r.code === 'NETWORK_MISMATCH');
});

test('policy: requireShieldedReceiver and Address Expiry', () => {
  const p2pkh = hexToBytes('7bb83570b8fae146e03c5331a020b1e0892f631d');
  const height = new Uint8Array([0x80, 0x84, 0x1e, 0x00]); // 2_000_000
  const time = new Uint8Array(8);
  new DataView(time.buffer).setBigUint64(0, 1_900_000_000n, true);
  const tu = encodeUnifiedRaw('tu', [
    { typecode: 0x00, data: p2pkh },
    { typecode: 0xe0, data: height },
    { typecode: 0xe1, data: time },
  ]);
  const p = parseZcashAddress(tu);
  assert.equal(p.shielded, false);
  assert.equal(p.expiryHeight, 2_000_000);
  assert.equal(p.expiryTime, 1_900_000_000n);
  const now = 1_800_000_000_000;
  assert.equal(isValidZcashAddress(tu, { now }), true);
  const r1 = validateZcashAddress(tu, { now, requireShieldedReceiver: true });
  assert.ok(!r1.valid && r1.code === 'NO_SHIELDED_RECEIVER');
  const r2 = validateZcashAddress(tu, { now: 1_900_000_001_000 });
  assert.ok(!r2.valid && r2.code === 'EXPIRED');
  assert.equal(isValidZcashAddress(tu, { now: 1_900_000_001_000, rejectExpired: false }), true);
  const r3 = validateZcashAddress(tu, { now, currentHeight: 2_000_001 });
  assert.ok(!r3.valid && r3.code === 'EXPIRED');
  assert.equal(isValidZcashAddress(tu, { now, currentHeight: 2_000_000 }), true);
  assert.equal(isValidZcashAddress(UA, { requireShieldedReceiver: true }), true);
});

test('input hygiene: whitespace, empty, non-string, case, length cap, junk', () => {
  const code = (s: unknown, opts = {}) => {
    const r = validateZcashAddress(s as string, opts);
    return r.valid ? 'VALID' : r.code;
  };
  assert.equal(code(' ' + UA), 'WHITESPACE');
  assert.equal(code(UA + '\n'), 'WHITESPACE');
  assert.equal(code(''), 'EMPTY');
  assert.equal(code(undefined), 'NOT_A_STRING');
  assert.equal(code(42), 'NOT_A_STRING');
  assert.equal(code(UA.toUpperCase()), 'VALID');
  assert.equal(parseZcashAddress(ZS.toUpperCase()).address, ZS);
  assert.equal(code(UA.slice(0, 10) + UA.slice(10).toUpperCase()), 'MIXED_CASE');
  assert.equal(code(UA, { maxLength: 50 }), 'TOO_LONG');
  assert.equal(code('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), 'UNKNOWN_FORMAT');
  assert.equal(code('0x52908400098527886E0F7030069857D2E4169EE7'), 'UNKNOWN_FORMAT');
  assert.equal(code('1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), 'UNKNOWN_FORMAT');
  assert.equal(code('hello world'), 'WHITESPACE');
  assert.equal(code('u1'), 'BAD_ENCODING');
});

test('checkPoints: false skips curve checks but keeps structure checks', () => {
  const bad = GEN.invalid.find((v) => v.code === 'INVALID_SAPLING_DIVERSIFIER')!.address;
  assert.equal(parseZcashAddress(bad, { checkPoints: false }).type, 'sapling');
  const order = GEN.invalid.find((v) => v.code === 'BAD_TYPECODE_ORDER')!.address;
  assert.throws(() => parseZcashAddress(order, { checkPoints: false }));
});
