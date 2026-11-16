const test = require('node:test'), assert = require('node:assert');
const { invoiceHtml, totals } = require('../invoice');
const { createStore } = require('../db');
const fs = require('fs'), os = require('os'), path = require('path');
const order = { no: 1, date: '2026-11-15', cust: 'A & <B>', email: 'a@b.co', invoiceNo: 'INV-0001', items: [{ n: 'Mug', q: 2, p: 100, c: 40 }] };

test('tax added on top when prices exclude tax', () => {
  const t = totals(order, { taxRate: 15, taxIncl: false });
  assert.equal(t.net, 200); assert.equal(t.tax, 30); assert.equal(t.total, 230);
});
test('tax carved out when prices include tax', () => {
  const t = totals(order, { taxRate: 15, taxIncl: true });
  assert.equal(t.total, 200); assert.ok(Math.abs(t.tax - 26.0869565) < 1e-5);
});
test('no tax rate means total equals subtotal', () => {
  assert.equal(totals(order, { taxRate: 0 }).total, 200);
});
test('invoice html escapes customer text and shows the number', () => {
  const h = invoiceHtml(order, { name: 'Shop <x>', taxRate: 0 }, 'R');
  assert.ok(h.includes('A &amp; &lt;B&gt;')); assert.ok(h.includes('INV-0001')); assert.ok(h.includes('Shop &lt;x&gt;'));
});
test('v1 data is upgraded to v2 with invoice fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ v: 1, products: [], orders: [{ id: 1, items: [] }], expenses: [], cur: 'R', n: 2 }));
  const d = createStore(dir).load().data;
  assert.equal(d.v, 2); assert.equal(d.nextInvoice, 1); assert.equal(d.orders[0].invoiceNo, null); assert.equal(d.biz.prefix, 'INV-');
  assert.ok(fs.existsSync(path.join(dir, 'backups', 'pre-migrate-v1.json')));
});
