// Mutation check: disables every validation rule in src/ one at a time and runs the test suite.
// A rule is "disabled" by turning its `fail('CODE', ...)` call into a no-op `void ('CODE', ...)`.
// A mutant is killed if at least one test fails. Usage: node scripts/mutate.mjs (takes a few minutes).
// Source files are restored after each mutant; check `git status` if the run is interrupted.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tsc = join('node_modules', 'typescript', 'bin', 'tsc');
const files = readdirSync('src').filter((f) => f.endsWith('.ts') && f !== 'errors.ts');
const run = (args) => spawnSync(process.execPath, args, { stdio: 'ignore' }).status;
const tests = () => readdirSync('dist/test').filter((f) => f.endsWith('.test.js')).map((f) => join('dist/test', f));

const survivors = [];
let total = 0;
for (const f of files) {
  const path = join('src', f);
  const original = readFileSync(path, 'utf8');
  const lines = original.split('\n');
  lines.forEach((line, i) => {
    let from = 0;
    for (;;) {
      const at = line.indexOf("fail('", from);
      if (at < 0) break;
      from = at + 1;
      const mutated = [...lines];
      mutated[i] = line.slice(0, at) + 'void (' + line.slice(at + 5);
      writeFileSync(path, mutated.join('\n'));
      try {
        run([tsc, '-p', 'tsconfig.json']); // type errors are expected for some mutants; JS is still emitted
        const killed = run(['--test', ...tests()]) !== 0;
        total++;
        const code = line.slice(at + 6, line.indexOf("'", at + 6));
        if (!killed) survivors.push(`${path}:${i + 1} ${code}`);
        console.log(`${killed ? 'killed  ' : 'SURVIVED'} ${path}:${i + 1} ${code}`);
      } finally {
        writeFileSync(path, original);
      }
    }
  });
}
run([tsc, '-p', 'tsconfig.json']);
console.log(`\n${total - survivors.length} of ${total} mutants killed`);
if (survivors.length) console.log('survivors:\n' + survivors.join('\n'));
