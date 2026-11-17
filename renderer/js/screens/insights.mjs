// Insights tab: accounting ratios against the owner's targets, and recommendations.
// The first screen written as a Preact component (see ../preact.mjs). The numbers come from insights.js.

import { html, useState, mount, unmount } from '../preact.mjs';

const PERIODS = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['year', 'This year so far'], ['lastYear', 'Last year']];
const GROUPS = ['Profitability', 'Stock', 'Getting paid', 'Sales and customers', 'Growth'];
const SEVERITY = { high: ['Act now', 'bad'], medium: ['Soon', 'warn'], low: ['Worth a look', ''] };
const SHOWN_AT_FIRST = 8;

// [from, to] for a period choice. Periods end today, so rates per day are not diluted by future dates.
function insightsRange(period, day) {
  if (period === 'year') return [day.slice(0, 4) + '-01-01', day];
  if (period === 'lastYear') return presetRange('lastYear', day);
  return [addDays(day, -(Number(period) - 1)), day];
}

const Tag = ({ label, tone }) => html`<span class=${'tag ' + (tone || '')}>${label}</span>`;

function InsightsScreen() {
  const [editingTargets, setEditingTargets] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const day = today(), [from, to] = insightsRange(ui.insightsPeriod, day);
  const result = computeInsights(db, { from, to, today: day });
  const recs = showAll ? result.recommendations : result.recommendations.slice(0, SHOWN_AT_FIRST);

  const choosePeriod = e => { ui.insightsPeriod = e.currentTarget.value; render(); };
  const exportRatios = () => { ui.report = { id: 'ratios', preset: 'custom', from, to }; goTo('rep'); };

  return html`
    <div class="row" style="margin-bottom:12px">
      <label>Period<select id="ins-period" onChange=${choosePeriod}>
        ${PERIODS.map(([value, label]) => html`<option value=${value} selected=${value === ui.insightsPeriod}>${label}</option>`)}
      </select></label>
      <button class="btn alt" aria-expanded=${editingTargets} onClick=${() => setEditingTargets(!editingTargets)}>Your targets</button>
      <button class="btn alt" onClick=${exportRatios}>Export key ratios</button>
    </div>
    <p class="empty" style="margin-top:-6px">${from} to ${to} (${result.days} days). Figures exclude tax.</p>
    ${editingTargets && html`<${TargetsCard} targets=${result.targets} onDone=${() => setEditingTargets(false)} />`}
    ${result.orderCount < 5 && html`<div class="msg">Only ${result.orderCount} order${result.orderCount === 1 ? '' : 's'} in this period, so treat these figures as rough. Try a longer period.</div>`}
    <${Recommendations} items=${recs} total=${result.recommendations.length} onShowAll=${() => setShowAll(true)} />
    ${GROUPS.map(group => html`<${RatioGroup} key=${group} title=${group} ratios=${result.ratios.filter(r => r.group === group)} />`)}
    <p class="empty">These are rules of thumb measured against your own targets, not financial advice. What is normal differs a lot between kinds of business, so set targets that fit yours.</p>`;
}

function Recommendations({ items, total, onShowAll }) {
  if (!total) {
    return html`<div class="card"><h2>Recommendations</h2><div class="empty">Nothing needs your attention in this period.</div></div>`;
  }
  return html`<div class="card"><h2>Recommendations</h2>
    <ol class="recs">
      ${items.map(r => html`<li key=${r.id} class=${'rec ' + r.severity}>
        <div><${Tag} label=${SEVERITY[r.severity][0]} tone=${SEVERITY[r.severity][1]} /> <span class="rec-area">${r.area}</span></div>
        <b>${r.title}</b>
        <p>${r.detail}</p>
        ${r.action && html`<${ActionButton} action=${r.action} id=${r.id} strong=${r.severity === 'high'} />`}
      </li>`)}
    </ol>
    ${total > items.length && html`<button class="btn alt" onClick=${onShowAll}>Show all ${total}</button>`}
  </div>`;
}

// Changing a price needs a second click, like deleting does elsewhere in the app.
function ActionButton({ action, id, strong }) {
  const key = 'ins:' + id, armed = ui.confirming === key;
  const onClick = () => {
    if (action.kind === 'price' && !armed) { ui.confirming = key; return render(); }
    ui.confirming = null;
    runInsightAction(action);
  };
  return html`<button class=${'btn sm' + (strong || armed ? '' : ' alt')} onClick=${onClick}>${armed ? 'Confirm: ' + action.label.toLowerCase() : action.label}</button>`;
}

function runInsightAction(a) {
  if (a.kind === 'price') {
    const p = findProduct(a.ref);
    if (!p) return;
    const old = p.price;
    setPrice(p, a.value, today());
    save();
    return showMessage(`${p.name} now sells for ${money(a.value)} instead of ${money(old)}. The old price is kept in its price history.`);
  }
  if (a.kind === 'purchase') {
    const p = findProduct(a.ref);
    if (!p) return;
    const line = ui.purchaseDraft.items.find(i => i.pid === p.id);
    if (line) line.q = a.value; else ui.purchaseDraft.items.push({ pid: p.id, n: p.name, q: a.value, c: p.cost });
    ui.purchasingView = db.suppliers.length ? 'orders' : 'suppliers';
    goTo('buy');
    return toast(db.suppliers.length
      ? `${a.value} × ${p.name} added to a new purchase order. Choose the supplier, check the cost and save it.`
      : `${a.value} × ${p.name} is waiting on a new purchase order. Add a supplier first.`, false);
  }
  if (a.kind === 'customer') { ui.tab = 'cust'; return selectCustomer(a.ref, true); }
  if (a.kind === 'order') return showOrder(a.ref);
  if (a.kind === 'product') { ui.tab = 'prod'; return openStockHistory(a.ref); }
  if (a.kind === 'quotes') { ui.ordersView = 'quotes'; return goTo('ord'); }
  if (a.kind === 'report') { ui.report = { ...ui.report, id: a.ref }; return goTo('rep'); }
  if (a.kind === 'tab') return goTo(a.ref);
}

function RatioGroup({ title, ratios }) {
  return html`<div class="card"><h2>${title}</h2><div class="scroll"><table>
    <tr><th>Ratio</th><th class="n">Value</th><th>Target</th><th>Status</th></tr>
    ${ratios.map(r => html`<tr key=${r.id}>
      <td class="ratio-name"><b>${r.label}</b><div class="explain">${r.explain}</div></td>
      <td class="n ratio-value">${formatRatio(r, db.cur)}</td>
      <td>${r.target || '–'}</td>
      <td>${r.status && html`<${Tag} label=${STATUS_LABEL[r.status]} tone=${r.status} />`}</td>
    </tr>`)}
  </table></div></div>`;
}

function TargetsCard({ targets, onDone }) {
  const [draft, setDraft] = useState(() => ({ ...targets }));
  // Reads the boxes themselves, so a value typed just before pressing Enter is never missed.
  const submit = e => {
    e.preventDefault();
    const result = cleanTargets(Object.fromEntries(new FormData(e.currentTarget)));
    if (result.error) return showError(result.error);
    db.targets = result.targets;
    save();
    onDone();
    showMessage('Targets saved.');
  };
  return html`<div class="card"><h2>Your targets</h2>
    <p class="empty">The ratios and recommendations are measured against these. The defaults suit a typical small retailer.</p>
    <form class="row" onSubmit=${submit}>
      ${TARGET_FIELDS.map(([key, label, unit]) => html`<label key=${key}>${label} (${unit})
        <input type="number" step="any" name=${key} value=${draft[key]} style="width:120px" onInput=${e => setDraft({ ...draft, [key]: e.currentTarget.value })} /></label>`)}
      <button class="btn">Save targets</button>
      <button type="button" class="btn alt" onClick=${() => setDraft({ ...DEFAULT_TARGETS })}>Back to defaults</button>
      <button type="button" class="btn alt" onClick=${onDone}>Cancel</button>
    </form></div>`;
}

registerComponentScreen('ins', element => mount(InsightsScreen, element), unmount);
