import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const releaseDir = path.resolve(root, 'release');
if (path.dirname(releaseDir) !== root || path.basename(releaseDir) !== 'release') {
  throw new Error(`Unsafe release path: ${releaseDir}`);
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const exeName = `CodexTracker-${packageJson.version}.exe`;
const exePath = path.join(releaseDir, exeName);
const digest = createHash('sha256').update(await readFile(exePath)).digest('hex');
const checksumName = `${exeName}.sha256`;
await writeFile(path.join(releaseDir, checksumName), `${digest}  ${exeName}\n`, 'utf8');

for (const entry of await readdir(releaseDir)) {
  if (entry !== exeName && entry !== checksumName) {
    const target = path.resolve(releaseDir, entry);
    if (path.dirname(target) !== releaseDir) throw new Error(`Unsafe artifact path: ${target}`);
    await rm(target, { recursive: true, force: true });
  }
}

console.log(`SHA-256 ${digest}`);
