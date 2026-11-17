const test = require('node:test'), assert = require('node:assert');
const L = require('../renderer/js/ledger');

const TODAY = '2026-11-16';
const item = (pid, q, p, c, n = 'P' + pid) => ({ pid, n, q, p, c });
const order = (o) => ({ id: 1, no: 1, date: '2026-11-10', cust: '', email: '', fee: 0, status: 'Pending', items: [], payments: [], ...o });
// A small shop: two products, no tax unless a test sets it.
const shop = (over = {}) => ({
  v: 3, cur: 'R', n: 100, nextInvoice: 1, nextQuote: 1, nextCredit: 1, nextPurchase: 1,
  biz: { name: 'Shop', taxRate: 0, taxIncl: false },
  products: [{ id: 1, name: 'Mug', cost: 4, price: 10, stock: 10, reorder: 2 }, { id: 2, name: 'Tea', cost: 1, price: 3, stock: 5, reorder: 1 }],
  orders: [], expenses: [], quotes: [], credits: [], suppliers: [{ id: 50, name: 'Acme' }], purchases: [], moves: [], ...over
});
const sell = (data, items, extra = {}) => L.createOrder(data, { cust: 'Ann', email: 'ann@x.com', date: '2026-11-10', fee: 0, items, ...extra }, TODAY);

test('order revenue, cost and profit include the fee', () => {
  const o = order({ fee: '5', items: [item(1, 2, 10, 4), item(2, 1, 3, 1)] });
  assert.equal(L.orderRevenue(o), 23);
  assert.equal(L.orderCost(o), 9);
  assert.equal(L.orderProfit(o), 9);
  assert.equal(L.orderUnits(o), 3);
  assert.equal(L.orderFee(order({ fee: '' })), 0);
});

test('tax is added on top, carved out, or absent', () => {
  const items = [item(1, 2, 100, 40)];
  const added = L.orderTotals({ items, tax: { rate: 15, incl: false } });
  assert.deepEqual([added.net, added.tax, added.total], [200, 30, 230]);
  const inside = L.orderTotals({ items, tax: { rate: 15, incl: true } });
  assert.equal(inside.total, 200); assert.ok(Math.abs(inside.tax - 26.0869565) < 1e-5);
  assert.equal(L.orderTotals({ items }).total, 200);
});

test('sales and profit leave out tax that is included in prices', () => {
  const incl = { items: [item(1, 2, 115, 40)], fee: 5, tax: { rate: 15, incl: true } };
  assert.equal(L.orderRevenue(incl), 230);             // what the customer is charged
  assert.ok(Math.abs(L.orderSales(incl) - 200) < 1e-9); // what the shop keeps
  assert.ok(Math.abs(L.orderProfit(incl) - 115) < 1e-9); // 200 − 80 goods − 5 fee
  const onTop = { items: [item(1, 2, 100, 40)], tax: { rate: 15, incl: false } };
  assert.equal(L.orderSales(onTop), 200);               // tax added on top is never sales
  assert.equal(L.orderProfit(onTop), 120);
  assert.ok(Math.abs(L.netOfTax(115, { rate: 15, incl: true }) - 100) < 1e-9);
  assert.equal(L.netOfTax(115, { rate: 15, incl: false }), 115);

  const data = shop({ biz: { taxRate: 15, taxIncl: true } });
  sell(data, [item(1, 2, 115, 40)]);
  const s = L.periodSummary(data, 'all', new Date(TODAY));
  assert.ok(Math.abs(s.revenue - 200) < 1e-9);
  assert.ok(Math.abs(s.grossProfit - 120) < 1e-9);
  const [mug] = L.salesByProduct(s.entries);
  assert.ok(Math.abs(mug.revenue - 200) < 1e-9 && Math.abs(mug.profit - 120) < 1e-9);
  const [ann] = L.summarizeCustomers(data);
  assert.ok(Math.abs(ann.spent - 200) < 1e-9);
  assert.equal(ann.awaitingPayment, 230); // what they owe still includes the tax
});

test('periods: all, this month, last 30 days', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.ok(L.isInPeriod('2020-01-01', 'all', now));
  assert.ok(L.isInPeriod('2026-11-01', 'month', now));
  assert.ok(!L.isInPeriod('2026-10-31', 'month', now));
  assert.ok(L.isInPeriod('2026-10-20', '30d', now));
  assert.ok(!L.isInPeriod('2026-10-10', '30d', now));
});

test('saving an order takes stock and logs it; the order remembers the tax rules', () => {
  const data = shop({ biz: { taxRate: 15, taxIncl: false } });
  const o = sell(data, [item(1, 3, 10, 4)]);
  assert.equal(data.products[0].stock, 7);
  assert.deepEqual(o.tax, { rate: 15, incl: false });
  assert.deepEqual(o.payments, []);
  const move = data.moves[0];
  assert.deepEqual([move.pid, move.q, move.why, move.ref], [1, -3, 'Sale', 'Order #1']);
});

test('period summary skips cancelled orders and subtracts expenses', () => {
  const data = shop({
    orders: [order({ fee: 2, items: [item(1, 1, 10, 4)] }), order({ id: 2, status: 'Cancelled', items: [item(1, 5, 10, 4)] })],
    expenses: [{ amt: 3, date: '2026-11-01' }]
  });
  const s = L.periodSummary(data, 'all');
  assert.equal(s.orders.length, 1);
  assert.equal(s.grossProfit, 4);
  assert.equal(s.netProfit, 1);
});

test('cancelling returns stock; reopening takes it again unless short', () => {
  const data = shop();
  const o = sell(data, [item(1, 2, 10, 4)]);
  assert.equal(L.changeOrderStatus(data, o, 'Cancelled', TODAY), '');
  assert.equal(data.products[0].stock, 10);
  data.products[0].stock = 1;
  assert.match(L.changeOrderStatus(data, o, 'Shipped', TODAY), /Not enough stock of P1/);
  assert.equal(o.status, 'Cancelled');
  data.products[0].stock = 2;
  assert.equal(L.changeOrderStatus(data, o, 'Shipped', TODAY), '');
  assert.equal(data.products[0].stock, 0);
  assert.deepEqual(data.moves.map(m => m.why), ['Sale', 'Order cancelled', 'Order reopened']);
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

test('editing stock by hand is logged as an adjustment', () => {
  const data = shop();
  L.setStock(data, data.products[0], 6, TODAY);
  assert.equal(data.products[0].stock, 6);
  assert.deepEqual([data.moves[0].q, data.moves[0].why], [-4, 'Adjustment']);
  L.setStock(data, data.products[0], 6, TODAY);
  assert.equal(data.moves.length, 1); // no change, nothing logged
  assert.equal(L.stockHistory(data, 1).length, 1);
});

test('payments: part payment, full payment, overpayment refused', () => {
  const data = shop();
  const o = sell(data, [item(1, 2, 10, 4)]); // owes 20
  assert.equal(L.paymentState(data, o), 'Unpaid');
  assert.equal(L.addPayment(data, o, { date: TODAY, amt: 5, method: 'Cash' }), '');
  assert.equal(L.orderBalance(data, o), 15);
  assert.equal(L.paymentState(data, o), 'Part paid');
  assert.equal(o.status, 'Pending');
  assert.match(L.addPayment(data, o, { date: TODAY, amt: 16 }), /more than the R15.00 still owed/);
  assert.match(L.addPayment(data, o, { date: TODAY, amt: 0 }), /Enter an amount/);
  assert.equal(L.addPayment(data, o, { date: TODAY, amt: 15, method: 'Card' }), '');
  assert.equal(L.paymentState(data, o), 'Paid');
  assert.equal(o.status, 'Paid'); // a pending order moves on by itself once settled
  assert.match(L.addPayment(data, o, { date: TODAY, amt: 1 }), /Nothing is owed/);
  L.removePayment(o, o.payments[0].id);
  assert.equal(L.orderBalance(data, o), 5);
});

test('payments include tax added on top', () => {
  const data = shop({ biz: { taxRate: 15, taxIncl: false } });
  const o = sell(data, [item(1, 2, 10, 4)]);
  assert.equal(L.orderBalance(data, o), 23);
});

test('choosing the Paid status records what is still owed', () => {
  const data = shop();
  const o = sell(data, [item(1, 2, 10, 4)]);
  L.addPayment(data, o, { date: TODAY, amt: 5 });
  L.changeOrderStatus(data, o, 'Paid', TODAY);
  assert.equal(L.orderBalance(data, o), 0);
  assert.equal(o.payments[1].amt, 15);
});

test('cancelling a paid order leaves a refund due, settled by a negative payment', () => {
  const data = shop();
  const o = sell(data, [item(1, 2, 10, 4)]);
  L.addPayment(data, o, { date: TODAY, amt: 20 });
  L.changeOrderStatus(data, o, 'Cancelled', TODAY);
  assert.equal(L.orderBalance(data, o), -20);
  assert.equal(L.paymentState(data, o), 'Refund due');
  assert.match(L.addPayment(data, o, { date: TODAY, amt: -25 }), /more than the R20.00 refund due/);
  assert.equal(L.addPayment(data, o, { date: TODAY, amt: -20 }), '');
  assert.equal(L.orderBalance(data, o), 0);
});

test('credit notes reduce what is owed and sales, and can restock', () => {
  const data = shop();
  const o = sell(data, [item(1, 3, 10, 4), item(2, 1, 3, 1)]); // 33 owed, mug stock 7
  assert.match(L.createCredit(data, o, [0, 0], { date: TODAY }).error, /at least one item/);
  assert.match(L.createCredit(data, o, [4, 0], { date: TODAY }).error, /Only 3 of P1/);
  const { credit } = L.createCredit(data, o, [2, 0], { reason: 'Broken', restock: true, date: TODAY });
  assert.equal(credit.no, 'CN-0001');
  assert.equal(data.products[0].stock, 9);
  assert.equal(L.orderBalance(data, o), 13);
  assert.equal(L.creditableItems(data, o)[0].left, 1);
  assert.match(L.createCredit(data, o, [2, 0], { date: TODAY }).error, /Only 1 of P1/);
  const s = L.periodSummary(data, 'all', new Date(TODAY));
  assert.equal(s.revenue, 13);
  assert.equal(s.costOfGoods, 5); // 13 sold cost, less 8 for the two mugs that came back
  assert.equal(s.orders.length, 1);
  assert.equal(L.salesByProduct(s.entries).find(p => p.name === 'P1').units, 1);
});

test('a credit note without restocking loses the cost of the goods', () => {
  const data = shop();
  const o = sell(data, [item(1, 2, 10, 4)]);
  L.createCredit(data, o, [1], { restock: false, date: TODAY });
  assert.equal(data.products[0].stock, 8);
  const s = L.periodSummary(data, 'all', new Date(TODAY));
  assert.deepEqual([s.revenue, s.costOfGoods], [10, 8]);
});

test('quotes do not touch stock until converted', () => {
  const data = shop();
  const q = L.createQuote(data, { cust: 'Bob', email: '', date: '2026-11-01', items: [item(1, 4, 9, 0)] }, TODAY);
  assert.equal(q.no, 'QUO-0001');
  assert.equal(q.validUntil, '2026-12-01');
  assert.equal(data.products[0].stock, 10);
  assert.equal(L.quoteStatus(q, '2026-11-20'), 'Open');
  assert.equal(L.quoteStatus(q, '2026-12-02'), 'Expired');
  data.products[0].stock = 3;
  assert.match(L.convertQuote(data, q, TODAY).error, /Not enough stock of P1/);
  data.products[0].stock = 10;
  const { order: o } = L.convertQuote(data, q, TODAY);
  assert.equal(data.products[0].stock, 6);
  assert.deepEqual([o.cust, o.items[0].p, o.items[0].c], ['Bob', 9, 4]); // quoted price, current cost
  assert.deepEqual([q.status, q.orderId], ['Accepted', o.id]);
  assert.match(L.convertQuote(data, q, TODAY).error, /already been accepted/);
});

test('receiving a purchase order adds stock at the weighted average cost', () => {
  const data = shop();
  const po = L.createPurchase(data, { supplierId: 50, date: TODAY, items: [{ pid: 1, n: 'Mug', q: 10, c: 6 }, { pid: 2, n: 'Tea', q: 5, c: 2 }] }, TODAY);
  assert.deepEqual([po.no, po.supplier, po.status, L.purchaseTotal(po)], ['PO-0001', 'Acme', 'Ordered', 70]);
  assert.equal(data.products[0].stock, 10);
  data.products[1].stock = 0; // nothing on the shelf: the new cost is simply the purchase cost
  assert.equal(L.receivePurchase(data, po, TODAY), '');
  assert.deepEqual([data.products[0].stock, data.products[0].cost], [20, 5]);
  assert.deepEqual([data.products[1].stock, data.products[1].cost], [5, 2]);
  assert.equal(po.status, 'Received');
  assert.match(L.receivePurchase(data, po, TODAY), /already received/);
  assert.equal(data.moves.filter(m => m.why === 'Purchase').length, 2);
});

test('customers are grouped by email, else by name, with what they owe', () => {
  const data = shop({
    orders: [
      order({ id: 1, cust: 'Ann', email: 'ann@x.com', items: [item(1, 1, 10, 4)] }),
      order({ id: 2, cust: 'Annie', email: 'ANN@x.com', status: 'Paid', date: '2026-11-12', items: [item(1, 2, 10, 4)], payments: [{ id: 9, date: '2026-11-12', amt: 20 }] }),
      order({ id: 3, cust: 'Bob', status: 'Cancelled', items: [item(1, 1, 10, 4)] }),
      order({ id: 4, items: [item(1, 1, 5, 1)], payments: [{ id: 8, date: '2026-11-10', amt: 5 }] })
    ]
  });
  const cs = L.summarizeCustomers(data);
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

test('aged debtors put each unpaid order in the right age band', () => {
  const data = shop({
    orders: [
      order({ id: 1, cust: 'Ann', date: '2026-11-10', items: [item(1, 1, 10, 4)] }),
      order({ id: 2, cust: 'Ann', date: '2026-09-20', items: [item(1, 2, 10, 4)], payments: [{ id: 9, date: '2026-10-01', amt: 5 }] }),
      order({ id: 3, cust: 'Bob', date: '2026-01-01', items: [item(1, 1, 10, 4)] }),
      order({ id: 4, cust: 'Cat', date: '2026-11-01', status: 'Paid', items: [item(1, 1, 10, 4)], payments: [{ id: 8, date: '2026-11-01', amt: 10 }] })
    ]
  });
  const rows = L.agedDebtors(data, TODAY);
  assert.deepEqual(rows.map(r => r.name), ['Ann', 'Bob']);
  assert.deepEqual([rows[0].d0, rows[0].d30, rows[0].total], [10, 15, 25]);
  assert.equal(rows[1].d90, 10);
});

test('statement runs a balance through invoices, credits and payments', () => {
  const data = shop();
  const o = sell(data, [item(1, 3, 10, 4)], { date: '2026-10-01' });
  o.invoiceNo = 'INV-0001';
  L.addPayment(data, o, { date: '2026-10-05', amt: 10, method: 'Cash' });
  L.createCredit(data, o, [1], { restock: true, date: '2026-11-02' });
  const ann = L.summarizeCustomers(data)[0];
  const all = L.customerStatement(data, ann);
  assert.deepEqual(all.lines.map(l => [l.text, l.amount, l.balance]), [
    ['Invoice INV-0001', 30, 30], ['Payment (Cash) for INV-0001', -10, 20], ['Credit note CN-0001', -10, 10]
  ]);
  assert.equal(all.closing, 10);
  const recent = L.customerStatement(data, ann, '2026-11-01');
  assert.equal(recent.opening, 20);
  assert.equal(recent.lines.length, 1);
  assert.equal(recent.closing, 10);
});

test('erasing records keeps business details and document numbering', () => {
  const data = shop({ nextInvoice: 7, nextQuote: 3, products: [{}], orders: [{}], expenses: [{}], quotes: [{}], moves: [{}] });
  const cleared = L.clearRecords(data);
  assert.deepEqual([cleared.products, cleared.orders, cleared.expenses, cleared.quotes, cleared.credits, cleared.suppliers, cleared.purchases, cleared.moves], [[], [], [], [], [], [], [], []]);
  assert.equal(cleared.biz.name, 'Shop');
  assert.deepEqual([cleared.nextInvoice, cleared.nextQuote, cleared.cur], [7, 3, 'R']);
});
