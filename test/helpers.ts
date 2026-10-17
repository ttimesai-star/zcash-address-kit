import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Compiled tests live in dist/test; vectors stay in test/vectors.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readVector<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, 'test', 'vectors', rel), 'utf8')) as T;
}

/** Official zcash-test-vectors JSON: row 0 = source, row 1 = header, rest = data. */
export function officialRows(name: string): Record<string, unknown>[] {
  const rows = readVector<unknown[][]>(`official/${name}`);
  const header = String(rows[1]![0]).split(',').map((h) => h.trim());
  return rows.slice(2).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
