// Expenses tab: running costs that come off net profit.

function expensesActions() { return formButton('addExpense', 'Record an expense', '#e-desc'); }

function expensesScreen() {
  const addCard = !formOpen('addExpense') ? '' : formCard('addExpense', 'Record an expense', `<form class="row" onsubmit="addExpense();return false">
  <label>Date<input id="e-date" type="date" value="${today()}"></label><label>What for<input id="e-desc"></label>
  <label>Category<input id="e-cat" list="e-cats" placeholder="e.g. Rent, Marketing" style="width:170px"></label><datalist id="e-cats">${expenseCategories().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
  <label>Amount<input id="e-amt" type="number" step="0.01" min="0" style="width:110px"></label>
  <button class="btn">Add expense</button></form>`);
  const rows = db.expenses.slice().reverse().map(e =>
    `<tr><td>${e.date}</td><td>${esc(e.cat || '–')}</td><td>${esc(e.desc)}</td><td class="n">${money(e.amt)}</td><td>${deleteButton('e' + e.id, e.desc, `deleteExpense(${e.id})`)}</td></tr>`).join('');
  const listBody = rows
    ? table([th('Date'), th('Category'), th('What for'), thNum('Amount'), th('')], rows)
    : emptyNote('No expenses yet. Use "Record an expense" at the top to add rent, ads, packaging and other running costs.');
  return addCard + card('All expenses', listBody);
}

// Categories already in use, for the suggestions under the Category box.
const expenseCategories = () => [...new Set(db.expenses.map(e => e.cat).filter(Boolean))].sort();

function addExpense() {
  const amount = +$('#e-amt').value, desc = $('#e-desc').value.trim();
  if (!desc) return showError('Enter what the expense was for.', '#e-desc');
  if (!amount) return showError('Enter an amount.', '#e-amt');
  db.expenses.push({ id: newId(), date: $('#e-date').value || today(), desc, amt: amount, cat: $('#e-cat').value.trim() });
  save();
  showMessage('Expense added.', '#e-desc');
}

function deleteExpense(id) {
  if (!confirmed('e' + id)) return;
  db.expenses = db.expenses.filter(e => e.id !== id);
  save();
  showMessage('Expense deleted.');
}
