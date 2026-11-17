const test = require('node:test'), assert = require('node:assert');
const L = require('../renderer/js/ledger');
const I = require('../renderer/js/insights');

const TODAY = '2026-11-16', FROM = '2026-10-18'; // a 30-day window ending today
const item = (pid, q, p, c, n) => ({ pid, n, q, p, c });
function shop(over = {}) {
  return {
    v: 3, cur: 'R', n: 100, nextInvoice: 1, nextQuote: 1, nextCredit: 1, nextPurchase: 1, biz: { name: 'S', taxRate: 0, taxIncl: false },
    products: [
      { id: 1, name: 'Mug', cost: 40, price: 100, stock: 50, reorder: 5 },
      { id: 2, name: 'Tea', cost: 9, price: 10, stock: 2, reorder: 5 },
      { id: 3, name: 'Vase', cost: 20, price: 50, stock: 10, reorder: 0 },
      { id: 4, name: 'Spoon', cost: 5, price: 4, stock: 30, reorder: 0 }
    ],
    orders: [], expenses: [], quotes: [], credits: [], suppliers: [], purchases: [], moves: [], ...over
  };
}
const sell = (data, date, items, extra = {}) => L.createOrder(data, { cust: 'Ann', email: 'ann@x.com', date, fee: 0, items, ...extra }, TODAY);
const run = (data, from = FROM) => I.computeInsights(data, { from, to: TODAY, today: TODAY });
const ratio = (r, id) => r.ratios.find(x => x.id === id);
const rec = (r, text) => r.recommendations.find(x => x.title.includes(text));

test('profit ratios use sales excluding tax', () => {
  const data = shop({ biz: { taxRate: 25, taxIncl: true } });
  sell(data, '2026-11-01', [item(1, 2, 125, 40, 'Mug')]); // 200 excluding tax, cost 80
  data.expenses.push({ id: 9, date: '2026-11-02', desc: 'Rent', amt: 60, cat: 'Rent' });
  const r = run(data);
  assert.equal(ratio(r, 'grossMargin').value, 60);
  assert.equal(ratio(r, 'netMargin').value, 30);
  assert.equal(ratio(r, 'expenseRatio').value, 30);
  assert.equal(ratio(r, 'markup').value, 150);
  assert.equal(ratio(r, 'grossMargin').status, 'good');
});

test('break-even sales per month', () => {
  const data = shop();
  sell(data, '2026-11-01', [item(1, 1, 100, 40, 'Mug')]); // 60% margin
  data.expenses.push({ id: 9, date: '2026-11-02', desc: 'Rent', amt: 300, cat: '' });
  const r = run(data), be = ratio(r, 'breakEven');
  assert.ok(Math.abs(be.value - 300 / 30 * 30.44 / 0.6) < 0.01);
  assert.equal(be.status, 'bad'); // selling about R101 a month, need about R507
  const loss = rec(r, 'You made a loss');
  assert.equal(loss.severity, 'high');
  assert.match(loss.detail, /need|needs/);
});

test('stock days, dead stock and turnover', () => {
  const data = shop();
  sell(data, '2026-11-01', [item(1, 30, 100, 40, 'Mug')]); // R1200 cost over 30 days = R40 a day
  const r = run(data);
  const stockValue = 20 * 40 + 2 * 9 + 10 * 20 + 30 * 5; // after the sale
  assert.ok(Math.abs(ratio(r, 'stockDays').value - stockValue / 40) < 1e-9);
  assert.ok(Math.abs(ratio(r, 'turnover').value - 40 * 365 / stockValue) < 1e-9);
  // Tea, Vase and Spoon never sold and were not added recently, so they count as not selling.
  assert.equal(ratio(r, 'deadStock').value, 2 * 9 + 10 * 20 + 30 * 5);
  assert.equal(ratio(r, 'lowStock').value, 1); // Tea: 2 in stock, reorder at 5
});

test('a product added recently is not called dead stock', () => {
  const data = shop();
  L.moveStock(data, 3, 1, 'Opening stock', 'Product added', '2026-11-10');
  const r = run(data);
  assert.ok(!rec(r, 'Vase is not selling'));
  assert.ok(rec(r, 'Spoon is not selling'));
});

test('getting paid: debtor days, days to pay, overdue share', () => {
  const data = shop();
  const a = sell(data, '2026-11-01', [item(1, 3, 100, 40, 'Mug')]);  // R300, paid after 4 days
  L.addPayment(data, a, { date: '2026-11-05', amt: 300 });
  sell(data, '2026-11-10', [item(1, 3, 100, 40, 'Mug')]);            // R300 owed
  sell(data, '2026-08-01', [item(1, 1, 100, 40, 'Mug')], { cust: 'Bob', email: 'bob@x.com' }); // R100 owed, overdue
  const r = run(data);
  assert.ok(Math.abs(ratio(r, 'debtorDays').value - 400 / (600 / 30)) < 1e-9);
  assert.equal(ratio(r, 'daysToPay').value, 4);
  assert.equal(ratio(r, 'overdue').value, 25);
  const bob = rec(r, 'Bob owes');
  assert.equal(bob.severity, 'high'); // oldest debt is over 90 days
  assert.deepEqual(bob.action, { kind: 'customer', ref: 'bob@x.com', label: 'Open customer' });
  assert.ok(!rec(r, 'Ann owes')); // owes, but nothing overdue
});

test('payments added by the data upgrade do not count towards days to pay', () => {
  const data = shop();
  const o = sell(data, '2026-11-01', [item(1, 1, 100, 40, 'Mug')]);
  o.payments.push({ id: 1, date: '2026-11-01', amt: 100, method: '', note: 'Paid before payments were tracked' });
  assert.equal(ratio(run(data), 'daysToPay').value, null);
});

test('pricing recommendations suggest a price that reaches the target margin', () => {
  const data = shop();
  sell(data, '2026-11-01', [item(2, 1, 10, 9, 'Tea')]);
  const r = run(data);
  const tea = rec(r, 'Tea earns');
  assert.equal(tea.action.value, 12.86); // 9 / 0.7, rounded up to the cent
  assert.equal(I.priceForMargin(9, 30, { rate: 0 }), 12.86);
  assert.equal(I.priceForMargin(9, 30, { rate: 15, incl: true }), 14.79);
  const spoon = rec(r, 'Spoon sells for less than it costs');
  assert.equal(spoon.severity, 'high');
  assert.equal(spoon.action.kind, 'price');
});

test('stock recommendations: out of stock, running low, already on order', () => {
  const data = shop();
  sell(data, '2026-11-01', [item(2, 2, 10, 9, 'Tea')]); // Tea now at 0, selling 2 in 30 days
  sell(data, '2026-11-02', [item(1, 45, 100, 40, 'Mug')]); // Mug 5 left, selling 1.5 a day
  let r = run(data);
  const tea = rec(r, 'Tea is out of stock');
  assert.deepEqual([tea.severity, tea.action.kind, tea.action.value], ['high', 'purchase', 2]);
  const mug = rec(r, 'Mug runs out in about 3 days');
  assert.deepEqual([mug.severity, mug.action.value], ['medium', 40]); // 1.5 a day × 30 days − 5
  data.purchases.push({ id: 7, no: 'PO-0001', status: 'Ordered', items: [{ pid: 1, n: 'Mug', q: 40, c: 40 }] });
  r = run(data);
  assert.ok(!rec(r, 'Mug runs out')); // enough on order now
});

test('customer concentration, returns and expiring quotes', () => {
  const data = shop();
  const big = sell(data, '2026-11-01', [item(1, 9, 100, 40, 'Mug')]);
  sell(data, '2026-11-02', [item(1, 1, 100, 40, 'Mug')], { cust: 'Bob', email: 'bob@x.com' });
  L.createCredit(data, big, [2], { restock: true, date: '2026-11-03' });
  L.createQuote(data, { cust: 'Cat', email: '', date: '2026-10-20', items: [item(3, 1, 50, 20, 'Vase')] }, TODAY); // valid to 2026-11-19
  const r = run(data);
  assert.equal(ratio(r, 'topCustomer').value, 700 / 800 * 100);
  assert.ok(rec(r, 'Ann makes up'));
  assert.equal(ratio(r, 'returns').value, 200 / 1000 * 100);
  assert.ok(rec(r, 'Mug comes back often'));
  assert.ok(rec(r, '1 quote expires this week'));
});

test('growth compares with the period before and a year ago', () => {
  const data = shop();
  sell(data, '2026-11-01', [item(1, 1, 100, 40, 'Mug')]);
  sell(data, '2026-10-01', [item(1, 2, 100, 40, 'Mug')]);
  sell(data, '2026-09-25', [item(1, 2, 100, 40, 'Mug')]);
  sell(data, '2026-09-20', [item(1, 2, 100, 40, 'Mug')]);
  sell(data, '2025-11-01', [item(1, 4, 100, 40, 'Mug')]);
  const r = run(data);
  assert.equal(ratio(r, 'salesChange').value, (100 - 600) / 600 * 100);
  assert.equal(ratio(r, 'yearChange').value, -75);
  assert.equal(rec(r, 'Sales are down').severity, 'medium');
});

test('recommendations come most serious first, then by money at stake', () => {
  const data = shop();
  sell(data, '2026-11-01', [item(2, 2, 10, 9, 'Tea')]);
  const order = I.computeInsights(data, { from: FROM, to: TODAY, today: TODAY }).recommendations.map(r => r.severity);
  const rank = { high: 0, medium: 1, low: 2 };
  assert.deepEqual(order, order.slice().sort((a, b) => rank[a] - rank[b]));
});

test('an empty shop gives no recommendations and no errors', () => {
  const r = run(shop({ products: [] }));
  assert.deepEqual(r.recommendations, []);
  assert.equal(ratio(r, 'grossMargin').value, null);
  assert.equal(I.formatRatio(ratio(r, 'grossMargin'), 'R'), 'Not enough data');
});

test('targets: defaults, overrides and checks', () => {
  assert.equal(I.targetsOf(shop()).grossMargin, 30);
  assert.equal(I.targetsOf(shop({ targets: { grossMargin: 45 } })).grossMargin, 45);
  assert.match(I.cleanTargets({ ...I.DEFAULT_TARGETS, grossMargin: 100 }).error, /Gross margin must be between 1 and 95%/);
  assert.match(I.cleanTargets({ ...I.DEFAULT_TARGETS, stockDays: 'x' }).error, /Days of stock/);
  assert.deepEqual(I.cleanTargets({ ...I.DEFAULT_TARGETS, debtorDays: '45' }).targets.debtorDays, 45);
});

test('formatting', () => {
  const f = (value, format) => I.formatRatio({ value, format }, 'R');
  assert.equal(f(12.345, 'pct'), '12.3%');
  assert.equal(f(5, 'change'), '+5.0%');
  assert.equal(f(1200, 'moneyMonth'), 'R1,200.00 a month');
  assert.equal(f(1, 'days'), '1 day');
  assert.equal(f(4.25, 'times'), '4.3 times a year');
});
