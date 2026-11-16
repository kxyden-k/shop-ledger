// Small helpers for building screen markup as strings.

const $ = selector => document.querySelector(selector);

// Escape anything the user typed before putting it into HTML.
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const today = () => new Date().toISOString().slice(0, 10);

// "12.3%", or "–" when there is nothing to divide by.
const percent = (part, whole) => whole ? (part / whole * 100).toFixed(1) + '%' : '–';

// Axis labels: 1234 → "1.2k", 2500000 → "2.5M".
function compactNumber(v) {
  const a = Math.abs(v);
  const text = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : Math.round(a);
  return (v < 0 ? '−' : '') + text;
}

const signClass = v => v < 0 ? 'neg' : 'pos';

const card = (title, body, id = '') => `<div class="card"${id ? ` id="${id}"` : ''}><h2>${title}</h2>${body}</div>`;

const searchBox = (id, value, handler, placeholder, width = 240) =>
  `<label>Search<input id="${id}" type="search" value="${esc(value)}" placeholder="${placeholder}" oninput="${handler}(this.value)" style="width:${width}px"></label>`;
const emptyNote = text => `<div class="empty">${text}</div>`;

// Tables scroll sideways on narrow windows. thNum is for right-aligned number columns.
const th = label => `<th>${label}</th>`;
const thNum = label => `<th class="n">${label}</th>`;
const table = (headers, rows) => `<div class="scroll"><table><tr>${headers.join('')}</tr>${rows}</table></div>`;

// pairs: [[value, label], ...]
const options = (pairs, selected) =>
  pairs.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');

// A summary tile. tile adds a class to the box, valueClass colours the number, note goes underneath.
const stat = (label, value, { tile = '', valueClass = '', note = '' } = {}) =>
  `<div class="stat${tile ? ' ' + tile : ''}"><small>${label}</small><b${valueClass ? ` class="${valueClass}"` : ''}>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
