'use strict';
// Runs the official and reference-generated vectors against the two published builds:
// dist/cjs/index.cjs (require) and dist/esm/index.js (import). Plain CommonJS with no
// test framework, so it also runs on Node versions without node:test (checked on Node 12).
// Usage: node test/builds.cjs   (after npm run build)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'vectors', rel), 'utf8'));
const officialRows = (name) => {
  const rows = read('official/' + name);
  const header = String(rows[1][0]).split(',').map((h) => h.trim());
  return rows.slice(2).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};
const hex = (u8) => Buffer.from(u8).toString('hex');
const ALL = { accept: ['p2pkh', 'p2sh', 'sapling', 'unified', 'tex', 'sprout'], network: ['mainnet', 'testnet', 'regtest'] };

function run(name, kit) {
  let n = 0;
  const ok = (cond, msg) => { assert.ok(cond, name + ': ' + msg); n++; };

  for (const file of ['unified_address.json', 'unified_address_r2.json']) {
    const rows = officialRows(file);
    ok(rows.length === 60, file + ' has 60 rows');
    for (const r of rows) {
      const p = kit.parseZcashAddress(r.unified_addr);
      ok(p.type === 'unified', file + ' parses as unified');
      ok(kit.validateZcashAddress(r.unified_addr, Object.assign({ rejectExpired: false }, ALL)).valid === true, file + ' validates');
      const kinds = p.receivers.map((x) => x.kind);
      if (typeof r.sapling_raw_addr === 'string') ok(kinds.includes('sapling'), file + ' sapling receiver');
      if (typeof r.orchard_raw_addr === 'string') ok(kinds.includes('orchard'), file + ' orchard receiver');
    }
  }

  for (const r of officialRows('zip_0320.json')) {
    ok(kit.parseZcashAddress(r.t_addr).type === 'p2pkh', 'zip_0320 t_addr');
    ok(kit.parseZcashAddress(r.tex_addr).type === 'tex', 'zip_0320 tex_addr');
  }

  for (const [normal, jumbled] of read('official/f4jumble.json').slice(2)) {
    ok(hex(kit.f4jumble(Buffer.from(normal, 'hex'))) === jumbled, 'f4jumble vector');
    ok(hex(kit.f4jumbleInv(Buffer.from(jumbled, 'hex'))) === normal, 'f4jumbleInv vector');
  }
  for (const [length, hash] of read('official/f4jumble_long.json').slice(2)) {
    const m = new Uint8Array(length);
    for (let i = 0; i < length; i++) m[i] = i & 0xff;
    const j = kit.f4jumble(m);
    ok(crypto.createHash('blake2b512').update(j).digest('hex') === hash, 'f4jumble long vector ' + length);
  }

  const gen = read('generated/reference_vectors.json');
  for (const v of gen.valid) {
    const p = kit.parseZcashAddress(v.address);
    ok(p.type === v.type && p.network === v.network, 'generated valid: ' + v.note);
    if (v.receivers) ok(JSON.stringify(p.receivers.map((x) => x.kind)) === JSON.stringify(v.receivers), 'receivers: ' + v.note);
  }
  for (const v of gen.invalid) {
    const res = kit.validateZcashAddress(v.address, ALL);
    ok(res.valid === false && res.code === v.code, 'generated invalid: ' + v.note + ' expected ' + v.code + ' got ' + res.code);
    let threw = null;
    try { kit.parseZcashAddress(v.address); } catch (e) { threw = e; }
    ok(threw instanceof kit.ZcashAddressError, 'throws ZcashAddressError: ' + v.note);
  }
  return n;
}

(async () => {
  const cjs = require(path.join(ROOT, 'dist', 'cjs', 'index.cjs'));
  const esm = await import(require('url').pathToFileURL(path.join(ROOT, 'dist', 'esm', 'index.js')).href);
  const a = run('cjs', cjs);
  const b = run('esm', esm);
  console.log('builds ok on Node ' + process.versions.node + ': cjs ' + a + ' checks, esm ' + b + ' checks');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
