// Settings tab: app info, backups, PIN lock, business details, email, currency and raw data.

function settingsScreen() {
  return aboutCard() + backupCard() + securityCard() + businessCard() + emailCard() + currencyCard() + manualDataCard();
}

// ---- about ----

function aboutCard() {
  const info = window.api.info();
  return card('About this app', `<p>Version ${esc(info.version)}<br>Data folder: ${esc(info.dataDir)}</p><div class="row"><button class="btn alt" onclick="window.api.openData()">Open data folder</button><button class="btn alt" onclick="checkForUpdates(this)">Check for updates</button></div>`);
}

async function checkForUpdates(button) {
  const text = await whileBusy(button, 'Checking…', () => window.api.checkUpdate());
  if (text) toast(text, /^Could not/.test(text));
}

// ---- off-computer backups ----

// Shown above every screen while backups are missing, failing or out of date.
function backupBanner() {
  const b = window.api.backupGet(), canBackUp = b.folder && b.folderOk;
  let warning = '';
  if (!b.folder) warning = 'Your data is only stored on this computer. Choose a backup folder so a lost or broken computer does not mean lost records.';
  else if (!b.folderOk) warning = 'The backup folder cannot be found. Is the drive or cloud folder connected? Backups are not being saved.';
  else if (b.lastError) warning = 'The last backup failed: ' + b.lastError;
  else if (!b.lastOk) warning = 'No backup has been made yet.';
  else if (Date.now() - b.lastOk > 3 * DAY_MS) warning = 'The last backup was ' + Math.floor((Date.now() - b.lastOk) / DAY_MS) + ' days ago.';
  if (!warning) return '';
  const button = canBackUp ? '<button class="btn sm" onclick="backUpNow(this)">Back up now</button>'
    : `<button class="btn sm" onclick="openBackupSettings()">Open settings</button>`;
  return `<div class="msg warnbar"><b>Backup warning:</b> ${esc(warning)} ${button}</div>`;
}

function openBackupSettings() {
  goTo('set');
  $('#backups').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backupCard() {
  const b = window.api.backupGet();
  const passwordPrompt = ui.pendingRestoreFile
    ? '<form class="row" onsubmit="restoreBackup(ui.pendingRestoreFile,this.querySelector(\'.btn\'));return false"><label>Backup password<input id="rs-pw" type="password" style="width:200px"></label><button class="btn">Restore</button></form>'
    : '';
  return card('Backups outside this computer', `
  <p>A backup is saved to a folder you choose once a day, again after you make changes, and when you close the app. Pick a folder inside OneDrive, Google Drive or Dropbox to get it into the cloud automatically, or use a USB or network drive. The newest 30 days are kept.</p>
  <p>Folder: <b>${esc(b.folder || 'not chosen yet')}</b>${b.folder && !b.folderOk ? ' <span class="neg">(cannot be reached)</span>' : ''}<br>Last successful backup: ${b.lastOk ? new Date(b.lastOk).toLocaleString() : 'never'}</p>
  <div class="row"><button class="btn" onclick="chooseBackupFolder(this)">${b.folder ? 'Change folder' : 'Choose folder'}</button><button class="btn alt" onclick="backUpNow(this)"${b.folder ? '' : ' disabled'}>Back up now</button></div>
  <form class="row" style="margin-top:12px" onsubmit="saveBackupSettings(this.querySelector('.btn'));return false"><label style="flex-direction:row;align-items:center;gap:6px"><input id="bk-enc" type="checkbox" ${b.encrypt ? 'checked' : ''}>Protect backups with a password</label>
  <label>${b.hasPass ? 'New password (empty keeps the current one)' : 'Password'}<input id="bk-pw" type="password" style="width:220px"></label><button class="btn alt">Save</button></form>
  <p class="empty">If the password is forgotten, the backups cannot be opened and nobody can recover them, so write it down somewhere safe. Earlier unencrypted backups stay in the folder until they age out.</p>
  <div class="row"><button class="btn alt" onclick="restoreBackup(null,this)">Restore from a backup file…</button></div>${passwordPrompt}`, 'backups');
}

async function chooseBackupFolder(button) {
  const result = await whileBusy(button, 'Backing up…', () => window.api.backupFolder());
  if (result) showResult(result);
}

async function backUpNow(button) {
  const result = await whileBusy(button, 'Backing up…', () => window.api.backupNow());
  if (result) showResult(result);
}

async function saveBackupSettings(button) {
  const settings = { encrypt: $('#bk-enc').checked, password: $('#bk-pw').value };
  const result = await whileBusy(button, 'Saving…', () => window.api.backupSettings(settings));
  if (!result) return;
  if (result.ok) showMessage(result.msg);
  else showError(result.msg, '#bk-pw'); // no redraw, so the typed password stays
}

// Without a file, the main process asks the user to pick one. If that file is password protected,
// it comes back with needPassword and we show a password box that calls this again with the file.
async function restoreBackup(file, button) {
  const password = file && $('#rs-pw') ? $('#rs-pw').value : '';
  const result = await whileBusy(button, 'Restoring…', () => window.api.backupRestore({ file, password }));
  if (!result) return;
  ui.pendingRestoreFile = result.needPassword ? result.file : null;
  if (result.needPassword) {
    ui.afterRender = { focus: '#rs-pw' };
    render();
    return showError(result.msg, '#rs-pw');
  }
  if (result.ok) {
    reloadData();
    ui.draft = emptyDraftOrder();
    ui.selectedCustomer = ui.invoiceOrderId = null;
  }
  showResult(result);
}

// ---- PIN lock ----

function securityCard() {
  const pin = window.api.pinStatus(), access = window.api.accessInfo();
  const licence = access.enforced
    ? 'Licensed to <b>' + esc(access.who) + '</b>, '
      + (access.exp ? 'valid until ' + new Date(access.exp).toISOString().slice(0, 10) : 'no expiry')
      + (access.lastOk ? '. Last verified ' + new Date(access.lastOk).toLocaleString() : '')
    : 'Development mode, no token required';
  const pinBoxes = (pin.set ? '<label>Current PIN<input id="pin-old" type="password" autocomplete="current-password" style="width:120px"></label>' : '')
    + `<label>${pin.set ? 'New PIN' : 'Set a PIN'}<input id="pin-new" type="password" autocomplete="new-password" placeholder="at least 4 characters" style="width:190px"></label>`;
  const extraButtons = pin.set ? '<button type="button" class="btn alt" onclick="savePin(true)">Remove PIN</button><button type="button" class="btn alt" onclick="window.api.lock()">Lock now</button>' : '';
  return card('Security', `<p>${licence}.</p>
  <form class="row" onsubmit="savePin(false);return false">${pinBoxes}
  <button class="btn">${pin.set ? 'Change PIN' : 'Turn on PIN lock'}</button>
  ${extraButtons}</form>
  <p class="empty">With a PIN, the app asks for it when it opens and after ${access.idleMinutes} minutes of inactivity, and waits longer after repeated wrong tries. It keeps casual users out; it does not encrypt the data file.</p>`);
}

async function savePin(remove) {
  const pin = $('#pin-new').value, old = $('#pin-old') ? $('#pin-old').value : '';
  if (!remove && !pin) return showError('Enter a PIN first.', '#pin-new');
  if ($('#pin-old') && !old) return showError('Enter your current PIN first.', '#pin-old');
  const result = await whileBusy(null, '', () => window.api.pinSet({ old, pin: remove ? '' : pin }));
  if (!result) return;
  if (result.ok) showMessage(result.msg);
  else showError(result.msg, /Current PIN|attempts/.test(result.msg) ? '#pin-old' : '#pin-new');
}

// ---- business details (printed on invoices) ----

function businessCard() {
  const b = db.biz;
  const attrs = (key, label) => `data-focus="biz-${key}" onchange="setBusinessField('${key}',this.value)" aria-label="${label}"`;
  const input = (key, label, width = 200) =>
    `<label>${label}<input value="${esc(b[key] || '')}" ${attrs(key, label)} style="width:${width}px"></label>`;
  const textarea = (key, label) =>
    `<label>${label}<textarea style="height:72px;width:260px" ${attrs(key, label)}>${esc(b[key] || '')}</textarea></label>`;
  return card('Business details for invoices', `
  <div class="row">${input('name', 'Business name', 240)}${input('email', 'Email', 220)}${input('phone', 'Phone', 150)}${input('taxId', 'Tax or VAT number', 170)}${input('prefix', 'Invoice prefix', 100)}
  <label>Tax rate %<input type="number" step="0.01" min="0" value="${b.taxRate || 0}" data-focus="biz-taxRate" onchange="setBusinessField('taxRate',+this.value)" style="width:90px"></label>
  <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" ${b.taxIncl ? 'checked' : ''} data-focus="biz-taxIncl" onchange="setBusinessField('taxIncl',this.checked)">Prices already include tax</label></div>
  <div class="row" style="margin-top:10px">${textarea('address', 'Address')}${textarea('bank', 'Bank or payment details')}${textarea('footer', 'Footer note')}</div>
  <p class="empty" id="biz-saved" aria-live="polite">Changes save as soon as you leave a box.</p>`);
}

function setBusinessField(key, value) {
  db.biz[key] = value;
  save();
  const note = $('#biz-saved');
  if (note) note.textContent = 'Saved.';
}

// ---- email (SMTP) ----

function emailCard() {
  const m = window.api.mailGet();
  const input = (id, label, value, width, type = 'text') =>
    `<label>${label}<input id="${id}" type="${type}" value="${esc(value)}" style="width:${width}px"></label>`;
  return card('Email setup', `
  <p>Invoices are sent from your own email account. Gmail: server smtp.gmail.com, port 587, and an app password (Google account, Security, 2-step verification, App passwords). Outlook: server smtp.office365.com, port 587.</p>
  <form class="row" onsubmit="saveEmailSettings(this.querySelector('.btn'));return false">${input('m-host', 'Server', m.host, 200)}${input('m-port', 'Port', m.port, 70, 'number')}${input('m-user', 'Username', m.user, 220)}${input('m-pass', 'Password', '', 180, 'password')}${input('m-from', 'From address', m.from, 220)}
  <label style="flex-direction:row;align-items:center;gap:6px"><input id="m-sec" type="checkbox" ${m.secure ? 'checked' : ''}>SSL (port 465)</label>
  <button class="btn">Save email settings</button><button type="button" class="btn alt" onclick="sendTestEmail(this)">Save and send a test email to myself</button></form>
  <p class="empty">${m.hasPass ? 'A password is saved. Leave the box empty to keep it.' : 'No password saved yet.'}</p>`);
}

const emailFormValues = () => ({
  host: $('#m-host').value.trim(), port: $('#m-port').value, secure: $('#m-sec').checked,
  user: $('#m-user').value.trim(), from: $('#m-from').value.trim(), pass: $('#m-pass').value
});

async function saveEmailSettings(button) {
  const values = emailFormValues();
  const result = await whileBusy(button, 'Saving…', () => window.api.mailSet(values));
  if (!result) return;
  if (result.ok) showMessage(result.msg);
  else showError(result.msg);
}

// Saves first, so the test uses what is on screen rather than the last saved settings.
async function sendTestEmail(button) {
  const values = emailFormValues();
  const result = await whileBusy(button, 'Sending…', async () => {
    const saved = await window.api.mailSet(values);
    return saved.ok ? window.api.mailTest() : saved;
  });
  if (!result) return;
  if (result.ok) showMessage(result.msg);
  else showError(result.msg);
}

// ---- currency ----

function currencyCard() {
  return card('Currency symbol', `<input id="cur" value="${esc(db.cur)}" style="width:80px" aria-label="Currency symbol" oninput="setCurrency(this.value)"><p class="empty">Shown in front of every amount, e.g. R, $ or €.</p>`);
}

function setCurrency(symbol) { db.cur = symbol; save(); renderSoon(); }

// ---- copy, paste and erase all data ----

function manualDataCard() {
  const armed = ui.confirming === 'wipe';
  return card('Manual copy of your data (advanced)', `
  <p>A backup is saved automatically in the data folder every day. Copy the text below to move your data to another computer. To restore, paste it here and load it.</p>
  <textarea id="bk" aria-label="Data as text">${esc(JSON.stringify(db))}</textarea>
  <div class="row" style="margin-top:8px"><button class="btn" onclick="loadPastedData()">Load pasted backup</button>
  <button class="btn del${armed ? ' armed' : ''}" data-focus="del-wipe" onclick="eraseAllData()">${armed ? 'Confirm: erase everything' : 'Erase all data'}</button></div>
  <p class="empty">Erasing removes all products, orders and expenses. Business details, email settings and invoice numbering are kept.</p>`);
}

function loadPastedData() {
  try {
    const pasted = JSON.parse($('#bk').value);
    if (!pasted.products || !pasted.orders) throw new Error('not a backup');
    window.api.save(pasted);
    location.reload();
  } catch (e) {
    showError('That text is not a valid backup.', '#bk');
  }
}

function eraseAllData() {
  if (!confirmed('wipe')) return;
  db = clearRecords(db);
  save();
  ui.draft = emptyDraftOrder();
  ui.selectedCustomer = ui.invoiceOrderId = null;
  showMessage('All products, orders and expenses erased.');
}
