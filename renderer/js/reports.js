// Reports for the Reports tab, CSV export and PDF. Pure functions on the saved data (see ledger.js).
// Each report is {title, note, columns: [{label, type}], rows, total}.
//   type: 'text' | 'money' | 'num' | 'pct'   rows and total hold raw values; formatting happens at display.
//   total (optional) is one more row, shown in bold.

// In the browser ledger.js is already loaded as globals; in Node tests it has to be pulled in.
if (typeof require !== 'undefined') Object.assign(globalThis, require('./ledger'));

const colText = label => ({ label, type: 'text' });
const colMoney = label => ({ label, type: 'money' });
const colNum = label => ({ label, type: 'num' });

// Adds up the money and number columns of rows into a "Total" row.
function totalRow(columns, rows) {
  return columns.map((c, i) => i === 0 ? 'Total' : c.type === 'money' || c.type === 'num' ? round2(sumOf(rows, r => r[i])) : '');
}

const monthOf = date => date.slice(0, 7);

function profitAndLoss(data, from, to) {
  const months = {};
  const month = date => months[monthOf(date)] = months[monthOf(date)] || { sales: 0, cogs: 0, fees: 0, expenses: 0 };
  salesEntries(data, d => inRange(d, from, to)).forEach(e => {
    const m = month(e.date);
    m.sales += orderTotals(e).net;
    m.cogs += orderCost(e);
    m.fees += orderFee(e);
  });
  data.expenses.filter(e => inRange(e.date, from, to)).forEach(e => month(e.date).expenses += e.amt);
  const columns = [colText('Month'), colMoney('Sales (excl. tax)'), colMoney('Cost of goods'), colMoney('Order fees'), colMoney('Gross profit'), colMoney('Expenses'), colMoney('Net profit')];
  const rows = Object.keys(months).sort().map(k => {
    const m = months[k], gross = m.sales - m.cogs - m.fees;
    return [k, m.sales, m.cogs, m.fees, gross, m.expenses, gross - m.expenses].map((v, i) => i ? round2(v) : v);
  });
  return {
    title: 'Profit and loss', columns, rows, total: totalRow(columns, rows),
    note: 'Sales leave out the tax you collect, so they can be lower than the dashboard revenue when your prices include tax. Credit notes are taken off in the month they were issued.'
  };
}

function taxReport(data, from, to) {
  const months = {};
  salesEntries(data, d => inRange(d, from, to)).forEach(e => {
    const m = months[monthOf(e.date)] = months[monthOf(e.date)] || { total: 0, net: 0, tax: 0 };
    const t = orderTotals(e);
    m.total += t.total; m.net += t.net; m.tax += t.tax;
  });
  const columns = [colText('Month'), colMoney('Sales incl. tax'), colMoney('Sales excl. tax'), colMoney('Tax collected')];
  const rows = Object.keys(months).sort().map(k => [k, round2(months[k].total), round2(months[k].net), round2(months[k].tax)]);
  return {
    title: 'Tax collected on sales', columns, rows, total: totalRow(columns, rows),
    note: 'By order date, using the tax rate each order was made under, less credit notes. Tax you paid on expenses and purchases is not recorded in this app, so claim that from your supplier invoices.'
  };
}

function salesByProductReport(data, from, to) {
  const columns = [colText('Product'), colNum('Units sold'), colMoney('Revenue'), colMoney('Cost'), colMoney('Profit'), { label: 'Margin', type: 'pct' }];
  const rows = salesByProduct(salesEntries(data, d => inRange(d, from, to)))
    .map(p => [p.name, p.units, round2(p.revenue), round2(p.cost), round2(p.profit), p.revenue ? p.profit / p.revenue * 100 : null]);
  const total = totalRow(columns, rows);
  total[5] = total[2] ? total[4] / total[2] * 100 : null;
  return { title: 'Sales by product', columns, rows, total, note: 'Returns on credit notes are taken off.' };
}

function salesByCustomerReport(data, from, to) {
  const byKey = {};
  const names = Object.fromEntries(summarizeCustomers(data).map(c => [c.key, c.name]));
  salesEntries(data, d => inRange(d, from, to)).forEach(e => {
    const key = customerKey(e);
    const c = byKey[key] = byKey[key] || { name: names[key] || e.cust || e.email || 'Walk-in customer', orders: 0, revenue: 0, profit: 0 };
    if (!e.isCredit) c.orders++;
    c.revenue += orderRevenue(e);
    c.profit += orderProfit(e);
  });
  const columns = [colText('Customer'), colNum('Orders'), colMoney('Revenue'), colMoney('Profit')];
  const rows = Object.values(byKey).sort((a, b) => b.revenue - a.revenue).map(c => [c.name, c.orders, round2(c.revenue), round2(c.profit)]);
  return { title: 'Sales by customer', columns, rows, total: totalRow(columns, rows), note: '' };
}

function expensesByCategory(data, from, to) {
  const byCat = {};
  data.expenses.filter(e => inRange(e.date, from, to)).forEach(e => {
    const c = byCat[e.cat || 'Uncategorised'] = byCat[e.cat || 'Uncategorised'] || { n: 0, total: 0 };
    c.n++; c.total += e.amt;
  });
  const columns = [colText('Category'), colNum('Expenses'), colMoney('Total')];
  const rows = Object.entries(byCat).sort((a, b) => b[1].total - a[1].total).map(([cat, c]) => [cat, c.n, round2(c.total)]);
  return { title: 'Expenses by category', columns, rows, total: totalRow(columns, rows), note: '' };
}

function expenseList(data, from, to) {
  const columns = [colText('Date'), colText('Category'), colText('What for'), colMoney('Amount')];
  const rows = data.expenses.filter(e => inRange(e.date, from, to)).sort((a, b) => a.date.localeCompare(b.date))
    .map(e => [e.date, e.cat || '', e.desc, e.amt]);
  return { title: 'Expense list', columns, rows, total: totalRow(columns, rows), note: '' };
}

function paymentsReport(data, from, to) {
  const columns = [colText('Date'), colText('Order'), colText('Invoice'), colText('Customer'), colText('Method'), colText('Note'), colMoney('Amount')];
  const rows = [];
  data.orders.forEach(o => (o.payments || []).filter(p => inRange(p.date, from, to))
    .forEach(p => rows.push([p.date, '#' + o.no, o.invoiceNo || '', o.cust || '', p.method || '', p.note || '', p.amt])));
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return { title: 'Payments received', columns, rows, total: totalRow(columns, rows), note: 'Refunds show as negative amounts.' };
}

function orderListReport(data, from, to) {
  const columns = [colText('No.'), colText('Date'), colText('Customer'), colText('Status'), colText('Invoice'), colMoney('Excl. tax'), colMoney('Tax'), colMoney('Total'), colMoney('Credited'), colMoney('Paid'), colMoney('Balance')];
  const rows = data.orders.filter(o => inRange(o.date, from, to)).map(o => {
    const t = isCancelled(o) ? { net: 0, tax: 0, total: 0 } : orderTotals(o);
    return ['#' + o.no, o.date, o.cust || '', o.status, o.invoiceNo || '', round2(t.net), round2(t.tax), round2(t.total), round2(orderCredited(data, o)), round2(orderPaid(o)), orderBalance(data, o)];
  });
  return { title: 'Order list', columns, rows, total: totalRow(columns, rows), note: 'Cancelled orders are listed with no charge.' };
}

// As things stand today, whatever dates are chosen.
function agedDebtorsReport(data, from, to, today) {
  const columns = [colText('Customer'), colText('Email'), colMoney('0–30 days'), colMoney('31–60 days'), colMoney('61–90 days'), colMoney('Over 90 days'), colMoney('Total owed')];
  const rows = agedDebtors(data, today).map(r => [r.name, r.email, r.d0, r.d30, r.d60, r.d90, r.total]);
  return { title: 'Who owes you (aged debtors)', columns, rows, total: totalRow(columns, rows), note: 'As at ' + today + ', by the age of each unpaid order. The dates above do not apply.', asAt: true };
}

function stockValuation(data, from, to, today) {
  const columns = [colText('SKU'), colText('Product'), colNum('In stock'), colMoney('Unit cost'), colMoney('Value at cost'), colMoney('Value at retail')];
  const rows = data.products.map(p => [p.sku || '', p.name, p.stock, p.cost, round2(p.stock * p.cost), round2(p.stock * p.price)]);
  const total = totalRow(columns, rows);
  total[3] = '';
  return { title: 'Stock valuation', columns, rows, total, note: 'As at ' + today + '. The dates above do not apply.', asAt: true };
}

const REPORTS = {
  pnl: profitAndLoss, tax: taxReport, products: salesByProductReport, customers: salesByCustomerReport,
  orders: orderListReport, payments: paymentsReport, debtors: agedDebtorsReport,
  expenseCats: expensesByCategory, expenses: expenseList, stock: stockValuation
};
const REPORT_NAMES = [
  ['pnl', 'Profit and loss'], ['tax', 'Tax collected on sales'], ['products', 'Sales by product'], ['customers', 'Sales by customer'],
  ['orders', 'Order list'], ['payments', 'Payments received'], ['debtors', 'Who owes you (aged debtors)'],
  ['expenseCats', 'Expenses by category'], ['expenses', 'Expense list'], ['stock', 'Stock valuation']
];

const buildReport = (id, data, from, to, today) => REPORTS[id](data, from, to, today);

// One cell as display text. cur: currency symbol.
function formatCell(value, type, cur) {
  if (value === '' || value == null) return type === 'pct' ? '–' : '';
  if (type === 'money') return fmtMoney(cur, value);
  if (type === 'pct') return value.toFixed(1) + '%';
  return String(value);
}

// For CSV: header row, raw values (so a spreadsheet can add them up), then the total row.
function reportToRows(report) {
  const raw = row => row.map((v, i) => v == null ? '' : report.columns[i].type === 'pct' && v !== '' ? round2(v) : v);
  return [report.columns.map(c => c.label), ...report.rows.map(raw), ...(report.total && report.rows.length ? [raw(report.total)] : [])];
}

// Date-range shortcuts for the Reports tab: [from, to] as yyyy-mm-dd, '' meaning open-ended.
function presetRange(preset, today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const pad = n => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (preset === 'month') return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${lastDay(y, m)}`];
  if (preset === 'lastMonth') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return [`${yy}-${pad(mm)}-01`, `${yy}-${pad(mm)}-${lastDay(yy, mm)}`]; }
  if (preset === 'year') return [`${y}-01-01`, `${y}-12-31`];
  if (preset === 'lastYear') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  return ['', ''];
}

if (typeof module !== 'undefined') {
  module.exports = {
    profitAndLoss, taxReport, salesByProductReport, salesByCustomerReport, expensesByCategory, expenseList, paymentsReport,
    orderListReport, agedDebtorsReport, stockValuation, REPORT_NAMES, buildReport, formatCell, reportToRows, presetRange
  };
}
