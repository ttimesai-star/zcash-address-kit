import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZcashAddress, validateZcashAddress } from '../src/address.js';
import { encodeUnifiedRaw, type RawItem } from '../src/unified.js';
import { bech32Encode, bytesToWords } from '../src/bech32.js';
import { ZcashAddressError } from '../src/errors.js';
import { bytesToHex, hexToBytes } from '../src/bytes.js';
import { officialRows } from './helpers.js';

const R0 = officialRows('unified_address.json');
const R2 = officialRows('unified_address_r2.json');

function expectedItems(row: Record<string, unknown>, r2: boolean): RawItem[] {
  const items: RawItem[] = [];
  const add = (tc: number, hex: unknown) => {
    if (typeof hex === 'string') items.push({ typecode: tc, data: hexToBytes(hex) });
  };
  add(0x00, row['p2pkh_bytes']);
  add(0x01, row['p2sh_bytes']);
  add(0x02, row['sapling_raw_addr']);
  add(0x03, row['orchard_raw_addr']);
  if (!r2 && typeof row['unknown_typecode'] === 'number') add(row['unknown_typecode'] as number, row['unknown_bytes']);
  if (r2 && typeof row['expiry_height'] === 'number') {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, row['expiry_height'] as number, true);
    items.push({ typecode: 0xe0, data: b });
  }
  if (r2 && typeof row['expiry_time'] === 'number') {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(row['expiry_time'] as number), true);
    items.push({ typecode: 0xe1, data: b });
  }
  return items.sort((a, b) => a.typecode - b.typecode);
}

function checkOfficial(rows: Record<string, unknown>[], r2: boolean) {
  for (const [i, row] of rows.entries()) {
    const ua = row['unified_addr'] as string;
    const p = parseZcashAddress(ua);
    assert.equal(p.type, 'unified', `vector ${i}`);
    assert.equal(p.network, 'mainnet');
    assert.equal(p.revision, r2 ? 2 : 0);
    const items = expectedItems(row, r2);
    const dataItems = items.filter((it) => it.typecode < 0xc0 || it.typecode > 0xfc);
    assert.deepEqual(
      p.receivers!.map((r) => [r.typecode, bytesToHex(r.data)]),
      dataItems.map((it) => [it.typecode, bytesToHex(it.data)]),
      `receivers of vector ${i}`,
    );
    if (r2) {
      assert.equal(p.expiryHeight, row['expiry_height'] ?? undefined, `expiry height ${i}`);
      assert.equal(p.expiryTime, row['expiry_time'] == null ? undefined : BigInt(row['expiry_time'] as number));
    }
    // Encoding the expected items with our encoder reproduces the official string (F4Jumble forward path).
    assert.equal(encodeUnifiedRaw(ua.slice(0, ua.lastIndexOf('1')), items), ua, `re-encode ${i}`);
  }
}

test('official unified_address.json (Revision 0): all vectors parse with the right receivers', () => {
  assert.equal(R0.length, 60);
  checkOfficial(R0, false);
});

test('official unified_address_r2.json (Revision 2, zu/tu, expiry metadata): all vectors parse', () => {
  assert.equal(R2.length, 60);
  checkOfficial(R2, true);
});

test('every single-character substitution of an official UA is rejected', () => {
  const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  let checked = 0;
  for (const row of [...R0.slice(0, 20), ...R2.slice(0, 20)]) {
    const ua = row['unified_addr'] as string;
    const sep = ua.lastIndexOf('1');
    for (let pos = sep + 1; pos < ua.length; pos++) {
      const orig = ua[pos]!;
      const repl = charset[(charset.indexOf(orig) + 1 + (pos % 31)) % 32]!;
      const bad = ua.slice(0, pos) + repl + ua.slice(pos + 1);
      assert.equal(validateZcashAddress(bad).valid, false, bad);
      checked++;
    }
  }
  assert.ok(checked > 5000);
});

test('adjacent swaps and truncation of official UAs are rejected', () => {
  for (const row of R0.slice(0, 15)) {
    const ua = row['unified_addr'] as string;
    for (let pos = ua.lastIndexOf('1') + 1; pos < ua.length - 1; pos += 7) {
      if (ua[pos] === ua[pos + 1]) continue;
      const swapped = ua.slice(0, pos) + ua[pos + 1] + ua[pos] + ua.slice(pos + 2);
      assert.equal(validateZcashAddress(swapped).valid, false);
    }
    assert.equal(validateZcashAddress(ua.slice(0, -1)).valid, false);
    assert.equal(validateZcashAddress(ua + 'q').valid, false);
  }
});

test('re-encoding official receivers in any non-ascending order is rejected', () => {
  let n = 0;
  for (const row of R0) {
    const items = expectedItems(row, false);
    if (items.length < 2) continue;
    const reversed = [...items].reverse();
    const ua = encodeUnifiedRaw('u', reversed);
    assert.throws(() => parseZcashAddress(ua), (e: ZcashAddressError) => e.code === 'BAD_TYPECODE_ORDER');
    n++;
  }
  assert.ok(n >= 30);
});

test('official receivers re-encoded with a different HRP change only the network', () => {
  const items = expectedItems(R0[5]!, false);
  for (const [hrp, net] of [
    ['utest', 'testnet'],
    ['uregtest', 'regtest'],
  ] as const) {
    const ua = encodeUnifiedRaw(hrp, items);
    assert.equal(parseZcashAddress(ua).network, net);
    assert.equal(validateZcashAddress(ua).valid, false); // default network is mainnet
    assert.equal(validateZcashAddress(ua, { network: net }).valid, true);
  }
});

// Jumbled byte strings from librustzcash components/zcash_address/src/kind/unified/address.rs tests.
const LIBRUSTZCASH_INVALID: [string, number[]][] = [
  [
    'padding: [0xff; 16] instead of the HRP padding',
    [
      0xe6, 0x59, 0xd1, 0xed, 0xf7, 0x4b, 0xe3, 0x5e, 0x5a, 0x54, 0x0e, 0x41, 0x5d, 0x2f, 0x0c, 0x0d, 0x33, 0x42, 0xbd,
      0xbe, 0x9f, 0x82, 0x62, 0x01, 0xc1, 0x1b, 0xd4, 0x1e, 0x42, 0x47, 0x86, 0x23, 0x05, 0x4b, 0x98, 0xd7, 0x76, 0x86,
      0xa5, 0xe3, 0x1b, 0xd3, 0x03, 0xca, 0x24, 0x44, 0x8e, 0x72, 0xc1, 0x4a, 0xc6, 0xbf, 0x3f, 0x2b, 0xce, 0xa7, 0x7b,
      0x28, 0x69, 0xc9, 0x84,
    ],
  ],
  [
    'padding truncated to 15 bytes',
    [
      0x9a, 0x56, 0x12, 0xa3, 0x43, 0x45, 0xe0, 0x82, 0x6c, 0xac, 0x24, 0x8b, 0x3b, 0x45, 0x72, 0x9a, 0x53, 0xd5, 0xf8,
      0xda, 0xec, 0x07, 0x7c, 0xba, 0x9f, 0xa8, 0xd2, 0x97, 0x5b, 0xda, 0x73, 0x1b, 0xd2, 0xd1, 0x32, 0x6b, 0x7b, 0x36,
      0xdd, 0x57, 0x84, 0x2a, 0xa0, 0x21, 0x23, 0x89, 0x73, 0x85, 0xe1, 0x4b, 0x3e, 0x95, 0xb7, 0xd4, 0x67, 0xbc, 0x4b,
      0x31, 0xee, 0x5a,
    ],
  ],
  [
    'missing the last data byte of the Sapling receiver',
    [
      0xaa, 0xb0, 0x6e, 0x7b, 0x26, 0x7a, 0x22, 0x17, 0x39, 0xfa, 0x07, 0x69, 0xe9, 0x32, 0x2b, 0xac, 0x8c, 0x9e, 0x5e,
      0x8a, 0xd9, 0x24, 0x06, 0x5a, 0x13, 0x79, 0x3a, 0x8d, 0xb4, 0x52, 0xfa, 0x18, 0x4e, 0x33, 0x4d, 0x8c, 0x17, 0x77,
      0x4d, 0x63, 0x69, 0x34, 0x22, 0x70, 0x3a, 0xea, 0x30, 0x82, 0x5a, 0x6b, 0x37, 0xd1, 0x0d, 0xbe, 0x20, 0xab, 0x82,
      0x86, 0x98, 0x34, 0x6a, 0xd8, 0x45, 0x40, 0xd0, 0x25, 0x60, 0xbf, 0x1e, 0xb6, 0xeb, 0x06, 0x85, 0x70, 0x4c, 0x42,
      0xbc, 0x19, 0x14, 0xef, 0x7a, 0x05, 0xa0, 0x71, 0xb2, 0x63, 0x80, 0xbb, 0xdc, 0x12, 0x08, 0x48, 0x28, 0x8f, 0x1c,
      0x9e, 0xc3, 0x42, 0xc6, 0x5e, 0x68, 0xa2, 0x78, 0x6c, 0x9e,
    ],
  ],
  [
    'truncated after the typecode of the Sapling receiver',
    [
      0x87, 0x7a, 0xdf, 0x79, 0x6b, 0xe3, 0xb3, 0x40, 0xef, 0xe4, 0x5d, 0xc2, 0x91, 0xa2, 0x81, 0xfc, 0x7d, 0x76, 0xbb,
      0xb0, 0x58, 0x98, 0x53, 0x59, 0xd3, 0x3f, 0xbc, 0x4b, 0x86, 0x59, 0x66, 0x62, 0x75, 0x92, 0xba, 0xcc, 0x31, 0x1e,
      0x60, 0x02, 0x3b, 0xd8, 0x4c, 0xdf, 0x36, 0xa1, 0xac, 0x82, 0x57, 0xed, 0x0c, 0x98, 0x49, 0x8f, 0x49, 0x7e, 0xe6,
      0x70, 0x36, 0x5b, 0x7b, 0x9e,
    ],
  ],
  [
    'only a transparent receiver',
    [
      0xf0, 0x9e, 0x9d, 0x6e, 0xf5, 0xa6, 0xac, 0x16, 0x50, 0xf0, 0xdb, 0xe1, 0x2c, 0xa5, 0x36, 0x22, 0xa2, 0x04, 0x89,
      0x86, 0xe9, 0x6a, 0x9b, 0xf3, 0xff, 0x6d, 0x2f, 0xe6, 0xea, 0xdb, 0xc5, 0x20, 0x62, 0xf9, 0x6f, 0xa9, 0x86, 0xcc,
    ],
  ],
];

test('librustzcash negative cases (jumbled bytes under the mainnet HRP) are rejected', () => {
  for (const [name, bytes] of LIBRUSTZCASH_INVALID) {
    const ua = bech32Encode('u', bytesToWords(Uint8Array.from(bytes)), 'bech32m');
    assert.throws(() => parseZcashAddress(ua), ZcashAddressError, name);
  }
});
