// Business rules: money, stock and customer calculations.
// No DOM and no window.api in here, so everything also runs in the Node tests (test/ledger.test.js).
//
// Saved data keeps short field names. They are in every user's data.json, so renaming one needs a
// migration in db.js.
//   top level   {products, orders, expenses, quotes, credits, suppliers, purchases, moves,
//                cur, n, nextInvoice, nextQuote, nextCredit, nextPurchase, nextBuild, biz, v}
//                 cur: currency symbol, n: next id, v: schema version
//   product     {id, sku, name, cost, price, stock, reorder, h, unit, bom}
//                 h: price history, [{d: date, o: old price}]
//                 unit: optional, e.g. 'kg'; stock and quantities may have decimals
//                 bom: optional bill of materials, what goes into ONE of it: [{pid, q}]
//   order       {id, no, date, cust, email, invoiceNo, fee, status, items, tax, payments}
//                 tax: {rate, incl} as it was when the order was made
//                 payments: [{id, date, amt, method, note}], a negative amt is a refund
//   item        {pid, n, q, p, c}
//                 product id, name, quantity, unit price, unit cost (name and cost are copied when sold)
//   expense     {id, date, desc, amt, cat}
//   quote       {id, no, date, validUntil, cust, email, items, tax, status, orderId}
//   credit      {id, no, date, orderId, orderNo, cust, email, items, tax, reason, restock}
//                 items also carry line: the index of the order item they credit
//   supplier    {id, name, email, phone, notes}
//   purchase    {id, no, date, supplierId, supplier, status, items, receivedOn}   items: {pid, n, q, c}
//   move        {id, date, pid, q, why, ref}   one stock change; q is signed

const ORDER_STATUSES = ['Pending', 'Paid', 'Shipped', 'Completed', 'Cancelled'];
const PAYMENT_METHODS = ['Cash', 'Card', 'Bank transfer', 'Other'];
const DAY_MS = 864e5;
const QUOTE_VALID_DAYS = 30;

const sumOf = (list, valueOf) => list.reduce((total, x) => total + valueOf(x), 0);
const round2 = v => Math.round(v * 100) / 100;
// Quantities can be weights (2.35 kg), so they keep three decimals and lose floating-point dust.
const roundQty = v => Math.round(v * 1000) / 1000;
const fmtMoney = (cur, v) => (v < 0 ? '−' : '') + cur + Math.abs(+v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const docNumber = (prefix, n) => prefix + String(n).padStart(4, '0');
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);

// ---- orders ----
// These also work on quotes, credit notes and the "New order" draft, which all have items.
// Tax rule for every figure in the app:
//   how the business is doing (sales, profit, margins, charts, reports): excluding tax, because tax
//   collected belongs to the tax authority, not the shop
//   what a customer is charged or owes (order totals, balances, invoices): including tax
// orderRevenue is the item prices as charged, which include tax when the shop's prices do.
const orderRevenue = order => sumOf(order.items, i => i.q * i.p);
const orderCost = order => sumOf(order.items, i => i.q * i.c);
const orderFee = order => +order.fee || 0;
// An amount at the shop's prices with any tax inside it taken out. tax: {rate, incl} (see currentTax).
const netOfTax = (amount, tax) => tax && tax.incl && tax.rate > 0 ? amount / (1 + tax.rate / 100) : amount;
// Sales excluding tax. For orders without tax rules (a draft not yet saved) it equals orderRevenue.
const orderSales = order => orderTotals(order).net;
const orderProfit = order => orderSales(order) - orderCost(order) - orderFee(order);
const orderUnits = order => sumOf(order.items, i => i.q);
const isCancelled = order => order.status === 'Cancelled';
const nextOrderNumber = orders => orders.reduce((max, o) => Math.max(max, o.no), 0) + 1;
const itemSummary = order => order.items.map(i => i.q + ' × ' + i.n).join(', ');
const currentTax = data => ({ rate: +data.biz.taxRate || 0, incl: !!data.biz.taxIncl });

// What the customer is charged: {net, tax, total, rate}. Tax is either added on top of the item
// prices or already inside them. Order fees are the shop's own costs and are never billed.
function orderTotals(order) {
  const amount = orderRevenue(order), rate = +(order.tax && order.tax.rate) || 0;
  if (rate <= 0) return { net: amount, tax: 0, total: amount, rate: 0 };
  if (order.tax.incl) { const tax = amount * rate / (100 + rate); return { net: amount - tax, tax, total: amount, rate }; }
  const tax = amount * rate / 100;
  return { net: amount, tax, total: amount + tax, rate };
}

const isLowStock = product => product.stock <= product.reorder;

// period: 'all' | 'month' (this calendar month) | '30d' (last 30 days)
function isInPeriod(date, period, now = new Date()) {
  if (period === 'all') return true;
  if (period === 'month') return date.slice(0, 7) === now.toISOString().slice(0, 7);
  return (now - new Date(date)) / DAY_MS <= 30;
}
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);

// ---- sales figures ----
// A credit note counts as a sale in reverse: negative quantities on the day it was issued.
// If the goods were not put back in stock their cost is not recovered.
const creditAsSale = credit => ({
  date: credit.date, cust: credit.cust, email: credit.email, fee: 0, tax: credit.tax, isCredit: true,
  items: credit.items.map(i => ({ ...i, q: -i.q, c: credit.restock ? i.c : 0 }))
});

// Everything that counts towards sales in a date test: live orders plus credit notes.
function salesEntries(data, dateOk) {
  return [
    ...data.orders.filter(o => !isCancelled(o) && dateOk(o.date)),
    ...(data.credits || []).filter(c => dateOk(c.date)).map(creditAsSale)
  ];
}

// Profit and loss for a period. Cancelled orders don't count; credit notes reduce sales.
function periodSummary(data, period, now = new Date()) {
  const dateOk = date => isInPeriod(date, period, now);
  const entries = salesEntries(data, dateOk);
  const orders = entries.filter(e => !e.isCredit);
  const expenses = data.expenses.filter(e => dateOk(e.date));
  const revenue = sumOf(entries, orderSales);
  const costOfGoods = sumOf(entries, orderCost);
  const fees = sumOf(entries, orderFee);
  const expenseTotal = sumOf(expenses, e => e.amt);
  const grossProfit = revenue - costOfGoods - fees;
  return { orders, entries, revenue, costOfGoods, fees, grossProfit, expenses: expenseTotal, netProfit: grossProfit - expenseTotal };
}

// Units, sales (excluding tax), cost and profit per product name, most profitable first.
function salesByProduct(entries) {
  const byName = {};
  entries.forEach(o => o.items.forEach(i => {
    const s = byName[i.n] = byName[i.n] || { name: i.n, units: 0, revenue: 0, cost: 0, profit: 0 };
    s.units += i.q;
    s.revenue += i.q * netOfTax(i.p, o.tax);
    s.cost += i.q * i.c;
    s.profit += i.q * (netOfTax(i.p, o.tax) - i.c);
  }));
  return Object.values(byName).sort((a, b) => b.profit - a.profit);
}

// Revenue and profit per day (or per month), oldest first, at most the last 12.
function revenueByPeriod(entries, byDay) {
  const groups = {};
  entries.forEach(o => {
    const key = byDay ? o.date : o.date.slice(0, 7);
    const g = groups[key] = groups[key] || { key, revenue: 0, profit: 0 };
    g.revenue += orderSales(o);
    g.profit += orderProfit(o);
  });
  return Object.keys(groups).sort().slice(-12).map(k => groups[k]);
}

function countByStatus(orders) {
  const counts = {};
  orders.forEach(o => counts[o.status] = (counts[o.status] || 0) + 1);
  return counts;
}

// ---- stock and prices ----
const productById = (products, id) => products.find(p => p.id === id);

// Every stock change goes through here so it lands in the product's history.
// why: 'Sale' | 'Order cancelled' | 'Order reopened' | 'Purchase' | 'Return' | 'Adjustment' | 'Opening stock'
//      | 'Built' | 'Used in build' | 'Written off'
function moveStock(data, pid, qty, why, ref, date) {
  const p = productById(data.products, pid);
  qty = roundQty(qty);
  if (!p || !qty) return;
  p.stock = roundQty(p.stock + qty);
  data.moves.push({ id: data.n++, date, pid, q: qty, why, ref });
}

const stockHistory = (data, pid) => data.moves.filter(m => m.pid === pid).reverse();

function setStock(data, product, stock, date) {
  moveStock(data, product.id, stock - product.stock, 'Adjustment', 'Edited by hand', date);
}

function setPrice(product, price, date) {
  if (price !== product.price) (product.h = product.h || []).push({ d: date, o: product.price });
  product.price = price;
}

// Every product, rounded to cents. History is recorded even when the rounded price is unchanged.
function changeAllPrices(products, percentChange, date) {
  products.forEach(p => {
    p.h = p.h || [];
    p.h.push({ d: date, o: p.price });
    p.price = Math.round(p.price * (1 + percentChange / 100) * 100) / 100;
  });
}

// The first item there isn't enough stock for, or undefined. Quantities of the same product are added up.
function stockShortage(products, items) {
  const wanted = {};
  items.forEach(i => wanted[i.pid] = roundQty((wanted[i.pid] || 0) + i.q));
  return items.find(i => { const p = productById(products, i.pid); return !p || p.stock < wanted[i.pid]; });
}

// ---- creating and changing orders ----

// draft: {cust, email, date, fee, items}. Takes the stock and returns the new order.
function createOrder(data, draft, today) {
  const order = {
    id: data.n++, no: nextOrderNumber(data.orders), date: draft.date || today, cust: draft.cust, email: draft.email,
    invoiceNo: null, fee: +draft.fee || 0, status: 'Pending', items: draft.items, tax: currentTax(data), payments: []
  };
  order.items.forEach(i => moveStock(data, i.pid, -i.q, 'Sale', 'Order #' + order.no, order.date));
  data.orders.push(order);
  return order;
}

// Moves stock back when an order is cancelled and out again when it is reopened. Choosing "Paid"
// records whatever is still owed as a payment, so the status and the balance can't disagree.
// Returns an error message, or '' when the status was changed.
function changeOrderStatus(data, order, status, today) {
  const was = order.status, ref = 'Order #' + order.no;
  if (status === 'Cancelled' && was !== 'Cancelled') {
    order.items.forEach(i => moveStock(data, i.pid, i.q, 'Order cancelled', ref, today));
  }
  if (was === 'Cancelled' && status !== 'Cancelled') {
    const short = stockShortage(data.products, order.items);
    if (short) return 'Not enough stock of ' + short.n + ' to reopen this order.';
    order.items.forEach(i => moveStock(data, i.pid, -i.q, 'Order reopened', ref, today));
  }
  order.status = status;
  const owed = orderBalance(data, order);
  if (status === 'Paid' && owed > 0) order.payments.push({ id: data.n++, date: today, amt: owed, method: '', note: 'Marked as paid' });
  return '';
}

// ---- payments ----
const orderPaid = order => sumOf(order.payments || [], p => p.amt);
const creditsOf = (data, order) => (data.credits || []).filter(c => c.orderId === order.id);
const orderCredited = (data, order) => sumOf(creditsOf(data, order), c => orderTotals(c).total);

// What the customer still owes on an order. Negative means they are owed a refund
// (a cancelled or credited order that had already been paid).
function orderBalance(data, order) {
  const charged = isCancelled(order) ? 0 : orderTotals(order).total - orderCredited(data, order);
  return round2(charged - orderPaid(order));
}

// 'Paid' | 'Part paid' | 'Unpaid' | 'Refund due'
function paymentState(data, order) {
  const balance = orderBalance(data, order);
  if (balance < 0) return 'Refund due';
  if (balance === 0) return 'Paid';
  return orderPaid(order) > 0 ? 'Part paid' : 'Unpaid';
}

// payment: {date, amt, method, note}. A negative amount is a refund and is only allowed while a
// refund is due. Returns an error message, or '' when the payment was recorded.
function addPayment(data, order, payment) {
  const amt = round2(+payment.amt || 0), balance = orderBalance(data, order);
  if (!amt) return 'Enter an amount.';
  if (amt > 0 && amt > balance) return balance > 0 ? 'That is more than the ' + fmtMoney(data.cur, balance) + ' still owed.' : 'Nothing is owed on this order.';
  if (amt < 0 && amt < balance) return balance < 0 ? 'That is more than the ' + fmtMoney(data.cur, -balance) + ' refund due.' : 'No refund is due on this order.';
  order.payments.push({ id: data.n++, date: payment.date, amt, method: payment.method || '', note: payment.note || '' });
  if (order.status === 'Pending' && orderBalance(data, order) <= 0) order.status = 'Paid';
  return '';
}

function removePayment(order, paymentId) {
  order.payments = order.payments.filter(p => p.id !== paymentId);
}

// ---- credit notes ----

// Order items with `left`: how many of each line have not been credited yet.
function creditableItems(data, order) {
  const credited = {};
  creditsOf(data, order).forEach(c => c.items.forEach(i => credited[i.line] = (credited[i.line] || 0) + i.q));
  return order.items.map((i, line) => ({ ...i, line, left: roundQty(i.q - (credited[line] || 0)) }));
}

// quantities: how many of each order line to credit, in order-item order.
// Returns {error} or {credit}. With restock, the goods go back on the shelf.
function createCredit(data, order, quantities, { reason, restock, date }) {
  if (isCancelled(order)) return { error: 'A cancelled order cannot be credited.' };
  const lines = creditableItems(data, order);
  const items = [];
  for (const l of lines) {
    const q = roundQty(+quantities[l.line] || 0);
    if (!(q >= 0)) return { error: 'Enter quantities of 0 or more.' };
    if (q > l.left) return { error: 'Only ' + l.left + ' of ' + l.n + ' left to credit.' };
    if (q) items.push({ line: l.line, pid: l.pid, n: l.n, q, p: l.p, c: l.c });
  }
  if (!items.length) return { error: 'Enter a quantity to credit for at least one item.' };
  const credit = {
    id: data.n++, no: docNumber('CN-', data.nextCredit++), date, orderId: order.id, orderNo: order.no,
    cust: order.cust, email: order.email, items, tax: order.tax, reason: reason || '', restock: !!restock
  };
  if (credit.restock) items.forEach(i => moveStock(data, i.pid, i.q, 'Return', credit.no, date));
  data.credits.push(credit);
  return { credit };
}

// ---- quotes ----
// A quote is an order that hasn't happened: no stock is taken until it is converted.

function createQuote(data, draft, today) {
  const date = draft.date || today;
  const quote = {
    id: data.n++, no: docNumber('QUO-', data.nextQuote++), date, validUntil: addDays(date, QUOTE_VALID_DAYS),
    cust: draft.cust, email: draft.email, items: draft.items, tax: currentTax(data), status: 'Open', orderId: null
  };
  data.quotes.push(quote);
  return quote;
}

// 'Open' | 'Expired' | 'Accepted' | 'Declined'
const quoteStatus = (quote, today) => quote.status === 'Open' && quote.validUntil < today ? 'Expired' : quote.status;

// Turns an accepted quote into an order at the quoted prices. Costs are taken fresh from the products.
// Returns {error} or {order}.
function convertQuote(data, quote, today) {
  if (quote.status !== 'Open') return { error: 'This quote has already been ' + quote.status.toLowerCase() + '.' };
  const short = stockShortage(data.products, quote.items);
  if (short) return { error: 'Not enough stock of ' + short.n + ' to turn this quote into an order.' };
  const items = quote.items.map(i => ({ ...i, c: productById(data.products, i.pid).cost }));
  const order = createOrder(data, { cust: quote.cust, email: quote.email, date: today, fee: 0, items }, today);
  quote.status = 'Accepted';
  quote.orderId = order.id;
  return { order };
}

// ---- suppliers and purchase orders ----
const purchaseTotal = purchase => sumOf(purchase.items, i => i.q * i.c);

// draft: {supplierId, date, items: [{pid, n, q, c}]}
function createPurchase(data, draft, today) {
  const supplier = data.suppliers.find(s => s.id === draft.supplierId);
  const purchase = {
    id: data.n++, no: docNumber('PO-', data.nextPurchase++), date: draft.date || today,
    supplierId: draft.supplierId, supplier: supplier ? supplier.name : '', status: 'Ordered', items: draft.items, receivedOn: null
  };
  data.purchases.push(purchase);
  return purchase;
}

// Puts the goods into stock. The product's cost becomes the weighted average of what was on the
// shelf and what just arrived, so profit on later sales reflects what the stock really cost.
function receivePurchase(data, purchase, today) {
  if (purchase.status !== 'Ordered') return 'This purchase order is already ' + purchase.status.toLowerCase() + '.';
  purchase.items.forEach(i => {
    const p = productById(data.products, i.pid);
    if (!p) return;
    p.cost = p.stock > 0 ? round2((p.stock * p.cost + i.q * i.c) / (p.stock + i.q)) : i.c;
    moveStock(data, i.pid, i.q, 'Purchase', purchase.no, today);
  });
  purchase.status = 'Received';
  purchase.receivedOn = today;
  return '';
}

// ---- bills of materials and builds ----
// Like Sage 50: a product's bill of materials says what goes into one of it. Building a quantity is
// a deliberate step: it takes the components out of stock and puts the finished product in. Selling
// never touches the components, so what is on the shelf is what has actually been made.

const bomOf = product => product.bom || [];
const unitText = product => product.unit ? ' ' + product.unit : '';
// What the components of one cost at today's cost prices.
const bomCost = (data, product) => round2(sumOf(bomOf(product), c => c.q * ((productById(data.products, c.pid) || {}).cost || 0)));

// Whether making `product` needs `componentId`, directly or inside another component's recipe.
function bomUses(data, product, componentId, seen = new Set()) {
  if (!product || seen.has(product.id)) return false;
  seen.add(product.id);
  return bomOf(product).some(c => c.pid === componentId || bomUses(data, productById(data.products, c.pid), componentId, seen));
}

// Adds, changes or (with q 0) removes one component. Returns an error message, or '' when done.
function setBomLine(data, product, pid, q) {
  const component = productById(data.products, pid);
  if (!component) return 'Choose a product.';
  if (pid === product.id) return 'A product cannot be made from itself.';
  if (bomUses(data, component, product.id)) return `${component.name} cannot go into ${product.name}, because ${component.name} is made with ${product.name}.`;
  q = roundQty(+q);
  if (!(q >= 0)) return 'Enter a quantity of 0 or more.';
  const lines = bomOf(product);
  if (!q) product.bom = lines.filter(c => c.pid !== pid);
  else if (lines.some(c => c.pid === pid)) product.bom = lines.map(c => c.pid === pid ? { pid, q } : c);
  else product.bom = [...lines, { pid, q }];
  return '';
}

// The most that can be built from the stock on hand, in whole units.
function maxBuildable(data, product) {
  const lines = bomOf(product);
  if (!lines.length) return 0;
  return Math.max(0, Math.min(...lines.map(c => {
    const p = productById(data.products, c.pid);
    return p ? Math.floor(roundQty(p.stock / c.q)) : 0;
  })));
}

// Builds qty of a product. Returns {error} or {no, unitCost}. The finished product's cost becomes the
// weighted average of what was already on the shelf and what this build cost, as when stock is bought.
function buildProduct(data, product, qty, date) {
  qty = roundQty(+qty);
  const lines = bomOf(product);
  if (!lines.length) return { error: product.name + ' has no bill of materials yet. Add what goes into one first.' };
  if (!(qty > 0)) return { error: 'Enter how many to make.' };
  const needs = lines.map(c => ({ p: productById(data.products, c.pid), need: roundQty(c.q * qty) }));
  if (needs.some(x => !x.p)) return { error: 'A component has been deleted. Remove it from the bill of materials first.' };
  const short = needs.find(x => x.p.stock < x.need);
  if (short) {
    const most = maxBuildable(data, product);
    return { error: `Not enough ${short.p.name}: making ${qty} needs ${short.need}${unitText(short.p)} and you have ${short.p.stock}. `
      + (most > 0 ? `You can make ${most} at most.` : 'Buy or make more first.') };
  }
  const no = docNumber('B-', data.nextBuild || 1);
  data.nextBuild = (data.nextBuild || 1) + 1;
  const unitCost = bomCost(data, product);
  needs.forEach(x => moveStock(data, x.p.id, -x.need, 'Used in build', `${no}: ${qty} × ${product.name}`, date));
  product.cost = product.stock > 0 ? round2((product.stock * product.cost + qty * unitCost) / (product.stock + qty)) : unitCost;
  moveStock(data, product.id, qty, 'Built', no, date);
  return { no, unitCost };
}

// Takes damaged, expired or unsold stock off the shelf. Its value at cost is recorded as an expense
// in the 'Stock written off' category, so profit shows the loss, as a write-off does in Sage.
const WRITE_OFF_CATEGORY = 'Stock written off';
function writeOffStock(data, product, qty, reason, date) {
  qty = roundQty(+qty);
  if (!(qty > 0)) return 'Enter how much to write off.';
  if (qty > product.stock) return `You only have ${product.stock}${unitText(product)} of ${product.name}.`;
  reason = (reason || '').trim() || 'Written off';
  moveStock(data, product.id, -qty, 'Written off', reason, date);
  const value = round2(qty * product.cost);
  if (value > 0) data.expenses.push({ id: data.n++, date, desc: `${qty}${unitText(product)} × ${product.name}: ${reason}`, amt: value, cat: WRITE_OFF_CATEGORY });
  return '';
}

// Products whose bill of materials uses this one, for warnings before it is deleted.
const usedIn = (data, pid) => data.products.filter(p => bomOf(p).some(c => c.pid === pid));

// ---- customers ----
// Customers aren't stored; they are worked out from orders. Orders with the same email, or the same
// name when there is no email, belong to one customer. Customers with only cancelled orders are left out.
const customerKey = order => (order.email || order.cust || 'walk-in').trim().toLowerCase() || 'walk-in';

function summarizeCustomers(data) {
  const byKey = {}, keyOfOrder = {};
  data.orders.forEach(o => {
    const key = keyOfOrder[o.id] = customerKey(o);
    const c = byKey[key] = byKey[key] || {
      key, name: '', email: '', orderCount: 0, spent: 0, profit: 0, awaitingPayment: 0, balance: 0, firstOrder: '', lastOrder: '', orders: []
    };
    if (o.cust && !c.name) c.name = o.cust;
    if (o.email) c.email = o.email;
    c.orders.push(o);
    const balance = orderBalance(data, o);
    c.balance = round2(c.balance + balance);
    if (isCancelled(o)) return;
    c.orderCount++;
    c.spent += orderSales(o);
    c.profit += orderProfit(o);
    if (balance > 0) c.awaitingPayment = round2(c.awaitingPayment + balance);
    if (!c.firstOrder || o.date < c.firstOrder) c.firstOrder = o.date;
    if (o.date > c.lastOrder) c.lastOrder = o.date;
  });
  (data.credits || []).forEach(credit => {
    const c = byKey[keyOfOrder[credit.orderId]];
    if (!c) return;
    const sale = creditAsSale(credit);
    c.spent += orderSales(sale);
    c.profit += orderProfit(sale);
  });
  return Object.values(byKey)
    .filter(c => c.orderCount)
    .map(c => { c.name = c.name || c.email || 'Walk-in customer'; return c; });
}

// The customer a name or email belongs to. Email wins when both are given.
function matchCustomer(customers, name, email) {
  const n = name.trim().toLowerCase(), e = email.trim().toLowerCase();
  if (!n && !e) return null;
  return customers.find(c => e ? c.email.toLowerCase() === e : c.name.toLowerCase() === n) || null;
}

// Products a customer buys most, as [{name, units}].
function favouriteProducts(customer, limit = 3) {
  const units = {};
  customer.orders.filter(o => !isCancelled(o)).forEach(o => o.items.forEach(i => units[i.n] = (units[i.n] || 0) + i.q));
  return Object.entries(units).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, n]) => ({ name, units: n }));
}

// Who owes money and for how long, by the age of each unpaid order: [{name, email, key, d0, d30, d60, d90, total}]
// d0: up to 30 days old, d30: 31 to 60, d60: 61 to 90, d90: older.
function agedDebtors(data, today) {
  return summarizeCustomers(data).map(c => {
    const row = { key: c.key, name: c.name, email: c.email, d0: 0, d30: 0, d60: 0, d90: 0, total: 0 };
    c.orders.forEach(o => {
      const owed = orderBalance(data, o);
      if (owed <= 0) return;
      const age = Math.floor((new Date(today) - new Date(o.date)) / DAY_MS);
      const bucket = age <= 30 ? 'd0' : age <= 60 ? 'd30' : age <= 90 ? 'd60' : 'd90';
      row[bucket] = round2(row[bucket] + owed);
      row.total = round2(row.total + owed);
    });
    return row;
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
}

// A customer's account: every invoice, credit note and payment in date order with a running balance.
// Activity before `from` is rolled into the opening balance. Returns {opening, lines, closing}.
function customerStatement(data, customer, from = '') {
  const events = [];
  customer.orders.forEach(o => {
    if (!isCancelled(o)) events.push({ date: o.date, sort: 0, text: (o.invoiceNo ? 'Invoice ' + o.invoiceNo : 'Order #' + o.no), amount: orderTotals(o).total });
    creditsOf(data, o).forEach(c => events.push({ date: c.date, sort: 1, text: 'Credit note ' + c.no, amount: -orderTotals(c).total }));
    (o.payments || []).forEach(p => events.push({
      date: p.date, sort: 2, amount: -p.amt,
      text: (p.amt < 0 ? 'Refund' : 'Payment') + (p.method ? ' (' + p.method + ')' : '') + ' for ' + (o.invoiceNo || 'order #' + o.no)
    }));
  });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.sort - b.sort);
  let balance = 0, opening = 0;
  const lines = [];
  events.forEach(e => {
    balance = round2(balance + e.amount);
    if (from && e.date < from) opening = balance;
    else lines.push({ date: e.date, text: e.text, amount: round2(e.amount), balance });
  });
  return { opening, lines, closing: balance };
}

// Empties all records. Business details, currency and document numbering stay,
// so an invoice number is never issued twice.
const clearRecords = data => ({ ...data, products: [], orders: [], expenses: [], quotes: [], credits: [], suppliers: [], purchases: [], moves: [], n: 1 });

if (typeof module !== 'undefined') {
  module.exports = {
    ORDER_STATUSES, PAYMENT_METHODS, DAY_MS, QUOTE_VALID_DAYS, sumOf, round2, fmtMoney, docNumber, addDays,
    orderRevenue, orderCost, orderFee, netOfTax, orderSales, orderProfit, orderUnits, isCancelled, nextOrderNumber, itemSummary, currentTax, orderTotals,
    isLowStock, isInPeriod, inRange, creditAsSale, salesEntries, periodSummary, salesByProduct, revenueByPeriod, countByStatus,
    productById, moveStock, stockHistory, setStock, setPrice, changeAllPrices, stockShortage,
    createOrder, changeOrderStatus, orderPaid, creditsOf, orderCredited, orderBalance, paymentState, addPayment, removePayment,
    creditableItems, createCredit, createQuote, quoteStatus, convertQuote, purchaseTotal, createPurchase, receivePurchase,
    roundQty, bomOf, unitText, bomCost, bomUses, setBomLine, maxBuildable, buildProduct, WRITE_OFF_CATEGORY, writeOffStock, usedIn,
    customerKey, summarizeCustomers, matchCustomer, favouriteProducts, agedDebtors, customerStatement, clearRecords
  };
}
