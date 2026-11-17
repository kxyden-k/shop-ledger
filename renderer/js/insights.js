// Accounting ratios and recommendations, for the Insights tab and the "Key ratios" report.
// Pure functions on the saved data (shape described in ledger.js), so they run in the Node tests.
//
// Every figure uses sales excluding tax, so ratios mean the same whether prices include tax or not.
// Recommendations are plain rules over the ratios: each one says which numbers triggered it.

if (typeof require !== 'undefined') Object.assign(globalThis, require('./ledger'));

// The owner's targets, kept in data.targets. Anything missing falls back to these.
const DEFAULT_TARGETS = {
  grossMargin: 30,      // % of sales left after the cost of goods and order fees
  netMargin: 10,        // % of sales left after running costs as well
  stockDays: 30,        // days of sales to keep in stock
  debtorDays: 30,       // most days of sales that should be waiting to be paid
  overdueDays: 60,      // an unpaid order older than this is overdue
  deadStockDays: 90,    // stock with no sale for this long counts as not selling
  topCustomerShare: 30  // most of your sales that should come from one customer, %
};

// For the targets form: [key, label, unit, min, max]
const TARGET_FIELDS = [
  ['grossMargin', 'Gross margin', '%', 1, 95],
  ['netMargin', 'Net margin', '%', 0, 95],
  ['stockDays', 'Days of stock to keep', 'days', 1, 365],
  ['debtorDays', 'Days customers should take to pay', 'days', 0, 365],
  ['overdueDays', 'A debt is overdue after', 'days', 1, 365],
  ['deadStockDays', 'Stock is not selling after', 'days', 7, 730],
  ['topCustomerShare', 'Most sales from one customer', '%', 1, 100]
];

const targetsOf = data => ({ ...DEFAULT_TARGETS, ...(data.targets || {}) });

// Checks targets typed into the form. Returns {error} or {targets}.
function cleanTargets(input) {
  const out = {};
  for (const [key, label, unit, min, max] of TARGET_FIELDS) {
    const v = Number(input[key]);
    if (!Number.isFinite(v) || v < min || v > max) return { error: `${label} must be between ${min} and ${max}${unit === '%' ? '%' : ' ' + unit}.` };
    out[key] = v;
  }
  return { targets: out };
}

// db.js writes this note on payments it created when upgrading to payment tracking. Those are dated
// on the order date, so they say nothing about how quickly customers really paid.
const MIGRATED_PAYMENT_NOTE = 'Paid before payments were tracked';
const MONTH_DAYS = 30.44;
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const STATUS_LABEL = { good: 'On target', warn: 'Watch', bad: 'Act on it', '': '' };

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY_MS);
const shiftYear = (date, years) => (+date.slice(0, 4) + years) + date.slice(4);
const pctText = v => v.toFixed(1) + '%';
const higherIsBetter = (v, good, okay) => v == null ? '' : v >= good ? 'good' : v >= okay ? 'warn' : 'bad';
const lowerIsBetter = (v, good, okay) => v == null ? '' : v <= good ? 'good' : v <= okay ? 'warn' : 'bad';

// Sales, costs and expenses between two dates (inclusive). Credit notes count as negative sales.
function figures(data, from, to) {
  const dateOk = d => inRange(d, from, to);
  const entries = salesEntries(data, dateOk);
  const orders = entries.filter(e => !e.isCredit), credits = entries.filter(e => e.isCredit);
  const net = e => orderTotals(e).net;
  const sales = sumOf(entries, net), cogs = sumOf(entries, orderCost), fees = sumOf(entries, orderFee);
  const expenses = sumOf(data.expenses.filter(e => dateOk(e.date)), e => e.amt);
  const gross = sales - cogs - fees;
  return {
    entries, orders, sales, cogs, fees, expenses, gross, net: gross - expenses,
    charged: sumOf(entries, e => orderTotals(e).total), grossSales: sumOf(orders, net), returned: -sumOf(credits, net)
  };
}

// The price that gives a product the target margin, including tax when prices include it. Rounded up to the cent.
function priceForMargin(cost, marginPct, tax) {
  const net = cost / (1 - marginPct / 100);
  const price = tax.rate > 0 && tax.incl ? net * (1 + tax.rate / 100) : net;
  return Math.ceil(price * 100 - 1e-6) / 100;
}

// How each product is doing: units sold in the period, sales rate, days of cover, margin, and
// whether it has stopped selling.
function productActivity(data, from, to, today, t) {
  const tax = currentTax(data), days = daysBetween(from, to) + 1;
  const lastSale = {}, sold = {}, returned = {}, added = {}, onOrder = {};
  data.orders.filter(o => !isCancelled(o)).forEach(o => o.items.forEach(i => {
    if (!lastSale[i.pid] || o.date > lastSale[i.pid]) lastSale[i.pid] = o.date;
    if (inRange(o.date, from, to)) sold[i.pid] = (sold[i.pid] || 0) + i.q;
  }));
  (data.credits || []).filter(c => inRange(c.date, from, to)).forEach(c => c.items.forEach(i => returned[i.pid] = (returned[i.pid] || 0) + i.q));
  // When a product was added is only known for products added from version 2.0 onwards.
  (data.moves || []).filter(m => m.why === 'Opening stock').forEach(m => { if (!added[m.pid] || m.date < added[m.pid]) added[m.pid] = m.date; });
  (data.purchases || []).filter(p => p.status === 'Ordered').forEach(p => p.items.forEach(i => onOrder[i.pid] = (onOrder[i.pid] || 0) + i.q));
  return data.products.map(p => {
    const units = sold[p.id] || 0, rate = units / days;
    const netPrice = tax.rate > 0 && tax.incl ? p.price / (1 + tax.rate / 100) : p.price;
    const quietDays = lastSale[p.id] ? daysBetween(lastSale[p.id], today) : Infinity;
    const age = added[p.id] ? daysBetween(added[p.id], today) : Infinity;
    return {
      p, units, rate, netPrice, tax, onOrder: onOrder[p.id] || 0, returned: returned[p.id] || 0, lastSale: lastSale[p.id] || '',
      cover: rate > 0 ? p.stock / rate : Infinity,
      margin: netPrice > 0 ? (netPrice - p.cost) / netPrice * 100 : null,
      dead: p.stock > 0 && quietDays > t.deadStockDays && age > t.deadStockDays
    };
  });
}

// What each customer owes, how much of it is overdue, and orders where a refund is due.
function debtSummary(data, today, t) {
  const debtors = summarizeCustomers(data).map(c => {
    let owed = 0, overdue = 0, oldest = 0;
    c.orders.forEach(o => {
      const balance = orderBalance(data, o);
      if (balance <= 0) return;
      const age = daysBetween(o.date, today);
      owed += balance;
      if (age > t.overdueDays) { overdue += balance; oldest = Math.max(oldest, age); }
    });
    return { key: c.key, name: c.name, owed: round2(owed), overdue: round2(overdue), oldest };
  }).filter(d => d.owed > 0);
  const refunds = data.orders.map(o => ({ order: o, amount: -orderBalance(data, o) })).filter(r => r.amount > 0);
  return { debtors, refunds };
}

// Average days from an order to the payment that settled it, for settled orders in the period.
function averageDaysToPay(data, from, to) {
  const spans = [];
  data.orders.filter(o => !isCancelled(o) && inRange(o.date, from, to) && orderBalance(data, o) <= 0).forEach(o => {
    const paid = (o.payments || []).filter(p => p.amt > 0 && p.note !== MIGRATED_PAYMENT_NOTE);
    if (!paid.length) return;
    const last = paid.reduce((latest, p) => p.date > latest ? p.date : latest, '');
    spans.push(Math.max(0, daysBetween(o.date, last)));
  });
  return spans.length ? sumOf(spans, d => d) / spans.length : null;
}

// Everything the Insights tab shows, for the period from..to (inclusive, yyyy-mm-dd).
// Returns {from, to, days, orderCount, targets, ratios, recommendations}.
//   ratio: {id, group, label, value, format, status, target, explain}
//     format: 'pct' | 'change' | 'money' | 'moneyMonth' | 'days' | 'times' | 'num'
//     status: 'good' | 'warn' | 'bad' | '' (no target for this one), value null when there isn't enough data
//   recommendation: {id, severity, area, title, detail, action, impact}
//     severity: 'high' | 'medium' | 'low'; impact: rough money at stake, used to order within a severity
//     action: {kind, ref, value, label}, see runInsightAction in screens/insights.mjs
function computeInsights(data, { from, to, today }) {
  const t = targetsOf(data), cur = data.cur, m = v => fmtMoney(cur, v);
  const days = Math.max(1, daysBetween(from, to) + 1);
  const now = figures(data, from, to);
  const before = figures(data, addDays(from, -days), addDays(from, -1));
  const lastYear = figures(data, shiftYear(from, -1), shiftYear(to, -1));
  const products = productActivity(data, from, to, today, t);
  const { debtors, refunds } = debtSummary(data, today, t);
  const stockValue = sumOf(data.products, p => Math.max(0, p.stock) * p.cost);
  const perMonth = v => v / days * MONTH_DAYS;
  const priorLabel = `the ${days} days before`;
  const ratios = [], recs = [];
  const ratio = (group, id, label, value, format, status, target, explain) => ratios.push({ id, group, label, value, format, status, target, explain });
  const recommend = (severity, area, title, detail, action, impact = 0) => recs.push({ id: area + ':' + title, severity, area, title, detail, action, impact });

  // ---- profitability ----
  const share = (part, whole) => whole > 0 ? part / whole * 100 : null;
  const grossMargin = share(now.gross, now.sales), netMargin = share(now.net, now.sales);
  const expenseRatio = share(now.expenses, now.sales), expenseRatioBefore = share(before.expenses, before.sales);
  const monthlyExpenses = perMonth(now.expenses), monthlySales = perMonth(now.sales);
  const breakEven = grossMargin > 0 ? monthlyExpenses / (grossMargin / 100) : null;
  ratio('Profitability', 'grossMargin', 'Gross margin', grossMargin, 'pct', higherIsBetter(grossMargin, t.grossMargin, t.grossMargin / 2), `${t.grossMargin}% or more`,
    'What is left of each sale after the cost of the goods and order fees, before running costs.');
  ratio('Profitability', 'netMargin', 'Net margin', netMargin, 'pct', higherIsBetter(netMargin, t.netMargin, 0), `${t.netMargin}% or more`,
    'What is left after running costs as well: your profit as a share of sales.');
  ratio('Profitability', 'expenseRatio', 'Running costs', expenseRatio, 'pct',
    expenseRatio != null && expenseRatioBefore != null && expenseRatio - expenseRatioBefore > 5 ? 'warn' : '', '',
    'Expenses as a share of sales.' + (expenseRatioBefore != null ? ` ${pctText(expenseRatioBefore)} in ${priorLabel}.` : ''));
  ratio('Profitability', 'markup', 'Average markup', now.cogs > 0 ? (now.sales - now.cogs) / now.cogs * 100 : null, 'pct', '', '',
    'How much you add on top of what the goods cost you.');
  ratio('Profitability', 'breakEven', 'Break-even sales', breakEven, 'moneyMonth',
    breakEven == null ? (now.expenses > 0 && grossMargin != null ? 'bad' : '') : higherIsBetter(monthlySales, breakEven, breakEven * 0.8), `Sales above it`,
    breakEven == null
      ? (now.expenses > 0 && grossMargin != null ? 'At your current margin no amount of sales covers your running costs.' : 'Sales you need each month to cover running costs.')
      : `Sales you need each month to cover running costs at your current margin. You are selling about ${m(monthlySales)} a month.`);

  // ---- stock ----
  const dailyCost = now.cogs / days;
  const stockDays = dailyCost > 0 ? stockValue / dailyCost : null;
  const deadValue = sumOf(products.filter(x => x.dead), x => x.p.stock * x.p.cost);
  const lowCount = data.products.filter(isLowStock).length;
  ratio('Stock', 'stockDays', 'Days of stock on hand', stockDays, 'days',
    stockDays == null ? '' : stockDays > t.stockDays * 4 ? 'bad' : stockDays > t.stockDays * 2 || stockDays < t.stockDays / 2 ? 'warn' : 'good', `About ${t.stockDays} days`,
    `How long your stock (${m(stockValue)} at cost) would last at the rate you are selling.`);
  ratio('Stock', 'turnover', 'Stock turnover', stockValue > 0 && dailyCost > 0 ? dailyCost * 365 / stockValue : null, 'times', '', '',
    'How many times a year you sell through your stock. Higher means less cash sitting on shelves.');
  ratio('Stock', 'deadStock', 'Stock not selling', deadValue, 'money', stockValue > 0 ? lowerIsBetter(deadValue / stockValue * 100, 0, 10) : '', 'None',
    `Value at cost of products with nothing sold in the last ${t.deadStockDays} days.`);
  ratio('Stock', 'lowStock', 'Products at reorder level', lowCount, 'num', lowerIsBetter(lowCount, 0, Infinity), 'None', 'Products at or below the reorder level set on them.');

  // ---- getting paid ----
  const owed = sumOf(debtors, d => d.owed), overdue = sumOf(debtors, d => d.overdue);
  const dailyCharged = now.charged / days;
  const debtorDays = owed === 0 ? 0 : dailyCharged > 0 ? owed / dailyCharged : null;
  const daysToPay = averageDaysToPay(data, from, to);
  ratio('Getting paid', 'debtorDays', 'Debtor days', debtorDays, 'days', lowerIsBetter(debtorDays, t.debtorDays, t.debtorDays * 2), `${t.debtorDays} days or fewer`,
    `How many days of sales are waiting to be paid. ${m(owed)} is owed to you in total.`);
  ratio('Getting paid', 'daysToPay', 'Average days to pay', daysToPay, 'days', lowerIsBetter(daysToPay, t.debtorDays, t.debtorDays * 2), `${t.debtorDays} days or fewer`,
    'From order to the payment that settled it, for orders in this period that are paid.');
  ratio('Getting paid', 'overdue', 'Owed and overdue', owed > 0 ? overdue / owed * 100 : 0, 'pct', lowerIsBetter(owed > 0 ? overdue / owed * 100 : 0, 0, 25), 'None',
    `Share of what you are owed that is more than ${t.overdueDays} days old (${m(overdue)}).`);

  // ---- sales and customers ----
  const orderValue = now.orders.length ? now.grossSales / now.orders.length : null;
  const named = k => k !== 'walk-in';
  const buyers = new Set(now.orders.map(customerKey).filter(named));
  const earlier = new Set(data.orders.filter(o => !isCancelled(o) && o.date < from).map(customerKey));
  const salesByKey = {};
  now.entries.forEach(e => { const k = customerKey(e); if (named(k)) salesByKey[k] = (salesByKey[k] || 0) + orderTotals(e).net; });
  const [topKey, topSales] = Object.entries(salesByKey).sort((a, b) => b[1] - a[1])[0] || [];
  const topName = topKey && (summarizeCustomers(data).find(c => c.key === topKey) || {}).name;
  const topShare = topKey && now.sales > 0 ? topSales / now.sales * 100 : null;
  const quotes = (data.quotes || []).filter(q => inRange(q.date, from, to));
  const decided = quotes.filter(q => q.status !== 'Open' || quoteStatus(q, today) === 'Expired');
  const conversion = decided.length ? decided.filter(q => q.status === 'Accepted').length / decided.length * 100 : null;
  const returnsRate = share(now.returned, now.grossSales);
  ratio('Sales and customers', 'orderValue', 'Average order value', orderValue, 'money', '', '',
    'Excluding tax.' + (before.orders.length ? ` ${m(before.grossSales / before.orders.length)} in ${priorLabel}.` : ''));
  ratio('Sales and customers', 'returning', 'Returning customers', buyers.size ? [...buyers].filter(k => earlier.has(k)).length / buyers.size * 100 : null, 'pct', '', '',
    'Customers who ordered in this period and had ordered before. Walk-in sales are left out.');
  ratio('Sales and customers', 'topCustomer', 'Biggest customer\'s share', topShare, 'pct', lowerIsBetter(topShare, t.topCustomerShare, t.topCustomerShare * 1.5), `${t.topCustomerShare}% or less`,
    topName ? `${topName} made up this share of your sales.` : 'Share of sales from your biggest named customer.');
  ratio('Sales and customers', 'quoteConversion', 'Quotes won', conversion, 'pct', higherIsBetter(conversion, 50, 25), '50% or more',
    `Quotes from this period that became orders, out of those accepted, declined or expired (${decided.length}).`);
  ratio('Sales and customers', 'returns', 'Returns', returnsRate, 'pct', lowerIsBetter(returnsRate, 2, 5), '2% or less', 'Credit notes as a share of sales.');

  // ---- growth ----
  const change = (a, b) => b > 0 ? (a - b) / b * 100 : null;
  const salesChange = change(now.sales, before.sales), profitChange = change(now.gross, before.gross), yearChange = change(now.sales, lastYear.sales);
  ratio('Growth', 'salesChange', 'Sales vs previous period', salesChange, 'change', higherIsBetter(salesChange, 0, -15), 'Growing',
    `${m(now.sales)} against ${m(before.sales)} in ${priorLabel}.`);
  ratio('Growth', 'profitChange', 'Gross profit vs previous period', profitChange, 'change', higherIsBetter(profitChange, 0, -15), 'Growing',
    `${m(now.gross)} against ${m(before.gross)} in ${priorLabel}.`);
  ratio('Growth', 'yearChange', 'Sales vs a year ago', yearChange, 'change', higherIsBetter(yearChange, 0, -15), 'Growing',
    lastYear.sales > 0 ? `${m(lastYear.sales)} in the same period last year.` : 'Needs sales from a year ago to compare with.');

  // ---- recommendations: the business as a whole ----
  if (now.sales > 0 && now.net < 0) {
    recommend('high', 'Profit', `You made a loss of ${m(-now.net)} in this period`,
      breakEven != null
        ? `Running costs are about ${m(monthlyExpenses)} a month. At your ${pctText(grossMargin)} margin that needs about ${m(breakEven)} of sales a month, and you are averaging ${m(monthlySales)}. Raise prices, cut costs, or sell more.`
        : 'Your sales do not even cover the cost of the goods and order fees, so raising prices comes first.',
      { kind: 'report', ref: 'pnl', label: 'Open profit and loss' }, -now.net);
  }
  if (grossMargin != null && grossMargin < t.grossMargin) {
    const worst = products.filter(x => x.units > 0 && x.margin != null && x.margin < t.grossMargin).sort((a, b) => b.units - a.units).slice(0, 3);
    recommend(grossMargin < t.grossMargin / 2 ? 'high' : 'medium', 'Pricing', `Overall margin is ${pctText(grossMargin)}, below your ${t.grossMargin}% target`,
      worst.length ? 'Your best sellers under target: ' + worst.map(x => `${x.p.name} (${pctText(x.margin)})`).join(', ') + '. Their prices are suggested below.'
        : 'Order fees or discounted order prices are pulling it down. Check the fees you pay per order.',
      null, now.sales * t.grossMargin / 100 - now.gross);
  }
  if (expenseRatio != null && expenseRatioBefore != null && expenseRatio - expenseRatioBefore > 5) {
    const byCat = {};
    data.expenses.filter(e => inRange(e.date, from, to)).forEach(e => byCat[e.cat || 'Uncategorised'] = (byCat[e.cat || 'Uncategorised'] || 0) + e.amt);
    const biggest = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, v]) => `${c} ${m(v)}`).join(', ');
    recommend('medium', 'Profit', `Running costs rose to ${pctText(expenseRatio)} of sales`,
      `Up from ${pctText(expenseRatioBefore)} in ${priorLabel}. Biggest: ${biggest}.`,
      { kind: 'tab', ref: 'exp', label: 'Open expenses' }, (expenseRatio - expenseRatioBefore) * now.sales / 100);
  }
  if (salesChange != null && salesChange < -15 && before.orders.length >= 3) {
    recommend('medium', 'Sales', `Sales are down ${pctText(-salesChange)}`, `${m(now.sales)} in the last ${days} days against ${m(before.sales)} in ${priorLabel}.`,
      { kind: 'report', ref: 'products', label: 'Sales by product' }, before.sales - now.sales);
  }
  if (topShare != null && topShare > t.topCustomerShare && buyers.size > 1) {
    recommend(topShare > t.topCustomerShare * 1.5 ? 'medium' : 'low', 'Sales', `${topName} makes up ${pctText(topShare)} of your sales`,
      'Losing them would hit hard. Look for more customers like them.', { kind: 'customer', ref: topKey, label: 'Open customer' }, topSales);
  }

  // ---- recommendations: products ----
  for (const x of products) {
    const name = x.p.name, priceText = m(x.p.price);
    if (x.margin != null && (x.p.stock > 0 || x.units > 0)) {
      const target = priceForMargin(x.p.cost, t.grossMargin, x.tax);
      const priceAction = { kind: 'price', ref: x.p.id, value: target, label: `Change price to ${m(target)}` };
      if (x.margin < 0) {
        recommend('high', 'Pricing', `${name} sells for less than it costs`,
          `Price ${priceText}${x.tax.incl && x.tax.rate ? ` (${m(x.netPrice)} without tax)` : ''}, cost ${m(x.p.cost)}. Every sale loses ${m(x.p.cost - x.netPrice)}. A price of ${m(target)} gives your ${t.grossMargin}% margin.`,
          priceAction, (x.p.cost - x.netPrice) * Math.max(1, x.units));
      } else if (x.units > 0 && x.margin < t.grossMargin) {
        recommend(x.margin < t.grossMargin / 2 ? 'medium' : 'low', 'Pricing', `${name} earns a ${pctText(x.margin)} margin`,
          `Below your ${t.grossMargin}% target. You sold ${x.units} in this period. A price of ${m(target)} instead of ${priceText} would reach the target.`,
          priceAction, x.units * (target - x.p.price));
      }
    }
    const cover = x.rate > 0 ? (x.p.stock + x.onOrder) / x.rate : Infinity;
    const orderQty = Math.max(1, Math.ceil(x.rate * t.stockDays - Math.max(0, x.p.stock) - x.onOrder));
    const buy = { kind: 'purchase', ref: x.p.id, value: orderQty, label: `Order ${orderQty}` };
    const sold = `You sold ${x.units} in the last ${days} days`;
    if (x.p.stock <= 0 && x.rate > 0 && x.onOrder === 0) {
      recommend('high', 'Stock', `${name} is out of stock`, `${sold}. Order about ${orderQty} to cover ${t.stockDays} days.`, buy, orderQty * x.netPrice);
    } else if (x.rate > 0 && cover < t.stockDays / 2) {
      recommend('medium', 'Stock', `${name} runs out in about ${Math.max(0, Math.round(x.p.stock / x.rate))} days`,
        `${sold}${x.onOrder ? `, and ${x.onOrder} are already on order` : ''}. Order about ${orderQty} more to cover ${t.stockDays} days.`, buy, orderQty * x.netPrice);
    } else if (x.dead) {
      const value = x.p.stock * x.p.cost;
      recommend(stockValue > 0 && value / stockValue >= 0.05 ? 'medium' : 'low', 'Stock', `${name} is not selling`,
        `${x.p.stock} in stock worth ${m(value)} at cost, ${x.lastSale ? 'last sold on ' + x.lastSale : 'never sold'}. A discount or bundle would free up the cash. Hold off reordering it.`,
        { kind: 'product', ref: x.p.id, label: 'Stock history' }, value);
    } else if (x.rate > 0 && x.cover > t.stockDays * 4 && x.p.cost > 0) {
      recommend('low', 'Stock', `${name} has about ${Math.round(x.cover / MONTH_DAYS)} months of stock`,
        `At about ${Math.round(x.rate * MONTH_DAYS)} a month you have ${x.p.stock}. Hold off reordering; ${m((x.p.stock - x.rate * t.stockDays) * x.p.cost)} more than you need is tied up.`,
        { kind: 'product', ref: x.p.id, label: 'Stock history' }, (x.p.stock - x.rate * t.stockDays) * x.p.cost);
    }
    if (x.returned >= 2 && x.units > 0 && x.returned / x.units >= 0.1) {
      recommend('medium', 'Sales', `${name} comes back often`, `${x.returned} returned out of ${x.units} sold in this period. Check its quality, or how it is described to customers.`,
        { kind: 'product', ref: x.p.id, label: 'Stock history' }, x.returned * x.netPrice);
    }
  }

  // ---- recommendations: getting paid ----
  for (const d of debtors.filter(d => d.overdue > 0)) {
    recommend(d.oldest > 90 ? 'high' : 'medium', 'Getting paid', `${d.name} owes ${m(d.owed)}`,
      `${m(d.overdue)} of it is more than ${t.overdueDays} days old (the oldest ${d.oldest} days). Send a statement or follow up.`,
      { kind: 'customer', ref: d.key, label: 'Open customer' }, d.overdue);
  }
  for (const r of refunds) {
    recommend('medium', 'Getting paid', `Refund due to ${r.order.cust || 'a walk-in customer'}`,
      `Order #${r.order.no} has ${m(r.amount)} to pay back. Record the refund once it is paid so your figures stay right.`,
      { kind: 'order', ref: r.order.id, label: 'Open order' }, r.amount);
  }
  const expiring = (data.quotes || []).filter(q => q.status === 'Open' && q.validUntil >= today && q.validUntil <= addDays(today, 7));
  if (expiring.length) {
    recommend('low', 'Sales', `${expiring.length} quote${expiring.length === 1 ? '' : 's'} expire${expiring.length === 1 ? 's' : ''} this week`,
      expiring.map(q => `${q.no} for ${q.cust || 'a customer'} (${m(orderTotals(q).total)}, until ${q.validUntil})`).join('; ') + '. A quick follow-up wins more of them.',
      { kind: 'quotes', label: 'Open quotes' }, sumOf(expiring, q => orderTotals(q).total));
  }
  if (conversion != null && decided.length >= 5 && conversion < 25) {
    recommend('low', 'Sales', `Only ${pctText(conversion)} of quotes are won`, `${decided.length} quotes were decided in this period. Check your quoted prices against competitors, and follow up sooner.`,
      { kind: 'quotes', label: 'Open quotes' });
  }

  recs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.impact - a.impact);
  return { from, to, days, orderCount: now.orders.length, targets: t, ratios, recommendations: recs };
}

// A ratio's value as text, e.g. "32.5%", "R1,200.00 a month", "45 days", "4.2 times a year".
function formatRatio(r, cur) {
  const v = r.value;
  if (v == null) return 'Not enough data';
  if (r.format === 'pct') return pctText(v);
  if (r.format === 'change') return (v > 0 ? '+' : '') + pctText(v);
  if (r.format === 'money') return fmtMoney(cur, v);
  if (r.format === 'moneyMonth') return fmtMoney(cur, v) + ' a month';
  if (r.format === 'days') return Math.round(v) + (Math.round(v) === 1 ? ' day' : ' days');
  if (r.format === 'times') return v.toFixed(1) + ' times a year';
  return String(Math.round(v));
}

// The first date anything was recorded, for "all dates" ranges.
function firstRecordDate(data) {
  const dates = [...data.orders.map(o => o.date), ...data.expenses.map(e => e.date)].filter(Boolean).sort();
  return dates[0] || '';
}

if (typeof module !== 'undefined') {
  module.exports = {
    DEFAULT_TARGETS, TARGET_FIELDS, STATUS_LABEL, targetsOf, cleanTargets, priceForMargin,
    computeInsights, formatRatio, firstRecordDate, daysBetween
  };
}
