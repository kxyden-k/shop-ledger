// Builds the invoice page that is turned into a PDF. Pure functions, so it can be tested.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (cur, v) => cur + Number(v || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = s => esc(s).replace(/\n/g, '<br>');

function totals(order, biz) {
  const sub = order.items.reduce((a, i) => a + i.q * i.p, 0), r = +biz.taxRate || 0;
  if (r <= 0) return { net: sub, tax: 0, total: sub, rate: 0 };
  if (biz.taxIncl) { const tax = sub * r / (100 + r); return { net: sub - tax, tax, total: sub, rate: r }; }
  const tax = sub * r / 100;
  return { net: sub, tax, total: sub + tax, rate: r };
}

function invoiceHtml(o, biz, cur) {
  const t = totals(o, biz), m = v => fmt(cur, v);
  const rows = o.items.map(i => `<tr><td>${esc(i.n)}</td><td class="n">${i.q}</td><td class="n">${m(i.p)}</td><td class="n">${m(i.q * i.p)}</td></tr>`).join('');
  const taxRows = t.rate ? `<tr><td>Subtotal</td><td class="n">${m(t.net)}</td></tr><tr><td>Tax (${t.rate}%)</td><td class="n">${m(t.tax)}</td></tr>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#1d2a2e;margin:0;padding:24px}
h1{font:700 26px Georgia,serif;margin:0 0 4px}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #1f5f5b;padding-bottom:14px;margin-bottom:18px}
.top .r{text-align:right}.big{font:700 22px Georgia,serif;color:#1f5f5b}
.mute{color:#667478}
table{width:100%;border-collapse:collapse;margin-top:14px}
th{text-align:left;border-bottom:2px solid #1d2a2e;padding:6px 4px;font-size:12px}
td{padding:7px 4px;border-bottom:1px solid #d9d5ca}
.n{text-align:right}th.n{text-align:right}
.tot{width:48%;margin-left:52%}.tot td{border:0}.tot tr.g td{border-top:2px solid #1d2a2e;font-weight:700;font-size:15px}
.box{margin-top:26px}
</style></head><body>
<div class="top"><div><h1>${esc(biz.name)}</h1><div class="mute">${br(biz.address)}${biz.email ? '<br>' + esc(biz.email) : ''}${biz.phone ? '<br>' + esc(biz.phone) : ''}${biz.taxId ? '<br>Tax no. ' + esc(biz.taxId) : ''}</div></div>
<div class="r"><div class="big">Invoice</div><div>${esc(o.invoiceNo)}</div><div class="mute">Date ${esc(o.date)}</div></div></div>
<div class="mute">Billed to</div><div><b>${esc(o.cust || 'Customer')}</b>${o.email ? '<br>' + esc(o.email) : ''}</div>
<table><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr>${rows}</table>
<table class="tot">${taxRows}<tr class="g"><td>Total due</td><td class="n">${m(t.total)}</td></tr></table>
${t.rate && biz.taxIncl ? '<div class="mute n" style="text-align:right">Prices include tax.</div>' : ''}
${biz.bank ? `<div class="box"><b>Payment details</b><br>${br(biz.bank)}<br>Reference: ${esc(o.invoiceNo)}</div>` : ''}
${biz.footer ? `<div class="box mute">${br(biz.footer)}</div>` : ''}
</body></html>`;
}
module.exports = { invoiceHtml, totals };
