const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

// renderer/vendor holds copies of browser libraries (see tools/vendor.js). They must match what
// package.json installs, so an upgrade can't be half done.
test('vendored libraries match the installed packages', () => {
  const files = {
    'preact.mjs': 'node_modules/preact/dist/preact.mjs',
    'hooks.mjs': 'node_modules/preact/hooks/dist/hooks.mjs',
    'htm.mjs': 'node_modules/htm/dist/htm.mjs'
  };
  for (const [name, from] of Object.entries(files)) {
    assert.ok(fs.readFileSync(path.join(root, 'renderer/vendor', name)).equals(fs.readFileSync(path.join(root, from))), name + ' is out of date: run node tools/vendor.js');
  }
});
