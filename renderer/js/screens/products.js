// Products & stock tab: add products, edit them in the table, change all prices at once, give a
// product a recipe (bill of materials) and make it, and write off stock that can't be sold.

const UNIT_SUGGESTIONS = ['each', 'kg', 'g', 'litre', 'ml', 'dozen', 'box', 'tray'];
const WRITE_OFF_REASONS = ['Damaged', 'Expired', 'Unsold at end of day', 'Used for samples'];

function productsActions() {
  return formButton('bulkPrice', 'Change all prices', '#bulk', false) + formButton('addProduct', 'Add product', '#f-sku');
}

function productsScreen() {
  const addCard = !formOpen('addProduct') ? '' : formCard('addProduct', 'Add a product', `<form class="row" onsubmit="addProduct();return false">
  <label>SKU<input id="f-sku" style="width:90px"></label><label>Name<input id="f-name"></label>
  <label>Unit<input id="f-unit" list="unit-list" placeholder="each" style="width:80px"></label>
  <label>Cost<input id="f-cost" type="number" step="0.01" min="0" style="width:90px"></label>
  <label>Selling price<input id="f-price" type="number" step="0.01" min="0" style="width:100px"></label>
  <label>Stock<input id="f-stock" type="number" min="0" step="any" style="width:80px"></label>
  <label>Reorder at<input id="f-re" type="number" min="0" step="any" style="width:80px"></label>
  <button class="btn">Add product</button></form>
  <p class="empty">Ingredients and packaging are products too: give them a unit such as kg, and a selling price of 0 if you never sell them on their own. Cost is per unit.</p>`);

  const bulkCard = !formOpen('bulkPrice') ? '' : formCard('bulkPrice', 'Change all prices', `<form class="row" onsubmit="changeAllPricesBy();return false">
  <label>Change by %<input id="bulk" type="number" step="0.1" placeholder="e.g. 5 or -10" style="width:130px"></label>
  <button class="btn alt">Apply to every product</button></form>
  <p class="empty">Raises or lowers every selling price by the same percentage. Old prices are kept in each product's price history.</p>`);

  const units = `<datalist id="unit-list">${UNIT_SUGGESTIONS.map(u => `<option value="${u}">`).join('')}</datalist>`;
  return stockHistoryPanel() + bomPanel() + addCard + bulkCard + card('All products', productList()) + units;
}

function productList() {
  if (!db.products.length) return emptyNote('No products yet. Use "Add product" at the top to add your first one.');
  const q = ui.productSearch.trim().toLowerCase();
  const shown = db.products.filter(p => !q || ((p.sku || '') + ' ' + p.name).toLowerCase().includes(q));
  const search = `<div class="row" style="margin-bottom:8px">${searchBox('prod-search', ui.productSearch, 'setProductSearch', 'Name or SKU')}</div>`;
  if (!shown.length) return search + emptyNote('No products match.');
  const headers = [th('SKU'), th('Name'), th('Unit'), thNum('Cost'), thNum('Price'), thNum('Profit/unit'), thNum('Margin'), thNum('Stock'), thNum('Reorder at'), thNum('Stock value'), th('')];
  return search + table(headers, shown.map(productRow).join(''))
    + `<p class="empty">Changes save as soon as you leave a box. Shaded rows are at or below their reorder level. Hover a price to see its earlier prices. Use Recipe for things you make from other products.${productTaxNote()}</p>`;
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
  const textCell = (field, label, attrs = '') =>
    `<td><input class="t" value="${esc(p[field] || '')}"${attrs} ${cellAttrs(field, label)} onchange="setProductText(${p.id},'${field}',this.value)"></td>`;
  const numberCell = (field, label, attrs, title = '') =>
    `<td class="n"><input type="number" ${attrs} value="${p[field]}"${title} ${cellAttrs(field, label)} onchange="setProductNumber(${p.id},'${field}',this.value)"></td>`;
  const hasRecipe = bomOf(p).length > 0;
  // Sold only as an ingredient: no selling price, so profit and margin mean nothing.
  const notSold = !p.price && usedIn(db, p.id).length > 0;
  return `<tr class="${isLowStock(p) ? 'low' : ''}">
    ${textCell('sku', 'SKU', ' style="width:80px"')}
    ${textCell('name', 'Name')}
    ${textCell('unit', 'Unit', ' list="unit-list" placeholder="each" style="width:64px"')}
    ${numberCell('cost', 'Cost', 'step="0.01" min="0"', hasRecipe ? ' title="Worked out each time you make it"' : '')}
    ${numberCell('price', 'Price', 'step="0.01" min="0"', ` title="${esc(priceHistory || 'No price changes yet')}"`)}
    ${notSold ? '<td class="n">–</td><td class="n" title="Only used in recipes">–</td>' : `<td class="n ${profit < 0 ? 'neg' : ''}">${money(profit)}</td>
    <td class="n ${margin < 10 ? 'neg' : 'pos'}" title="${markup}">${margin.toFixed(1)}%</td>`}
    ${numberCell('stock', 'Stock', 'step="any"')}
    ${numberCell('reorder', 'Reorder level', 'step="any" min="0"')}
    <td class="n">${money(p.stock * p.cost)}</td>
    <td><div class="actions"><button type="button" class="btn alt sm" data-focus="bom-${p.id}" aria-label="Recipe of ${name}" onclick="openBom(${p.id})">${hasRecipe ? 'Make' : 'Recipe'}</button><button type="button" class="btn alt sm" data-focus="hist-${p.id}" aria-label="Stock history of ${name}" onclick="openStockHistory(${p.id})">History</button>${deleteButton('p' + p.id, p.name, `deleteProduct(${p.id})`)}</div></td></tr>`;
}

function addProduct() {
  const field = id => $('#f-' + id).value;
  const name = field('name').trim();
  if (!name) return showError('Enter a product name.', '#f-name');
  const unit = field('unit').trim();
  const product = { id: newId(), sku: field('sku').trim(), name, cost: +field('cost') || 0, price: +field('price') || 0, stock: 0, reorder: roundQty(+field('re') || 0), h: [] };
  if (unit && unit !== 'each') product.unit = unit;
  db.products.push(product);
  moveStock(db, product.id, +field('stock') || 0, 'Opening stock', 'Product added', today());
  save();
  showMessage('Added ' + name + '.', '#f-sku');
}

function setProductText(id, field, value) {
  const p = findProduct(id);
  if (!p) return;
  value = value.trim();
  if (field === 'unit' && value === 'each') value = '';
  if (field === 'name' && !value) return renderSoon(); // a product needs a name: put the old one back
  p[field] = value;
  save();
  renderSoon();
}

function setProductNumber(id, field, text) {
  const p = findProduct(id);
  if (!p) return;
  const value = +text;
  if (text === '' || isNaN(value)) return renderSoon(); // puts the old value back in the box
  if (field === 'price') setPrice(p, value, today());
  else if (field === 'stock') setStock(db, p, roundQty(value), today());
  else p[field] = field === 'reorder' ? roundQty(value) : value;
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
  const p = findProduct(id);
  const recipes = usedIn(db, id);
  if (recipes.length) return showError(`${p.name} is in the recipe of ${recipes.map(r => r.name).join(', ')}. Remove it from there first.`);
  if (!confirmed('p' + id)) return;
  if (ui.historyProductId === id) ui.historyProductId = null;
  if (ui.bomProductId === id) ui.bomProductId = null;
  db.products = db.products.filter(x => x.id !== id);
  save();
  showMessage('Deleted ' + p.name + '. Past orders keep their details.');
}

// ---- stock history and write-offs ----

function openStockHistory(id) {
  ui.historyProductId = id;
  ui.bomProductId = null;
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
  const unit = unitText(p);
  const moves = stockHistory(db, p.id), shown = moves.slice(0, 200);
  const rows = shown.map(m => `<tr><td>${m.date}</td><td class="n ${m.q < 0 ? 'neg' : 'pos'}">${m.q > 0 ? '+' : '−'}${Math.abs(m.q)}</td><td>${esc(m.why)}</td><td>${esc(m.ref || '')}</td></tr>`).join('');
  const body = rows
    ? table([th('Date'), thNum('Change'), th('Reason'), th('Reference')], rows) + (moves.length > shown.length ? `<p class="empty">Showing the latest ${shown.length} of ${moves.length} changes.</p>` : '')
    : emptyNote('No stock changes recorded yet. History starts from version 2.0 of the app, so earlier sales are not listed.');
  const writeOff = p.stock > 0 ? `<h3>Write off stock</h3>
  <form class="row" onsubmit="writeOffFromPanel(${p.id});return false">
  <label>Amount${unit}<input id="wo-qty" type="number" min="0" max="${p.stock}" step="any" style="width:100px"></label>
  <label>Reason<input id="wo-reason" list="wo-reasons" placeholder="e.g. Expired" style="width:220px"></label>
  <datalist id="wo-reasons">${WRITE_OFF_REASONS.map(r => `<option value="${r}">`).join('')}</datalist>
  <button class="btn alt">Write off</button></form>
  <p class="empty">For stock that is damaged, expired or left unsold. It comes out of stock, and its cost (${money(p.cost)} per ${esc(p.unit || 'item')}) is recorded as an expense under "${WRITE_OFF_CATEGORY}" so your profit shows the loss.</p>` : '';
  return card('Stock history: ' + esc(p.name), `<p>${p.stock}${esc(unit)} in stock now · reorder at ${p.reorder}${esc(unit)}</p>${body}${writeOff}
  <div class="row" style="margin-top:10px"><button class="btn alt" id="stock-history-close" onclick="closeStockHistory()">Close</button></div>`, 'stock-history');
}

function writeOffFromPanel(id) {
  const p = findProduct(id);
  if (!p) return;
  const qty = $('#wo-qty').value, reason = $('#wo-reason').value;
  const error = writeOffStock(db, p, qty, reason, today());
  if (error) return showError(error, '#wo-qty');
  save();
  showMessage(`Wrote off ${roundQty(+qty)}${unitText(p)} of ${p.name}.`, '#wo-qty');
}

// ---- recipes (bill of materials) and making ----
// Works like Sage 50: the recipe says what goes into one; making a quantity is a deliberate step that
// takes the components out of stock and adds the finished product. Selling never touches components.

function openBom(id) {
  ui.bomProductId = id;
  ui.historyProductId = null;
  const p = findProduct(id);
  ui.afterRender = { scroll: '#bom-panel', focus: bomOf(p).length ? '#build-qty' : '#bom-prod' };
  render();
}

function closeBom() {
  const id = ui.bomProductId;
  ui.bomProductId = null;
  ui.afterRender = { focus: `[data-focus="bom-${id}"]` };
  render();
}

function bomPanel() {
  const p = ui.bomProductId && findProduct(ui.bomProductId);
  if (!p) return '';
  const name = esc(p.name), lines = bomOf(p);
  const rows = lines.map(c => {
    const comp = findProduct(c.pid);
    const remove = `<button type="button" class="btn del sm" aria-label="Remove ${comp ? esc(comp.name) : 'deleted product'} from the recipe" onclick="removeBomLine(${p.id},${c.pid})">Remove</button>`;
    if (!comp) return `<tr><td colspan="6">A product that has been deleted</td><td>${remove}</td></tr>`;
    const short = comp.stock < c.q;
    return `<tr><td>${esc(comp.name)}</td>
      <td class="n"><input type="number" min="0" step="any" value="${c.q}" data-focus="bom-${p.id}-${c.pid}" aria-label="Amount of ${esc(comp.name)} in one ${name}" onchange="setBomQty(${p.id},${c.pid},this.value)"></td>
      <td>${esc(comp.unit || 'each')}</td><td class="n">${money(comp.cost)}</td><td class="n">${money(c.q * comp.cost)}</td>
      <td class="n ${short ? 'neg' : ''}">${comp.stock}</td><td>${remove}</td></tr>`;
  }).join('');
  const choices = db.products.filter(x => x.id !== p.id && !bomUses(db, x, p.id) && !lines.some(c => c.pid === x.id));
  const addLine = choices.length ? `<form class="row" onsubmit="addBomLine(${p.id});return false">
  <label>Add a component<select id="bom-prod">${choices.map(x => `<option value="${x.id}">${esc(x.name)}${x.unit ? ' (' + esc(x.unit) + ')' : ''}</option>`).join('')}</select></label>
  <label>Amount in one ${name}<input id="bom-qty" type="number" min="0" step="any" style="width:110px"></label>
  <button class="btn alt">Add</button></form>` : emptyNote('Add the ingredients and packaging as products first, then list them here.');

  const recipe = lines.length
    ? table([th('Component'), thNum('Amount in one'), th('Unit'), thNum('Cost per unit'), thNum('Cost in one'), thNum('In stock'), th('')], rows)
      + `<p><b>Components cost ${money(bomCost(db, p))} per ${name}</b> at today's cost prices. ${p.price ? `It sells for ${money(p.price)}.` : ''}</p>`
    : emptyNote(`No recipe yet. List what goes into one ${name}: ingredients, packaging, or other things you make (a platter can contain pastries).`);

  const most = maxBuildable(db, p);
  const make = lines.length ? `<h3>Make ${name}</h3>
  <form class="row" onsubmit="buildFromPanel(${p.id});return false">
  <label>How many<input id="build-qty" type="number" min="0" step="any" style="width:100px"></label>
  <button class="btn">Make</button></form>
  <p class="empty">${most > 0 ? `You have enough to make ${most}.` : 'You don\'t have enough components to make any yet.'} Making takes the components out of stock and adds the ${name} to stock at what the components cost. Record it when you make them, before you sell them.</p>` : '';

  return card('Recipe: ' + name, `<p class="empty">Also called a bill of materials. In stock: ${p.stock}${esc(unitText(p))}, costing ${money(p.cost)} each.</p>${recipe}${addLine}${make}
  <div class="row" style="margin-top:10px"><button class="btn alt" id="bom-close" onclick="closeBom()">Close</button></div>`, 'bom-panel');
}

function addBomLine(id) {
  const p = findProduct(id);
  if (!p) return;
  const qty = +$('#bom-qty').value;
  if (!(qty > 0)) return showError(`Enter how much goes into one ${p.name}.`, '#bom-qty');
  const error = setBomLine(db, p, +$('#bom-prod').value, qty);
  if (error) return showError(error, '#bom-prod');
  save();
  ui.afterRender = { focus: '#bom-prod' };
  render();
}

function setBomQty(id, componentId, text) {
  const p = findProduct(id);
  if (!p) return;
  const value = +text;
  if (text === '' || !(value >= 0)) return renderSoon();
  const error = setBomLine(db, p, componentId, value);
  if (error) return showError(error);
  save();
  renderSoon();
}

function removeBomLine(id, componentId) {
  const p = findProduct(id);
  if (!p) return;
  p.bom = bomOf(p).filter(c => c.pid !== componentId);
  save();
  ui.afterRender = { focus: '#bom-panel' };
  render();
}

function buildFromPanel(id) {
  const p = findProduct(id);
  if (!p) return;
  const result = buildProduct(db, p, $('#build-qty').value, today());
  if (result.error) return showError(result.error, '#build-qty');
  save();
  showMessage(`Made ${roundQty(+$('#build-qty').value)}${unitText(p)} ${p.name} (${result.no}), at ${money(result.unitCost)} each in components.`, '#build-qty');
}
