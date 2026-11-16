// Turns a document description (built by renderer/js/documents.js) into the HTML page that is
// printed to PDF. One layout serves invoices, quotes, credit notes, purchase orders, statements
// and reports. Everything is escaped here, so no text from the screens can inject markup.
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const br = s => esc(s).replace(/\n/g, '<br>');
const list = v => Array.isArray(v) ? v : [];

const STYLE = `
body{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#1d2a2e;margin:0;padding:24px}
h1{font:700 26px Georgia,serif;margin:0 0 4px}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #1f5f5b;padding-bottom:14px;margin-bottom:18px}
.top .r{text-align:right}.big{font:700 22px Georgia,serif;color:#1f5f5b}
.mute{color:#667478}
table{width:100%;border-collapse:collapse;margin-top:14px}
th{text-align:left;border-bottom:2px solid #1d2a2e;padding:6px 4px;font-size:12px}
td{padding:7px 4px;border-bottom:1px solid #d9d5ca}
tr{break-inside:avoid}
.n{text-align:right}
.tot{width:48%;margin-left:52%}.tot td{border:0}.tot tr.g td{border-top:2px solid #1d2a2e;font-weight:700;font-size:15px}
.box{margin-top:22px;break-inside:avoid}
.wide{font-size:11px}.wide td,.wide th{padding:5px 3px}`;

function documentHtml(doc, biz) {
  doc = doc || {}; biz = biz || {};
  const columns = list(doc.columns);
  const cell = (v, i) => {
    const strong = v && typeof v === 'object', value = strong ? v.strong : v;
    return `<td class="${columns[i] && columns[i].num ? 'n' : ''}">${strong ? '<b>' + esc(value) + '</b>' : esc(value)}</td>`;
  };
  const head = columns.map(c => `<th class="${c.num ? 'n' : ''}">${esc(c.label)}</th>`).join('');
  const rows = list(doc.rows).map(r => `<tr>${list(r).map(cell).join('')}</tr>`).join('');
  const totals = list(doc.totals).map(t => `<tr class="${t.strong ? 'g' : ''}"><td>${esc(t.label)}</td><td class="n">${esc(t.value)}</td></tr>`).join('');
  const meta = list(doc.meta).map(m => `<div class="mute">${esc(m[0])} ${esc(m[1])}</div>`).join('');
  const party = doc.party ? `<div class="mute">${esc(doc.party.label)}</div><div><b>${esc(doc.party.name)}</b>${list(doc.party.lines).map(l => '<br>' + esc(l)).join('')}</div>` : '';
  const notes = list(doc.notes).map(n => `<div class="box${n.title ? '' : ' mute'}">${n.title ? '<b>' + esc(n.title) + '</b><br>' : ''}${br(n.text)}</div>`).join('');
  const contact = [biz.email && esc(biz.email), biz.phone && esc(biz.phone), biz.taxId && 'Tax no. ' + esc(biz.taxId)].filter(Boolean).map(l => '<br>' + l).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<div class="top"><div><h1>${esc(biz.name)}</h1><div class="mute">${br(biz.address)}${contact}</div></div>
<div class="r"><div class="big">${esc(doc.kind)}</div><div>${esc(doc.number)}</div>${meta}</div></div>
${party}
<table class="${doc.wide ? 'wide' : ''}"><tr>${head}</tr>${rows}</table>
${totals ? `<table class="tot">${totals}</table>` : ''}
${notes}
</body></html>`;
}

// Spreadsheet file from rows of cells. Text that a spreadsheet would run as a formula is defused.
function toCsv(rows) {
  const cell = v => {
    if (typeof v === 'number') return String(v);
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + list(rows).map(r => list(r).map(cell).join(',')).join('\r\n') + '\r\n'; // BOM so Excel reads the currency symbols
}

module.exports = { documentHtml, toCsv };
