// node tools/vendor.js
// Copies the browser libraries the screens use from node_modules into renderer/vendor, which is what
// the installer ships. Run it after upgrading preact or htm with npm, then commit renderer/vendor.
// test/vendor.test.js fails if the copies and the installed versions drift apart.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const FILES = {
  'preact.mjs': 'node_modules/preact/dist/preact.mjs',
  'hooks.mjs': 'node_modules/preact/hooks/dist/hooks.mjs',
  'htm.mjs': 'node_modules/htm/dist/htm.mjs'
};
for (const [name, from] of Object.entries(FILES)) {
  fs.copyFileSync(path.join(root, from), path.join(root, 'renderer', 'vendor', name));
  console.log('renderer/vendor/' + name + '  <-  ' + from);
}
module.exports = { FILES };
