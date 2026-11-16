// Builds the content of every PDF the app makes: invoices, quotes, credit notes, purchase orders,
// statements and reports. Pure functions on the saved data. The result is a plain description of
// the page; pdf-template.js in the main process turns it into HTML and escapes every value.
//
//   {kind, number, meta: [[label, value]], party: {label, name, lines}, columns: [{label, num}],
//    rows: [[cell, ...]], totals: [{label, value, strong}], notes: [{title, text}], wide}

// In the browser ledger.js and reports.js are already loaded as globals; in Node tests they are pulled in.
if (typeof require !== 'undefined') Object.assign(globalThis, require('./ledger'), require('./reports'));

const ITEM_COLUMNS = [{ label: 'Description' }, { label: 'Qty', num: true }, { label: 'Unit price', num: true }, { label: 'Amount', num: true }];

const itemRows = (items, cur) => items.map(i => [i.n, String(i.q), fmtMoney(cur, i.p), fmtMoney(cur, i.q * i.p)]);

// Subtotal and tax lines, shown only when tax applies.
function taxLines(totals, cur) {
  return totals.rate ? [{ label: 'Subtotal', value: fmtMoney(cur, totals.net) }, { label: `Tax (${totals.rate}%)`, value: fmtMoney(cur, totals.tax) }] : [];
}
const taxNote = doc => doc.tax && doc.tax.rate && doc.tax.incl ? [{ text: 'Prices include tax.' }] : [];
const customerParty = (label, doc) => ({ label, name: doc.cust || 'Customer', lines: doc.email ? [doc.email] : [] });

function invoiceDoc(data, order) {
  const cur = data.cur, t = orderTotals(order), credited = orderCredited(data, order), paid = orderPaid(order);
  const totals = [...taxLines(t, cur), { label: 'Invoice total', value: fmtMoney(cur, t.total), strong: !credited && !paid }];
  if (credited) totals.push({ label: 'Credit notes', value: fmtMoney(cur, -credited) });
  if (paid) totals.push({ label: 'Paid', value: fmtMoney(cur, -paid) });
  if (credited || paid) totals.push({ label: 'Balance due', value: fmtMoney(cur, orderBalance(data, order)), strong: true });
  const notes = [...taxNote(order)];
  if (data.biz.bank) notes.push({ title: 'Payment details', text: data.biz.bank + '\nReference: ' + order.invoiceNo });
  if (data.biz.footer) notes.push({ text: data.biz.footer });
  return {
    kind: 'Invoice', number: order.invoiceNo, meta: [['Date', order.date], ['Order', '#' + order.no]],
    party: customerParty('Billed to', order), columns: ITEM_COLUMNS, rows: itemRows(order.items, cur), totals, notes
  };
}

function quoteDoc(data, quote) {
  const cur = data.cur, t = orderTotals(quote);
  const notes = [...taxNote(quote), { text: 'This quote is valid until ' + quote.validUntil + '. Prices and availability may change after that.' }];
  if (data.biz.footer) notes.push({ text: data.biz.footer });
  return {
    kind: 'Quote', number: quote.no, meta: [['Date', quote.date], ['Valid until', quote.validUntil]],
    party: customerParty('Prepared for', quote), columns: ITEM_COLUMNS, rows: itemRows(quote.items, cur),
    totals: [...taxLines(t, cur), { label: 'Total', value: fmtMoney(cur, t.total), strong: true }], notes
  };
}

function creditDoc(data, credit) {
  const cur = data.cur, t = orderTotals(credit);
  const order = data.orders.find(o => o.id === credit.orderId);
  const against = order && order.invoiceNo ? 'invoice ' + order.invoiceNo : 'order #' + credit.orderNo;
  const notes = [...taxNote(credit), { text: 'This credit note reduces what is owed on ' + against + '.' }];
  if (credit.reason) notes.unshift({ title: 'Reason', text: credit.reason });
  return {
    kind: 'Credit note', number: credit.no, meta: [['Date', credit.date], ['Against', against]],
    party: customerParty('Credited to', credit), columns: ITEM_COLUMNS, rows: itemRows(credit.items, cur),
    totals: [...taxLines(t, cur), { label: 'Total credited', value: fmtMoney(cur, t.total), strong: true }], notes
  };
}

function purchaseDoc(data, purchase) {
  const cur = data.cur, supplier = data.suppliers.find(s => s.id === purchase.supplierId) || {};
  return {
    kind: 'Purchase order', number: purchase.no, meta: [['Date', purchase.date]],
    party: { label: 'Supplier', name: purchase.supplier || 'Supplier', lines: [supplier.email, supplier.phone].filter(Boolean) },
    columns: [{ label: 'Description' }, { label: 'Qty', num: true }, { label: 'Unit cost', num: true }, { label: 'Amount', num: true }],
    rows: purchase.items.map(i => [i.n, String(i.q), fmtMoney(cur, i.c), fmtMoney(cur, i.q * i.c)]),
    totals: [{ label: 'Order total', value: fmtMoney(cur, purchaseTotal(purchase)), strong: true }],
    notes: [{ text: 'Please confirm this order and the expected delivery date.' }]
  };
}

// customer: one entry from summarizeCustomers(). from: '' for the whole history.
function statementDoc(data, customer, from, today) {
  const cur = data.cur, s = customerStatement(data, customer, from);
  const aged = agedDebtors(data, today).find(r => r.key === customer.key) || { d0: 0, d30: 0, d60: 0, d90: 0 };
  const rows = s.lines.map(l => [l.date, l.text, l.amount > 0 ? fmtMoney(cur, l.amount) : '', l.amount < 0 ? fmtMoney(cur, -l.amount) : '', fmtMoney(cur, l.balance)]);
  if (from) rows.unshift([from, 'Balance brought forward', '', '', fmtMoney(cur, s.opening)]);
  const notes = [{ title: 'Age of amounts owed', text: `Up to 30 days: ${fmtMoney(cur, aged.d0)}  ·  31 to 60 days: ${fmtMoney(cur, aged.d30)}  ·  61 to 90 days: ${fmtMoney(cur, aged.d60)}  ·  Over 90 days: ${fmtMoney(cur, aged.d90)}` }];
  if (data.biz.bank && s.closing > 0) notes.push({ title: 'Payment details', text: data.biz.bank });
  return {
    kind: 'Statement', number: '', meta: [['Date', today], ...(from ? [['From', from]] : [])],
    party: { label: 'Account of', name: customer.name, lines: customer.email ? [customer.email] : [] },
    columns: [{ label: 'Date' }, { label: 'Details' }, { label: 'Charged', num: true }, { label: 'Paid or credited', num: true }, { label: 'Balance', num: true }],
    rows, totals: [{ label: s.closing < 0 ? 'Credit on account' : 'Amount due', value: fmtMoney(cur, Math.abs(s.closing)), strong: true }], notes
  };
}

function reportDoc(data, report, from, to, today) {
  const cur = data.cur;
  const line = row => row.map((v, i) => formatCell(v, report.columns[i].type, cur));
  const range = report.asAt ? 'As at ' + today : (from || to) ? (from || 'the start') + ' to ' + (to || today) : 'All dates';
  const rows = report.rows.map(line);
  if (report.total && report.rows.length) rows.push(line(report.total).map(v => ({ strong: v })));
  return {
    kind: report.title, number: '', meta: [['Period', range], ['Printed', today]], party: null, wide: report.columns.length > 6,
    columns: report.columns.map(c => ({ label: c.label, num: c.type !== 'text' })), rows, totals: [],
    notes: report.note ? [{ text: report.note }] : []
  };
}

if (typeof module !== 'undefined') module.exports = { invoiceDoc, quoteDoc, creditDoc, purchaseDoc, statementDoc, reportDoc };
