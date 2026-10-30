// Builds the two published entry points from src/index.ts with @noble/hashes bundled in:
//   dist/esm/index.js   (ES module)
//   dist/cjs/index.cjs  (CommonJS, loads with require() on old Node versions)
// The package therefore has no runtime dependency. Prints the minified+gzipped size.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const nobleVersion = JSON.parse(readFileSync('node_modules/@noble/hashes/package.json', 'utf8')).version;
const banner = `/* zcash-address-kit (MIT). Bundles @noble/hashes ${nobleVersion} (MIT, Paul Miller): BLAKE2b, BLAKE2s, SHA-256. */`;
const common = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'neutral',
  target: ['es2020', 'node12'],
  banner: { js: banner },
  define: { 'Object.hasOwn': '__hasOwn' },
  inject: ['scripts/hasown.mjs'],
  logLevel: 'warning',
};

await build({ ...common, format: 'esm', outfile: 'dist/esm/index.js' });
await build({ ...common, format: 'cjs', outfile: 'dist/cjs/index.cjs' });

const min = await build({ ...common, format: 'esm', minify: true, write: false });
const bytes = min.outputFiles[0].contents;
console.log(`bundle size: ${bytes.length} B minified, ${gzipSync(bytes, { level: 9 }).length} B minified+gzipped`);
