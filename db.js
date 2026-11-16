// Data layer: no Electron code in here, so it can be tested on its own.
const fs = require('fs'), path = require('path');

const SCHEMA = 3;
// When the data shape changes: bump SCHEMA and add one function here.
// Key = the version it upgrades TO. Never edit an old migration after release.
// Example:  3: d => { d.products.forEach(p => p.supplier = ''); return d; }
const MIGRATIONS = {
  2: d => { // v1.1: invoices
    d.biz = { name: '', address: '', email: '', phone: '', taxId: '', taxRate: 0, taxIncl: false, prefix: 'INV-', bank: '', footer: 'Thank you for your business.' };
    d.nextInvoice = 1;
    d.orders.forEach(o => { o.email = o.email || ''; o.invoiceNo = o.invoiceNo || null; });
    return d;
  },
  3: d => { // v2.0: payments, quotes, credit notes, suppliers, purchase orders, stock history
    const tax = { rate: +d.biz.taxRate || 0, incl: !!d.biz.taxIncl };
    d.orders.forEach(o => {
      o.tax = { ...tax }; // from now on each order remembers the tax rules it was made under
      // Until now "paid" was only a status. Orders at Paid or beyond count as paid in full on their own date.
      const sub = o.items.reduce((a, i) => a + i.q * i.p, 0);
      const total = Math.round((tax.rate > 0 && !tax.incl ? sub * (1 + tax.rate / 100) : sub) * 100) / 100;
      const paid = ['Paid', 'Shipped', 'Completed'].includes(o.status) && total > 0;
      o.payments = paid ? [{ id: d.n++, date: o.date, amt: total, method: '', note: 'Paid before payments were tracked' }] : [];
    });
    d.expenses.forEach(e => { e.cat = e.cat || ''; });
    d.quotes = []; d.credits = []; d.suppliers = []; d.purchases = []; d.moves = [];
    d.nextQuote = 1; d.nextCredit = 1; d.nextPurchase = 1;
    return d;
  }
};

const blank = () => migrate({ v: 1, products: [], orders: [], expenses: [], cur: 'R', n: 1 });

function migrate(d) {
  if (!d || !Array.isArray(d.products) || !Array.isArray(d.orders)) throw new Error('Not a valid data file');
  d.expenses = d.expenses || [];
  d.v = d.v || 1;
  if (d.v > SCHEMA) throw new Error('This data is from a newer version of the app (v' + d.v + '). Update the app first.');
  while (d.v < SCHEMA) {
    const to = d.v + 1, m = MIGRATIONS[to];
    if (!m) throw new Error('Missing migration to v' + to);
    d = m(d); d.v = to;
  }
  return d;
}

function createStore(dir) {
  const file = path.join(dir, 'data.json'), bk = path.join(dir, 'backups');

  function copyBackup(name) {
    fs.mkdirSync(bk, { recursive: true });
    const t = path.join(bk, name);
    if (fs.existsSync(file) && !fs.existsSync(t)) fs.copyFileSync(file, t);
  }

  function load() {
    const tries = [file];
    if (fs.existsSync(bk)) {
      tries.push(...fs.readdirSync(bk).filter(f => f.startsWith('data-')).sort().reverse().map(f => path.join(bk, f)));
    }
    for (const f of tries) {
      if (!fs.existsSync(f)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (f === file && (raw.v || 1) < SCHEMA) copyBackup('pre-migrate-v' + (raw.v || 1) + '.json');
        return { data: migrate(raw), from: f };
      } catch (e) {
        if (/newer version/.test(e.message)) throw e;
        if (f === file) { try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (x) {} }
      }
    }
    return { data: blank(), from: null };
  }

  function save(d) {
    d = migrate(JSON.parse(JSON.stringify(d)));
    fs.mkdirSync(bk, { recursive: true });
    copyBackup('data-' + new Date().toISOString().slice(0, 10) + '.json'); // state before today's first change
    const old = fs.readdirSync(bk).filter(f => f.startsWith('data-')).sort();
    old.slice(0, -30).forEach(f => fs.unlinkSync(path.join(bk, f)));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d));
    fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written file
  }

  return { load, save, file, bk };
}

module.exports = { createStore, migrate, SCHEMA };
