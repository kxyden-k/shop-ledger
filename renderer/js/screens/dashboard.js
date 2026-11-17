// Dashboard tab: profit for a period, charts, restock list and best sellers.

const PERIODS = [['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days']];
const STATUS_COLORS = { Pending: '#c98a1b', Paid: '#2f7fb0', Shipped: '#7a5fb3', Completed: '#1d7a46', Cancelled: '#b3362b' };

function setPeriod(period) { ui.period = period; render(); }

function dashboardActions() {
  return `<label class="inline">Period<select id="period" onchange="setPeriod(this.value)">${options(PERIODS, ui.period)}</select></label>`;
}

function dashboardScreen() {
  const s = periodSummary(db, ui.period);
  const orderCount = s.orders.length;
  const stockAtCost = sumOf(db.products, p => p.stock * p.cost);
  const stockAtRetail = sumOf(db.products, p => p.stock * p.price); // at the selling price, as the customer pays it
  const owed = sumOf(customers(), c => c.awaitingPayment);
  return `<div class="grid">
  ${stat('Sales' + exclTax(), money(s.revenue))}
  ${stat('Cost of goods', money(s.costOfGoods))}
  ${stat('Order fees (shipping etc.)', money(s.fees))}
  ${stat('Gross profit · margin ' + percent(s.grossProfit, s.revenue), money(s.grossProfit), { valueClass: signClass(s.grossProfit) })}
  ${stat('Expenses', money(s.expenses))}
  ${stat('Net profit · margin ' + percent(s.netProfit, s.revenue), money(s.netProfit), { tile: 'net', valueClass: signClass(s.netProfit) })}
  ${stat('Orders · average sale' + exclTax(), orderCount + ' · ' + money(orderCount ? s.revenue / orderCount : 0))}
  ${stat('Stock value (cost → retail)', money(stockAtCost), { note: money(stockAtRetail) + ' at retail' })}
  ${stat('Owed to you by customers', money(owed), { note: 'all unpaid orders, any date' })}</div>
  ${insightsCard()}
  ${trendCard(s.entries)}
  <div class="two">${productProfitCard(s.entries)}
  ${card('Orders by status', statusDonut(db.orders.filter(o => isInPeriod(o.date, ui.period))))}</div>
  ${restockCard()}
  ${topProductsCard(s.entries)}`;
}

// The three most important recommendations from the Insights tab, over the last 90 days.
function insightsCard() {
  const day = today(), recs = computeInsights(db, { from: addDays(day, -89), to: day, today: day }).recommendations;
  if (!recs.length) return '';
  const tones = { high: 'bad', medium: 'warn', low: '' }, labels = { high: 'Act now', medium: 'Soon', low: 'Worth a look' };
  const items = recs.slice(0, 3).map(r => `<li>${tag(labels[r.severity], tones[r.severity])} ${esc(r.title)}</li>`).join('');
  return card('Things to look at', `<ul class="dash-recs">${items}</ul>
  <div class="row"><button class="btn alt" onclick="goTo('ins')">See all ${recs.length} in Insights</button></div>`);
}

function restockCard() {
  const low = db.products.filter(isLowStock);
  if (!low.length) return card('Needs restocking', emptyNote('Nothing is below its reorder level.'));
  const rows = low.map(p => `<tr><td>${esc(p.name)}</td><td class="n neg">${p.stock}</td><td class="n">${p.reorder}</td></tr>`).join('');
  return card('Needs restocking', table([th('Product'), thNum('In stock'), thNum('Reorder at')], rows));
}

function topProductsCard(orders) {
  const top = salesByProduct(orders).slice(0, 5);
  if (!top.length) return card('Top products by profit', emptyNote('Add products and orders to see what earns the most.'));
  const rows = top.map(t => `<tr><td>${esc(t.name)}</td><td class="n">${t.units}</td><td class="n">${money(t.profit)}</td></tr>`).join('');
  return card('Top products by profit', table([th('Product'), thNum('Units sold'), thNum('Profit')], rows));
}

function productProfitCard(orders) {
  const top = salesByProduct(orders).slice(0, 8);
  if (!top.length) return card('Profit by product', emptyNote('No sales in this period yet.'));
  const max = Math.max(1, ...top.map(t => Math.abs(t.profit)));
  return card('Profit by product', top.map(t => barRow(t.name, t.profit, max)).join(''));
}

// One labelled horizontal bar, scaled against max. Negative values are red.
const barRow = (label, value, max) =>
  `<div class="hb"><span title="${esc(label)}">${esc(label)}</span><div><b style="width:${Math.max(2, Math.abs(value) / max * 100)}%;background:${value < 0 ? 'var(--bad)' : 'var(--acc)'}"></b></div><em>${money(value)}</em></div>`;

// Revenue and profit bars per month (all time) or per day (shorter periods).
function trendCard(orders) {
  const byDay = ui.period !== 'all';
  return card('Sales and profit ' + (byDay ? 'by day' : 'by month') + exclTax(), trendChart(revenueByPeriod(orders, byDay), byDay));
}

// Round-number gridlines that cover lo..hi, e.g. 0, 500, 1000, 1500. Returns the tick values.
function niceTicks(lo, hi, count = 5) {
  const raw = (hi - lo) / count, size = 10 ** Math.floor(Math.log10(raw)), step = size * [1, 2, 2.5, 5, 10].find(f => f * size >= raw);
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function trendChart(groups, byDay) {
  if (!groups.length) return emptyNote('No orders in this period yet.');
  const values = groups.flatMap(g => [g.revenue, g.profit]);
  // Drawn at about the size it is shown, so text stays at its normal size. Room on the left for the
  // value labels, at the bottom for the dates, and a little at the top.
  const W = 1000, H = 280, LEFT = 60, BOTTOM = 30, TOP = 12;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(1, ...values));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = v => TOP + (H - TOP - BOTTOM) * (hi - v) / (hi - lo);
  const zeroY = y(0);
  const groupWidth = (W - LEFT - 8) / groups.length;
  const barWidth = Math.min(34, groupWidth * .32);

  let svg = '';
  for (const v of ticks) {
    svg += `<line x1="${LEFT}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${LEFT - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" style="fill:var(--mute)">${compactNumber(v)}</text>`;
  }
  const bar = (value, x, color, title) =>
    `<rect x="${x}" y="${Math.min(y(value), zeroY)}" width="${barWidth}" height="${Math.max(1, Math.abs(y(value) - zeroY))}" rx="2" style="fill:${color}"><title>${title}: ${money(value)}</title></rect>`;
  groups.forEach((g, i) => {
    const center = LEFT + groupWidth * (i + .5);
    const label = byDay ? g.key.slice(5) : monthLabel(g.key);
    svg += bar(g.revenue, center - barWidth - 1, 'var(--acc)', g.key + ' Sales');
    svg += bar(g.profit, center + 1, 'var(--good)', g.key + ' Profit');
    svg += `<text x="${center}" y="${H - 9}" text-anchor="middle" font-size="12" style="fill:var(--mute)">${label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:300px" role="img" aria-label="Sales and profit over time">${svg}</svg><div class="legend"><i style="background:var(--acc)"></i>Sales<i style="background:var(--good)"></i>Profit</div>`;
}

// "2026-03" → "Mar 2026"
const monthLabel = key => new Date(key + '-01T00:00:00Z').toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// Ring chart drawn with stroke dashes: the circle's circumference is 100, so each status's
// share in percent is its dash length.
function statusDonut(orders) {
  if (!orders.length) return emptyNote('No orders in this period yet.');
  const counts = countByStatus(orders), shown = ORDER_STATUSES.filter(s => counts[s]);
  let offset = 25, segments = ''; // 25 starts the first segment at 12 o'clock
  shown.forEach(s => {
    const share = counts[s] / orders.length * 100;
    segments += `<circle r="15.9155" cx="21" cy="21" fill="none" stroke="${STATUS_COLORS[s]}" stroke-width="6" stroke-dasharray="${share} ${100 - share}" stroke-dashoffset="${offset}"><title>${s}: ${counts[s]}</title></circle>`;
    offset -= share;
  });
  const legend = shown.map(s => `<div><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${STATUS_COLORS[s]};margin-right:6px"></i>${s}: ${counts[s]}</div>`).join('');
  return `<div class="row" style="align-items:center;gap:20px"><svg viewBox="0 0 42 42" width="150" role="img" aria-label="Orders by status"><circle r="15.9155" cx="21" cy="21" fill="none" style="stroke:var(--line)" stroke-width="6"/>${segments}<text x="21" y="23" text-anchor="middle" font-size="7" font-weight="700" style="fill:var(--ink)">${orders.length}</text></svg>
  <div>${legend}</div></div>`;
}
