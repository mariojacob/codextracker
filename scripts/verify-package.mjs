import { access } from 'node:fs/promises';
import path from 'node:path';
import fusePackage from '@electron/fuses';
import { spawnSync } from 'node:child_process';
import electronPath from 'electron';

const { getCurrentFuseWire } = fusePackage;
const DISABLE = '0'.charCodeAt(0);
const ENABLE = '1'.charCodeAt(0);

const root = path.resolve(import.meta.dirname, '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const executable = path.join(unpacked, 'CodexTracker.exe');
const nativeKeyring = path.join(
  unpacked,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  '@napi-rs',
  'keyring-win32-x64-msvc',
  'keyring.win32-x64-msvc.node',
);

await access(nativeKeyring);
await access(path.join(unpacked, 'resources', 'assets', 'icon.ico'));
await access(path.join(unpacked, 'resources', 'assets', 'icon.png'));
const fuses = await getCurrentFuseWire(executable);
const expected = new Map([
  [0, DISABLE], // RunAsNode
  [1, ENABLE], // EnableCookieEncryption
  [2, DISABLE], // EnableNodeOptionsEnvironmentVariable
  [3, DISABLE], // EnableNodeCliInspectArguments
  [4, ENABLE], // EnableEmbeddedAsarIntegrityValidation
  [5, ENABLE], // OnlyLoadAppFromAsar
]);

for (const [fuse, state] of expected) {
  if (fuses[fuse] !== state) throw new Error(`Unexpected Electron fuse ${fuse}: ${fuses[fuse]}`);
}

console.log(`Verified native keyring: ${path.relative(root, nativeKeyring)}`);
console.log('Verified Electron fuse hardening.');
console.log('Verified Windows shell icons outside app.asar.');

const iconEnv = { ...process.env };
delete iconEnv.ELECTRON_RUN_AS_NODE;
const icons = spawnSync(electronPath, [path.join(root, 'scripts', 'verify-icons.cjs')], {
  env: iconEnv, encoding: 'utf8', timeout: 30_000, windowsHide: true,
});
if (icons.error || icons.status !== 0) throw new Error(`Icon verification failed: ${icons.error ?? icons.stderr}`);
console.log(icons.stdout.trim());
