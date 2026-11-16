// What the screens read and change:
//   db  the saved data (its shape is described at the top of ledger.js). Call save() after changing it.
//   ui  what is on screen right now. Not saved.
// After changing either one, call render() (app.js) to redraw the page.

let db = window.api.load();

const emptyDraftOrder = () => ({ cust: '', email: '', date: today(), fee: 0, items: [] });
const emptyDraftPurchase = () => ({ supplierId: null, date: today(), items: [] });

const ui = {
  tab: 'dash',
  period: 'all',            // dashboard period, see isInPeriod()
  confirming: null,         // the delete button waiting for its second click, e.g. 'p12' or 'wipe'
  ordersView: 'orders',     // Orders tab: 'orders' | 'quotes' | 'credits'
  openOrderId: null,        // order whose panel (payments, credit notes, invoice) is open
  creditForm: false,        // the "new credit note" form inside the order panel
  send: null,               // the "send as PDF or email" panel, see screens/send.js
  draft: emptyDraftOrder(), // the "New order" form
  purchasingView: 'orders', // Purchasing tab: 'orders' | 'suppliers'
  purchaseDraft: emptyDraftPurchase(),
  historyProductId: null,   // product whose stock history is open
  report: { id: 'pnl', preset: 'year', from: '', to: '' },
  productSearch: '',
  orderSearch: '',
  orderStatusFilter: '',    // '' shows every status
  customerSearch: '',
  customerSort: 'spent',
  selectedCustomer: null,   // key of the customer whose details are open
  pendingRestoreFile: null, // password-protected backup waiting for its password
  afterRender: null         // {focus, scroll}: selectors applied once, after the next render
};

function save() { window.api.save(db); }
function reloadData() { db = window.api.load(); }
const newId = () => db.n++;

const findProduct = id => productById(db.products, id);
const findOrder = id => db.orders.find(o => o.id === id);
const customers = () => summarizeCustomers(db);

const money = v => fmtMoney(db.cur, v);

// Forget anything on screen that points at records, after the data is replaced or erased.
function resetScreens() {
  Object.assign(ui, { openOrderId: null, creditForm: false, send: null, selectedCustomer: null, historyProductId: null,
    draft: emptyDraftOrder(), purchaseDraft: emptyDraftPurchase() });
}

function goTo(tab) {
  ui.tab = tab;
  ui.confirming = null;
  render();
  window.scrollTo(0, 0);
}

// For change events. Waiting a moment lets a Tab keypress move focus first, so render() keeps
// focus on the field the user moved to instead of dropping it.
let renderQueued = false;
function renderSoon() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); });
}

// ---- notices ----
// Shown in a corner toast so they are seen however far down the page you are.
// showMessage is for success: it redraws, because the action changed something.
// showError does not redraw, so whatever the user typed stays in the form.
// focus: selector of the field to fix, or to carry on typing in.

let toastTimer = null;
function toast(text, isError) {
  const el = $('#toast');
  el.className = 'toast' + (isError ? ' error' : '');
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(text)}</span><button class="toast-close" aria-label="Dismiss" onclick="hideToast()">×</button>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, isError ? 9000 : 4500);
}
function hideToast() { $('#toast').hidden = true; }

function showMessage(text, focus) {
  toast(text, false);
  if (focus) ui.afterRender = { ...ui.afterRender, focus };
  render();
}

function showError(text, focus) {
  toast(text, true);
  const field = focus && $(focus);
  if (field) { field.focus(); if (field.select) field.select(); }
}

// For {ok, msg} results from the main process. Cancelling a dialog isn't an error.
function showResult(result) {
  if (result.ok || /cancelled\.$|^No folder chosen/.test(result.msg)) showMessage(result.msg);
  else { render(); showError(result.msg); }
}

// Disables the clicked button while slow work runs (email, PDF, backups), so it can't be sent twice.
// Returns the work's result, or undefined if it was already running or failed.
async function whileBusy(button, busyLabel, work) {
  if (button) {
    if (button.disabled) return;
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
  }
  try {
    return await work();
  } catch (e) {
    showError('Something went wrong: ' + e.message);
  } finally {
    if (button && button.isConnected) { button.disabled = false; button.textContent = button.dataset.label; }
  }
}

// ---- delete buttons ----
// They need two clicks: the first turns the button red and into "Confirm". Escape cancels.
// confirmed() returns true on the second click.
function confirmed(key) {
  if (ui.confirming === key) { ui.confirming = null; return true; }
  ui.confirming = key;
  render();
  return false;
}

function deleteButton(key, itemName, onclick) {
  const armed = ui.confirming === key;
  return `<button type="button" class="btn del sm${armed ? ' armed' : ''}" data-focus="del-${key}" aria-label="${armed ? 'Confirm deleting' : 'Delete'} ${esc(itemName)}" onclick="${onclick}">${armed ? 'Confirm' : 'Delete'}</button>`;
}
