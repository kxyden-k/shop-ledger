// Business rules: money, stock and customer calculations.
// No DOM and no window.api in here, so everything also runs in the Node tests (test/ledger.test.js).
//
// Saved data keeps short field names. They are in every user's data.json, so renaming one needs a
// migration in db.js.
//   top level   {products, orders, expenses, cur, n, nextInvoice, biz, v}
//                 cur: currency symbol, n: next id, v: schema version
//   product     {id, sku, name, cost, price, stock, reorder, h}
//                 h: price history, [{d: date, o: old price}]
//   order       {id, no, date, cust, email, invoiceNo, fee, status, items}
//   order item  {pid, n, q, p, c}
//                 product id, name, quantity, unit price, unit cost (name and cost are copied when sold)
//   expense     {id, date, desc, amt}

const ORDER_STATUSES = ['Pending', 'Paid', 'Shipped', 'Completed', 'Cancelled'];
const DAY_MS = 864e5;

const sumOf = (list, valueOf) => list.reduce((total, x) => total + valueOf(x), 0);

// ---- orders ----
// These also work on the "New order" draft, which has the same items and fee fields.
const orderRevenue = order => sumOf(order.items, i => i.q * i.p);
const orderCost = order => sumOf(order.items, i => i.q * i.c);
const orderFee = order => +order.fee || 0;
const orderProfit = order => orderRevenue(order) - orderCost(order) - orderFee(order);
const orderUnits = order => sumOf(order.items, i => i.q);
const isCancelled = order => order.status === 'Cancelled';
const nextOrderNumber = orders => orders.reduce((max, o) => Math.max(max, o.no), 0) + 1;

const isLowStock = product => product.stock <= product.reorder;

// period: 'all' | 'month' (this calendar month) | '30d' (last 30 days)
function isInPeriod(date, period, now = new Date()) {
  if (period === 'all') return true;
  if (period === 'month') return date.slice(0, 7) === now.toISOString().slice(0, 7);
  return (now - new Date(date)) / DAY_MS <= 30;
}

// Profit and loss for a period. Cancelled orders don't count.
function periodSummary(data, period, now = new Date()) {
  const orders = data.orders.filter(o => !isCancelled(o) && isInPeriod(o.date, period, now));
  const expenses = data.expenses.filter(e => isInPeriod(e.date, period, now));
  const revenue = sumOf(orders, orderRevenue);
  const costOfGoods = sumOf(orders, orderCost);
  const fees = sumOf(orders, orderFee);
  const expenseTotal = sumOf(expenses, e => e.amt);
  const grossProfit = revenue - costOfGoods - fees;
  return { orders, revenue, costOfGoods, fees, grossProfit, expenses: expenseTotal, netProfit: grossProfit - expenseTotal };
}

// Units and profit per product name, most profitable first.
function salesByProduct(orders) {
  const byName = {};
  orders.forEach(o => o.items.forEach(i => {
    const s = byName[i.n] = byName[i.n] || { name: i.n, units: 0, profit: 0 };
    s.units += i.q;
    s.profit += i.q * (i.p - i.c);
  }));
  return Object.values(byName).sort((a, b) => b.profit - a.profit);
}

// Revenue and profit per day (or per month), oldest first, at most the last 12.
function revenueByPeriod(orders, byDay) {
  const groups = {};
  orders.forEach(o => {
    const key = byDay ? o.date : o.date.slice(0, 7);
    const g = groups[key] = groups[key] || { key, revenue: 0, profit: 0 };
    g.revenue += orderRevenue(o);
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

function takeStock(products, items) {
  items.forEach(i => { const p = productById(products, i.pid); if (p) p.stock -= i.q; });
}

// Moves stock back when an order is cancelled and out again when it is reopened.
// Returns an error message, or '' when the status was changed.
function changeOrderStatus(products, order, status) {
  const was = order.status;
  if (status === 'Cancelled' && was !== 'Cancelled') {
    order.items.forEach(i => { const p = productById(products, i.pid); if (p) p.stock += i.q; });
  }
  if (was === 'Cancelled' && status !== 'Cancelled') {
    const short = order.items.find(i => { const p = productById(products, i.pid); return !p || p.stock < i.q; });
    if (short) return 'Not enough stock of ' + short.n + ' to reopen this order.';
    takeStock(products, order.items);
  }
  order.status = status;
  return '';
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

// ---- customers ----
// Customers aren't stored; they are worked out from orders. Orders with the same email, or the same
// name when there is no email, belong to one customer. Customers with only cancelled orders are left out.
function summarizeCustomers(orders) {
  const byKey = {};
  orders.forEach(o => {
    const key = (o.email || o.cust || 'walk-in').trim().toLowerCase() || 'walk-in';
    const c = byKey[key] = byKey[key] || {
      key, name: '', email: '', orderCount: 0, spent: 0, profit: 0, awaitingPayment: 0, firstOrder: '', lastOrder: '', orders: []
    };
    if (o.cust && !c.name) c.name = o.cust;
    if (o.email) c.email = o.email;
    c.orders.push(o);
    if (isCancelled(o)) return;
    const revenue = orderRevenue(o);
    c.orderCount++;
    c.spent += revenue;
    c.profit += orderProfit(o);
    if (o.status === 'Pending') c.awaitingPayment += revenue;
    if (!c.firstOrder || o.date < c.firstOrder) c.firstOrder = o.date;
    if (o.date > c.lastOrder) c.lastOrder = o.date;
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

// Empties products, orders and expenses. Business details, currency and invoice numbering stay,
// so an invoice number is never issued twice.
const clearRecords = data => ({ ...data, products: [], orders: [], expenses: [], n: 1 });

if (typeof module !== 'undefined') {
  module.exports = {
    ORDER_STATUSES, orderRevenue, orderCost, orderFee, orderProfit, orderUnits, nextOrderNumber, isLowStock,
    isInPeriod, periodSummary, salesByProduct, revenueByPeriod, countByStatus,
    takeStock, changeOrderStatus, setPrice, changeAllPrices,
    summarizeCustomers, matchCustomer, favouriteProducts, clearRecords
  };
}
