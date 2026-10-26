const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadSettings, saveSettings } = require('../dist-main/main/settings.js');
const { moduleOrder, moveModule } = require('../dist-main/shared/modules.js');

test('loading legacy settings persists migration and preserves unrelated rules and preferences', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codextracker-settings-test-'));
  const dataDirectory = path.join(directory, '.codex-tracker');
  const file = path.join(dataDirectory, 'settings.json');
  const originalHome = os.homedir;
  const legacy = {
    refresh_seconds: 120, forecast_minutes: 42, history_days: 30, language: 'de',
    notifications: { enabled: false, rules: [
      { id: 'custom', card: 'weekly', field: 'pct_left', threshold: 32, enabled: true },
      { id: 'forecast-high', card: 'forecast', field: 'pct_left', threshold: 70, enabled: true },
    ] },
  };
  try {
    await fs.mkdir(dataDirectory);
    await fs.writeFile(file, JSON.stringify(legacy));
    os.homedir = () => directory;
    const loaded = await loadSettings();
    assert.equal(loaded.language, 'de');
    assert.equal(loaded.codex_enabled, true, 'existing installations keep Codex enabled');
    assert.deepEqual(loaded.module_order, moduleOrder());
    assert.equal(loaded.refresh_seconds, 120);
    assert.equal(loaded.notifications.enabled, false);
    assert.deepEqual(loaded.notifications.rules, [legacy.notifications.rules[0]]);
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), /forecast/);
    assert.deepEqual(await loadSettings(), loaded, 'migration remains stable on the next load');
    await fs.writeFile(file, JSON.stringify({ ...loaded, codex_enabled: false }));
    assert.equal((await loadSettings()).codex_enabled, false, 'disabled module persists across restart');
    const reordered = { ...loaded, module_order: moveModule(loaded.module_order, 'antigravity', 'codex') };
    await saveSettings(reordered);
    assert.deepEqual(await loadSettings(), reordered, 'module order survives a restart');
    const planned = { ...reordered, manual_resets: { codex: { window_id: 'weekly', enabled: true,
      reset_at: 1793000000000, start_at: 1792700000000, start_used_percent: 0 } } };
    await saveSettings(planned);
    assert.deepEqual(await loadSettings(), planned, 'manual deadline and selected display survive a restart');
    const banked = { ...planned, codex_banked_reset_budget: true };
    await saveSettings(banked);
    assert.deepEqual(await loadSettings(), banked, 'banked display and saved manual deadline survive a restart');
    await saveSettings({ ...banked, codex_banked_reset_budget: false });
    assert.equal((await loadSettings()).codex_banked_reset_budget, false, 'switching back to the automatic or manual display persists');
  } finally {
    os.homedir = originalHome;
    await fs.unlink(file).catch(() => {});
    await fs.unlink(file + '.tmp').catch(() => {});
    await fs.rmdir(dataDirectory);
    await fs.rmdir(directory);
  }
});
