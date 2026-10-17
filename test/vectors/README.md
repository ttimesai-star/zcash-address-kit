# Test vectors

`official/` — copied unmodified from [zcash/zcash-test-vectors](https://github.com/zcash/zcash-test-vectors)
(`test-vectors/json/`, commit `78321beacb0e0477e33cd002b56585a107c2708c`), licensed MIT OR Apache-2.0,
Copyright (c) The Electric Coin Company and contributors.

| File | Used for |
|---|---|
| `unified_address.json` | 60 Revision 0 Unified Addresses (`u1…`), incl. unknown typecodes |
| `unified_address_r2.json` | 60 Revision 2 Unified Addresses (`zu1…`, `tu1…`), incl. expiry metadata |
| `f4jumble.json`, `f4jumble_long.json` | F4Jumble and its inverse, up to the 4 194 368-byte maximum |
| `zip_0320.json` | 15 transparent P2PKH addresses and their TEX (ZIP 320) forms |
| `sapling_key_components.json` | valid Sapling diversifiers and pk_d |
| `orchard_key_components.json` | valid Orchard pk_d |
| `sapling_generators.json` | Jubjub group hash (`Zcash_G_`, `Zcash_H_`, `Zcash_J_`) |

`generated/reference_vectors.json` — extra valid and invalid address strings produced by
`scripts/gen_reference_vectors.py` with the reference Python code of zcash-test-vectors (its Bech32/Bech32m,
F4Jumble and compactSize encoders, its Sapling DiversifyHash and its Jubjub/Pallas point decoding).
Expected error codes follow ZIP 316, ZIP 320 and librustzcash (`zcash_address`).

Regenerate:

```sh
git clone https://github.com/zcash/zcash-test-vectors ../zcash-test-vectors
python -I scripts/gen_reference_vectors.py ../zcash-test-vectors "$(git -C ../zcash-test-vectors rev-parse HEAD)" \
  test/vectors/generated/reference_vectors.json
```
