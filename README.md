# zcash-address-kit

Parse and validate every Zcash address type in plain TypeScript: Unified Addresses (`u1…`, and the
Revision 2 `zu1…` / `tu1…` forms) with F4Jumble, Sapling (`zs1…`), TEX (`tex1…`, ZIP 320) and transparent
(`t1…`, `t3…`) addresses, on mainnet, testnet and regtest.

No keys, no proving, no WASM, no network access. One runtime dependency: [`@noble/hashes`](https://github.com/paulmillr/noble-hashes)
(BLAKE2b, BLAKE2s, SHA-256).

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

Node.js 22 or later (ES modules).

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
p.expiryHeight; p.expiryTime; // Revision 2 metadata, if present
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
  librustzcash, which counts unknown receivers as non-transparent. Use `requireShieldedReceiver` if you need a
  known shielded receiver.
- **Curve checks.** Sapling and Orchard receivers are checked the way `sapling-crypto` and `orchard` do when
  they decode a raw address. Generic validators usually skip this; an address with an invalid diversifier
  would otherwise pass validation and fail only when the wallet tries to build the transaction. BigInt field
  arithmetic is not constant-time; it only ever touches public address data.

## Tests

`npm test` builds and runs the suite (Node's built-in test runner). CI runs it on Node 22 and 24.

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
- **Mutation**: every single-character substitution of 40 official UAs (>5 000 strings), adjacent swaps,
  truncation, and receivers re-encoded in non-ascending order must all be rejected.

## Prior art

- [`zcash_address`](https://github.com/zcash/librustzcash/tree/main/components/zcash_address) (Rust) — the
  reference parser; this library follows its rules. Its Python counterpart lives in zcash-test-vectors.
- JavaScript code that parses Unified Addresses exists inside larger SDKs: Ledger Live's `coin-zcash`
  module (Revision 0, recipient classification) and the NEAR Intents SDK (`validateZcashUnifiedAddress`,
  Revision 0 mainnet). They are not standalone packages, do not cover Revision 2, TEX or regtest, and do not
  check receiver points.
- `@ensdomains/address-encoder` handles transparent and Sapling Zcash addresses (not Unified or TEX);
  `multicoin-address-validator` handles transparent only.

## Contributing

Issues and pull requests are welcome. Please add a test vector for every behaviour change; prefer vectors
generated by the reference implementation (`scripts/gen_reference_vectors.py`).

Most of this code was written with an AI coding assistant (Claude). Correctness is established by the
official test vectors and the reference-generated vectors above, not by trust in the assistant; review is
very welcome.

## License

MIT. Test vectors in `test/vectors/official/` are from zcash-test-vectors (MIT OR Apache-2.0).
