// Purchasing tab: suppliers, and purchase orders that put stock on the shelf when received.
// Buying stock is not an expense here: its cost counts against profit when the goods are sold.

const PURCHASING_VIEWS = [['orders', 'Purchase orders'], ['suppliers', 'Suppliers']];
const PURCHASE_TONES = { Ordered: 'warn', Received: 'good', Cancelled: '' };

function purchasingScreen() {
  const nav = subNav(PURCHASING_VIEWS, ui.purchasingView, 'setPurchasingView');
  return nav + (ui.purchasingView === 'suppliers' ? suppliersView() : (formOpen('newPurchase') ? newPurchaseCard() : '') + purchaseListCard());
}

function setPurchasingView(view) { ui.purchasingView = view; ui.confirming = null; render(); }

function purchasingActions() {
  return ui.purchasingView === 'suppliers'
    ? formButton('addSupplier', 'Add supplier', '#s-name')
    : formButton('newPurchase', 'New purchase order', db.suppliers.length ? '#po-supplier' : '#po-add-supplier');
}

const findSupplier = id => db.suppliers.find(s => s.id === id);
const findPurchase = id => db.purchases.find(p => p.id === id);

// ---- suppliers ----

function suppliersView() {
  const addCard = !formOpen('addSupplier') ? '' : formCard('addSupplier', 'Add a supplier', `<form class="row" onsubmit="addSupplier();return false">
  <label>Name<input id="s-name"></label><label>Email<input id="s-email" type="email" style="width:220px"></label>
  <label>Phone<input id="s-phone" style="width:150px"></label><label>Notes<input id="s-notes" placeholder="e.g. account number, lead time" style="width:260px"></label>
  <button class="btn">Add supplier</button></form>`);
  if (!db.suppliers.length) return addCard + card('Suppliers', emptyNote('No suppliers yet. Use "Add supplier" at the top to add the people you buy stock from.'));
  const cell = (s, field, label, width) =>
    `<td><input class="t" value="${esc(s[field] || '')}" style="width:${width}px" data-focus="s${s.id}-${field}" aria-label="${label} of ${esc(s.name)}" onchange="setSupplierField(${s.id},'${field}',this.value)"></td>`;
  const rows = db.suppliers.map(s => {
    const orders = db.purchases.filter(p => p.supplierId === s.id && p.status !== 'Cancelled');
    return `<tr>${cell(s, 'name', 'Name', 180)}${cell(s, 'email', 'Email', 210)}${cell(s, 'phone', 'Phone', 130)}${cell(s, 'notes', 'Notes', 240)}
    <td class="n">${orders.length}</td><td class="n">${money(sumOf(orders, purchaseTotal))}</td>
    <td>${deleteButton('s' + s.id, s.name, `deleteSupplier(${s.id})`)}</td></tr>`;
  }).join('');
  return addCard + card('Suppliers', table([th('Name'), th('Email'), th('Phone'), th('Notes'), thNum('Orders'), thNum('Ordered in total'), th('')], rows)
    + '<p class="empty">Edit any cell and it saves straight away.</p>');
}

function addSupplier() {
  const name = $('#s-name').value.trim();
  if (!name) return showError('Enter the supplier\'s name.', '#s-name');
  db.suppliers.push({ id: newId(), name, email: $('#s-email').value.trim(), phone: $('#s-phone').value.trim(), notes: $('#s-notes').value.trim() });
  save();
  showMessage('Added ' + name + '.', '#s-name');
}

function setSupplierField(id, field, value) {
  const s = findSupplier(id);
  if (!s) return;
  if (field === 'name' && !value.trim()) { renderSoon(); return showError('A supplier needs a name.'); }
  s[field] = value.trim();
  save();
  renderSoon();
}

function deleteSupplier(id) {
  if (!confirmed('s' + id)) return;
  const s = findSupplier(id);
  db.suppliers = db.suppliers.filter(x => x.id !== id);
  save();
  showMessage('Deleted ' + s.name + '. Their past purchase orders are kept.');
}

// ---- new purchase order (ui.purchaseDraft) ----

function newPurchaseCard() {
  if (!db.suppliers.length) {
    return formCard('newPurchase', 'New purchase order', emptyNote('Add a supplier first.') + `<div class="row"><button class="btn" id="po-add-supplier" onclick="ui.forms.addSupplier=true;setPurchasingView('suppliers')">Add a supplier</button></div>`);
  }
  if (!db.products.length) return formCard('newPurchase', 'New purchase order', emptyNote('Add your products on the Products & stock tab first.'));
  const draft = ui.purchaseDraft;
  const supplierOptions = options(db.suppliers.map(s => [s.id, esc(s.name)]), draft.supplierId || db.suppliers[0].id);
  const productOptions = db.products.map(p => `<option value="${p.id}">${esc(p.name)} (${p.stock} in stock${isLowStock(p) ? ', low' : ''})</option>`).join('');
  const itemRows = draft.items.map((i, index) =>
    `<tr><td>${esc(i.n)}</td><td class="n">${i.q}</td><td class="n">${money(i.c)}</td><td class="n">${money(i.q * i.c)}</td><td><button type="button" class="btn del sm" aria-label="Remove ${esc(i.n)}" onclick="removePurchaseItem(${index})">Remove</button></td></tr>`).join('');
  const none = draft.items.length ? '' : ' disabled';
  return formCard('newPurchase', 'New purchase order', `<div class="row">
  <label>Supplier<select id="po-supplier" onchange="ui.purchaseDraft.supplierId=+this.value">${supplierOptions}</select></label>
  <label>Date<input id="po-date" type="date" value="${draft.date}" oninput="ui.purchaseDraft.date=this.value"></label></div>
  <form class="row" style="margin-top:10px" onsubmit="addPurchaseItem();return false">
  <label>Product<select id="po-prod" onchange="onPurchaseProductChange(this.value)">${productOptions}</select></label>
  <label>Qty<input id="po-qty" type="number" min="1" step="1" value="1" style="width:80px"></label>
  <label>Unit cost<input id="po-cost" type="number" step="0.01" min="0" value="${db.products[0].cost}" style="width:100px"></label>
  <button class="btn alt">Add item</button></form>
  ${draft.items.length ? `<div class="scroll" style="margin-top:10px"><table><tr>${[th('Item'), thNum('Qty'), thNum('Unit cost'), thNum('Amount'), th('')].join('')}</tr>${itemRows}</table></div>` : ''}
  <p aria-live="polite">${draft.items.length ? 'Order total ' + money(purchaseTotal(draft)) : 'Add the items you are ordering.'}</p>
  <button class="btn" onclick="savePurchase()"${none}>Save purchase order</button>`);
}

function onPurchaseProductChange(id) {
  const p = findProduct(+id);
  $('#po-cost').value = p ? p.cost : '';
}

function addPurchaseItem() {
  const p = findProduct(+$('#po-prod').value), qty = +$('#po-qty').value, cost = +$('#po-cost').value;
  if (!p) return showError('Choose a product.', '#po-prod');
  if (!(qty >= 1) || !Number.isInteger(qty)) return showError('Enter a whole quantity of at least 1.', '#po-qty');
  if (!(cost >= 0)) return showError('Enter the unit cost.', '#po-cost');
  ui.purchaseDraft.items.push({ pid: p.id, n: p.name, q: qty, c: cost });
  ui.afterRender = { focus: '#po-prod' };
  render();
}

function removePurchaseItem(index) {
  ui.purchaseDraft.items.splice(index, 1);
  render();
}

function savePurchase() {
  const draft = ui.purchaseDraft;
  if (!draft.items.length) return showError('Add at least one item.', '#po-prod');
  draft.supplierId = draft.supplierId || db.suppliers[0].id;
  const purchase = createPurchase(db, draft, today());
  ui.purchaseDraft = emptyDraftPurchase();
  save();
  showMessage('Purchase order ' + purchase.no + ' saved. Stock goes up when you mark it received.', `[data-focus="send-${purchase.id}"]`);
}

// ---- purchase order list ----

function purchaseListCard() {
  if (!db.purchases.length) return card('Purchase orders', emptyNote('No purchase orders yet. Use "New purchase order" at the top to order stock from a supplier.'));
  const rows = db.purchases.slice().reverse().map(p => {
    const ordered = p.status === 'Ordered';
    return `<tr class="${p.status === 'Cancelled' ? 'cancelled' : ''}"><td>${esc(p.no)}</td><td>${p.date}</td><td>${esc(p.supplier || '–')}</td>
    <td class="items" title="${esc(itemSummary(p))}">${esc(itemSummary(p))}</td><td class="n">${money(purchaseTotal(p))}</td>
    <td>${tag(p.status, PURCHASE_TONES[p.status])}${p.receivedOn ? ' ' + p.receivedOn : ''}</td>
    <td><button class="btn alt sm" data-focus="send-${p.id}" onclick="sendPurchase(${p.id})">Send…</button>
    ${ordered ? `<button class="btn sm" data-focus="receive-${p.id}" onclick="receiveStock(${p.id})">${ui.confirming === 'rcv' + p.id ? 'Confirm: goods arrived' : 'Receive stock'}</button> <button type="button" class="btn del sm${ui.confirming === 'po' + p.id ? ' armed' : ''}" data-focus="cancel-${p.id}" aria-label="Cancel purchase order ${esc(p.no)}" onclick="cancelPurchase(${p.id})">${ui.confirming === 'po' + p.id ? 'Confirm cancel' : 'Cancel'}</button>` : ''}</td></tr>`;
  }).join('');
  return card('Purchase orders', table([th('No.'), th('Date'), th('Supplier'), th('Items'), thNum('Total'), th('Status'), th('')], rows)
    + '<p class="empty">"Receive stock" adds the items to stock and updates each product\'s cost to the average of what you had and what arrived.</p>');
}

function receiveStock(id) {
  if (!confirmed('rcv' + id)) return;
  const purchase = findPurchase(id);
  const error = receivePurchase(db, purchase, today());
  if (error) return showError(error);
  save();
  showMessage(purchase.no + ' received: ' + itemSummary(purchase) + ' added to stock.');
}

function cancelPurchase(id) {
  if (!confirmed('po' + id)) return;
  const purchase = findPurchase(id);
  if (purchase.status === 'Ordered') purchase.status = 'Cancelled';
  save();
  showMessage(purchase.no + ' cancelled.');
}

function sendPurchase(id) {
  const p = findPurchase(id), supplier = findSupplier(p.supplierId) || {};
  openSend({
    title: 'Purchase order ' + p.no, to: supplier.email, returnFocus: `[data-focus="send-${id}"]`,
    message: 'Hi ' + (p.supplier || 'there') + ',\n\nPlease find our purchase order attached.' + signOff(),
    prepare: () => ({ doc: purchaseDoc(db, p), filename: 'Purchase order ' + p.no, subject: 'Purchase order ' + p.no + ' from ' + db.biz.name })
  });
}
