// Run ONCE. Creates your signing keys. keys/private.pem must stay secret and be backed up.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), priv = path.join(root, 'keys', 'private.pem'), pub = path.join(root, 'access', 'public.pem');
if (fs.existsSync(priv) || fs.existsSync(pub)) { console.error('Keys already exist. Replacing them would stop every issued token working.'); process.exit(1); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(priv), { recursive: true }); fs.mkdirSync(path.dirname(pub), { recursive: true });
fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Created keys/private.pem (SECRET: never commit or share it; back it up somewhere safe)');
console.log('Created access/public.pem (safe to commit; it is built into the app)');
