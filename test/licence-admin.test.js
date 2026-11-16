const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { createAdmin } = require('../tools/licence-admin');
const { verifyToken } = require('../security');

// A throwaway project folder with its own signing keys, so the real keys/ folder is never touched.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-lic-'));
  fs.mkdirSync(path.join(root, 'keys')); fs.mkdirSync(path.join(root, 'access'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(root, 'keys', 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { root, admin: createAdmin(root), publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

test('admin is only available where the private key is', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-lic-'));
  assert.equal(createAdmin(empty).available(), false);
  assert.throws(() => createAdmin(empty).issue('Ann', 0), /No private key/);
  assert.equal(sandbox().admin.available(), true);
});

test('issued tokens verify with the public key and are recorded', () => {
  const { admin, publicPem } = sandbox(), now = Date.UTC(2026, 10, 16);
  const forever = admin.issue('  Ann  ', 0, now), trial = admin.issue('Bob', 30, now);
  const checked = verifyToken(trial.token, publicPem);
  assert.equal(checked.ok, true);
  assert.deepEqual([checked.payload.name, checked.payload.exp], ['Bob', now + 30 * 864e5]);
  assert.equal(forever.payload.exp, undefined);
  assert.deepEqual(admin.list(now).map(t => [t.name, t.status]), [['Ann', 'active'], ['Bob', 'active']]);
  assert.equal(admin.list(now + 31 * 864e5)[1].status, 'expired');
  assert.throws(() => admin.issue('', 0), /customer name/);
  assert.throws(() => admin.issue('X', -1), /0 \(no expiry\) or more/);
});

test('revoking and restoring updates the published list', () => {
  const { admin, root } = sandbox();
  const { payload } = admin.issue('Ann', 0);
  admin.setRevoked(payload.id, true);
  admin.setRevoked(payload.id, true); // twice must not duplicate
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'access', 'revoked.json'), 'utf8')), { revoked: [payload.id] });
  assert.equal(admin.list()[0].status, 'revoked');
  admin.setRevoked(payload.id, false);
  assert.equal(admin.list()[0].status, 'active');
  assert.throws(() => admin.setRevoked('', true), /No token id/);
});
