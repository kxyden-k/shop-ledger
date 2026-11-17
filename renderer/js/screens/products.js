// Products & stock tab: add products, edit them in the table, change all prices at once.

function productsActions() {
  return formButton('bulkPrice', 'Change all prices', '#bulk', false) + formButton('addProduct', 'Add product', '#f-sku');
}

function productsScreen() {
  const addCard = !formOpen('addProduct') ? '' : formCard('addProduct', 'Add a product', `<form class="row" onsubmit="addProduct();return false">
  <label>SKU<input id="f-sku" style="width:90px"></label><label>Name<input id="f-name"></label>
  <label>Cost<input id="f-cost" type="number" step="0.01" min="0" style="width:90px"></label>
  <label>Selling price<input id="f-price" type="number" step="0.01" min="0" style="width:100px"></label>
  <label>Stock<input id="f-stock" type="number" min="0" style="width:80px"></label>
  <label>Reorder at<input id="f-re" type="number" min="0" style="width:80px"></label>
  <button class="btn">Add product</button></form>`);

  const bulkCard = !formOpen('bulkPrice') ? '' : formCard('bulkPrice', 'Change all prices', `<form class="row" onsubmit="changeAllPricesBy();return false">
  <label>Change by %<input id="bulk" type="number" step="0.1" placeholder="e.g. 5 or -10" style="width:130px"></label>
  <button class="btn alt">Apply to every product</button></form>
  <p class="empty">Raises or lowers every selling price by the same percentage. Old prices are kept in each product's price history.</p>`);

  return stockHistoryPanel() + addCard + bulkCard + card('All products', productList());
}

function productList() {
  if (!db.products.length) return emptyNote('No products yet. Use "Add product" at the top to add your first one.');
  const q = ui.productSearch.trim().toLowerCase();
  const shown = db.products.filter(p => !q || ((p.sku || '') + ' ' + p.name).toLowerCase().includes(q));
  const search = `<div class="row" style="margin-bottom:8px">${searchBox('prod-search', ui.productSearch, 'setProductSearch', 'Name or SKU')}</div>`;
  if (!shown.length) return search + emptyNote('No products match.');
  const headers = [th('SKU'), th('Name'), thNum('Cost'), thNum('Price'), thNum('Profit/unit'), thNum('Margin'), thNum('Stock'), thNum('Reorder at'), thNum('Stock value'), th('')];
  return search + table(headers, shown.map(productRow).join(''))
    + `<p class="empty">Changes save as soon as you leave a box. Shaded rows are at or below their reorder level. Hover a price to see its earlier prices.${productTaxNote()}</p>`;
}

// Prices include tax: say that profit and margin are worked out without it.
function productTaxNote() {
  const tax = currentTax(db);
  return tax.rate > 0 && tax.incl ? ` Your prices include ${tax.rate}% tax, so profit and margin are worked out on the price without it.` : '';
}

function setProductSearch(text) { ui.productSearch = text; render(); }

function productRow(p) {
  const sellsFor = netOfTax(p.price, currentTax(db)); // the price without any tax inside it
  const profit = sellsFor - p.cost;
  const margin = sellsFor ? profit / sellsFor * 100 : 0;
  const markup = p.cost ? 'Markup ' + (profit / p.cost * 100).toFixed(0) + '%' : '';
  const priceHistory = (p.h || []).map(h => h.d + ': ' + db.cur + h.o).join('\n');
  const name = esc(p.name);
  // data-focus lets render() put the cursor back in the same cell; aria-label names the cell for screen readers.
  const cellAttrs = (field, label) => `data-focus="p${p.id}-${field}" aria-label="${label} of ${name}"`;
  const textCell = (field, label, style = '') =>
    `<td><input class="t" value="${esc(p[field] || '')}"${style} ${cellAttrs(field, label)} onchange="setProductText(${p.id},'${field}',this.value)"></td>`;
  const numberCell = (field, label, attrs, title = '') =>
    `<td class="n"><input type="number" ${attrs} value="${p[field]}"${title} ${cellAttrs(field, label)} onchange="setProductNumber(${p.id},'${field}',this.value)"></td>`;
  return `<tr class="${isLowStock(p) ? 'low' : ''}">
    ${textCell('sku', 'SKU', ' style="width:80px"')}
    ${textCell('name', 'Name')}
    ${numberCell('cost', 'Cost', 'step="0.01" min="0"')}
    ${numberCell('price', 'Price', 'step="0.01" min="0"', ` title="${esc(priceHistory || 'No price changes yet')}"`)}
    <td class="n ${profit < 0 ? 'neg' : ''}">${money(profit)}</td>
    <td class="n ${margin < 10 ? 'neg' : 'pos'}" title="${markup}">${margin.toFixed(1)}%</td>
    ${numberCell('stock', 'Stock', 'step="1"')}
    ${numberCell('reorder', 'Reorder level', 'step="1" min="0"')}
    <td class="n">${money(p.stock * p.cost)}</td>
    <td><div class="actions"><button type="button" class="btn alt sm" data-focus="hist-${p.id}" aria-label="Stock history of ${name}" onclick="openStockHistory(${p.id})">History</button>${deleteButton('p' + p.id, p.name, `deleteProduct(${p.id})`)}</div></td></tr>`;
}

function addProduct() {
  const field = id => $('#f-' + id).value;
  const name = field('name').trim();
  if (!name) return showError('Enter a product name.', '#f-name');
  const product = { id: newId(), sku: field('sku').trim(), name, cost: +field('cost') || 0, price: +field('price') || 0, stock: 0, reorder: +field('re') || 0, h: [] };
  db.products.push(product);
  moveStock(db, product.id, +field('stock') || 0, 'Opening stock', 'Product added', today());
  save();
  showMessage('Added ' + name + '.', '#f-sku');
}

function setProductText(id, field, value) {
  const p = findProduct(id);
  if (!p) return;
  p[field] = value;
  save();
  renderSoon();
}

function setProductNumber(id, field, text) {
  const p = findProduct(id);
  if (!p) return;
  const value = +text;
  if (isNaN(value)) return renderSoon(); // puts the old value back in the box
  if (field === 'price') setPrice(p, value, today());
  else if (field === 'stock') setStock(db, p, value, today());
  else p[field] = value;
  save();
  renderSoon();
}

function changeAllPricesBy() {
  const pct = +$('#bulk').value;
  if (!pct) return showError('Enter a percentage first, e.g. 5 to raise prices or -10 to lower them.', '#bulk');
  changeAllPrices(db.products, pct, today());
  save();
  showMessage('All prices changed by ' + pct + '%.');
}

function deleteProduct(id) {
  if (!confirmed('p' + id)) return;
  if (ui.historyProductId === id) ui.historyProductId = null;
  const p = findProduct(id);
  db.products = db.products.filter(x => x.id !== id);
  save();
  showMessage('Deleted ' + p.name + '. Past orders keep their details.');
}

// ---- stock history ----

function openStockHistory(id) {
  ui.historyProductId = id;
  ui.afterRender = { scroll: '#stock-history', focus: '#stock-history-close' };
  render();
}

function closeStockHistory() {
  const id = ui.historyProductId;
  ui.historyProductId = null;
  ui.afterRender = { focus: `[data-focus="hist-${id}"]` };
  render();
}

function stockHistoryPanel() {
  const p = ui.historyProductId && findProduct(ui.historyProductId);
  if (!p) return '';
  const moves = stockHistory(db, p.id), shown = moves.slice(0, 200);
  const rows = shown.map(m => `<tr><td>${m.date}</td><td class="n ${m.q < 0 ? 'neg' : 'pos'}">${m.q > 0 ? '+' : '−'}${Math.abs(m.q)}</td><td>${esc(m.why)}</td><td>${esc(m.ref || '')}</td></tr>`).join('');
  const body = rows
    ? table([th('Date'), thNum('Change'), th('Reason'), th('Reference')], rows) + (moves.length > shown.length ? `<p class="empty">Showing the latest ${shown.length} of ${moves.length} changes.</p>` : '')
    : emptyNote('No stock changes recorded yet. History starts from version 2.0 of the app, so earlier sales are not listed.');
  return card('Stock history: ' + esc(p.name), `<p>${p.stock} in stock now · reorder at ${p.reorder}</p>${body}
  <div class="row" style="margin-top:10px"><button class="btn alt" id="stock-history-close" onclick="closeStockHistory()">Close</button></div>`, 'stock-history');
}
