// node tools/revoke.js <id>            revoke
// node tools/revoke.js --restore <id>  undo
// node tools/revoke.js --list          show issued tokens and their status
const fs = require('fs'), path = require('path');
const rf = path.join(__dirname, '..', 'access', 'revoked.json'), lf = path.join(__dirname, '..', 'keys', 'issued.json');
const read = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;
const r = read(rf, { revoked: [] }), ledger = read(lf, []), args = process.argv.slice(2);
if (args[0] === '--list') {
  ledger.forEach(t => console.log(t.id, r.revoked.includes(t.id) ? 'REVOKED' : 'active ', t.name, t.exp ? 'expires ' + new Date(t.exp).toISOString().slice(0, 10) : ''));
  process.exit(0);
}
const restore = args[0] === '--restore', id = restore ? args[1] : args[0];
if (!id) { console.error('Usage: node tools/revoke.js <id> | --restore <id> | --list'); process.exit(1); }
r.revoked = r.revoked.filter(x => x !== id);
if (!restore) r.revoked.push(id);
fs.writeFileSync(rf, JSON.stringify(r, null, 2) + '\n');
const who = ledger.find(t => t.id === id);
console.log((restore ? 'Restored ' : 'Revoked ') + id + (who ? ' (' + who.name + ')' : ''));
console.log('Now commit and push access/revoked.json. Installs pick it up when they next go online (at start-up and every 6 hours).');
