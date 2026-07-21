import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const allowed = new Set(['dist-main', 'dist-renderer', 'release']);

for (const name of process.argv.slice(2)) {
  if (!allowed.has(name)) throw new Error(`Refusing to remove unexpected path: ${name}`);
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) throw new Error(`Refusing to remove path outside project: ${target}`);
  await rm(target, { recursive: true, force: true });
}
