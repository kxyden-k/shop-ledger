// Orders tab. Three views: orders (new order form, list, and a panel per order for payments,
// credit notes and the invoice), quotes, and credit notes.
// Stock comes off when an order is saved and goes back if the order is cancelled.

const ORDER_VIEWS = [['orders', 'Orders'], ['quotes', 'Quotes'], ['credits', 'Credit notes']];

function ordersScreen() {
  const nav = subNav(ORDER_VIEWS, ui.ordersView, 'setOrdersView');
  if (ui.ordersView === 'quotes') return nav + quotesCard();
  if (ui.ordersView === 'credits') return nav + creditsCard();
  return nav + orderPanel() + (formOpen('newOrder') ? newOrderCard() : '') + orderListCard();
}

function setOrdersView(view) { ui.ordersView = view; ui.confirming = null; render(); }

function ordersActions() {
  if (ui.ordersView === 'credits') return '';
  if (ui.ordersView === 'quotes') return '<button class="btn" onclick="startNewOrder()">New quote</button>';
  return formButton('newOrder', 'New order or quote', '#oc-name');
}

// Opens the order form from anywhere, e.g. the Quotes view.
function startNewOrder() {
  ui.tab = 'ord';
  ui.ordersView = 'orders';
  ui.forms.newOrder = true;
  ui.afterRender = { focus: '#oc-name', scroll: '#form-newOrder' };
  render();
}

// ---- order list ----

const orderSearchText = o => ['#' + o.no, o.cust, o.email, o.invoiceNo || '', itemSummary(o)].join(' ').toLowerCase();

function orderListCard() {
  if (!db.orders.length) return card('All orders', emptyNote('No orders yet. Orders you save appear here.'));
  const q = ui.orderSearch.trim().toLowerCase();
  const shown = db.orders.filter(o => (!ui.orderStatusFilter || o.status === ui.orderStatusFilter) && (!q || orderSearchText(o).includes(q)));
  const statusOptions = options([['', 'All'], ...ORDER_STATUSES.map(s => [s, s])], ui.orderStatusFilter);
  const filters = `<div class="row" style="margin-bottom:8px">${searchBox('ord-search', ui.orderSearch, 'setOrderSearch', 'Customer, number, invoice or item', 280)}
  <label>Status<select id="ord-status" onchange="setOrderStatusFilter(this.value)">${statusOptions}</select></label></div>`;
  if (!shown.length) return card('All orders', filters + emptyNote('No orders match.'));
  const headers = [th('Order'), th('Date'), th('Customer'), th('Items'), thNum('Total'), thNum('Profit'), th('Status'), th('Payment'), th('')];
  return card('All orders', filters + table(headers, shown.slice().reverse().map(orderRow).join(''))
    + '<p class="empty">Cancelled orders are greyed out and don\'t count towards totals. Total is what the customer pays. Profit leaves out tax; hover it to see the figures behind it.</p>');
}

function setOrderSearch(text) { ui.orderSearch = text; render(); }
function setOrderStatusFilter(status) { ui.orderStatusFilter = status; render(); }

// "Paid", "R50.00 owed" and so on, as a coloured label.
function paymentTag(o) {
  const state = paymentState(db, o), balance = orderBalance(db, o);
  if (isCancelled(o) && !balance) return '–';
  if (state === 'Paid') return tag('Paid', 'good');
  if (state === 'Refund due') return tag('Refund due ' + money(-balance), 'bad');
  return tag(money(balance) + ' owed' + (state === 'Part paid' ? ' (part paid)' : ''), 'warn');
}

function orderRow(o) {
  const profit = orderProfit(o), sales = orderSales(o), charged = orderTotals(o).total, items = itemSummary(o);
  const statusSelect = `<select data-focus="status-${o.id}" aria-label="Status of order #${o.no}" onchange="setOrderStatus(${o.id},this.value)">${ORDER_STATUSES.map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  return `<tr class="${isCancelled(o) ? 'cancelled' : ''}${ui.openOrderId === o.id ? ' selected' : ''}">
  <td><b>#${o.no}</b>${o.invoiceNo ? `<div class="sub">${esc(o.invoiceNo)}</div>` : ''}</td><td>${o.date}</td>
  <td>${o.cust ? esc(o.cust) : '<span class="sub">Walk-in</span>'}</td>
  <td class="items" title="${esc(items)}">${esc(items)}</td>
  <td class="n">${money(charged)}</td>
  <td class="n" title="Sales${exclTax()} ${money(sales)}, goods ${money(orderCost(o))}${orderFee(o) ? ', fees ' + money(orderFee(o)) : ''}"><span class="${signClass(profit)}">${money(profit)}</span><div class="sub">${percent(profit, sales)} margin</div></td>
  <td>${statusSelect}</td><td>${paymentTag(o)}</td>
  <td><button class="btn alt sm" data-focus="open-${o.id}" aria-label="Open order #${o.no}" onclick="openOrder(${o.id})">Open</button></td></tr>`;
}

function setOrderStatus(id, status) {
  const order = findOrder(id), paidBefore = orderPaid(order);
  const error = changeOrderStatus(db, order, status, today());
  if (error) { render(); return showError(error); } // render puts the old status back in the box
  save();
  const recorded = orderPaid(order) - paidBefore;
  if (recorded > 0) return showMessage('Order #' + order.no + ' marked as paid: payment of ' + money(recorded) + ' recorded.');
  renderSoon();
}

// ---- one order: payments, credit notes, invoice ----

function openOrder(id) {
  ui.openOrderId = id;
  ui.creditForm = false;
  ui.afterRender = { scroll: '#order-panel', focus: '#order-panel-close' };
  render();
}

function closeOrder() {
  const id = ui.openOrderId;
  ui.openOrderId = null;
  ui.creditForm = false;
  ui.afterRender = { focus: `[data-focus="open-${id}"]` };
  render();
}

function orderPanel() {
  const o = ui.openOrderId && findOrder(ui.openOrderId);
  if (!o) return '';
  const totals = orderTotals(o), credited = orderCredited(db, o), balance = orderBalance(db, o), cancelled = isCancelled(o);
  const balanceLabel = balance > 0 ? 'Still owed' : balance < 0 ? 'Refund due to customer' : 'Balance';
  return card(`Order #${o.no} · ${esc(o.cust || 'Walk-in customer')}`, `
  <p>${o.date} · ${esc(itemSummary(o))} · status ${o.status}${o.invoiceNo ? ' · invoice ' + esc(o.invoiceNo) : ''}</p>
  <div class="grid">
  ${stat(cancelled ? 'Order total (cancelled, not charged)' : totals.rate ? `Order total (incl. ${totals.rate}% tax)` : 'Order total', money(totals.total))}
  ${credited ? stat('Credit notes', money(-credited)) : ''}
  ${stat('Paid', money(orderPaid(o)))}
  ${stat(balanceLabel, money(Math.abs(balance)), { tile: 'net', valueClass: balance > 0 ? 'neg' : balance < 0 ? 'neg' : 'pos' })}</div>
  <h3>Payments</h3>${paymentList(o)}${paymentForm(o, balance)}
  <h3>Credit notes</h3>${creditSection(o)}
  <div class="row" style="margin-top:14px">${cancelled ? '' : `<button class="btn" onclick="openInvoice(${o.id})">Invoice…</button>`}<button class="btn alt" id="order-panel-close" onclick="closeOrder()">Close</button></div>`, 'order-panel');
}

function paymentList(o) {
  if (!o.payments.length) return emptyNote('No payments recorded yet.');
  const rows = o.payments.map(p => `<tr><td>${p.date}</td><td>${esc(p.method || '–')}</td><td>${esc(p.note || '')}</td><td class="n ${p.amt < 0 ? 'neg' : ''}">${money(p.amt)}</td><td>${deleteButton('pay' + p.id, 'payment of ' + money(p.amt), `deletePayment(${o.id},${p.id})`)}</td></tr>`).join('');
  return table([th('Date'), th('Method'), th('Note'), thNum('Amount'), th('')], rows);
}

function paymentForm(o, balance) {
  if (!balance) return '';
  const refund = balance < 0;
  return `<form class="row" style="margin-top:8px" onsubmit="recordPayment(${refund});return false">
  <label>Date<input id="pay-date" type="date" value="${today()}"></label>
  <label>${refund ? 'Refund amount' : 'Amount received'}<input id="pay-amt" type="number" step="0.01" min="0.01" value="${Math.abs(balance)}" style="width:120px"></label>
  <label>Method<select id="pay-method">${PAYMENT_METHODS.map(m => `<option>${m}</option>`).join('')}</select></label>
  <label>Note<input id="pay-note" placeholder="Optional, e.g. a reference" style="width:200px"></label>
  <button class="btn">${refund ? 'Record refund' : 'Record payment'}</button></form>`;
}

function recordPayment(isRefund) {
  const o = findOrder(ui.openOrderId), amount = +$('#pay-amt').value;
  if (!(amount > 0)) return showError('Enter an amount greater than zero.', '#pay-amt');
  const error = addPayment(db, o, { date: $('#pay-date').value || today(), amt: isRefund ? -amount : amount, method: $('#pay-method').value, note: $('#pay-note').value.trim() });
  if (error) return showError(error, '#pay-amt');
  save();
  const left = orderBalance(db, o);
  showMessage((isRefund ? 'Refund' : 'Payment') + ' of ' + money(amount) + ' recorded. ' + (left ? money(Math.abs(left)) + (left > 0 ? ' still owed.' : ' refund still due.') : 'Order #' + o.no + ' is settled.'));
}

function deletePayment(orderId, paymentId) {
  if (!confirmed('pay' + paymentId)) return;
  removePayment(findOrder(orderId), paymentId);
  save();
  showMessage('Payment removed.');
}

function creditSection(o) {
  const credits = creditsOf(db, o);
  const list = credits.length
    ? table([th('No.'), th('Date'), th('Items'), thNum('Amount'), th('Stock'), th('')], credits.map(c => `<tr><td>${esc(c.no)}</td><td>${c.date}</td><td class="items">${esc(itemSummary(c))}</td><td class="n">${money(orderTotals(c).total)}</td><td>${c.restock ? 'Returned to stock' : 'Not returned'}</td><td><button class="btn alt sm" data-focus="send-${c.id}" onclick="sendCredit(${c.id})">Send…</button></td></tr>`).join(''))
    : emptyNote('None. Use a credit note when goods come back or you agree to take money off an order.');
  if (isCancelled(o)) return list;
  const lines = creditableItems(db, o);
  if (!lines.some(l => l.left > 0)) return list + '<p class="empty">Everything on this order has been credited.</p>';
  if (!ui.creditForm) return list + `<div class="row"><button class="btn alt" id="credit-new" onclick="toggleCreditForm(true)">New credit note</button></div>`;
  const rows = lines.map(l => `<tr><td>${esc(l.n)}</td><td class="n">${l.q}</td><td class="n">${money(l.p)}</td><td class="n">${l.left}</td><td class="n"><input id="cr-q-${l.line}" type="number" min="0" max="${l.left}" step="1" value="0" aria-label="Quantity of ${esc(l.n)} to credit"${l.left ? '' : ' disabled'}></td></tr>`).join('');
  return list + `<form onsubmit="saveCredit();return false" style="margin-top:10px">
  ${table([th('Item'), thNum('Sold'), thNum('Price'), thNum('Can credit'), thNum('Credit now')], rows)}
  <div class="row" style="margin-top:8px"><label>Reason<input id="cr-reason" placeholder="e.g. Returned, damaged in transit" style="width:280px"></label>
  <label style="flex-direction:row;align-items:center;gap:6px"><input id="cr-restock" type="checkbox" checked>Goods came back, return them to stock</label>
  <button class="btn">Save credit note</button><button type="button" class="btn alt" onclick="toggleCreditForm(false)">Cancel</button></div></form>`;
}

function toggleCreditForm(show) {
  ui.creditForm = show;
  ui.afterRender = { focus: show ? '#order-panel input[id^="cr-q-"]:not([disabled])' : '#credit-new' };
  render();
}

function saveCredit() {
  const o = findOrder(ui.openOrderId);
  const quantities = o.items.map((item, line) => +$('#cr-q-' + line).value || 0);
  const result = createCredit(db, o, quantities, { reason: $('#cr-reason').value.trim(), restock: $('#cr-restock').checked, date: today() });
  if (result.error) return showError(result.error);
  save();
  ui.creditForm = false;
  const balance = orderBalance(db, o);
  showMessage('Credit note ' + result.credit.no + ' saved.' + (balance < 0 ? ' A refund of ' + money(-balance) + ' is now due: record it under Payments.' : ''));
}

function sendCredit(id) {
  const c = db.credits.find(x => x.id === id);
  openSend({
    title: 'Credit note ' + c.no, to: c.email, returnFocus: `[data-focus="send-${id}"]`,
    message: 'Hi ' + (c.cust || 'there') + ',\n\nPlease find your credit note attached.' + signOff(),
    prepare: () => ({ doc: creditDoc(db, c), filename: 'Credit note ' + c.no, subject: 'Credit note ' + c.no + ' from ' + db.biz.name })
  });
}

// The invoice number is assigned the first time the invoice is saved or emailed, and then fixed.
function openInvoice(id) {
  const o = findOrder(id);
  openSend({
    title: `Invoice for order #${o.no}${o.invoiceNo ? ' (' + esc(o.invoiceNo) + ')' : ''}`, to: o.email, returnFocus: '#order-panel-close',
    message: 'Hi ' + (o.cust || 'there') + ',\n\nPlease find your invoice attached.' + signOff(),
    hint: 'The invoice number is assigned the first time you save or email it and never changes. Payments and credit notes already recorded are shown on it.',
    prepare(to) {
      if (to) o.email = to;
      if (!o.invoiceNo) o.invoiceNo = docNumber(db.biz.prefix || 'INV-', db.nextInvoice++);
      save();
      return { doc: invoiceDoc(db, o), filename: 'Invoice ' + o.invoiceNo, subject: 'Invoice ' + o.invoiceNo + ' from ' + db.biz.name };
    }
  });
}

// ---- new order form (ui.draft) ----

function newOrderCard() {
  const draft = ui.draft;
  const inStock = db.products.filter(p => p.stock > 0);
  const known = customers();
  const productOptions = inStock.map(p => `<option value="${p.id}">${esc(p.name)} (${p.stock} in stock)</option>`).join('');
  const itemRows = draft.items.map((i, index) =>
    `<tr><td>${esc(i.n)}</td><td class="n">${i.q}</td><td class="n">${money(i.p)}</td><td class="n">${money(i.c)}</td><td><button type="button" class="btn del sm" aria-label="Remove ${esc(i.n)}" onclick="removeDraftItem(${index})">Remove</button></td></tr>`).join('');
  const itemTable = draft.items.length
    ? `<div class="scroll" style="margin-top:10px"><table><tr>${[th('Item'), thNum('Qty'), thNum('Price'), thNum('Cost'), th('')].join('')}</tr>${itemRows}</table></div>`
    : '';
  const summary = draft.items.length ? draftSummary()
    : inStock.length ? 'Add items to build the order.' : 'Add products with stock before creating an order.';
  const none = draft.items.length ? '' : ' disabled';

  return formCard('newOrder', 'New order or quote', `<div class="row">
  <label>Customer<input id="oc-name" list="cl-names" autocomplete="off" value="${esc(draft.cust)}" oninput="onDraftCustomerInput('name',this.value)"></label>
  <label>Customer email<input id="oc-email" type="email" list="cl-emails" autocomplete="off" value="${esc(draft.email)}" oninput="onDraftCustomerInput('email',this.value)" style="width:220px"></label>
  <label>Date<input id="oc-date" type="date" value="${draft.date}" oninput="ui.draft.date=this.value"></label>
  <label>Fees (shipping, platform)<input id="oc-fee" type="number" step="0.01" min="0" value="${draft.fee}" oninput="setDraftFee(this.value)" style="width:130px"></label></div>
  <datalist id="cl-names">${known.map(c => `<option value="${esc(c.name)}" label="${esc(c.email)}">`).join('')}</datalist>
  <datalist id="cl-emails">${known.filter(c => c.email).map(c => `<option value="${esc(c.email)}" label="${esc(c.name)}">`).join('')}</datalist>
  <div id="oc-hint" class="empty" style="margin:4px 0" aria-live="polite">${esc(customerHint())}</div>
  <form class="row" style="margin-top:10px" onsubmit="addDraftItem();return false">
  <label>Product<select id="ol-prod" onchange="onDraftProductChange(this.value)">${productOptions}</select></label>
  <label>Qty<input id="ol-qty" type="number" min="1" value="1" style="width:70px"></label>
  <label>Unit price<input id="ol-price" type="number" step="0.01" min="0" value="${inStock[0] ? inStock[0].price : ''}" style="width:100px"></label>
  <button class="btn alt"${inStock.length ? '' : ' disabled'}>Add item</button></form>
  ${itemTable}
  <p id="dsum" aria-live="polite">${summary}</p>
  <div class="row"><button class="btn" id="save-order" onclick="saveOrder()"${none}>Save order</button><button class="btn alt" id="save-quote" onclick="saveQuote()"${none}>Save as quote</button></div>
  <p class="empty">An order takes the items out of stock straight away. A quote doesn't touch stock until you turn it into an order.</p>`);
}

// The customer's total (with tax), then the shop's profit and margin (without it).
function draftSummary() {
  const draft = { ...ui.draft, tax: currentTax(db) }, t = orderTotals(draft), profit = orderProfit(draft);
  const taxPart = t.rate ? ` (${t.rate}% tax ${draft.tax.incl ? 'included' : 'added'}: ${money(t.tax)})` : '';
  return `Customer pays ${money(t.total)}${taxPart} · profit ${money(profit)} · margin ${percent(profit, t.net)}`;
}

// Typing updates the summary line in place so the fee box keeps focus.
function setDraftFee(value) {
  ui.draft.fee = +value;
  if (ui.draft.items.length && $('#dsum')) $('#dsum').textContent = draftSummary();
}

function onDraftProductChange(id) {
  const p = findProduct(+id);
  $('#ol-price').value = p ? p.price : '';
}

function addDraftItem() {
  const p = findProduct(+$('#ol-prod').value), qty = +$('#ol-qty').value, price = +$('#ol-price').value;
  if (!p) return showError('Choose a product.', '#ol-prod');
  if (!(qty >= 1)) return showError('Enter a quantity of at least 1.', '#ol-qty');
  const alreadyAdded = sumOf(ui.draft.items.filter(i => i.pid === p.id), i => i.q);
  if (alreadyAdded + qty > p.stock) {
    const left = p.stock - alreadyAdded;
    return showError(`Only ${p.stock} of ${p.name} in stock` + (alreadyAdded ? `, and ${alreadyAdded} are already in this order.` : '.') + (left > 0 ? ` You can add ${left} more.` : ''), '#ol-qty');
  }
  ui.draft.items.push({ pid: p.id, n: p.name, q: qty, p: price, c: p.cost });
  ui.afterRender = { focus: '#ol-prod' }; // ready for the next item
  render();
}

function removeDraftItem(index) {
  ui.draft.items.splice(index, 1);
  render();
}

function saveOrder() {
  if (!ui.draft.items.length) return showError('Add at least one item.', '#ol-prod');
  const order = createOrder(db, ui.draft, today());
  ui.draft = emptyDraftOrder();
  save();
  showMessage('Order #' + order.no + ' saved and stock updated.', '#oc-name');
}

function saveQuote() {
  if (!ui.draft.items.length) return showError('Add at least one item.', '#ol-prod');
  const quote = createQuote(db, ui.draft, today());
  ui.draft = emptyDraftOrder();
  ui.ordersView = 'quotes';
  save();
  showMessage('Quote ' + quote.no + ' saved. It is valid until ' + quote.validUntil + '.', `[data-focus="send-${quote.id}"]`);
}

// ---- customer autocomplete ----

function customerHint() {
  const { cust, email } = ui.draft;
  if (!cust.trim() && !email.trim()) return '';
  const c = matchCustomer(customers(), cust, email);
  if (!c) return 'New customer.';
  return 'Existing customer: ' + c.orderCount + ' order' + (c.orderCount === 1 ? '' : 's') + ', last on ' + c.lastOrder + '.'
    + (c.awaitingPayment ? ' Owes ' + money(c.awaitingPayment) + '.' : '');
}

// which: 'name' | 'email'. When the typed value matches exactly one known customer, fill in the
// other box if it is still empty. Updates the boxes in place so typing isn't interrupted.
function onDraftCustomerInput(which, value) {
  const draft = ui.draft;
  if (which === 'name') draft.cust = value; else draft.email = value;
  const typed = value.trim().toLowerCase();
  if (typed) {
    const matches = customers().filter(c => (which === 'name' ? c.name : c.email).toLowerCase() === typed);
    if (matches.length === 1) {
      const c = matches[0];
      if (which === 'name' && !draft.email && c.email) { draft.email = c.email; $('#oc-email').value = c.email; }
      if (which === 'email' && !draft.cust && c.name) { draft.cust = c.name; $('#oc-name').value = c.name; }
    }
  }
  $('#oc-hint').textContent = customerHint();
}

// ---- quotes ----

const QUOTE_TONES = { Open: 'warn', Accepted: 'good', Declined: '', Expired: 'bad' };

function quotesCard() {
  if (!db.quotes.length) {
    return card('Quotes', emptyNote('No quotes yet. Use "New quote" at the top, add the items, then choose "Save as quote".')
      + `<div class="row"><button class="btn" onclick="startNewOrder()">New quote</button></div>`);
  }
  const rows = db.quotes.slice().reverse().map(q => {
    const status = quoteStatus(q, today()), open = q.status === 'Open';
    const order = q.orderId && findOrder(q.orderId);
    return `<tr><td>${esc(q.no)}</td><td>${q.date}</td><td>${q.validUntil}</td><td>${esc(q.cust || '–')}</td>
    <td class="items" title="${esc(itemSummary(q))}">${esc(itemSummary(q))}</td><td class="n">${money(orderTotals(q).total)}</td>
    <td>${tag(status, QUOTE_TONES[status])}${order ? ' order #' + order.no : ''}</td>
    <td><button class="btn alt sm" data-focus="send-${q.id}" onclick="sendQuote(${q.id})">Send…</button>
    ${open ? `<button class="btn sm" data-focus="accept-${q.id}" onclick="acceptQuote(${q.id})">Make order</button> <button class="btn alt sm" onclick="declineQuote(${q.id})">Declined</button>` : ''}
    ${deleteButton('q' + q.id, 'quote ' + q.no, `deleteQuote(${q.id})`)}</td></tr>`;
  }).join('');
  return card('Quotes', table([th('No.'), th('Date'), th('Valid until'), th('Customer'), th('Items'), thNum('Total'), th('Status'), th('')], rows)
    + `<p class="empty">"Make order" turns the quote into an order at the quoted prices and takes the stock. Quotes are valid for ${QUOTE_VALID_DAYS} days.</p>
`);
}

const findQuote = id => db.quotes.find(q => q.id === id);

function sendQuote(id) {
  const q = findQuote(id);
  openSend({
    title: 'Quote ' + q.no, to: q.email, returnFocus: `[data-focus="send-${id}"]`,
    message: 'Hi ' + (q.cust || 'there') + ',\n\nThank you for your enquiry. Your quote is attached and is valid until ' + q.validUntil + '.' + signOff(),
    prepare(to) {
      if (to && !q.email) { q.email = to; save(); }
      return { doc: quoteDoc(db, q), filename: 'Quote ' + q.no, subject: 'Quote ' + q.no + ' from ' + db.biz.name };
    }
  });
}

function acceptQuote(id) {
  const result = convertQuote(db, findQuote(id), today());
  if (result.error) return showError(result.error);
  save();
  ui.ordersView = 'orders';
  ui.openOrderId = result.order.id;
  ui.afterRender = { scroll: '#order-panel' };
  showMessage('Order #' + result.order.no + ' created from the quote and stock updated.', '#order-panel-close');
}

function declineQuote(id) {
  findQuote(id).status = 'Declined';
  save();
  render();
}

function deleteQuote(id) {
  if (!confirmed('q' + id)) return;
  db.quotes = db.quotes.filter(q => q.id !== id);
  save();
  showMessage('Quote deleted.');
}

// ---- all credit notes ----

function creditsCard() {
  if (!db.credits.length) return card('Credit notes', emptyNote('No credit notes yet. To issue one, open the order it relates to and choose "New credit note".'));
  const rows = db.credits.slice().reverse().map(c => `<tr><td>${esc(c.no)}</td><td>${c.date}</td><td>#${c.orderNo}</td><td>${esc(c.cust || '–')}</td>
  <td class="items" title="${esc(itemSummary(c))}">${esc(itemSummary(c))}</td><td class="n">${money(orderTotals(c).total)}</td>
  <td>${c.restock ? 'Returned to stock' : 'Not returned'}</td><td class="items" title="${esc(c.reason)}">${esc(c.reason || '–')}</td>
  <td><button class="btn alt sm" data-focus="send-${c.id}" onclick="sendCredit(${c.id})">Send…</button></td></tr>`).join('');
  return card('Credit notes', table([th('No.'), th('Date'), th('Order'), th('Customer'), th('Items'), thNum('Amount'), th('Stock'), th('Reason'), th('')], rows)
    + '<p class="empty">A credit note takes money off an order and off your sales for the day it was issued. To issue one, open the order on the Orders view.</p>');
}
