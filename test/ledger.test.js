const test = require('node:test'), assert = require('node:assert');
const L = require('../renderer/js/ledger');

const item = (pid, q, p, c, n = 'P' + pid) => ({ pid, n, q, p, c });
const order = (o) => ({ id: 1, no: 1, date: '2026-11-10', cust: '', email: '', fee: 0, status: 'Pending', items: [], ...o });

test('order revenue, cost and profit include the fee', () => {
  const o = order({ fee: '5', items: [item(1, 2, 10, 4), item(2, 1, 3, 1)] });
  assert.equal(L.orderRevenue(o), 23);
  assert.equal(L.orderCost(o), 9);
  assert.equal(L.orderProfit(o), 9);
  assert.equal(L.orderUnits(o), 3);
  assert.equal(L.orderFee(order({ fee: '' })), 0);
});

test('periods: all, this month, last 30 days', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.ok(L.isInPeriod('2020-01-01', 'all', now));
  assert.ok(L.isInPeriod('2026-11-01', 'month', now));
  assert.ok(!L.isInPeriod('2026-10-31', 'month', now));
  assert.ok(L.isInPeriod('2026-10-20', '30d', now));
  assert.ok(!L.isInPeriod('2026-10-10', '30d', now));
});

test('period summary skips cancelled orders and subtracts expenses', () => {
  const data = {
    orders: [order({ fee: 2, items: [item(1, 1, 10, 4)] }), order({ status: 'Cancelled', items: [item(1, 5, 10, 4)] })],
    expenses: [{ amt: 3, date: '2026-11-01' }]
  };
  const s = L.periodSummary(data, 'all');
  assert.equal(s.orders.length, 1);
  assert.equal(s.grossProfit, 4);
  assert.equal(s.netProfit, 1);
});

test('cancelling returns stock; reopening takes it again unless short', () => {
  const products = [{ id: 1, stock: 1 }];
  const o = order({ items: [item(1, 2, 10, 4)] });
  assert.equal(L.changeOrderStatus(products, o, 'Cancelled'), '');
  assert.equal(products[0].stock, 3);
  products[0].stock = 1;
  assert.match(L.changeOrderStatus(products, o, 'Paid'), /Not enough stock of P1/);
  assert.equal(o.status, 'Cancelled');
  products[0].stock = 2;
  assert.equal(L.changeOrderStatus(products, o, 'Paid'), '');
  assert.equal(products[0].stock, 0);
  assert.equal(o.status, 'Paid');
});

test('price changes are recorded in history', () => {
  const p = { price: 10 };
  L.setPrice(p, 10, '2026-11-01');
  assert.equal(p.h, undefined);
  L.setPrice(p, 12, '2026-11-02');
  assert.deepEqual(p.h, [{ d: '2026-11-02', o: 10 }]);
  const all = [{ price: 9.99, h: [] }];
  L.changeAllPrices(all, 10, '2026-11-03');
  assert.equal(all[0].price, 10.99);
});

test('erasing records keeps business details and invoice numbering', () => {
  const data = { v: 2, cur: '$', n: 50, nextInvoice: 7, biz: { name: 'Shop' }, products: [{}], orders: [{}], expenses: [{}] };
  const cleared = L.clearRecords(data);
  assert.deepEqual([cleared.products, cleared.orders, cleared.expenses], [[], [], []]);
  assert.equal(cleared.biz.name, 'Shop');
  assert.equal(cleared.nextInvoice, 7);
  assert.equal(cleared.cur, '$');
});

test('customers are grouped by email, else by name', () => {
  const cs = L.summarizeCustomers([
    order({ cust: 'Ann', email: 'ann@x.com', items: [item(1, 1, 10, 4)] }),
    order({ cust: 'Annie', email: 'ANN@x.com', status: 'Paid', date: '2026-11-12', items: [item(1, 2, 10, 4)] }),
    order({ cust: 'Bob', status: 'Cancelled', items: [item(1, 1, 10, 4)] }),
    order({ items: [item(1, 1, 5, 1)] })
  ]);
  assert.equal(cs.length, 2); // Bob only has a cancelled order
  const ann = cs.find(c => c.key === 'ann@x.com');
  assert.equal(ann.name, 'Ann');
  assert.equal(ann.orderCount, 2);
  assert.equal(ann.spent, 30);
  assert.equal(ann.awaitingPayment, 10);
  assert.equal(ann.lastOrder, '2026-11-12');
  assert.equal(cs.find(c => c.key === 'walk-in').name, 'Walk-in customer');
  assert.equal(L.matchCustomer(cs, 'zzz', 'Ann@X.com'), ann);
  assert.equal(L.matchCustomer(cs, '', ''), null);
  assert.deepEqual(L.favouriteProducts(ann), [{ name: 'P1', units: 3 }]);
});
