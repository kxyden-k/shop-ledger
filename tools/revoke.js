// node tools/revoke.js <id>            revoke
// node tools/revoke.js --restore <id>  undo
// node tools/revoke.js --list          show issued tokens and their status
const admin = require('./licence-admin').createAdmin(), args = process.argv.slice(2);
if (args[0] === '--list') {
  admin.list().forEach(t => console.log(t.id, t.status.toUpperCase().padEnd(7), t.name, t.exp ? 'expires ' + new Date(t.exp).toISOString().slice(0, 10) : ''));
  process.exit(0);
}
const restore = args[0] === '--restore', id = restore ? args[1] : args[0];
if (!id) { console.error('Usage: node tools/revoke.js <id> | --restore <id> | --list'); process.exit(1); }
admin.setRevoked(id, !restore);
const who = admin.list().find(t => t.id === id);
console.log((restore ? 'Restored ' : 'Revoked ') + id + (who ? ' (' + who.name + ')' : ''));
console.log('Now commit and push access/revoked.json. Installs pick it up when they next go online (at start-up and every 6 hours).');
