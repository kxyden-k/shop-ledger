// node tools/issue-token.js "Customer name" [days valid]
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const { signToken } = require('../security');
const [, , name, days] = process.argv;
if (!name) { console.error('Usage: node tools/issue-token.js "Customer name" [days valid]'); process.exit(1); }
const keyFile = path.join(__dirname, '..', 'keys', 'private.pem'), ledgerFile = path.join(__dirname, '..', 'keys', 'issued.json');
if (!fs.existsSync(keyFile)) { console.error('No private key. Run: node tools/keygen.js'); process.exit(1); }
const payload = { id: crypto.randomBytes(4).toString('hex'), name, iat: Date.now() };
if (days) payload.exp = Date.now() + Number(days) * 864e5;
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : [];
ledger.push(payload); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
console.log('Token id: ' + payload.id + (payload.exp ? '  (expires ' + new Date(payload.exp).toISOString().slice(0, 10) + ')' : '  (no expiry)'));
console.log('\nGive the customer this token:\n\n' + signToken(payload, fs.readFileSync(keyFile, 'utf8')) + '\n');
