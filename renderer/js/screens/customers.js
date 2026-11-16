// Customers tab: totals, top customers, a searchable list and one customer's history.
// Customers come from orders, see summarizeCustomers() in ledger.js.

const CUSTOMER_SORTS = {
  spent: { label: 'Most spent', compare: (a, b) => b.spent - a.spent },
  orders: { label: 'Most orders', compare: (a, b) => b.orderCount - a.orderCount },
  recent: { label: 'Most recent', compare: (a, b) => b.lastOrder.localeCompare(a.lastOrder) },
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) }
};

function customersScreen() {
  const all = customers();
  const repeat = all.filter(c => c.orderCount > 1).length;
  const totalSpent = sumOf(all, c => c.spent), awaiting = sumOf(all, c => c.awaitingPayment);
  const top = all.slice().sort(CUSTOMER_SORTS.spent.compare).slice(0, 8);
  const max = Math.max(1, ...top.map(c => c.spent));
  const topBody = top.length ? top.map(c => barRow(c.name, c.spent, max)).join('')
    : emptyNote('Customers appear here once you have orders. Orders with the same email, or the same name when there is no email, are grouped together.');
  const sortOptions = options(Object.entries(CUSTOMER_SORTS).map(([key, s]) => [key, s.label]), ui.customerSort);

  return `<div class="grid">
  ${stat('Customers', all.length)}
  ${stat('Repeat customers', percent(repeat, all.length))}
  ${stat('Average lifetime value', money(all.length ? totalSpent / all.length : 0))}
  ${stat('Awaiting payment', money(awaiting))}</div>
  ${agedDebtCard()}
  ${card('Top customers by revenue', topBody)}
  ${card('All customers', `<div class="row" style="margin-bottom:8px">${searchBox('cust-search', ui.customerSearch, 'setCustomerSearch', 'Name or email')}
  <label>Sort by<select id="cust-sort" onchange="setCustomerSort(this.value)">${sortOptions}</select></label></div><div id="ctab">${customerTable()}</div>`)}${customerDetail()}`;
}

// Who owes money, split by how old each unpaid order is.
function agedDebtCard() {
  const rows = agedDebtors(db, today());
  if (!rows.length) return '';
  const cell = v => `<td class="n">${v ? money(v) : '–'}</td>`;
  const body = rows.map(r => `<tr><td><button class="btn alt sm" data-k="${esc(r.key)}" data-focus="debt-${esc(r.key)}" onclick="selectCustomer(this.dataset.k, true)">${esc(r.name)}</button></td>${cell(r.d0)}${cell(r.d30)}${`<td class="n ${r.d60 ? 'neg' : ''}">${r.d60 ? money(r.d60) : '–'}</td>`}${`<td class="n ${r.d90 ? 'neg' : ''}">${r.d90 ? money(r.d90) : '–'}</td>`}<td class="n"><b>${money(r.total)}</b></td></tr>`).join('');
  return card('Who owes you', table([th('Customer'), thNum('0–30 days'), thNum('31–60 days'), thNum('61–90 days'), thNum('Over 90 days'), thNum('Total owed')], body)
    + '<p class="empty">By the age of each unpaid order. Open a customer to send them a statement.</p>');
}

// Search and sort only redraw the table, so the search box keeps focus.
function setCustomerSearch(text) { ui.customerSearch = text; $('#ctab').innerHTML = customerTable(); }
function setCustomerSort(key) { ui.customerSort = key; $('#ctab').innerHTML = customerTable(); }

// Details open at the bottom of the page, so scroll there.
// keepOpen: open the customer even if they are already selected (used by the "Who owes you" list).
function selectCustomer(key, keepOpen) {
  ui.selectedCustomer = ui.selectedCustomer === key && !keepOpen ? null : key;
  if (ui.selectedCustomer) ui.afterRender = { scroll: '#customer-detail' };
  render();
}

function customerTable() {
  const q = ui.customerSearch.trim().toLowerCase();
  const rows = customers()
    .filter(c => !q || (c.name + ' ' + c.email).toLowerCase().includes(q))
    .sort(CUSTOMER_SORTS[ui.customerSort].compare);
  if (!rows.length) return emptyNote('No customers match.');
  const headers = [th('Customer'), th('Email'), thNum('Orders'), thNum('Spent'), thNum('Profit'), thNum('Avg order'), th('Last order'), thNum('Awaiting payment')];
  return table(headers, rows.map(c => {
    const open = ui.selectedCustomer === c.key;
    return `<tr class="${open ? 'selected' : ''}"><td><button class="btn alt sm" data-k="${esc(c.key)}" data-focus="cust-${esc(c.key)}" aria-expanded="${open}" onclick="selectCustomer(this.dataset.k)">${esc(c.name)}</button></td><td>${esc(c.email || '–')}</td><td class="n">${c.orderCount}</td><td class="n">${money(c.spent)}</td><td class="n ${c.profit < 0 ? 'neg' : ''}">${money(c.profit)}</td><td class="n">${money(c.spent / c.orderCount)}</td><td>${c.lastOrder}</td><td class="n">${c.awaitingPayment ? money(c.awaitingPayment) : '–'}</td></tr>`;
  }).join(''));
}

function customerDetail() {
  const c = ui.selectedCustomer && customers().find(x => x.key === ui.selectedCustomer);
  if (!c) return '';
  const favourites = favouriteProducts(c).map(f => esc(f.name) + ' (' + f.units + ')').join(', ');
  const rows = c.orders.slice().reverse().map(o => `<tr class="${isCancelled(o) ? 'cancelled' : ''}"><td>#${o.no}</td><td>${o.date}</td><td class="items" title="${esc(itemSummary(o))}">${esc(itemSummary(o))}</td><td class="n">${money(orderRevenue(o))}</td><td>${o.status}</td><td>${paymentTag(o)}</td><td>${esc(o.invoiceNo || '–')} <button class="btn alt sm" aria-label="Open order #${o.no}" onclick="showOrder(${o.id})">Open</button></td></tr>`).join('');
  return card(esc(c.name), `<p>${esc(c.email || 'No email on file')} · customer since ${c.firstOrder} · most bought: ${favourites || '–'} · margin ${percent(c.profit, c.spent)} · ${c.balance > 0 ? '<b class="neg">owes ' + money(c.balance) + '</b>' : c.balance < 0 ? '<b>in credit by ' + money(-c.balance) + '</b>' : 'nothing owed'}</p>
  ${table([th('Order'), th('Date'), th('Items'), thNum('Total'), th('Status'), th('Payment'), th('Invoice')], rows)}
  <div class="row" style="margin-top:10px"><label>Statement covers<select id="st-from">${options(statementRanges(), '')}</select></label>
  <button class="btn" id="statement-btn" data-k="${esc(c.key)}" onclick="sendStatement(this.dataset.k)">Statement…</button>
  <button class="btn alt" data-k="${esc(c.key)}" onclick="selectCustomer(this.dataset.k)">Close</button></div>`, 'customer-detail');
}

const statementRanges = () => [['', 'Whole history'], [today().slice(0, 4) + '-01-01', 'This year'], [addDays(today(), -90), 'Last 3 months']];

// A statement lists every invoice, credit note and payment with a running balance.
function sendStatement(key) {
  const c = customers().find(x => x.key === key), from = $('#st-from').value;
  openSend({
    title: 'Statement for ' + esc(c.name), to: c.email, returnFocus: '#statement-btn',
    message: 'Hi ' + c.name + ',\n\nPlease find your statement attached.' +(c.balance > 0 ? ' The amount due is ' + money(c.balance) + '.' : '') + signOff(),
    prepare: () => ({ doc: statementDoc(db, c, from, today()), filename: 'Statement ' + c.name + ' ' + today(), subject: 'Statement from ' + db.biz.name })
  });
}

// Jump from a customer's history to that order's panel on the Orders tab.
function showOrder(id) {
  ui.tab = 'ord';
  ui.ordersView = 'orders';
  openOrder(id);
}
