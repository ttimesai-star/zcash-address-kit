# External reviews

## Jules review, 2026-10-17 (session 11225908359992205481, commit 9954dc1)

Google Jules reviewed branch `review/zcash-address-kit-1017` (a copy of commit `9954dc1`) on seven areas: node /
librustzcash parity, F4Jumble, Bech32/Bech32m, compactSize, curve and field arithmetic, denial of service, API.
The session delivered no patch (it reverted its own edits) and posted the written report only after a follow-up
message. Each item was checked against ZIP 316 (zcash/zips `main`, 17.10.2026) and librustzcash
`components/zcash_address/src/kind/unified.rs` (`main`, 17.10.2026).

| Item | Outcome |
|---|---|
| Intermediate edit: reject a Revision 0 UA whose only non-transparent receiver has an unknown typecode (e.g. `{0x05}` or `{P2PKH, 0x05}`) | **Not made the default; available as an option.** The suggestion matches the letter of ZIP 316 ("A Revision 0 Unified Address MUST contain at least one shielded Item (currently Typecodes 0x02 and 0x03)"). librustzcash treats unknown data typecodes as non-transparent (`DataTypecode::is_transparent` is true only for P2PKH/P2SH) and accepts such a UA, and ZIP 316 also tells Consumers to ignore unrecognised typecodes. The library follows librustzcash by default; `requireShieldedReceiver` (error `NO_SHIELDED_RECEIVER`) gives the stricter reading. This divergence from the ZIP text is documented in the README ("Reference behaviour") and will be raised with the ZIP editors. Pinned by a test. *(Wording corrected 2026-10-30: the earlier text called the suggestion contrary to ZIP 316, which was inaccurate.)* |
| Intermediate edit: a `tu` UA must contain a transparent receiver (new code `NO_TRANSPARENT_RECEIVER`) | **Rejected.** ZIP 316 sets no such rule (only `zu` has a content rule), and librustzcash says "A `tu` address has no additional constraints". 12 of the 33 official `tu` vectors in `unified_address_r2.json` have no transparent receiver, so the check would reject official vectors. Pinned by the same test. |
| Areas 1-6 (F4Jumble personalisation and bounds, Bech32 HRP/case/padding, canonical compactSize and the 0x2000000 cap, Jubjub/Pallas decoding, subgroup and diversifier checks, Tonelli-Shanks, length caps) | No findings. |
| Area 7: `expiryTime` is a `bigint`, so `JSON.stringify` of a parse result throws | **Accepted as documentation.** The type stays `bigint` (ZIP 316 Address Expiry Time is a u64; `number` would lose precision). README notes that serialising a parse result needs a replacer (also for the `Uint8Array` receiver data). |

Tests: 36 (35 + 1 parity test); all official vectors pass.
