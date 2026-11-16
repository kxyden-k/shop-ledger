const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const b = require('../backup');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
const data = { v: 2, products: [{ id: 1, name: 'Mug' }], orders: [], expenses: [] };

test('plain backup round-trips', () => assert.deepEqual(b.decode(b.encode(data, ''), ''), data));
test('encrypted backup round-trips and hides the content', () => {
  const buf = b.encode(data, 'secret1');
  assert.ok(b.isEncrypted(buf)); assert.ok(!buf.toString('latin1').includes('Mug'));
  assert.deepEqual(b.decode(buf, 'secret1'), data);
});
test('wrong or missing password is reported', () => {
  const buf = b.encode(data, 'secret1');
  assert.throws(() => b.decode(buf, 'nope'), e => e.code === 'WRONG_PASSWORD');
  assert.throws(() => b.decode(buf, ''), e => e.code === 'PASSWORD_NEEDED');
});
test('tampering is detected', () => {
  const buf = Buffer.from(b.encode(data, 'secret1')); buf[buf.length - 1] ^= 1;
  assert.throws(() => b.decode(buf, 'secret1'), e => e.code === 'WRONG_PASSWORD');
});
test('same-day backup is replaced and only the newest 30 are kept', () => {
  const dir = tmp(), day = n => new Date(Date.UTC(2026, 0, 1) + n * 864e5);
  for (let i = 0; i < 35; i++) b.writeBackup(dir, data, '', day(i));
  b.writeBackup(dir, { ...data, cur: '$' }, '', day(34));
  const files = fs.readdirSync(dir).sort();
  assert.equal(files.length, 30);
  assert.equal(b.decode(fs.readFileSync(path.join(dir, files.pop())), '').cur, '$');
});
test('switching on encryption removes that day\'s plain copy', () => {
  const dir = tmp(), d = new Date(Date.UTC(2026, 5, 1));
  b.writeBackup(dir, data, '', d); b.writeBackup(dir, data, 'pw1234', d);
  assert.deepEqual(fs.readdirSync(dir), ['ShopLedger-2026-06-01.slbk']);
});
