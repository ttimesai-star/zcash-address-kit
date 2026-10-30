// Error paths that the vector suites reach only through a later check with a different code.
// Added after `node scripts/mutate.mjs` showed that disabling them went unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZcashAddress } from '../src/address.js';
import { base58CheckDecode, base58CheckEncode } from '../src/base58.js';
import { bech32Decode, bech32Encode, bytesToWords } from '../src/bech32.js';
import { decodeUnifiedPayload, hrpPadding } from '../src/unified.js';
import { f4jumble } from '../src/f4jumble.js';
import { ZcashAddressError, type ZcashAddressErrorCode } from '../src/errors.js';

const throwsCode = (fn: () => unknown, code: ZcashAddressErrorCode) =>
  assert.throws(fn, (e: unknown) => e instanceof ZcashAddressError && e.code === code, `expected ${code}`);

/** A mainnet UA string whose decoded item body is exactly `body`. */
function uaWithBody(body: number[]): string {
  const raw = new Uint8Array([...body, ...hrpPadding('u')]);
  return bech32Encode('u', bytesToWords(f4jumble(raw)), 'bech32m');
}

test('Base58Check string shorter than its 4-byte checksum: BAD_LENGTH', () => {
  throwsCode(() => base58CheckDecode('1111'), 'BAD_LENGTH');
});

test('Base58Check payload of 1 byte (no room for the 2-byte prefix): BAD_LENGTH', () => {
  throwsCode(() => parseZcashAddress(base58CheckEncode(new Uint8Array([0x1c]))), 'BAD_LENGTH');
});

test('Bech32 data part with a character outside the charset: BAD_ENCODING', () => {
  throwsCode(() => bech32Decode('a1bqqqqqq'), 'BAD_ENCODING');
});

test('UA body ending inside a multi-byte compactSize: TRUNCATED', () => {
  const unknown20 = [0x05, 20, ...new Array<number>(20).fill(7)];
  throwsCode(() => parseZcashAddress(uaWithBody([...unknown20, 0x06, 0xfd, 0x01])), 'TRUNCATED');
  throwsCode(() => parseZcashAddress(uaWithBody([...unknown20, 0x06])), 'TRUNCATED');
});

test('decodeUnifiedPayload with a non-Unified HRP: UNKNOWN_FORMAT', () => {
  throwsCode(() => decodeUnifiedPayload('zs', new Uint8Array(48)), 'UNKNOWN_FORMAT');
});
