import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bech32Decode, bech32Encode, bytesToWords, wordsToBytes } from '../src/bech32.js';
import { base58CheckDecode, base58CheckEncode, base58Decode, base58Encode } from '../src/base58.js';
import { ZcashAddressError } from '../src/errors.js';
import { bytesToHex, hexToBytes } from '../src/bytes.js';

// BIP 173 and BIP 350 test vectors (bitcoin/bips, "Test vectors" sections).
const BECH32_VALID = [
  'A12UEL5L',
  'a12uel5l',
  'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
  'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
  '11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
  'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
  '?1ezyfcl',
];
const BECH32M_VALID = [
  'A1LQFN3A',
  'a1lqfn3a',
  'an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6',
  'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx',
  '11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8',
  'split1checkupstagehandshakeupstreamerranterredcaperredlc445v',
  '?1v759aa',
];
const BECH32_INVALID = [
  '\x201nwldj5',
  '\x7f1axkwrx',
  '\x801eym55h',
  'an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx',
  'pzry9x0s0muk',
  '1pzry9x0s0muk',
  'x1b4n0q5v',
  'li1dgmt3',
  'de1lg7wt\xff',
  'A1G7SGD8',
  '10a06t8',
  '1qzzfhee',
];
const BECH32M_INVALID = [
  '\x201xj0phk',
  '\x7f1g6xzxy',
  '\x801vctc34',
  'an84characterslonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11d6pts4',
  'qyrz8wqd2c9m',
  '1qyrz8wqd2c9m',
  'y1b0jsk6g',
  'lt1igcx5c0',
  'in1muywd',
  'mm1crxm3i',
  'au1s5cgom',
  'M1VUXWEZ',
  '16plkw9',
  '1p2gdwpf',
];

test('BIP 173 valid Bech32 strings decode as bech32 and re-encode', () => {
  for (const s of BECH32_VALID) {
    const d = bech32Decode(s);
    assert.equal(d.variant, 'bech32', s);
    assert.equal(bech32Encode(d.hrp, d.words, 'bech32'), s.toLowerCase());
  }
});

test('BIP 350 valid Bech32m strings decode as bech32m and re-encode', () => {
  for (const s of BECH32M_VALID) {
    const d = bech32Decode(s);
    assert.equal(d.variant, 'bech32m', s);
    assert.equal(bech32Encode(d.hrp, d.words, 'bech32m'), s.toLowerCase());
  }
});

test('BIP 173 / BIP 350 invalid strings are rejected', () => {
  for (const s of [...BECH32_INVALID, ...BECH32M_INVALID]) {
    assert.throws(() => bech32Decode(s), ZcashAddressError, JSON.stringify(s));
  }
});

test('mixed case is rejected', () => {
  assert.throws(() => bech32Decode('a12UEL5L'), (e: ZcashAddressError) => e.code === 'MIXED_CASE');
});

test('Bech32 decoding has no 90-character limit', () => {
  const words = bytesToWords(new Uint8Array(300).fill(7));
  const s = bech32Encode('u', words, 'bech32m');
  assert.ok(s.length > 400);
  assert.equal(bytesToHex(wordsToBytes(bech32Decode(s).words)), '07'.repeat(300));
});

test('wordsToBytes rejects non-zero padding and over-long padding', () => {
  // 2 words = 10 bits -> 1 byte + 2 padding bits; set a padding bit.
  assert.throws(() => wordsToBytes([0, 1]), (e: ZcashAddressError) => e.code === 'BAD_ENCODING');
  // 3 words = 15 bits -> 1 byte + 7 leftover bits (>= 5): invalid.
  assert.throws(() => wordsToBytes([0, 0, 0]), (e: ZcashAddressError) => e.code === 'BAD_ENCODING');
  assert.deepEqual([...wordsToBytes([0, 0])], [0]);
});

test('Base58 round trip keeps leading zero bytes', () => {
  for (const hex of ['00', '0000ff', '1cb8' + '00'.repeat(20), 'ffeeddccbbaa']) {
    const b = hexToBytes(hex);
    assert.equal(bytesToHex(base58Decode(base58Encode(b))), hex);
  }
});

test('Base58Check: known value, checksum failure', () => {
  // ZIP 320 test vector 0: t1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdgW = Base58Check(1cb8 || 7bb835...)
  const payload = hexToBytes('1cb87bb83570b8fae146e03c5331a020b1e0892f631d');
  assert.equal(base58CheckEncode(payload), 't1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdgW');
  assert.equal(bytesToHex(base58CheckDecode('t1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdgW')), bytesToHex(payload));
  assert.throws(() => base58CheckDecode('t1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdgX'), (e: ZcashAddressError) => e.code === 'BAD_CHECKSUM');
  assert.throws(() => base58Decode('t1V9mnyk5Z5cTNMCkLbaDwSskgJZucTLdg0'), (e: ZcashAddressError) => e.code === 'BAD_ENCODING');
});
