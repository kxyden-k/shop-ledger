// Orders tab: build a new order, change order status, send or save invoices.
// Stock comes off when an order is saved and goes back if the order is cancelled.

function ordersScreen() {
  return invoicePanel() + newOrderCard() + orderListCard();
}

// ---- order list ----

const itemSummary = o => o.items.map(i => i.q + ' × ' + i.n).join(', ');
const orderSearchText = o => ['#' + o.no, o.cust, o.email, o.invoiceNo || '', itemSummary(o)].join(' ').toLowerCase();

function orderListCard() {
  if (!db.orders.length) return card('Orders', emptyNote('No orders yet. Orders you save above appear here.'));
  const q = ui.orderSearch.trim().toLowerCase();
  const shown = db.orders.filter(o => (!ui.orderStatusFilter || o.status === ui.orderStatusFilter) && (!q || orderSearchText(o).includes(q)));
  const statusOptions = options([['', 'All'], ...ORDER_STATUSES.map(s => [s, s])], ui.orderStatusFilter);
  const filters = `<div class="row" style="margin-bottom:8px">${searchBox('ord-search', ui.orderSearch, 'setOrderSearch', 'Customer, number, invoice or item', 280)}
  <label>Status<select id="ord-status" onchange="setOrderStatusFilter(this.value)">${statusOptions}</select></label></div>`;
  if (!shown.length) return card('Orders', filters + emptyNote('No orders match.'));
  const headers = [th('No.'), th('Date'), th('Customer'), th('Items'), thNum('Revenue'), thNum('Costs'), thNum('Profit'), thNum('Margin'), th('Status'), th('Invoice')];
  return card('Orders', filters + table(headers, shown.slice().reverse().map(orderRow).join(''))
    + '<p class="empty">Stock is taken off when an order is saved and returned if it is cancelled. Cancelled orders are greyed out and don\'t count towards totals.</p>');
}

function setOrderSearch(text) { ui.orderSearch = text; render(); }
function setOrderStatusFilter(status) { ui.orderStatusFilter = status; render(); }

function orderRow(o) {
  const profit = orderProfit(o), revenue = orderRevenue(o), items = itemSummary(o);
  const statusSelect = `<select data-focus="status-${o.id}" aria-label="Status of order #${o.no}" onchange="setOrderStatus(${o.id},this.value)">${ORDER_STATUSES.map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  const invoiceButton = isCancelled(o) ? '' : `<button class="btn alt sm" data-focus="inv-${o.id}" onclick="openInvoice(${o.id})">Invoice</button>`;
  return `<tr class="${isCancelled(o) ? 'cancelled' : ''}">
  <td>#${o.no}</td><td>${o.date}</td><td>${esc(o.cust || '–')}</td>
  <td class="items" title="${esc(items)}">${esc(items)}</td>
  <td class="n">${money(revenue)}</td><td class="n">${money(orderCost(o) + orderFee(o))}</td>
  <td class="n ${signClass(profit)}">${money(profit)}</td><td class="n">${percent(profit, revenue)}</td>
  <td>${statusSelect}</td><td>${o.invoiceNo ? esc(o.invoiceNo) + ' ' : ''}${invoiceButton}</td></tr>`;
}

function setOrderStatus(id, status) {
  const error = changeOrderStatus(db.products, findOrder(id), status);
  if (error) { render(); return showError(error); } // render puts the old status back in the box
  save();
  renderSoon();
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

  return card('New order', `<div class="row">
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
  <button class="btn" id="save-order" onclick="saveOrder()"${draft.items.length ? '' : ' disabled'}>Save order</button>`);
}

function draftSummary() {
  const revenue = orderRevenue(ui.draft), profit = orderProfit(ui.draft);
  return `Total ${money(revenue)} · profit ${money(profit)} · margin ${percent(profit, revenue)}`;
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
  const draft = ui.draft;
  if (!draft.items.length) return showError('Add at least one item.', '#ol-prod');
  takeStock(db.products, draft.items);
  const no = nextOrderNumber(db.orders);
  db.orders.push({
    id: newId(), no, date: draft.date || today(), cust: draft.cust, email: draft.email,
    invoiceNo: null, fee: +draft.fee || 0, status: 'Pending', items: draft.items
  });
  ui.draft = emptyDraftOrder();
  save();
  showMessage('Order #' + no + ' saved and stock updated.', '#oc-name');
}

// ---- customer autocomplete ----

function customerHint() {
  const { cust, email } = ui.draft;
  if (!cust.trim() && !email.trim()) return '';
  const c = matchCustomer(customers(), cust, email);
  if (!c) return 'New customer.';
  return 'Existing customer: ' + c.orderCount + ' order' + (c.orderCount === 1 ? '' : 's') + ', last on ' + c.lastOrder + '.';
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

// ---- invoices ----

function openInvoice(id) {
  ui.invoiceOrderId = id;
  ui.afterRender = { focus: '#iv-to', scroll: '#invoice-panel' }; // the panel is at the top, the button may be far below
  render();
}

function closeInvoice() {
  const id = ui.invoiceOrderId;
  ui.invoiceOrderId = null;
  ui.afterRender = { focus: `[data-focus="inv-${id}"]` };
  render();
}

function invoicePanel() {
  const o = ui.invoiceOrderId && findOrder(ui.invoiceOrderId);
  if (!o) return '';
  const defaultMessage = 'Hi ' + (o.cust || 'there') + ',\n\nPlease find your invoice attached.\n\nKind regards,\n' + db.biz.name;
  const missingBusiness = db.biz.name.trim() ? ''
    : `<div class="msg warnbar">Add your business name in Settings before creating invoices. <button type="button" class="btn sm" onclick="goTo('set')">Open settings</button></div>`;
  return card(`Invoice for order #${o.no}${o.invoiceNo ? ' (' + esc(o.invoiceNo) + ')' : ''}`, `${missingBusiness}
  <div class="row"><label>Send to<input id="iv-to" type="email" value="${esc(o.email || '')}" style="width:260px"></label>
  <label>Subject<input id="iv-sub" placeholder="Invoice number and your business name" style="width:300px"></label></div>
  <label style="display:block;margin:8px 0;color:var(--mute);font-size:13px">Message<textarea id="iv-msg">${esc(defaultMessage)}</textarea></label>
  <div class="row"><button class="btn" onclick="sendInvoice('email',this)">Email invoice</button><button class="btn alt" onclick="sendInvoice('save',this)">Save as PDF</button><button class="btn alt" onclick="closeInvoice()">Close</button></div>
  <p class="empty">The invoice number is assigned the first time you save or email it and never changes. Press Esc to close.</p>`, 'invoice-panel');
}

// mode: 'email' | 'save' (PDF). The invoice number is assigned on first use and then fixed.
async function sendInvoice(mode, button) {
  const o = findOrder(ui.invoiceOrderId);
  if (!o) return;
  if (!db.biz.name.trim()) return showError('Add your business name in Settings first.');
  const to = $('#iv-to').value.trim();
  if (mode === 'email' && !/^\S+@\S+\.\S+$/.test(to)) return showError('Enter a valid email address to send to.', '#iv-to');
  const subject = $('#iv-sub').value.trim(), message = $('#iv-msg').value;
  o.email = to;
  if (!o.invoiceNo) o.invoiceNo = (db.biz.prefix || 'INV-') + String(db.nextInvoice++).padStart(4, '0');
  save();
  const result = await whileBusy(button, mode === 'email' ? 'Sending…' : 'Saving…', () => window.api.invoice({
    order: o, biz: db.biz, cur: db.cur, mode, to,
    subject: subject || ('Invoice ' + o.invoiceNo + ' from ' + db.biz.name), message
  }));
  if (!result) return;
  if (result.ok) { ui.invoiceOrderId = null; showMessage(result.msg); }
  else if (result.msg === 'Save cancelled.') toast(result.msg, false);
  else showError(result.msg); // no redraw, so the message the user wrote is kept for another try
}
