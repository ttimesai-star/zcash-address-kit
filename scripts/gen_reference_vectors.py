#!/usr/bin/env python3
"""Generate extra address test vectors with the reference Python code of zcash/zcash-test-vectors.

The official JSON vectors only contain valid Unified Addresses. This script builds additional valid
and invalid address strings with the *reference* encoders (Bech32/Bech32m, F4Jumble, compactSize) and
the reference curve code (Jubjub DiversifyHash, Jubjub/Pallas point decoding), so the expected outcome
of every point check is decided by the reference implementation, not by this library.

Usage:
    python -I scripts/gen_reference_vectors.py <path-to-zcash-test-vectors-checkout> <commit> <out.json>
"""
import hashlib
import json
import random
import sys
from pathlib import Path

ZTV = Path(sys.argv[1]).resolve()
COMMIT = sys.argv[2]
OUT = Path(sys.argv[3])
sys.path.insert(0, str(ZTV))

from zcash_test_vectors.bech32m import bech32_encode, convertbits, Encoding  # noqa: E402
import zcash_test_vectors.f4jumble as _f4  # noqa: E402
from zcash_test_vectors.f4jumble import f4jumble  # noqa: E402
from zcash_test_vectors.zc_utils import write_compact_size  # noqa: E402
from zcash_test_vectors.sapling.key_components import diversify_hash  # noqa: E402
from zcash_test_vectors.sapling import jubjub  # noqa: E402
from zcash_test_vectors.orchard import pallas  # noqa: E402

# The reference Python F4Jumble still enforces an older minimum input length of 48 bytes; ZIP 316 and
# librustzcash (f4jumble::VALID_LENGTH = 38..=4194368) allow 38, which a transparent-only `tu` address needs.
_f4.MIN_l_M = 38

rng = random.Random(0x7A5C)


def load(name):
    rows = json.loads((ZTV / 'test-vectors' / 'json' / name).read_text())
    header = [h.strip() for h in rows[1][0].split(',')]
    return [dict(zip(header, r)) for r in rows[2:]]


def b(hexstr):
    return bytes.fromhex(hexstr) if hexstr is not None else None


def bech(hrp, payload, enc):
    return bech32_encode(hrp, convertbits(payload, 8, 5), enc)


def ua(hrp, items, padding_hrp=None, enc=Encoding.BECH32M, trailing=b''):
    """Encode items in the given order (no sorting, no checks)."""
    raw = b''.join(write_compact_size(tc) + write_compact_size(len(v)) + v for tc, v in items) + trailing
    pad_hrp = hrp if padding_hrp is None else padding_hrp
    raw += pad_hrp.encode() + bytes(16 - len(pad_hrp))
    return bech(hrp, f4jumble(raw), enc)


def ua_raw_body(hrp, body):
    raw = body + hrp.encode() + bytes(16 - len(hrp))
    return bech(hrp, f4jumble(raw), Encoding.BECH32M)


def b58check(payload):
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    data = payload + hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    n = int.from_bytes(data, 'big')
    s = ''
    while n:
        n, r = divmod(n, 58)
        s = alphabet[r] + s
    return '1' * (len(data) - len(data.lstrip(b'\0'))) + s


def jj_mul(p, n):
    acc = jubjub.Point.ZERO
    for bit in bin(n)[2:]:
        acc = acc + acc
        if bit == '1':
            acc = acc + p
    return acc


valid, invalid = [], []


def V(address, type_, network, note, receivers=None):
    e = {'address': address, 'type': type_, 'network': network, 'note': note}
    if receivers is not None:
        e['receivers'] = receivers
    valid.append(e)


def I(address, code, note):
    invalid.append({'address': address, 'code': code, 'note': note})


# ---------------------------------------------------------------- Sapling
sap = load('sapling_key_components.json')
good_d = b(sap[0]['default_d'])
good_pkd = b(sap[0]['default_pk_d'])
for i, row in enumerate(sap):
    raw = b(row['default_d']) + b(row['default_pk_d'])
    V(bech('zs', raw, Encoding.BECH32), 'sapling', 'mainnet', f'sapling_key_components[{i}] default address')
V(bech('ztestsapling', good_d + good_pkd, Encoding.BECH32), 'sapling', 'testnet', 'testnet HRP')
V(bech('zregtestsapling', good_d + good_pkd, Encoding.BECH32), 'sapling', 'regtest', 'regtest HRP')

bad_ds = []
while len(bad_ds) < 3:
    d = bytes(rng.getrandbits(8) for _ in range(11))
    if diversify_hash(d) is None:
        bad_ds.append(d)
for d in bad_ds:
    I(bech('zs', d + good_pkd, Encoding.BECH32), 'INVALID_SAPLING_DIVERSIFIER',
      'reference diversify_hash(d) is None')

off_curve = []
while len(off_curve) < 2:
    cand = bytearray(rng.getrandbits(8) for _ in range(32))
    cand[31] &= 0x3F  # keep v < q
    if jubjub.Point.from_bytes(bytes(cand)) is None:
        off_curve.append(bytes(cand))
for pk in off_curve:
    I(bech('zs', good_d + pk, Encoding.BECH32), 'INVALID_SAPLING_PK_D', 'pk_d not on Jubjub (reference from_bytes is None)')

# A subgroup point whose v is small enough that v + q still fits in 255 bits.
small = jubjub.Point.from_bytes(good_pkd)
k = 2
while (int.from_bytes(bytes(small), 'little') & ((1 << 255) - 1)) + jubjub.q_j >= (1 << 255):
    small = jj_mul(jubjub.Point.from_bytes(good_pkd), k)
    k += 1
small_bytes = bytes(small)
V(bech('zs', good_d + small_bytes, Encoding.BECH32), 'sapling', 'mainnet',
  f'valid diversifier with pk_d = [{k - 1}] * default_pk_d (prime-order subgroup point)')
v =int.from_bytes(small_bytes, 'little') & ((1 << 255) - 1)
sign = small_bytes[31] >> 7
noncanon = (v + jubjub.q_j)
assert noncanon < (1 << 255)
nc = bytearray(noncanon.to_bytes(32, 'little'))
nc[31] |= sign << 7
assert jubjub.Point.from_bytes(bytes(nc)) is None
I(bech('zs', good_d + bytes(nc), Encoding.BECH32), 'INVALID_SAPLING_PK_D', 'pk_d with non-canonical v + q')

identity = bytes(jubjub.Point.ZERO)
I(bech('zs', good_d + identity, Encoding.BECH32), 'INVALID_SAPLING_PK_D', 'pk_d is the identity')
t2 = jubjub.Point(jubjub.Fq.ZERO, jubjub.Fq.MINUS_ONE)
assert jj_mul(t2, 2) == jubjub.Point.ZERO
I(bech('zs', good_d + bytes(t2), Encoding.BECH32), 'INVALID_SAPLING_PK_D', 'pk_d is the point of order 2')
P = jubjub.Point.from_bytes(good_pkd)
assert jj_mul(P, jubjub.r_j) == jubjub.Point.ZERO
mixed = P + t2
assert jj_mul(mixed, jubjub.r_j) != jubjub.Point.ZERO
I(bech('zs', good_d + bytes(mixed), Encoding.BECH32), 'INVALID_SAPLING_PK_D',
  'pk_d = valid point + order-2 point: on the curve but outside the prime-order subgroup')
i_unit = jubjub.Fq.MINUS_ONE.sqrt()
t4 = jubjub.Point(i_unit, jubjub.Fq.ZERO)
assert jj_mul(t4, 4) == jubjub.Point.ZERO and jj_mul(t4, 2) != jubjub.Point.ZERO
I(bech('zs', good_d + bytes(P + t4), Encoding.BECH32), 'INVALID_SAPLING_PK_D',
  'pk_d = valid point + order-4 point')

I(bech('zs', good_d + good_pkd, Encoding.BECH32M), 'WRONG_VARIANT', 'Sapling address encoded with Bech32m')
I(bech('zs', (good_d + good_pkd)[:42], Encoding.BECH32), 'BAD_LENGTH', 'Sapling payload of 42 bytes')
I(bech('zs', good_d + good_pkd + b'\0', Encoding.BECH32), 'BAD_LENGTH', 'Sapling payload of 44 bytes')

# ---------------------------------------------------------------- TEX and transparent
tex = load('zip_0320.json')
pkh = b(tex[0]['p2pkh_bytes'])
V(bech('textest', pkh, Encoding.BECH32M), 'tex', 'testnet', 'ZIP 320 testnet HRP')
V(bech('texregtest', pkh, Encoding.BECH32M), 'tex', 'regtest', 'regtest HRP')
I(bech('tex', pkh, Encoding.BECH32), 'WRONG_VARIANT', 'TEX encoded with Bech32 instead of Bech32m')
I(bech('tex', pkh + b'\0', Encoding.BECH32M), 'BAD_LENGTH', 'TEX payload of 21 bytes')
V(b58check(bytes([0x1d, 0x25]) + pkh), 'p2pkh', 'testnet', 'testnet P2PKH (tm)')
V(b58check(bytes([0x1c, 0xbd]) + pkh), 'p2sh', 'mainnet', 'mainnet P2SH (t3)')
V(b58check(bytes([0x1c, 0xba]) + pkh), 'p2sh', 'testnet', 'testnet P2SH (t2)')
I(b58check(bytes([0x1c, 0xb8]) + pkh[:19]), 'BAD_LENGTH', 'P2PKH payload of 19 bytes')
I(b58check(bytes([0x1c, 0xb9]) + pkh), 'UNKNOWN_FORMAT', 'unknown Base58 prefix 0x1cb9')

# ---------------------------------------------------------------- Unified
uas = load('unified_address.json')
full = next(r for r in uas if r['p2pkh_bytes'] and r['sapling_raw_addr'] and r['orchard_raw_addr'])
p2pkh, sapling, orchard = b(full['p2pkh_bytes']), b(full['sapling_raw_addr']), b(full['orchard_raw_addr'])
items = [(0x00, p2pkh), (0x02, sapling), (0x03, orchard)]

for hrp, net in (('utest', 'testnet'), ('uregtest', 'regtest')):
    V(ua(hrp, items), 'unified', net, f'official items re-encoded with {hrp}', ['p2pkh', 'sapling', 'orchard'])
V(ua('u', [(0x03, orchard), (0x04, bytes(10))]), 'unified', 'mainnet', 'unknown data typecode 0x04 is ignored',
  ['orchard', 'unknown'])
V(ua('u', [(0x03, orchard), (0xC0, b'\x01\x02')]), 'unified', 'mainnet',
  'non-MUST-understand metadata 0xC0 is ignored', ['orchard'])
V(ua('u', [(0x00, p2pkh), (0x05, bytes(32))]), 'unified', 'mainnet',
  'P2PKH + unknown typecode: accepted, as librustzcash counts unknown items as non-transparent',
  ['p2pkh', 'unknown'])
V(ua('zu', [(0xFFFA, bytes(50))]), 'unified', 'mainnet',
  'zu with only an experimental receiver is well-formed (librustzcash)', ['unknown'])
V(ua('tu', [(0x00, p2pkh), (0xE0, (3_000_000).to_bytes(4, 'little'))]), 'unified', 'mainnet',
  'transparent-only tu address with Address Expiry Height', ['p2pkh'])
V(ua('zutest', [(0x03, orchard)]), 'unified', 'testnet', 'zu testnet HRP', ['orchard'])
V(ua('turegtest', [(0x01, p2pkh), (0x03, orchard)]), 'unified', 'regtest', 'tu regtest HRP', ['p2sh', 'orchard'])

I(ua('u', [(0x03, orchard), (0x02, sapling)]), 'BAD_TYPECODE_ORDER', 'receivers in priority order instead of typecode order')
I(ua('u', [(0x02, sapling), (0x00, p2pkh), (0x03, orchard)]), 'BAD_TYPECODE_ORDER', 'P2PKH after Sapling')
I(ua('u', [(0x00, p2pkh), (0x03, orchard), (0x03, orchard)]), 'DUPLICATE_TYPECODE', 'Orchard receiver twice')
I(ua('u', [(0x00, p2pkh), (0x01, p2pkh), (0x03, orchard)]), 'BOTH_P2PKH_AND_P2SH', 'P2PKH and P2SH together')
I(ua('u', [(0x00, p2pkh)]), 'ONLY_TRANSPARENT', 'Revision 0 UA with only a P2PKH receiver')
I(ua('u', [(0x00, p2pkh), (0xC0, b'\x01')]), 'ONLY_TRANSPARENT', 'only P2PKH plus ignorable metadata')
I(ua('tu', [(0xC0, bytes(20)), (0xE0, (3_000_000).to_bytes(4, 'little'))]), 'NO_DATA_ITEMS', 'metadata only')
I(ua('zu', [(0x00, p2pkh), (0x03, orchard)]), 'TRANSPARENT_IN_ZU', 'zu address with a P2PKH receiver')
I(ua('zu', [(0x01, p2pkh), (0x02, sapling)]), 'TRANSPARENT_IN_ZU', 'zu address with a P2SH receiver')
I(ua('u', [(0x03, orchard), (0xE0, (3_000_000).to_bytes(4, 'little'))]), 'METADATA_NOT_IN_REVISION',
  'Revision 0 UA with expiry metadata')
I(ua('zu', [(0x03, orchard), (0xE2, b'\x00')]), 'MUST_UNDERSTAND_METADATA', 'unassigned MUST-understand 0xE2')
I(ua('zu', [(0x03, orchard), (0xFC, b'')]), 'MUST_UNDERSTAND_METADATA', 'unassigned MUST-understand 0xFC')
I(ua('zu', [(0x03, orchard), (0xE0, bytes(5))]), 'BAD_METADATA_LENGTH', 'expiry height of 5 bytes')
I(ua('zu', [(0x03, orchard), (0xE1, bytes(4))]), 'BAD_METADATA_LENGTH', 'expiry time of 4 bytes')
I(ua('u', [(0x03, orchard[:42])]), 'BAD_RECEIVER_LENGTH', 'Orchard receiver of 42 bytes')
I(ua('u', [(0x00, p2pkh + b'\0'), (0x03, orchard)]), 'BAD_RECEIVER_LENGTH', 'P2PKH receiver of 21 bytes')
I(ua('u', [(0x02, sapling + b'\0')]), 'BAD_RECEIVER_LENGTH', 'Sapling receiver of 44 bytes')
I(ua('u', items, padding_hrp='utest'), 'BAD_PADDING', 'mainnet HRP with testnet padding')
I(ua('utest', items, padding_hrp='u'), 'BAD_PADDING', 'testnet HRP with mainnet padding')
I(ua('u', items, trailing=b'\x03'), 'TRUNCATED', 'trailing byte after the last item')
I(ua_raw_body('u', bytes([0x03, 43]) + orchard[:40]), 'TRUNCATED', 'item shorter than its length field')
I(ua_raw_body('u', bytes([0xFD, 0x03, 0x00, 43]) + orchard), 'BAD_COMPACT_SIZE', 'non-canonical compactSize typecode')
I(ua_raw_body('u', bytes([0x03, 0xFD, 43, 0x00]) + orchard), 'BAD_COMPACT_SIZE', 'non-canonical compactSize length')
I(ua_raw_body('u', bytes([0x03, 43]) + orchard + bytes([0xFE, 0x01, 0x00, 0x00, 0x02, 0x00])),
  'BAD_COMPACT_SIZE', 'typecode above 0x2000000')
I(ua('u', items, enc=Encoding.BECH32), 'WRONG_VARIANT', 'UA encoded with Bech32 instead of Bech32m')
I(bech('u', bytes(20), Encoding.BECH32M), 'BAD_LENGTH', 'payload of 20 bytes, below the F4Jumble minimum of 38')

I(ua('u', [(0x02, bad_ds[0] + good_pkd), (0x03, orchard)]), 'INVALID_SAPLING_DIVERSIFIER',
  'UA whose Sapling receiver has an invalid diversifier')
I(ua('u', [(0x02, good_d + bytes(mixed))]), 'INVALID_SAPLING_PK_D', 'UA whose Sapling pk_d is outside the subgroup')

o_d = orchard[:11]
off = []
while len(off) < 2:
    cand = bytearray(rng.getrandbits(8) for _ in range(32))
    cand[31] &= 0x3F
    if pallas.Point.from_bytes(bytes(cand)) is None:
        off.append(bytes(cand))
for pk in off:
    I(ua('u', [(0x03, o_d + pk)]), 'INVALID_ORCHARD_PK_D', 'Orchard pk_d not on Pallas (reference from_bytes is None)')
assert pallas.Point.from_bytes(bytes(32)).is_identity
I(ua('u', [(0x03, o_d + bytes(32))]), 'INVALID_ORCHARD_PK_D', 'Orchard pk_d is the identity')
x_nc = (pallas.p + 1).to_bytes(32, 'little')
I(ua('u', [(0x03, o_d + x_nc)]), 'INVALID_ORCHARD_PK_D', 'Orchard pk_d with non-canonical x = p + 1')

out = {
    '_about': 'Extra vectors generated with the reference Python code of zcash/zcash-test-vectors. '
              'Encoders, DiversifyHash and point decoding come from that code; expected error codes follow '
              'ZIP 316 / ZIP 320 and librustzcash.',
    'generator': 'scripts/gen_reference_vectors.py',
    'zcash_test_vectors_commit': COMMIT,
    'valid': valid,
    'invalid': invalid,
}
OUT.write_text(json.dumps(out, indent=1) + '\n')
print(f'{len(valid)} valid, {len(invalid)} invalid -> {OUT}')
