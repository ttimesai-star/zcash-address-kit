# zcash-address-kit

Parse and validate every Zcash address type in plain TypeScript: Unified Addresses (`u1…`, and the
Revision 2 `zu1…` / `tu1…` forms) with F4Jumble, Sapling (`zs1…`), TEX (`tex1…`, ZIP 320) and transparent
(`t1…`, `t3…`) addresses, on mainnet, testnet and regtest.

No keys, no proving, no WASM, no network access, no runtime dependencies. The published ES module and CommonJS
builds bundle BLAKE2b, BLAKE2s and SHA-256 from the audited [`@noble/hashes`](https://github.com/paulmillr/noble-hashes)
2.4.0. Size: **11.4 kB minified + gzipped** (29.4 kB minified), as printed by `npm run build`.

> **Status: prototype (v0.1.0), not audited, not yet published to npm.** It passes all official Zcash test
> vectors listed below, but nobody outside this repository has used it in production yet. Please open an
> issue if it accepts something it should reject, or the other way round.

## Why

Services that accept a withdrawal address often check it with a generic JavaScript validator. Those
libraries know Zcash only as a transparent address, so a user who pastes a Unified or Sapling address is
told the address is invalid and has to fall back to a transparent one. Example:
[multicoin-address-validator#20](https://github.com/christsim/multicoin-address-validator/issues/20) has been
open since 2020.

The missing piece is a small, standalone parser that implements ZIP 316 completely (Bech32m without the
90-character limit, F4Jumble, padding, typecode rules, Revision 2) and can be dropped into those libraries.

## What is checked

| Address | Encoding | Checks |
|---|---|---|
| Unified `u` / `utest` / `uregtest` (ZIP 316 Revision 0) | Bech32m + F4Jumble | checksum; payload length 38..4 194 368 bytes; HRP padding; canonical compactSize ≤ 0x2000000; strictly ascending typecodes (no duplicates); not both P2PKH and P2SH; at least one receiver; at least one non-transparent receiver; no MUST-understand metadata; receiver lengths; receiver contents (below) |
| Unified `zu` / `tu` (+`test`, `regtest`) (ZIP 316 Revision 2, Draft) | Bech32m + F4Jumble | as above, plus: `zu` has no transparent receiver; Address Expiry Height (0xE0, 4 bytes) and Expiry Time (0xE1, 8 bytes); any other MUST-understand metadata (0xE2..0xFC) rejected; transparent-only `tu` allowed |
| Sapling `zs` / `ztestsapling` / `zregtestsapling` | Bech32 | 43 bytes; diversifier valid (`DiversifyHash(d) ≠ ⊥`); `pk_d` a canonical, non-identity point of the Jubjub prime-order subgroup |
| Orchard receiver (inside a UA) | — | 43 bytes; `pk_d` a canonical, non-identity Pallas point |
| TEX `tex` / `textest` / `texregtest` (ZIP 320) | Bech32m | 20 bytes |
| Transparent `t1` (P2PKH), `t3` (P2SH); testnet `tm`, `t2` | Base58Check | checksum, prefix, 20 bytes |
| Sprout `zc` / `zt` | Base58Check | recognised, **not accepted by default** (Sprout cannot receive funds since Canopy) |

Unknown receiver typecodes (0x04..0xBF, 0xFD.., experimental 0xFFFA..0xFFFF) and ignorable metadata
(0xC0..0xDF) are kept in the result and otherwise ignored, as ZIP 316 requires of a Consumer.

Revision 2 (`zu` / `tu`) is still a Draft in ZIP 316; if its text changes, the behaviour here follows in a new
major version.

### Reference behaviour: one known divergence from the ZIP 316 text

This library follows **librustzcash** (`zcash_address`) where the two disagree. There is one such case:

- ZIP 316 says: "A Revision 0 Unified Address MUST contain at least one shielded Item (currently Typecodes
  0x02 and 0x03). Consumers MUST reject addresses that violate this restriction." The same ZIP also says
  Consumers "MUST ignore constituent Items with Typecodes they do not recognise".
- librustzcash resolves this by counting any non-P2PKH/P2SH receiver as non-transparent
  (`DataTypecode::is_transparent` in `components/zcash_address/src/kind/unified.rs`), so a Revision 0 UA made
  of `{P2PKH, unknown 0x05}` or of `{unknown 0x05}` alone is **accepted**.
- **Default here: accepted, as in librustzcash** (pinned by the test "reference parity" in
  `test/unified.test.ts`). With `requireShieldedReceiver: true` such an address is rejected with
  `NO_SHIELDED_RECEIVER`, which is the stricter reading of the ZIP text. Services that will actually send to a
  shielded receiver should set this option.

This is a divergence from the letter of the ZIP, not a claim that the ZIP requires it. The question of which
reading is intended will be raised with the ZIP editors; if the answer is "reject", the default will change in
a major version.

**NU6.3 (Ironwood).** Ironwood does not introduce a new receiver type or typecode. ZIP 229 states: "The
addition of the *Ironwood pool* does not change address structures or encodings"; Orchard receivers (0x03)
are reused and new payments to them land in the Ironwood pool. The ZIP 316 typecode registry still lists
0x04..0xBF as unassigned (checked against zcash/zips at commit `a34cfc0`, 16 Oct 2026). If a later upgrade
assigns a new typecode, this library keeps accepting such addresses and reports the new receiver as
`unknown`; use `requireShieldedReceiver` to insist on a known Sapling or Orchard receiver.

## Install

Not on npm yet. From GitHub:

```sh
npm install github:ttimesai-star/zcash-address-kit
```

Both module formats are published:

```js
import { isValidZcashAddress } from 'zcash-address-kit';            // ESM: dist/esm/index.js
const { isValidZcashAddress } = require('zcash-address-kit');        // CommonJS: dist/cjs/index.cjs
```

The API is synchronous; there is nothing to initialise. CI runs the full test suite on Node.js 18, 20, 22 and
24, and runs the official vectors against both builds on the end-of-life Node.js 12, 14 and 16 as well (the
bundles are compiled to ES2020 with BigInt; `Object.hasOwn`, used by `@noble/hashes`, is replaced at build time).
The CommonJS build also goes through browserify 17 unchanged (checked by hand, not in CI).

## Usage

```ts
import { isValidZcashAddress, validateZcashAddress, parseZcashAddress } from 'zcash-address-kit';

// Default policy: mainnet; accept p2pkh, p2sh, sapling, unified, tex (not sprout).
isValidZcashAddress('u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf');
// true

// Only shielded-capable addresses, testnet:
isValidZcashAddress(input.trim(), {
  network: 'testnet',
  accept: ['sapling', 'unified'],
  requireShieldedReceiver: true,
});

// Why was it rejected?
const r = validateZcashAddress('zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly');
// { valid: false, code: 'BAD_CHECKSUM', message: 'Bech32/Bech32m checksum mismatch' }

// What is inside a Unified Address?
const p = parseZcashAddress(ua);
p.type;        // 'unified'
p.network;     // 'mainnet'
p.revision;    // 0 for u1…, 2 for zu1…/tu1…
p.receivers;   // [{ typecode: 0, kind: 'p2pkh', data }, { typecode: 2, kind: 'sapling', data }, …]
p.shielded;    // true if there is a Sapling or Orchard receiver
p.expiryHeight; p.expiryTime; // Revision 2 metadata, if present (expiryTime is a bigint: u64 seconds)
// receivers[].data is a Uint8Array and expiryTime a bigint: JSON.stringify(p) needs a replacer for both
```

### API

- `parseZcashAddress(input, { maxLength?, checkPoints? })` → `ParsedZcashAddress`. Throws
  `ZcashAddressError` with a `code` if the string is not a well-formed Zcash address on any network.
- `validateZcashAddress(input, options)` → `{ valid: true, address }` or `{ valid: false, code, message }`.
  Never throws for bad input.
- `isValidZcashAddress(input, options)` → `boolean`.

Options of `validateZcashAddress` / `isValidZcashAddress`:

| Option | Default | Meaning |
|---|---|---|
| `network` | `'mainnet'` | network or list of networks to accept. Base58 testnet prefixes are shared with regtest, so `'regtest'` also accepts them. |
| `accept` | `['p2pkh','p2sh','sapling','unified','tex']` | address types to accept; `'transparent'` = p2pkh + p2sh; add `'sprout'` explicitly if you really need it |
| `requireShieldedReceiver` | `false` | a Unified Address must contain a Sapling or Orchard receiver |
| `rejectExpired` | `true` | reject Revision 2 addresses whose Expiry Time has passed (`now`) or whose Expiry Height is below `currentHeight` |
| `now`, `currentHeight` | `Date.now()`, unchecked | inputs for the expiry check |
| `maxLength` | `4096` | maximum input length in characters (`Infinity` to disable) |
| `checkPoints` | `true` | validate Sapling/Orchard receivers as curve points |

Error codes are listed in [`src/errors.ts`](src/errors.ts).

### Deliberate choices

- **Whitespace is rejected, not trimmed.** Trim user input yourself; this keeps the string you validate
  identical to the string you later pass to a node.
- **Input length is capped at 4096 characters by default.** ZIP 316 allows Unified Addresses up to about
  6.7 million characters; real ones are a few hundred. The cap avoids spending seconds on hostile input.
- **Upper-case Bech32 input is accepted** (as BIP 173 allows) and `address` in the result is lower-cased.
- **A Revision 0 UA with a transparent receiver plus an unknown-typecode receiver is accepted**, as in
  librustzcash, which counts unknown receivers as non-transparent. The ZIP 316 text is stricter here; see
  "Reference behaviour" above. Use `requireShieldedReceiver` if you need a known shielded receiver.
- **Curve checks.** Sapling and Orchard receivers are checked the way `sapling-crypto` and `orchard` do when
  they decode a raw address. Generic validators usually skip this; an address with an invalid diversifier
  would otherwise pass validation and fail only when the wallet tries to build the transaction. BigInt field
  arithmetic is not constant-time; it only ever touches public address data.

## Tests

`npm test` builds and runs the suite (41 tests, Node's built-in test runner), then `test/builds.cjs`, which runs the
official and reference-generated vectors against the published CommonJS and ESM bundles. CI: Node 18, 20, 22
and 24 (everything) and Node 12, 14 and 16 (`test/builds.cjs`).

- **Official vectors** from [zcash/zcash-test-vectors](https://github.com/zcash/zcash-test-vectors)
  (see [`test/vectors/README.md`](test/vectors/README.md)): 60 Revision 0 and 60 Revision 2 Unified
  Addresses (every receiver and expiry value compared, and every address re-encoded byte-for-byte),
  8 + 2 F4Jumble vectors including the 4 194 368-byte maximum, 15 transparent/TEX pairs from ZIP 320,
  Sapling and Orchard key components, the Sapling generators (group hash reproduced).
- **Reference-generated vectors**: 27 valid and 49 invalid strings built with the reference Python code
  of zcash-test-vectors (invalid diversifiers, off-curve / small-order / non-canonical `pk_d`, wrong order,
  duplicates, P2PKH+P2SH, transparent in `zu`, bad padding, non-canonical compactSize, wrong Bech32
  variant, bad metadata, …), each with the expected error code.
- **librustzcash** negative cases (bad padding, truncation, transparent-only).
- **BIP 173 / BIP 350** Bech32 and Bech32m vectors.
- **Mutated inputs**: one character substituted at every position of 40 official UAs (>5 000 strings), adjacent
  swaps, truncation, and receivers re-encoded in non-ascending order must all be rejected.
- **Mutated code**: `node scripts/mutate.mjs` disables every validation check in `src/` one at a time (each
  `fail('CODE', …)` becomes a no-op) and runs the suite. Result on 30 Oct 2026: 53 of 54 mutants
  killed. The survivor (`src/unified.ts`, first `TRUNCATED` in `readCompactSize`) is equivalent: without it the
  next line rejects the same input with the same code. Five other survivors of the first run led to
  `test/defensive.test.ts`.

## Why plain JavaScript, not WebAssembly or a node

The reference parser is Rust (`zcash_address`), and there are two ways to use it from JavaScript today: a
WebAssembly build, or a full node's address-validation RPC. Both are the right tool in some places. This
library exists for the places where they are not:

- **Size.** `@elemental-zcash/zaddr_wasm_parser` 0.2.0 ships a 1 295 079-byte `.wasm` file (435 721 bytes
  gzipped, measured from the npm tarball). This library is 11.4 kB minified + gzipped, for the
  address-format part only.
- **Loading.** That package is ESM-only and imports the `.wasm` file as a module (wasm-pack `bundler` target), so it
  needs a bundler with WebAssembly support and cannot be `require()`d by CommonJS validator libraries such as
  `multicoin-address-validator` (Node >= 12, browserify). React Native's default engine (Hermes) has no
  WebAssembly.
- **Content Security Policy.** Compiling WebAssembly in a browser page needs `'wasm-unsafe-eval'` (or
  `'unsafe-eval'`) in `script-src`. A withdrawal page with a strict policy would have to loosen it; plain
  JavaScript needs no policy change.
- **Synchronous API.** Validator libraries expose `validate(address)` returning a boolean. This library is a
  plain synchronous function with no initialisation step.
- **Auditability.** About 1 100 lines of TypeScript, no build-time code generation, rules mapped to ZIP 316 /
  ZIP 320 and to tests (see "Tests"). A reviewer can read it in one sitting.
- **A node** (`z_validateaddress`) is the right answer for a service that already runs one. It does not help a
  browser form, a mobile app or a library that has no node.

What it costs: this is a second implementation of the address rules, so it can drift from librustzcash. That
is why every official vector is a test, why the one known difference from the ZIP text is documented below, and
why new Zcash address rules require a release here.

## Prior art

- [`zcash_address`](https://github.com/zcash/librustzcash/tree/main/components/zcash_address) (Rust) — the
  reference parser; this library follows its rules. Its Python counterpart lives in zcash-test-vectors.
- JavaScript code that parses Unified Addresses exists inside larger SDKs (checked 30 Oct 2026):
  - Ledger Live `coin-zcash` module,
    [`src/logic/address.ts`](https://github.com/LedgerHQ/ledger-live/blob/4fe7e66b42f2a6386fdd5444eef62193d4547c80/libs/coin-modules/coin-zcash/src/logic/address.ts)
    (module added in commit `66fc12d`, 22 Jul 2026): HRPs `u` / `utest` only (Revision 0), no receiver
    point checks; its `validateAddress` accepts transparent addresses and UAs with an Orchard or transparent
    receiver, and rejects Sapling-only addresses by design.
  - NEAR Intents SDK (`@defuse-protocol/intents-sdk`),
    [`validateZcashUnifiedAddress`](https://github.com/defuse-protocol/sdk-monorepo/blob/f7702ac2feb56ced2e2bfa8723e85ad98564561c/packages/intents-sdk/src/lib/zcash-unified-address.ts)
    (added 1 Sep 2026): mainnet `u` only, no receiver point checks, Sapling-only UAs rejected by design; its
    address check also accepts `t1`/`t3` and `tex`.

  Both are written for what their own product can send to. Neither can be used as a small dependency of a
  validator library: Ledger's module is published as `@ledgerhq/coin-zcash` (on npm since July 2026, 1.0.0 on 22 Oct 2026),
  a full coin module with 15 dependencies; the NEAR code is an internal function of an SDK. The NEAR code also
  sets the F4Jumble minimum to 48 bytes (as does the Python reference code), while ZIP 316 and librustzcash
  `main` use 38.
- [`@elemental-zcash/zaddr_wasm_parser`](https://www.npmjs.com/package/@elemental-zcash/zaddr_wasm_parser)
  0.2.0 (April 2025): a WebAssembly wrapper of `zcash_address`. Not updated since April 2025; the repository
  linked from its package.json returns 404, so I could not check which ZIP 316 revision it builds from. See
  "Why plain JavaScript" above for when it does and does not fit.
- A full node's `z_validateaddress` RPC.
- `@ensdomains/address-encoder` handles transparent and Sapling Zcash addresses (not Unified or TEX);
  `multicoin-address-validator` handles transparent only.

## Contributing

Issues and pull requests are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md). Please add a test vector for
every behaviour change; prefer vectors generated by the reference implementation
(`scripts/gen_reference_vectors.py`).

Most of this code was written with an AI coding assistant (Claude) under the maintainer's direction.
Correctness is established by checks anyone can rerun, not by trust in the assistant: the official test
vectors, the reference-generated vectors, and the code-mutation run above, which shows that each validation
check is exercised by at least one test. Review is very welcome.

## License

MIT. Test vectors in `test/vectors/official/` are from zcash-test-vectors (MIT OR Apache-2.0).
