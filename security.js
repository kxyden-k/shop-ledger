// Access tokens (signed with your private key, checked with the public key inside the app)
// and the PIN lock. No Electron code here, so it is fully testable.
const crypto = require('crypto');

function signToken(payload, privateKeyPem) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.sign(null, Buffer.from(p), privateKeyPem).toString('base64url');
  return 'SL1.' + p + '.' + s;
}

function verifyToken(token, publicKeyPem) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'SL1') return { ok: false, reason: 'That does not look like an access token.' };
  try {
    if (!crypto.verify(null, Buffer.from(parts[1]), publicKeyPem, Buffer.from(parts[2], 'base64url'))) throw new Error('bad signature');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.id) throw new Error('no id');
    return { ok: true, payload };
  } catch (e) { return { ok: false, reason: 'This token is not valid.' }; }
}

// revoked: array of token ids. lastOk: time of the last successful online check.
function evaluate(payload, revoked, lastOk, now, graceDays) {
  if ((revoked || []).includes(payload.id)) return { state: 'revoked' };
  if (payload.exp && now > payload.exp) return { state: 'expired' };
  if (!lastOk || now - lastOk > graceDays * 864e5) return { state: 'stale' };
  return { state: 'ok' };
}

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
function makePin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPin(pin, salt), fails: 0, until: 0 };
}
// 5 wrong tries, then waits that double each time (30s, 60s ... up to 15 minutes). Survives restarts.
function checkPin(rec, pin, now) {
  if (now < rec.until) return { ok: false, wait: Math.ceil((rec.until - now) / 1000), rec };
  const good = crypto.timingSafeEqual(Buffer.from(hashPin(pin, rec.salt), 'hex'), Buffer.from(rec.hash, 'hex'));
  if (good) return { ok: true, rec: { ...rec, fails: 0, until: 0 } };
  const fails = rec.fails + 1, until = fails >= 5 ? now + Math.min(30e3 * 2 ** (fails - 5), 15 * 60e3) : 0;
  return { ok: false, wait: Math.ceil((until - now) / 1000), rec: { ...rec, fails, until } };
}
module.exports = { signToken, verifyToken, evaluate, makePin, checkPin };
