const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const L = require('../renderer/js/ledger');
const R = require('../renderer/js/reports');
const D = require('../renderer/js/documents');
const { documentHtml, toCsv } = require('../pdf-template');
const { createStore, SCHEMA } = require('../db');

const TODAY = '2026-11-16';
const item = (pid, q, p, c, n) => ({ pid, n, q, p, c });
// Two months of trading with tax included in prices, one credit note, one part payment.
function shop() {
  const data = {
    v: 3, cur: 'R', n: 100, nextInvoice: 2, nextQuote: 1, nextCredit: 1, nextPurchase: 1,
    biz: { name: 'Shop <x>', address: '1 Road', taxRate: 15, taxIncl: true, bank: 'Bank 123', footer: 'Thanks' },
    products: [{ id: 1, sku: 'M', name: 'Mug', cost: 40, price: 115, stock: 20, reorder: 2 }],
    orders: [], quotes: [], credits: [], purchases: [], moves: [], suppliers: [{ id: 50, name: 'Acme', email: 'acme@x.com' }],
    expenses: [{ id: 1, date: '2026-10-03', desc: 'Rent', amt: 50, cat: 'Rent' }, { id: 2, date: '2026-11-03', desc: 'Ads', amt: 20, cat: '' }]
  };
  const oct = L.createOrder(data, { cust: 'A & <B>', email: 'a@b.co', date: '2026-10-10', fee: 5, items: [item(1, 2, 115, 40, 'Mug')] }, TODAY);
  oct.invoiceNo = 'INV-0001';
  L.addPayment(data, oct, { date: '2026-10-12', amt: 100, method: 'Card', note: '' });
  const nov = L.createOrder(data, { cust: 'Bob', email: '', date: '2026-11-05', fee: 0, items: [item(1, 1, 115, 40, 'Mug')] }, TODAY);
  L.createCredit(data, oct, [1], { reason: 'Chipped', restock: true, date: '2026-11-06' });
  return { data, oct, nov };
}

test('profit and loss is by month, net of tax and credit notes', () => {
  const { data } = shop();
  const r = R.profitAndLoss(data, '', '');
  assert.deepEqual(r.rows.map(x => x[0]), ['2026-10', '2026-11']);
  assert.deepEqual(r.rows[0], ['2026-10', 200, 80, 5, 115, 50, 65]);
  assert.deepEqual(r.rows[1], ['2026-11', 0, 0, 0, 0, 20, -20]); // one mug sold, one credited back
  assert.deepEqual(r.total, ['Total', 200, 80, 5, 115, 70, 45]);
  assert.deepEqual(R.profitAndLoss(data, '2026-11-01', '2026-11-30').rows.length, 1);
});

test('tax report shows tax collected per month', () => {
  const { data } = shop();
  const r = R.taxReport(data, '2026-10-01', '2026-10-31');
  assert.deepEqual(r.rows, [['2026-10', 230, 200, 30]]);
});

test('other reports add up', () => {
  const { data } = shop();
  assert.deepEqual(R.salesByProductReport(data, '', '').rows, [['Mug', 2, 230, 80, 150, 150 / 230 * 100]]);
  const customers = R.salesByCustomerReport(data, '', '').rows;
  assert.deepEqual(customers, [['A & <B>', 1, 115, 70], ['Bob', 1, 115, 75]]);
  assert.deepEqual(R.expensesByCategory(data, '', '').rows, [['Rent', 1, 50], ['Uncategorised', 1, 20]]);
  assert.deepEqual(R.paymentsReport(data, '', '').total.at(-1), 100);
  const orders = R.orderListReport(data, '', '');
  assert.deepEqual(orders.rows[0].slice(5), [200, 30, 230, 115, 100, 15]);
  assert.deepEqual(R.agedDebtorsReport(data, '', '', TODAY).rows.map(x => [x[0], x.at(-1)]), [['Bob', 115], ['A & <B>', 15]]);
  assert.deepEqual(R.stockValuation(data, '', '', TODAY).rows, [['M', 'Mug', 18, 40, 720, 2070]]);
  assert.equal(R.REPORT_NAMES.every(([id]) => Array.isArray(R.buildReport(id, data, '', '', TODAY).rows)), true);
});

test('report rows for CSV keep raw numbers and end with the total', () => {
  const { data } = shop();
  const rows = R.reportToRows(R.taxReport(data, '', ''));
  assert.deepEqual(rows[0], ['Month', 'Sales incl. tax', 'Sales excl. tax', 'Tax collected']);
  assert.equal(rows.at(-1)[0], 'Total');
  assert.equal(typeof rows[1][1], 'number');
});

test('date presets', () => {
  assert.deepEqual(R.presetRange('month', '2026-02-10'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(R.presetRange('lastMonth', '2026-01-10'), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(R.presetRange('year', TODAY), ['2026-01-01', '2026-12-31']);
  assert.deepEqual(R.presetRange('all', TODAY), ['', '']);
});

test('invoice shows credit notes, payments and the balance due', () => {
  const { data, oct } = shop();
  const doc = D.invoiceDoc(data, oct);
  assert.equal(doc.number, 'INV-0001');
  assert.deepEqual(doc.rows, [['Mug', '2', 'R115.00', 'R230.00']]);
  assert.deepEqual(doc.totals.map(t => [t.label, t.value]), [
    ['Subtotal', 'R200.00'], ['Tax (15%)', 'R30.00'], ['Invoice total', 'R230.00'], ['Credit notes', '−R115.00'], ['Paid', '−R100.00'], ['Balance due', 'R15.00']
  ]);
  assert.ok(doc.notes.some(n => n.text.includes('Reference: INV-0001')));
});

test('quote, credit note, purchase order and statement documents', () => {
  const { data, oct } = shop();
  const quote = L.createQuote(data, { cust: 'Cat', email: '', date: TODAY, items: [item(1, 1, 115, 40, 'Mug')] }, TODAY);
  assert.deepEqual(D.quoteDoc(data, quote).totals.at(-1), { label: 'Total', value: 'R115.00', strong: true });
  const credit = D.creditDoc(data, data.credits[0]);
  assert.deepEqual([credit.kind, credit.number, credit.meta[1][1]], ['Credit note', 'CN-0001', 'invoice INV-0001']);
  const po = L.createPurchase(data, { supplierId: 50, date: TODAY, items: [{ pid: 1, n: 'Mug', q: 10, c: 38 }] }, TODAY);
  const poDoc = D.purchaseDoc(data, po);
  assert.deepEqual([poDoc.party.name, poDoc.party.lines[0], poDoc.totals[0].value], ['Acme', 'acme@x.com', 'R380.00']);
  const customer = L.summarizeCustomers(data).find(c => c.key === L.customerKey(oct));
  const statement = D.statementDoc(data, customer, '', TODAY);
  assert.equal(statement.rows.length, 3);
  assert.deepEqual(statement.totals[0], { label: 'Amount due', value: 'R15.00', strong: true });
  assert.equal(D.statementDoc(data, customer, '2026-11-01', TODAY).rows[0][1], 'Balance brought forward');
});

test('report document formats cells and marks the total row', () => {
  const { data } = shop();
  const doc = D.reportDoc(data, R.taxReport(data, '', ''), '', '', TODAY);
  assert.deepEqual(doc.rows[0], ['2026-10', 'R230.00', 'R200.00', 'R30.00']);
  assert.deepEqual(doc.rows.at(-1)[0], { strong: 'Total' });
  assert.equal(doc.meta[0][1], 'All dates');
});

test('pdf page escapes everything it is given', () => {
  const { data, oct } = shop();
  const html = documentHtml(D.invoiceDoc(data, oct), data.biz);
  assert.ok(html.includes('A &amp; &lt;B&gt;'));
  assert.ok(html.includes('Shop &lt;x&gt;'));
  assert.ok(html.includes('INV-0001'));
  assert.ok(!html.includes('<B>'));
  assert.ok(documentHtml({ kind: '<script>', rows: [[{ strong: '<i>' }]], columns: [{ label: 'a' }] }, {}).includes('<b>&lt;i&gt;</b>'));
  assert.doesNotThrow(() => documentHtml(null, null));
});

test('csv quotes text, keeps numbers, and defuses formulas', () => {
  const csv = toCsv([['Name', 'Amount'], ['He said "hi", twice', 12.5], ['=SUM(A1)', -3], ['line\nbreak', '']]);
  assert.equal(csv, '﻿Name,Amount\r\n"He said ""hi"", twice",12.5\r\n\'=SUM(A1),-3\r\n"line\nbreak",\r\n');
});

test('v1 data is upgraded through every version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ v: 1, products: [], orders: [{ id: 1, items: [] }], expenses: [], cur: 'R', n: 2 }));
  const d = createStore(dir).load().data;
  assert.equal(d.v, SCHEMA); assert.equal(d.nextInvoice, 1); assert.equal(d.orders[0].invoiceNo, null); assert.equal(d.biz.prefix, 'INV-');
  assert.ok(fs.existsSync(path.join(dir, 'backups', 'pre-migrate-v1.json')));
});

test('v2 data gains payments, tax on orders and the new record lists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
  const items = [{ pid: 1, n: 'Mug', q: 2, p: 100, c: 40 }];
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
    v: 2, cur: 'R', n: 10, nextInvoice: 4, biz: { name: 'S', taxRate: 15, taxIncl: false, prefix: 'INV-' }, products: [],
    orders: [
      { id: 1, no: 1, date: '2026-01-05', status: 'Pending', fee: 0, items },
      { id: 2, no: 2, date: '2026-01-06', status: 'Completed', fee: 0, items },
      { id: 3, no: 3, date: '2026-01-07', status: 'Cancelled', fee: 0, items }
    ],
    expenses: [{ id: 4, date: '2026-01-01', desc: 'Rent', amt: 5 }]
  }));
  const d = createStore(dir).load().data;
  assert.equal(d.v, 3);
  assert.deepEqual(d.orders[0].tax, { rate: 15, incl: false });
  assert.deepEqual(d.orders.map(o => o.payments.length), [0, 1, 0]);
  assert.deepEqual([d.orders[1].payments[0].amt, d.orders[1].payments[0].date, d.orders[1].payments[0].id], [230, '2026-01-06', 10]);
  assert.equal(d.n, 11);
  assert.deepEqual(d.orders.map(o => L.orderBalance(d, o)), [230, 0, 0]); // owed exactly as before the upgrade
  assert.equal(d.expenses[0].cat, '');
  assert.deepEqual([d.quotes, d.credits, d.suppliers, d.purchases, d.moves], [[], [], [], [], []]);
  assert.deepEqual([d.nextQuote, d.nextCredit, d.nextPurchase, d.nextInvoice], [1, 1, 1, 4]);
  assert.ok(fs.existsSync(path.join(dir, 'backups', 'pre-migrate-v2.json')));
});
