// Off-computer backups: file format, optional password encryption, writing and pruning.
// No Electron code here, so it is fully testable.
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const MAGIC = Buffer.from('SLBK1'), KEEP = 30;
const NAME = /^ShopLedger-\d{4}-\d{2}-\d{2}\.(json|slbk)$/;
const key = (pw, salt) => crypto.scryptSync(String(pw), salt, 32);
const fail = code => Object.assign(new Error(code), { code });

// No password: readable JSON. With a password: AES-256-GCM (tamper-evident) behind a small header.
function encode(data, password) {
  const json = Buffer.from(JSON.stringify(data));
  if (!password) return json;
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(password, salt), iv);
  const enc = Buffer.concat([c.update(json), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}
const isEncrypted = buf => buf.length > 49 && buf.subarray(0, 5).equals(MAGIC);

function decode(buf, password) {
  if (!isEncrypted(buf)) return JSON.parse(buf.toString('utf8'));
  if (!password) throw fail('PASSWORD_NEEDED');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(password, buf.subarray(5, 21)), buf.subarray(21, 33));
    d.setAuthTag(buf.subarray(33, 49));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(49)), d.final()]).toString('utf8'));
  } catch (e) { throw fail('WRONG_PASSWORD'); }
}

// One file per day (later backups the same day replace it), newest 30 kept.
function writeBackup(folder, data, password, now = new Date()) {
  fs.mkdirSync(folder, { recursive: true });
  const day = now.toISOString().slice(0, 10);
  const file = path.join(folder, 'ShopLedger-' + day + (password ? '.slbk' : '.json'));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, encode(data, password));
  fs.renameSync(tmp, file);
  decode(fs.readFileSync(file), password); // read it back: never trust a backup you have not opened
  const other = path.join(folder, 'ShopLedger-' + day + (password ? '.json' : '.slbk'));
  if (fs.existsSync(other)) fs.unlinkSync(other); // do not leave a plain copy next to an encrypted one
  fs.readdirSync(folder).filter(f => NAME.test(f)).sort().slice(0, -KEEP).forEach(f => { try { fs.unlinkSync(path.join(folder, f)); } catch (e) {} });
  return { file };
}
module.exports = { encode, decode, isEncrypted, writeBackup };
