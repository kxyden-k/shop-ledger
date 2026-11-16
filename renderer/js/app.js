// The page frame: tabs in the header, the backup warning, and the current tab's screen.
// Every screen is a function returning HTML; render() redraws the whole page from db and ui.

const TABS = {
  dash: { label: 'Dashboard', screen: dashboardScreen },
  prod: { label: 'Products & stock', screen: productsScreen },
  ord: { label: 'Orders', screen: ordersScreen },
  cust: { label: 'Customers', screen: customersScreen },
  buy: { label: 'Purchasing', screen: purchasingScreen },
  exp: { label: 'Expenses', screen: expensesScreen },
  rep: { label: 'Reports', screen: reportsScreen },
  set: { label: 'Settings', screen: settingsScreen }
};
// The developer's own tab. It only exists when running from source with the private key present.
if (licencesAvailable()) TABS.lic = { label: 'Licences', screen: licencesScreen };

function navButtons() {
  const lowStock = db.products.filter(isLowStock).length;
  return Object.entries(TABS).map(([key, t]) => {
    const on = ui.tab === key;
    const badge = key === 'prod' && lowStock ? ` <span class="badge" aria-label="${lowStock} low on stock">${lowStock}</span>` : '';
    return `<button class="${on ? 'on' : ''}" data-focus="tab-${key}"${on ? ' aria-current="page"' : ''} onclick="goTo('${key}')">${t.label}${badge}</button>`;
  }).join('');
}

// Finds the focused element again after a redraw, by id or data-focus.
function focusSelector(el) {
  if (!el || el === document.body) return '';
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.dataset && el.dataset.focus) return `[data-focus="${CSS.escape(el.dataset.focus)}"]`;
  return '';
}

function render() {
  // Redrawing replaces every element, so remember where the cursor was and put it back.
  const active = document.activeElement, previousFocus = focusSelector(active);
  let selection = null;
  try { if (typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd]; } catch (e) { /* not a text field */ }

  $('#ver').textContent = 'v' + window.api.info().version;
  $('#nav').innerHTML = navButtons();
  $('#app').innerHTML = backupBanner() + sendPanel() + TABS[ui.tab].screen();

  const after = ui.afterRender || {};
  ui.afterRender = null;
  const target = after.focus ? $(after.focus) : previousFocus ? $(previousFocus) : null;
  if (target) {
    target.focus({ preventScroll: !after.focus });
    if (selection && !after.focus) try { target.setSelectionRange(...selection); } catch (e) { /* not a text field */ }
  }
  if (after.scroll && $(after.scroll)) $(after.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Escape backs out of whatever is open, innermost first.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (ui.confirming) { ui.confirming = null; render(); }
  else if (ui.send) closeSend();
  else if (ui.creditForm) toggleCreditForm(false);
  else if (ui.tab === 'ord' && ui.openOrderId) closeOrder();
  else if (ui.tab === 'prod' && ui.historyProductId) closeStockHistory();
  else hideToast();
});

render();
