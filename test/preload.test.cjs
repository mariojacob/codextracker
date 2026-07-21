const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('sandboxed preload has no local runtime imports', () => {
  const preload = readFileSync(
    path.join(__dirname, '..', 'dist-main', 'preload', 'index.js'),
    'utf8',
  );

  assert.doesNotMatch(
    preload,
    /require\(["']\.\.?[\\/]/,
    'sandboxed preload scripts cannot require local compiled modules',
  );
  assert.match(preload, /require\(["']electron["']\)/);
});
