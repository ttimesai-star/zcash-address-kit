// Runs the compiled node:test suite, then the vector checks against both published builds.
// Lists test files explicitly because `node --test` glob patterns need Node >= 21.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = readdirSync('dist/test').filter((f) => f.endsWith('.test.js')).map((f) => join('dist/test', f));
for (const args of [['--test', ...files], ['test/builds.cjs']]) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
