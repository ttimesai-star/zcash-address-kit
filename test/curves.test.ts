import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JUBJUB_D,
  JUBJUB_Q,
  JUBJUB_R,
  jubjubDecode,
  jubjubEncode,
  jubjubGroupHash,
  jubjubInPrimeOrderSubgroup,
  saplingDiversifierIsValid,
  saplingPkdIsValid,
} from '../src/jubjub.js';
import { PALLAS_P, orchardPkdIsValid, pallasDecode } from '../src/pallas.js';
import { PrimeField } from '../src/field.js';
import { bytesToHex, hexToBytes } from '../src/bytes.js';
import { officialRows } from './helpers.js';

test('Jubjub constants', () => {
  // d as published for Jubjub (sapling-crypto / jubjub crate).
  assert.equal(JUBJUB_D, 0x2a9318e74bfa2b48f5fd9207e6bd7fd4292d7f6d37579d2601065fd6d6343eb1n);
  assert.equal(JUBJUB_Q % 2n ** 32n, 1n);
  assert.ok(JUBJUB_R < JUBJUB_Q);
});

test('Tonelli-Shanks square roots', () => {
  for (const p of [JUBJUB_Q, PALLAS_P]) {
    const F = new PrimeField(p);
    for (const x of [1n, 2n, 3n, 5n, 12345678901234567890n, p - 2n]) {
      const sq = F.mod(x * x);
      const r = F.sqrt(sq);
      assert.ok(r !== null);
      assert.equal(F.mod(r * r), sq);
    }
    let nonSquares = 0;
    for (let x = 2n; x < 40n; x++) if (F.sqrt(x) === null) nonSquares++;
    assert.ok(nonSquares > 0);
  }
});

const findGroupHash = (pers: string, msg: Uint8Array) => {
  for (let i = 0; i < 256; i++) {
    const p = jubjubGroupHash(new TextEncoder().encode(pers), Uint8Array.from([...msg, i]));
    if (p !== null) return p;
  }
  throw new Error('no group hash');
};

test('official sapling_generators.json: group hash reproduces the Sapling generators', () => {
  const [g] = officialRows('sapling_generators.json');
  assert.ok(g);
  // SPENDING_KEY_BASE = find_group_hash("Zcash_G_", ""), PROVING_KEY_BASE = find_group_hash("Zcash_H_", "")
  assert.equal(bytesToHex(jubjubEncode(findGroupHash('Zcash_G_', new Uint8Array()))), g['skb']);
  assert.equal(bytesToHex(jubjubEncode(findGroupHash('Zcash_H_', new Uint8Array()))), g['pkb']);
  assert.equal(bytesToHex(jubjubEncode(findGroupHash('Zcash_J_', new Uint8Array()))), g['npb']);
  for (const key of ['skb', 'pkb', 'npb', 'wprb', 'vcvb', 'vcrb', 'pb0', 'pb1', 'pb2', 'pb3']) {
    const p = jubjubDecode(hexToBytes(g[key] as string));
    assert.ok(p, key);
    assert.ok(jubjubInPrimeOrderSubgroup(p), key);
    assert.equal(bytesToHex(jubjubEncode(p)), g[key]);
  }
});

test('official sapling_key_components.json: default diversifiers and pk_d are valid', () => {
  const rows = officialRows('sapling_key_components.json');
  assert.equal(rows.length, 10);
  for (const r of rows) {
    assert.ok(saplingDiversifierIsValid(hexToBytes(r['default_d'] as string)));
    assert.ok(saplingPkdIsValid(hexToBytes(r['default_pk_d'] as string)));
  }
});

test('official orchard_key_components.json: default pk_d are valid Pallas points', () => {
  const rows = officialRows('orchard_key_components.json');
  assert.ok(rows.length >= 10);
  for (const r of rows) {
    assert.ok(orchardPkdIsValid(hexToBytes(r['default_pk_d'] as string)));
    assert.ok(orchardPkdIsValid(hexToBytes(r['ak'] as string)));
  }
});

test('Pallas decoding edge cases', () => {
  assert.equal(pallasDecode(new Uint8Array(32)), 'identity');
  const xp = new Uint8Array(32);
  let p = PALLAS_P;
  for (let i = 0; i < 32; i++) {
    xp[i] = Number(p & 0xffn);
    p >>= 8n;
  }
  assert.equal(pallasDecode(xp), 'invalid'); // x = p is non-canonical
  assert.equal(pallasDecode(new Uint8Array(31)), 'invalid');
});

test('Jubjub decoding edge cases', () => {
  // identity (u = 0, v = 1) decodes but is not a valid pk_d
  const id = new Uint8Array(32);
  id[0] = 1;
  assert.ok(jubjubDecode(id));
  assert.equal(saplingPkdIsValid(id), false);
  // u = 0 with the sign bit set is rejected (jubjub crate behaviour)
  const idNeg = Uint8Array.from(id);
  idNeg[31] = 0x80;
  assert.equal(jubjubDecode(idNeg), null);
  // v = q is non-canonical
  const vq = new Uint8Array(32);
  let q = JUBJUB_Q;
  for (let i = 0; i < 32; i++) {
    vq[i] = Number(q & 0xffn);
    q >>= 8n;
  }
  assert.equal(jubjubDecode(vq), null);
  assert.equal(saplingDiversifierIsValid(new Uint8Array(10)), false);
});
