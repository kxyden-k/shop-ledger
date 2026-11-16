// Reports tab: pick a report and a date range, then view it, export it to a spreadsheet or save a PDF.
// The numbers come from renderer/js/reports.js.

const REPORT_PRESETS = [['month', 'This month'], ['lastMonth', 'Last month'], ['year', 'This year'], ['lastYear', 'Last year'], ['all', 'All dates'], ['custom', 'Custom dates']];

// The dates the current choice stands for: [from, to].
function reportRange() {
  const r = ui.report;
  return r.preset === 'custom' ? [r.from, r.to] : presetRange(r.preset, today());
}

const currentReport = () => buildReport(ui.report.id, db, ...reportRange(), today());

function reportsScreen() {
  const r = ui.report, [from, to] = reportRange(), report = currentReport();
  const controls = `<div class="row" style="margin-bottom:12px">
  <label>Report<select id="rep-id" onchange="setReport('id',this.value)">${options(REPORT_NAMES, r.id)}</select></label>
  <label>Period<select id="rep-preset" onchange="setReport('preset',this.value)"${report.asAt ? ' disabled' : ''}>${options(REPORT_PRESETS, r.preset)}</select></label>
  ${r.preset === 'custom' && !report.asAt ? `<label>From<input id="rep-from" type="date" value="${r.from}" onchange="setReport('from',this.value)"></label>
  <label>To<input id="rep-to" type="date" value="${r.to}" onchange="setReport('to',this.value)"></label>` : ''}
  <button class="btn" onclick="exportReport(this)"${report.rows.length ? '' : ' disabled'}>Export to spreadsheet (CSV)</button>
  <button class="btn alt" onclick="saveReportPdf(this)"${report.rows.length ? '' : ' disabled'}>Save as PDF</button></div>`;
  const range = report.asAt ? 'As at ' + today() : from || to ? (from || 'the start') + ' to ' + (to || 'today') : 'All dates';
  return controls + card(esc(report.title) + ' · ' + range, reportTable(report) + (report.note ? `<p class="empty">${esc(report.note)}</p>` : ''));
}

function reportTable(report) {
  if (!report.rows.length) return emptyNote('Nothing to show for these dates.');
  const numeric = c => c.type !== 'text';
  const cells = (row, bold) => row.map((v, i) => {
    const c = report.columns[i], shown = esc(formatCell(v, c.type, db.cur));
    const negative = c.type === 'money' && v < 0 ? ' neg' : '';
    return `<td class="${numeric(c) ? 'n' : ''}${negative}">${bold ? '<b>' + shown + '</b>' : shown}</td>`;
  }).join('');
  const body = report.rows.map(r => `<tr>${cells(r)}</tr>`).join('') + (report.total ? `<tr class="total">${cells(report.total, true)}</tr>` : '');
  return table(report.columns.map(c => numeric(c) ? thNum(c.label) : th(c.label)), body);
}

function setReport(field, value) {
  ui.report[field] = value;
  if (field === 'preset' && value === 'custom' && !ui.report.from) [ui.report.from, ui.report.to] = presetRange('month', today());
  render();
}

const reportFileName = report => report.title.replace(/\s*\(.*\)/, '') + ' ' + (report.asAt ? today() : reportRange().filter(Boolean).join(' to ') || 'all dates');

async function exportReport(button) {
  const report = currentReport();
  const result = await whileBusy(button, 'Saving…', () => window.api.exportCsv({ filename: reportFileName(report), rows: reportToRows(report) }));
  if (result) toast(result.msg, !result.ok && result.msg !== 'Save cancelled.');
}

async function saveReportPdf(button) {
  if (!db.biz.name.trim()) return showError('Add your business name in Settings first. It is printed at the top of the report.');
  const report = currentReport(), [from, to] = reportRange();
  const result = await whileBusy(button, 'Saving…', () => window.api.document({ doc: reportDoc(db, report, from, to, today()), biz: db.biz, filename: reportFileName(report), mode: 'save' }));
  if (result) toast(result.msg, !result.ok && result.msg !== 'Save cancelled.');
}
