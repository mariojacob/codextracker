const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Windows icon includes bitmap frames for taskbar and common display scaling sizes', () => {
  const ico = fs.readFileSync(path.join(__dirname, '../assets/icon.ico'));
  const frames = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + 16 * i;
    const offset = ico.readUInt32LE(entry + 12);
    frames.push({ size: ico[entry] || 256, header: ico.readUInt32LE(offset) });
  }
  for (const size of [16, 20, 24, 32, 40, 48, 64, 256]) {
    assert.ok(frames.some((frame) => frame.size === size && frame.header === 40), `Missing Windows bitmap frame: ${size}px`);
  }
});

function identity(isPackaged, portable, options = {}) {
  const loaded = [];
  const exports = {};
  const image = { isEmpty: () => false };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist-main/main/window-identity.js'), 'utf8'), {
    exports,
    require: (id) => id === 'electron' ? {
      app: { isPackaged, getAppPath: () => 'C:\\source' },
      nativeImage: { createFromPath: (file) => { loaded.push(file); return image; } },
    } : id === 'node:path' ? path.win32
      : id === 'node:os' && options.home ? { homedir: () => options.home }
      : id === 'node:fs/promises' && options.icon ? { ...require(id), readFile: async () => options.icon }
      : require(id),
    process: { platform: 'win32', resourcesPath: 'C:\\temporary app\\resources',
      execPath: 'C:\\temporary app\\CodexTracker.exe', env: portable ? { PORTABLE_EXECUTABLE_FILE: portable } : {} },
  });
  return { api: exports, loaded, image };
}

test('taskbar icon is retained across portable extractions without referencing a temporary executable', async (t) => {
  const fsp = require('node:fs/promises');
  const home = await fsp.mkdtemp(path.join(require('node:os').tmpdir(), 'codextracker-identity-'));
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const data = fs.readFileSync(path.join(__dirname, '../assets/icon.ico'));
  let previousPath;
  for (const portable of ['E:\\Apps\\CodexTracker-2.4.1.exe', 'E:\\Apps\\CodexTracker-2.4.2.exe']) {
    const { api } = identity(true, portable, { home, icon: data });
    await api.prepareWindowIdentity();
    const calls = [];
    let details;
    api.setWindowIdentity({ setIcon() { calls.push('icon'); }, setAppDetails(value) { details = value; calls.push('metadata'); } });
    assert.equal(path.dirname(details.appIconPath), path.join(home, '.codex-tracker', 'shell'));
    assert.match(path.basename(details.appIconPath), /^CodexTracker-[a-f0-9]{16}\.ico$/);
    assert.deepEqual(await fsp.readFile(details.appIconPath), data);
    assert.equal(details.relaunchCommand, `"${portable}"`);
    assert.deepEqual(calls, ['metadata', 'icon']);
    if (previousPath) assert.equal(details.appIconPath, previousPath, 'an executable update keeps the same durable icon');
    previousPath = details.appIconPath;
  }
});

test('packaged windows use an explicit ICO while relaunching the original portable EXE', () => {
  const portable = 'E:\\My Apps\\CodexTracker-2.4.1.exe';
  const { api, loaded, image } = identity(true, portable);
  let details, icon;
  api.setWindowIdentity({ setIcon: (value) => { icon = value; }, setAppDetails: (value) => { details = value; } });
  assert.equal(icon, image);
  assert.equal(loaded[0], 'C:\\temporary app\\resources\\assets\\icon.png');
  assert.doesNotMatch(loaded[0], /app\.asar/);
  assert.equal(details.appId, 'com.codextracker.desktop');
  assert.equal(details.appId, require('../package.json').build.appId);
  assert.equal(details.appIconPath, 'C:\\temporary app\\resources\\assets\\icon.ico');
  assert.equal(details.relaunchCommand, `"${portable}"`);
  assert.equal(details.relaunchDisplayName, 'CodexTracker');
});

test('unpacked and development runs still resolve Windows icons without a portable launcher', () => {
  for (const packaged of [false, true]) {
    const { api } = identity(packaged);
    let details;
    api.setWindowIdentity({ setIcon() {}, setAppDetails: (value) => { details = value; } });
    assert.equal(details.appIconPath, packaged ? 'C:\\temporary app\\resources\\assets\\icon.ico' : 'C:\\source\\assets\\icon.ico');
  }
});
