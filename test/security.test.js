const test = require('node:test'), assert = require('node:assert'), crypto = require('crypto');
const sec = require('../security');
const kp = () => { const k = crypto.generateKeyPairSync('ed25519'); return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };

test('a signed token verifies and carries its details', () => {
  const k = kp(), t = sec.signToken({ id: 'ab12', name: 'Bob' }, k.priv), v = sec.verifyToken(t, k.pub);
  assert.ok(v.ok); assert.equal(v.payload.name, 'Bob');
});
test('tampered or foreign tokens are rejected', () => {
  const k = kp(), other = kp(), t = sec.signToken({ id: 'ab12', name: 'Bob' }, k.priv);
  const forged = ['SL1', Buffer.from(JSON.stringify({ id: 'ab12', name: 'Eve' })).toString('base64url'), t.split('.')[2]].join('.');
  assert.equal(sec.verifyToken(forged, k.pub).ok, false);
  assert.equal(sec.verifyToken(t, other.pub).ok, false);
  assert.equal(sec.verifyToken('garbage', k.pub).ok, false);
  assert.equal(sec.verifyToken('', k.pub).ok, false);
});
test('revoked, expired, stale and ok are told apart', () => {
  const now = Date.now(), day = 864e5, p = { id: 'x1' };
  assert.equal(sec.evaluate(p, ['x1'], now, now, 14).state, 'revoked');
  assert.equal(sec.evaluate({ id: 'x1', exp: now - 1 }, [], now, now, 14).state, 'expired');
  assert.equal(sec.evaluate(p, [], now - 15 * day, now, 14).state, 'stale');
  assert.equal(sec.evaluate(p, [], undefined, now, 14).state, 'stale');
  assert.equal(sec.evaluate(p, [], now - 13 * day, now, 14).state, 'ok');
  assert.equal(sec.evaluate(p, undefined, now, now, 14).state, 'ok');
});
test('PIN accepts the right one and locks out after repeated failures', () => {
  let rec = sec.makePin('1234'), now = 1e12;
  assert.ok(sec.checkPin(rec, '1234', now).ok);
  for (let i = 0; i < 4; i++) { const r = sec.checkPin(rec, '0000', now); assert.equal(r.ok, false); rec = r.rec; }
  const fifth = sec.checkPin(rec, '0000', now); rec = fifth.rec;
  assert.ok(fifth.wait >= 30);
  assert.equal(sec.checkPin(rec, '1234', now + 1000).ok, false);   // right PIN still refused during lockout
  assert.ok(sec.checkPin(rec, '1234', now + 31e3).ok);             // fine once the wait is over
});
