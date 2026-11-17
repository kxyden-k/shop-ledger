// The page frame: the sidebar, the page header, the backup warning, and the current tab's screen.
// Two kinds of screen live side by side while the app moves to Preact:
//   string screens    a function returning HTML; render() redraws them completely
//   component screens a Preact component (screens/*.mjs) that registers itself below; render()
//                     asks Preact to update it, which keeps focus and typing intact on its own

// title: shown in the sidebar and as the page heading. intro: one line under the heading.
// actions: optional function returning the buttons on the right of the page heading.
const TABS = {
  dash: { label: 'Dashboard', screen: dashboardScreen, actions: dashboardActions, intro: 'How the business is doing at a glance.' },
  ins: { label: 'Insights', component: true, intro: 'Your key ratios against your targets, and what to do about them.' },
  ord: { label: 'Orders', screen: ordersScreen, actions: ordersActions, intro: 'Orders, quotes and credit notes. Open an order to take a payment, send its invoice or issue a credit note.' },
  cust: { label: 'Customers', screen: customersScreen, intro: 'Everyone who has ordered from you, what they spend and what they owe.' },
  prod: { label: 'Products & stock', screen: productsScreen, actions: productsActions, intro: 'Your products, prices and stock levels. Click any value in the table to change it.' },
  buy: { label: 'Purchasing', screen: purchasingScreen, actions: purchasingActions, intro: 'Your suppliers, and purchase orders that add stock when the goods arrive.' },
  exp: { label: 'Expenses', screen: expensesScreen, actions: expensesActions, intro: 'Running costs such as rent, ads and packaging. They come off your profit.' },
  rep: { label: 'Reports', screen: reportsScreen, intro: 'Reports for any period, to read here, open in a spreadsheet or save as PDF.' },
  set: { label: 'Settings', screen: settingsScreen, intro: 'Your business details, email, backups and security.' }
};
// The developer's own tab. It only exists when running from source with the private key present.
if (licencesAvailable()) TABS.lic = { label: 'Licences', screen: licencesScreen, intro: 'Issue and revoke your customers\' access tokens. Only you see this tab.' };

// Sidebar sections. The last one sits at the bottom.
const NAV_GROUPS = [['Overview', ['dash', 'ins']], ['Sales', ['ord', 'cust']], ['Stock', ['prod', 'buy']], ['Money', ['exp', 'rep']], ['', ['set', 'lic']]];

// Component screens register here from their module: {mount(element), unmount(element)}.
const componentScreens = {};
function registerComponentScreen(key, mount, unmount) { componentScreens[key] = { mount, unmount }; }
let mountedComponent = null; // key of the component screen currently in #app

function navButton(key) {
  const on = ui.tab === key, lowStock = key === 'prod' ? db.products.filter(isLowStock).length : 0;
  const badge = lowStock ? ` <span class="badge" aria-label="${lowStock} low on stock">${lowStock}</span>` : '';
  return `<button class="${on ? 'on' : ''}" data-focus="tab-${key}"${on ? ' aria-current="page"' : ''} onclick="goTo('${key}')">${TABS[key].label}${badge}</button>`;
}

function navButtons() {
  return NAV_GROUPS.map(([heading, keys]) => {
    const items = keys.filter(k => TABS[k]).map(navButton).join('');
    return items ? `<div class="nav-group">${heading ? `<div class="nav-heading">${heading}</div>` : ''}${items}</div>` : '';
  }).join('');
}

function pageHeader() {
  const t = TABS[ui.tab], actions = t.actions ? t.actions() : '';
  return `<div class="page-head"><div><h1>${t.label}</h1><p>${t.intro}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

// Finds the focused element again after a redraw, by id or data-focus.
function focusSelector(el) {
  if (!el || el === document.body) return '';
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.dataset && el.dataset.focus) return `[data-focus="${CSS.escape(el.dataset.focus)}"]`;
  return '';
}

function drawScreen(app) {
  const tab = TABS[ui.tab];
  if (mountedComponent && mountedComponent !== ui.tab) { componentScreens[mountedComponent].unmount(app); mountedComponent = null; }
  if (!tab.component) { app.innerHTML = tab.screen(); return; }
  const component = componentScreens[ui.tab];
  if (!component) { app.innerHTML = card(tab.label, emptyNote('This screen could not be loaded. Restart the app, and if it keeps happening, reinstall it.')); return; }
  if (!mountedComponent) app.innerHTML = '';
  component.mount(app);
  mountedComponent = ui.tab;
}

function render() {
  // String screens replace every element, so remember where the cursor was and put it back.
  const active = document.activeElement, previousFocus = focusSelector(active);
  let selection = null;
  try { if (typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd]; } catch (e) { /* not a text field */ }

  $('#ver').textContent = 'v' + window.api.info().version;
  $('#biz-name').textContent = db.biz.name;
  $('#nav').innerHTML = navButtons();
  $('#top').innerHTML = pageHeader() + backupBanner() + sendPanel();
  drawScreen($('#app'));

  const after = ui.afterRender || {};
  ui.afterRender = null;
  const target = after.focus ? $(after.focus) : previousFocus ? $(previousFocus) : null;
  if (target && (after.focus || target !== active)) {
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

// Module scripts (the component screens) run after this file but before DOMContentLoaded,
// so waiting for it means every screen has registered before the first draw.
document.addEventListener('DOMContentLoaded', render);
