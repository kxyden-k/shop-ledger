// Dashboard tab: profit for a period, charts, restock list and best sellers.

const PERIODS = [['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days']];
const STATUS_COLORS = { Pending: '#c98a1b', Paid: '#2f7fb0', Shipped: '#7a5fb3', Completed: '#1d7a46', Cancelled: '#b3362b' };

function setPeriod(period) { ui.period = period; render(); }

function dashboardScreen() {
  const s = periodSummary(db, ui.period);
  const orderCount = s.orders.length;
  const stockAtCost = sumOf(db.products, p => p.stock * p.cost);
  const stockAtRetail = sumOf(db.products, p => p.stock * p.price);
  const owed = sumOf(customers(), c => c.awaitingPayment);
  return `<div class="row" style="margin-bottom:12px"><label>Period<select id="period" onchange="setPeriod(this.value)">${options(PERIODS, ui.period)}</select></label></div>
  <div class="grid">
  ${stat('Revenue', money(s.revenue))}
  ${stat('Cost of goods', money(s.costOfGoods))}
  ${stat('Order fees (shipping etc.)', money(s.fees))}
  ${stat('Gross profit · margin ' + percent(s.grossProfit, s.revenue), money(s.grossProfit), { valueClass: signClass(s.grossProfit) })}
  ${stat('Expenses', money(s.expenses))}
  ${stat('Net profit · margin ' + percent(s.netProfit, s.revenue), money(s.netProfit), { tile: 'net', valueClass: signClass(s.netProfit) })}
  ${stat('Orders · average value', orderCount + ' · ' + money(orderCount ? s.revenue / orderCount : 0))}
  ${stat('Stock value (cost → retail)', money(stockAtCost), { note: money(stockAtRetail) + ' at retail' })}
  ${stat('Owed to you by customers', money(owed), { note: 'all unpaid orders, any date' })}</div>
  ${trendCard(s.entries)}
  <div class="two">${productProfitCard(s.entries)}
  ${card('Orders by status', statusDonut(db.orders.filter(o => isInPeriod(o.date, ui.period))))}</div>
  ${restockCard()}
  ${topProductsCard(s.entries)}`;
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
  return card('Revenue and profit ' + (byDay ? 'by day' : 'by month'), trendChart(revenueByPeriod(orders, byDay), byDay));
}

function trendChart(groups, byDay) {
  if (!groups.length) return emptyNote('No orders in this period yet.');
  const values = groups.flatMap(g => [g.revenue, g.profit]);
  // Canvas size, plus room for the value axis on the left, date labels at the bottom and a top margin.
  const W = 640, H = 230, LEFT = 52, BOTTOM = 28, TOP = 10;
  const hi = Math.max(1, ...values), lo = Math.min(0, ...values);
  const y = v => TOP + (H - TOP - BOTTOM) * (hi - v) / (hi - lo);
  const zeroY = y(0);
  const groupWidth = (W - LEFT - 8) / groups.length;
  const barWidth = Math.min(26, groupWidth * .35);

  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4;
    svg += `<line x1="${LEFT}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${LEFT - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--mute)">${compactNumber(v)}</text>`;
  }
  const bar = (value, x, color, title) =>
    `<rect x="${x}" y="${Math.min(y(value), zeroY)}" width="${barWidth}" height="${Math.max(1, Math.abs(y(value) - zeroY))}" rx="2" style="fill:${color}"><title>${title}: ${money(value)}</title></rect>`;
  groups.forEach((g, i) => {
    const center = LEFT + groupWidth * (i + .5);
    const label = byDay ? g.key.slice(5) : g.key.slice(2); // "03-14" or "25-03"
    svg += bar(g.revenue, center - barWidth, 'var(--acc)', g.key + ' Revenue');
    svg += bar(g.profit, center, 'var(--good)', g.key + ' Profit');
    svg += `<text x="${center}" y="${H - 8}" text-anchor="middle" font-size="11" style="fill:var(--mute)">${label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Revenue and profit over time">${svg}</svg><div class="legend"><i style="background:var(--acc)"></i>Revenue<i style="background:var(--good)"></i>Profit</div>`;
}

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
