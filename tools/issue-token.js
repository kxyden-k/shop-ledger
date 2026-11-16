// node tools/issue-token.js "Customer name" [days valid]
const { createAdmin } = require('./licence-admin');
const [, , name, days] = process.argv;
if (!name) { console.error('Usage: node tools/issue-token.js "Customer name" [days valid]'); process.exit(1); }
try {
  const { payload, token } = createAdmin().issue(name, days);
  console.log('Token id: ' + payload.id + (payload.exp ? '  (expires ' + new Date(payload.exp).toISOString().slice(0, 10) + ')' : '  (no expiry)'));
  console.log('\nGive the customer this token:\n\n' + token + '\n');
} catch (e) { console.error(e.message); process.exit(1); }
