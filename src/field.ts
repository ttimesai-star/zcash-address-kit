// Minimal prime-field arithmetic on BigInt, enough to decompress Jubjub and Pallas points.
// Not constant-time: it only ever handles public data (addresses), never secrets.

export function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

export function powMod(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

export class PrimeField {
  readonly p: bigint;
  private readonly s: bigint; // p - 1 = 2^s * t, t odd
  private readonly t: bigint;
  private readonly z: bigint; // a quadratic non-residue

  constructor(p: bigint) {
    this.p = p;
    let t = p - 1n;
    let s = 0n;
    while ((t & 1n) === 0n) {
      t >>= 1n;
      s++;
    }
    this.s = s;
    this.t = t;
    let z = 2n;
    while (this.legendre(z) !== -1) z++;
    this.z = z;
  }

  mod(a: bigint): bigint {
    return mod(a, this.p);
  }

  inv(a: bigint): bigint {
    const x = this.mod(a);
    if (x === 0n) throw new RangeError('inverse of zero');
    return powMod(x, this.p - 2n, this.p);
  }

  /** 1 for non-zero squares, -1 for non-squares, 0 for zero. */
  legendre(a: bigint): number {
    const x = this.mod(a);
    if (x === 0n) return 0;
    return powMod(x, (this.p - 1n) >> 1n, this.p) === 1n ? 1 : -1;
  }

  /** A square root of a (Tonelli-Shanks), or null if a is not a square. */
  sqrt(a: bigint): bigint | null {
    const n = this.mod(a);
    if (n === 0n) return 0n;
    if (this.legendre(n) !== 1) return null;
    const p = this.p;
    let m = this.s;
    let c = powMod(this.z, this.t, p);
    let t = powMod(n, this.t, p);
    let r = powMod(n, (this.t + 1n) >> 1n, p);
    while (t !== 1n) {
      let i = 0n;
      let t2 = t;
      while (t2 !== 1n) {
        t2 = (t2 * t2) % p;
        i++;
      }
      let b = c;
      for (let k = 0n; k < m - i - 1n; k++) b = (b * b) % p;
      m = i;
      c = (b * b) % p;
      t = (t * c) % p;
      r = (r * b) % p;
    }
    return r;
  }
}
