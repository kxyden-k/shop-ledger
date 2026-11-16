// Issuing and revoking access tokens. Used by the command-line tools and by the Licences screen,
// which only exists when the app is run from source on the machine that holds keys/private.pem.
// Nothing in tools/ or keys/ is ever packed into the installer.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const { signToken } = require('../security');

function createAdmin(root = path.join(__dirname, '..')) {
  const keyFile = path.join(root, 'keys', 'private.pem'), ledgerFile = path.join(root, 'keys', 'issued.json');
  const revokedFile = path.join(root, 'access', 'revoked.json');
  const read = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  const revokedIds = () => read(revokedFile, { revoked: [] }).revoked.map(String);

  return {
    root, revokedFile,
    available: () => fs.existsSync(keyFile),

    // Every token ever issued: {id, name, iat, exp, status}. status: 'active' | 'expired' | 'revoked'
    list(now = Date.now()) {
      const revoked = revokedIds();
      return read(ledgerFile, []).map(t => ({
        id: t.id, name: t.name, iat: t.iat || 0, exp: t.exp || 0,
        status: revoked.includes(t.id) ? 'revoked' : t.exp && now > t.exp ? 'expired' : 'active'
      }));
    },

    // days: how long the token is valid, or 0 for no expiry. Returns {payload, token}.
    issue(name, days, now = Date.now()) {
      name = String(name || '').trim();
      days = Number(days) || 0;
      if (!name) throw new Error('Enter the customer name.');
      if (days < 0) throw new Error('Days must be 0 (no expiry) or more.');
      if (!fs.existsSync(keyFile)) throw new Error('No private key. Run: node tools/keygen.js');
      const payload = { id: crypto.randomBytes(4).toString('hex'), name, iat: now };
      if (days) payload.exp = now + days * 864e5;
      const ledger = read(ledgerFile, []);
      ledger.push(payload);
      fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
      return { payload, token: signToken(payload, fs.readFileSync(keyFile, 'utf8')) };
    },

    // Takes effect once access/revoked.json is committed and pushed.
    setRevoked(id, revoked) {
      id = String(id || '');
      if (!id) throw new Error('No token id given.');
      const ids = revokedIds().filter(x => x !== id);
      if (revoked) ids.push(id);
      fs.writeFileSync(revokedFile, JSON.stringify({ revoked: ids }, null, 2) + '\n');
    }
  };
}

module.exports = { createAdmin };
