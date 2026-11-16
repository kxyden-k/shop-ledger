const { app, BrowserWindow, ipcMain, shell, dialog, net, powerMonitor, safeStorage, clipboard } = require('electron');
const path = require('path'), fs = require('fs');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { createStore, migrate } = require('./db');
const backup = require('./backup');
const { documentHtml, toCsv } = require('./pdf-template');
const createMail = require('./mail');
const sec = require('./security');
const CFG = require('./access.config.json');

// Installed builds always require an access token. `npm start` skips it unless REQUIRE_ACCESS=1.
const ENFORCE = app.isPackaged || process.env.REQUIRE_ACCESS === '1';
let win, store, cache, mail;
let dirty = false, folderOk = false; // dirty: changes saved since the last off-computer backup
let S = { mode: 'boot', msg: '' }; // mode: activate | stale | pin | open. Data is only served when 'open'.

const dir = () => app.getPath('userData');
const log = m => { try { fs.appendFileSync(path.join(dir(), 'app.log'), new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} };
const jread = (n, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8')); } catch (e) { return d; } };
const jwrite = (n, v) => fs.writeFileSync(path.join(dir(), n), JSON.stringify(v));
const pinSet = () => !!jread('pin.json', null);
const publicKey = () => { try { return fs.readFileSync(path.join(__dirname, 'access', 'public.pem'), 'utf8'); } catch (e) { return null; } };

// Every message is checked in the main process: it must come from our own window, and data
// calls only work while the app is unlocked. The screens cannot bypass this.
const trusted = e => win && e.sender === win.webContents && e.senderFrame === e.sender.mainFrame;
const ok = (e, open) => trusted(e) && (!open || S.mode === 'open');
const sync = (ch, fn, open = true) => ipcMain.on(ch, (e, ...a) => { e.returnValue = ok(e, open) ? fn(e, ...a) : null; });
const send = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (ok(e, true)) fn(e, ...a); });
const call = (ch, fn, open = true) => ipcMain.handle(ch, (e, ...a) => ok(e, open) ? fn(e, ...a) : { ok: false, msg: 'Locked.' });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start);
}

function show() { win.loadFile(path.join(__dirname, 'renderer', S.mode === 'open' ? 'index.html' : 'gate.html')); }
function lockNow() { if (S.mode === 'open' && pinSet()) { S.mode = 'pin'; show(); } }

// Decide from what is stored on this machine (fast, works offline).
function evaluateLocal(keepOpen) {
  const open = () => { S.mode = keepOpen && S.mode === 'open' ? 'open' : (pinSet() ? 'pin' : 'open'); S.msg = ''; };
  if (!ENFORCE) { S.who = 'Development'; return open(); }
  const pub = publicKey();
  if (!pub) { S = { mode: 'stale', msg: 'This build has no access key installed.' }; return; }
  const a = jread('access.json', {}), v = sec.verifyToken(a.token, pub);
  if (!v.ok) { S = { mode: 'activate', msg: a.token ? v.reason : '' }; return; }
  Object.assign(S, { who: v.payload.name, id: v.payload.id, exp: v.payload.exp, lastOk: a.lastOk });
  const ev = sec.evaluate(v.payload, a.revoked, a.lastOk, Date.now(), CFG.graceDays);
  if (ev.state === 'revoked') { S.mode = 'activate'; S.msg = 'Access for this installation has been withdrawn. ' + CFG.contact; }
  else if (ev.state === 'expired') { S.mode = 'activate'; S.msg = 'This access token has expired. ' + CFG.contact; }
  else if (ev.state === 'stale') { S.mode = 'stale'; S.msg = 'The app could not confirm your access for more than ' + CFG.graceDays + ' days. Connect to the internet and try again.'; }
  else open();
}

// Ask the internet for the revoked list, then re-decide. Runs in the background.
async function refresh() {
  if (!ENFORCE) return;
  const a = jread('access.json', {});
  if (!a.token) return;
  try {
    const r = await net.fetch(CFG.revocationUrl + '?t=' + Date.now(), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    a.revoked = ((await r.json()).revoked || []).map(String); a.lastOk = Date.now();
    jwrite('access.json', a);
  } catch (e) { log('access check failed ' + e.message); }
  const was = S.mode; evaluateLocal(true);
  if (S.mode !== was) show();
}

const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);

// Renders the page in a hidden window with scripts off. It goes through a temporary file
// because a long report does not fit in a data: address.
async function makePdf(html, landscape) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
  const file = path.join(app.getPath('temp'), 'shop-ledger-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.html');
  try {
    fs.writeFileSync(file, html);
    await w.loadFile(file);
    return await w.webContents.printToPDF({ pageSize: 'A4', landscape: !!landscape, printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
  } finally {
    w.destroy();
    try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
  }
}

// ---- off-computer backups ----
const bcfg = () => jread('backup.json', {});
const bpass = c => (c.encrypt && c.pass) ? safeStorage.decryptString(Buffer.from(c.pass, 'base64')) : '';
const backupDue = () => { const c = bcfg(); return !!c.folder && (!c.lastOk || new Date(c.lastOk).toDateString() !== new Date().toDateString()); };
async function checkFolder() { // async with a timeout, so an unplugged drive can never freeze the app
  const c = bcfg();
  if (!c.folder) { folderOk = false; return; }
  try { await Promise.race([fs.promises.access(c.folder), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); folderOk = true; }
  catch (e) { folderOk = false; }
}
function doBackup() {
  const c = bcfg();
  try {
    if (c.encrypt && !c.pass) throw new Error('Encryption is on but no password is saved.');
    const r = backup.writeBackup(c.folder, store.load().data, bpass(c));
    c.lastOk = Date.now(); c.lastError = ''; jwrite('backup.json', c); dirty = false;
    return { ok: true, msg: 'Backed up to ' + r.file };
  } catch (e) { c.lastError = e.message; jwrite('backup.json', c); log('backup failed ' + e.message); return { ok: false, msg: 'Backup failed: ' + e.message }; }
}
async function runBackup() {
  if (!bcfg().folder) return { ok: false, msg: 'Choose a backup folder first.' };
  await checkFolder();
  if (!folderOk) return { ok: false, msg: 'The backup folder cannot be reached. Is the drive or cloud folder connected?' };
  return doBackup();
}

function register() {
  // data
  sync('db:load', () => { const d = cache || store.load().data; cache = null; return d; });
  send('db:save', (e, d) => { try { store.save(d); dirty = true; } catch (err) { log('save failed ' + err.message); dialog.showErrorBox('Could not save your changes', err.message); } });
  sync('app:info', () => ({ version: app.getVersion(), dataDir: dir() }));
  send('app:open-data', () => shell.openPath(dir()));
  call('update:check', async () => {
    if (!app.isPackaged) return 'Updates only work in the installed app.';
    try {
      const r = await autoUpdater.checkForUpdates();
      return r && r.isUpdateAvailable ? 'Version ' + r.updateInfo.version + ' is downloading. It installs when you close the app.' : 'You are up to date.';
    } catch (e) { log('update check failed ' + e.message); return 'Could not check for updates: ' + e.message; }
  });
  // email and invoices
  sync('mail:get', () => mail.get());
  call('mail:set', (e, c) => { try { mail.set(c); return { ok: true, msg: 'Email settings saved.' }; } catch (err) { return { ok: false, msg: err.message }; } });
  call('mail:test', async () => {
    try {
      const c = mail.get(), to = c.from || c.user;
      await mail.send({ to, subject: 'Shop Ledger test email', text: 'Email is set up correctly.' });
      return { ok: true, msg: 'Test email sent to ' + to + '.' };
    } catch (err) { log('test mail failed ' + err.message); return { ok: false, msg: 'Email failed: ' + err.message }; }
  });
  // Any document (invoice, quote, credit note, purchase order, statement, report) as a PDF: saved or emailed.
  call('doc:run', async (e, a) => {
    try {
      const label = String(a.filename || 'Document'), name = safeName(label) + '.pdf';
      const pdf = await makePdf(documentHtml(a.doc, a.biz), a.doc && a.doc.wide);
      if (a.mode === 'save') {
        const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (r.canceled) return { ok: false, msg: 'Save cancelled.' };
        fs.writeFileSync(r.filePath, pdf); shell.showItemInFolder(r.filePath);
        return { ok: true, msg: 'Saved ' + path.basename(r.filePath) + '.' };
      }
      try { await mail.send({ to: a.to, subject: a.subject, text: a.message, filename: name, pdf }); }
      catch (err) { log('email failed ' + err.message); return { ok: false, msg: 'Could not email it: ' + err.message }; }
      return { ok: true, msg: label + ' emailed to ' + a.to + '.' };
    } catch (err) { log('document failed ' + err.message); return { ok: false, msg: 'Could not create the document: ' + err.message }; }
  });
  call('export:csv', async (e, a) => {
    try {
      const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safeName(a.filename || 'Export') + '.csv'), filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }] });
      if (r.canceled) return { ok: false, msg: 'Save cancelled.' };
      fs.writeFileSync(r.filePath, toCsv(a.rows)); shell.showItemInFolder(r.filePath);
      return { ok: true, msg: 'Saved ' + path.basename(r.filePath) + '.' };
    } catch (err) { log('export failed ' + err.message); return { ok: false, msg: 'Export failed: ' + err.message }; }
  });
  send('clip:copy', (e, text) => clipboard.writeText(String(text || '')));
  // backups
  sync('backup:get', () => { const c = bcfg(); return { folder: c.folder || '', folderOk, encrypt: !!c.encrypt, hasPass: !!c.pass, lastOk: c.lastOk || 0, lastError: c.lastError || '' }; });
  call('backup:folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a backup folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, msg: 'No folder chosen.' };
    const c = bcfg(); c.folder = r.filePaths[0]; jwrite('backup.json', c);
    return runBackup();
  });
  call('backup:settings', (e, a) => {
    const c = bcfg();
    if (a.encrypt) {
      if (a.password) {
        if (String(a.password).length < 6) return { ok: false, msg: 'Use at least 6 characters.' };
        if (!safeStorage.isEncryptionAvailable()) return { ok: false, msg: 'Secure storage is not available on this computer.' };
        c.pass = safeStorage.encryptString(String(a.password)).toString('base64');
      } else if (!c.pass) return { ok: false, msg: 'Enter a password to turn on encryption.' };
    } else delete c.pass;
    c.encrypt = !!a.encrypt; jwrite('backup.json', c);
    return c.folder ? runBackup() : { ok: true, msg: 'Backup settings saved. Now choose a backup folder.' };
  });
  call('backup:now', () => runBackup());
  call('backup:restore', async (e, a) => {
    try {
      let file = a && a.file;
      if (!file) {
        const r = await dialog.showOpenDialog(win, { title: 'Choose a backup file', defaultPath: bcfg().folder || undefined, filters: [{ name: 'Shop Ledger backup', extensions: ['json', 'slbk'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths[0]) return { ok: false, msg: 'Restore cancelled.' };
        file = r.filePaths[0];
      }
      let data;
      try { data = backup.decode(fs.readFileSync(file), a && a.password); }
      catch (err) {
        if (err.code === 'PASSWORD_NEEDED') return { ok: false, needPassword: true, file, msg: 'This backup is password protected. Enter its password.' };
        if (err.code === 'WRONG_PASSWORD') return { ok: false, needPassword: true, file, msg: 'Wrong password, or the file is damaged.' };
        return { ok: false, msg: 'That file is not a valid Shop Ledger backup.' };
      }
      const clean = migrate(JSON.parse(JSON.stringify(data))); // also refuses files from a newer app version
      const pick = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Replace my data'], defaultId: 0, cancelId: 0, message: 'Replace the current data with this backup?', detail: clean.products.length + ' products and ' + clean.orders.length + ' orders. A copy of your current data is kept in the backups folder.' });
      if (pick.response !== 1) return { ok: false, msg: 'Restore cancelled.' };
      fs.mkdirSync(store.bk, { recursive: true });
      if (fs.existsSync(store.file)) fs.copyFileSync(store.file, path.join(store.bk, 'pre-restore-' + Date.now() + '.json'));
      store.save(clean); dirty = true;
      return { ok: true, msg: 'Backup restored.' };
    } catch (err) { log('restore failed ' + err.message); return { ok: false, msg: 'Restore failed: ' + err.message }; }
  });
  // lock screen (these work while locked)
  sync('gate:state', () => ({ mode: S.mode, msg: S.msg, who: S.who }), false);
  call('access:activate', async (e, token) => {
    const pub = publicKey();
    if (!pub) return { ok: false, msg: 'This build has no access key installed.' };
    const v = sec.verifyToken(token, pub);
    if (!v.ok) return { ok: false, msg: v.reason };
    jwrite('access.json', { token: String(token).trim(), lastOk: Date.now(), revoked: [] });
    S.mode = 'activate'; await refresh();
    if (S.mode === 'activate') evaluateLocal(false);
    if (S.mode !== 'activate') { show(); return { ok: true }; }
    return { ok: false, msg: S.msg };
  }, false);
  call('access:recheck', async () => { await refresh(); return { ok: S.mode !== 'stale', msg: S.msg }; }, false);
  call('pin:check', (e, pin) => {
    const rec = jread('pin.json', null);
    if (S.mode !== 'pin' || !rec) return { ok: false, msg: 'Locked.' };
    const r = sec.checkPin(rec, String(pin || ''), Date.now());
    jwrite('pin.json', r.rec);
    if (r.ok) { S.mode = 'open'; show(); return { ok: true }; }
    return { ok: false, msg: r.wait ? 'Too many attempts. Try again in ' + r.wait + ' seconds.' : 'Wrong PIN.' };
  }, false);
  // security settings (only while open)
  sync('pin:status', () => ({ set: pinSet() }));
  sync('access:info', () => ({ enforced: ENFORCE, who: S.who, exp: S.exp, lastOk: S.lastOk, idleMinutes: CFG.idleMinutes }));
  send('pin:lock', () => lockNow());
  call('pin:set', (e, { old, pin }) => {
    const rec = jread('pin.json', null);
    if (rec) {
      const r = sec.checkPin(rec, String(old || ''), Date.now()); jwrite('pin.json', r.rec);
      if (!r.ok) return { ok: false, msg: r.wait ? 'Too many attempts. Try again in ' + r.wait + ' seconds.' : 'Current PIN is wrong.' };
    }
    if (!pin) { if (rec) fs.unlinkSync(path.join(dir(), 'pin.json')); return { ok: true, msg: 'PIN lock removed.' }; }
    if (String(pin).length < 4) return { ok: false, msg: 'Use at least 4 characters.' };
    jwrite('pin.json', sec.makePin(pin)); return { ok: true, msg: 'PIN lock is on.' };
  });
  registerLicenceAdmin();
}

// The developer's own Licences screen: issue, list and revoke access tokens. It needs the private
// key, so it only exists when running from source (npm start) on a machine that has keys/private.pem.
// tools/ and keys/ are not in the installer, and a packaged app never reaches the require below.
function registerLicenceAdmin() {
  const admin = app.isPackaged ? null : (() => { try { return require('./tools/licence-admin').createAdmin(); } catch (e) { return null; } })();
  const on = !!admin && admin.available();
  sync('lic:available', () => on);
  if (!on) return;
  const git = (...args) => new Promise(resolve => execFile('git', args, { cwd: admin.root, timeout: 30000 }, (err, out, errOut) => resolve({ err, out: String(out || ''), errOut: String(errOut || '') })));
  // True while access/revoked.json has changes that customers' apps can't see yet.
  const unpublished = async () => {
    const changed = await git('status', '--porcelain', '--', 'access/revoked.json');
    if (changed.out.trim()) return true;
    const ahead = await git('log', '--oneline', '@{u}..HEAD', '--', 'access/revoked.json');
    return !!ahead.out.trim();
  };
  const guard = fn => async (e, a) => { try { return await fn(a || {}); } catch (err) { log('licence admin failed ' + err.message); return { ok: false, msg: err.message }; } };
  call('lic:list', guard(async () => ({ ok: true, tokens: admin.list(), unpublished: await unpublished() })));
  call('lic:issue', guard(a => {
    const r = admin.issue(a.name, a.days);
    return { ok: true, msg: 'Token issued for ' + r.payload.name + '.', token: r.token, id: r.payload.id };
  }));
  call('lic:revoke', guard(a => {
    admin.setRevoked(a.id, a.revoked);
    return { ok: true, msg: (a.revoked ? 'Revoked ' : 'Restored ') + a.id + '. Publish the list to make it take effect.' };
  }));
  call('lic:publish', guard(async () => {
    if (!(await unpublished())) return { ok: true, msg: 'The revoked list is already published.' };
    await git('add', '--', 'access/revoked.json');
    const staged = await git('diff', '--cached', '--quiet', '--', 'access/revoked.json');
    if (staged.err) {
      const commit = await git('commit', '-m', 'Update revoked licences', '--', 'access/revoked.json');
      if (commit.err) throw new Error('Could not commit: ' + (commit.errOut || commit.err.message).trim());
    }
    const push = await git('push');
    if (push.err) throw new Error('Committed, but the push failed: ' + (push.errOut || push.err.message).trim());
    return { ok: true, msg: 'Published. Apps pick it up at their next check (start-up and every 6 hours).' };
  }));
}

function start() {
  store = createStore(dir()); mail = createMail(dir());
  try {
    const first = store.load(); cache = first.data;
    if (first.from && first.from !== store.file) dialog.showMessageBoxSync({ type: 'warning', message: 'Your data file was damaged, so the latest backup was loaded.', detail: first.from });
  } catch (e) {
    log('load failed ' + e.message);
    dialog.showErrorBox('Shop Ledger cannot open your data', e.message);
    return app.quit();
  }
  register();
  checkFolder().then(() => { if (backupDue()) runBackup(); });
  setInterval(checkFolder, 60e3);
  setInterval(async () => { await checkFolder(); if (bcfg().folder && (dirty || backupDue())) runBackup(); }, 3600e3);
  app.on('before-quit', () => { if (dirty && folderOk && bcfg().folder) doBackup(); }); // catch the day's last changes
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, backgroundColor: '#f3f1ec',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  evaluateLocal(false); show();
  if (ENFORCE) { refresh(); setInterval(refresh, 6 * 3600e3); }
  setInterval(() => { if (powerMonitor.getSystemIdleTime() >= CFG.idleMinutes * 60) lockNow(); }, 30e3);
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(e => log('update failed ' + e.message)), 5000);
}
