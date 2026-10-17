import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blake2b } from '@noble/hashes/blake2.js';
import { f4jumble, f4jumbleInv, F4JUMBLE_MAX_LENGTH, F4JUMBLE_MIN_LENGTH } from '../src/f4jumble.js';
import { bytesToHex, hexToBytes } from '../src/bytes.js';
import { readVector } from './helpers.js';

test('official f4jumble.json vectors: jumble and unjumble', () => {
  const rows = readVector<unknown[][]>('official/f4jumble.json').slice(2) as [string, string][];
  assert.ok(rows.length >= 8);
  for (const [normal, jumbled] of rows) {
    assert.equal(bytesToHex(f4jumble(hexToBytes(normal))), jumbled);
    assert.equal(bytesToHex(f4jumbleInv(hexToBytes(jumbled))), normal);
  }
});

test('official f4jumble_long.json vectors (3246395 and 4194368 bytes)', () => {
  const rows = readVector<unknown[][]>('official/f4jumble_long.json').slice(2) as [number, string][];
  assert.equal(rows.length, 2);
  for (const [length, hash] of rows) {
    const m = new Uint8Array(length);
    for (let i = 0; i < length; i++) m[i] = i & 0xff;
    const j = f4jumble(m);
    assert.equal(bytesToHex(blake2b(j)), hash, `length ${length}`);
    const back = f4jumbleInv(j);
    assert.equal(back.length, length);
    assert.ok(back.every((b, i) => b === (i & 0xff)));
  }
});

test('F4Jumble rejects lengths outside 38..4194368', () => {
  assert.equal(F4JUMBLE_MIN_LENGTH, 38);
  assert.equal(F4JUMBLE_MAX_LENGTH, 4194368);
  assert.throws(() => f4jumble(new Uint8Array(37)), RangeError);
  assert.throws(() => f4jumbleInv(new Uint8Array(37)), RangeError);
  assert.throws(() => f4jumble(new Uint8Array(F4JUMBLE_MAX_LENGTH + 1)), RangeError);
  assert.equal(f4jumble(new Uint8Array(38)).length, 38);
});

test('F4Jumble round trip on assorted lengths', () => {
  for (const len of [38, 39, 47, 48, 64, 127, 128, 129, 130, 500, 4097]) {
    const m = new Uint8Array(len).map((_, i) => (i * 31 + len) & 0xff);
    assert.deepEqual(f4jumbleInv(f4jumble(m)), m);
  }
});
