// Expenses tab: running costs that come off net profit.

function expensesScreen() {
  const addCard = card('Record an expense', `<form class="row" onsubmit="addExpense();return false">
  <label>Date<input id="e-date" type="date" value="${today()}"></label><label>What for<input id="e-desc"></label>
  <label>Amount<input id="e-amt" type="number" step="0.01" min="0" style="width:110px"></label>
  <button class="btn">Add expense</button></form>`);
  const rows = db.expenses.slice().reverse().map(e =>
    `<tr><td>${e.date}</td><td>${esc(e.desc)}</td><td class="n">${money(e.amt)}</td><td>${deleteButton('e' + e.id, e.desc, `deleteExpense(${e.id})`)}</td></tr>`).join('');
  const listBody = rows
    ? table([th('Date'), th('What for'), thNum('Amount'), th('')], rows)
    : emptyNote('Rent, ads, packaging and other running costs go here. They come off net profit.');
  return addCard + card('Expenses', listBody);
}

function addExpense() {
  const amount = +$('#e-amt').value, desc = $('#e-desc').value.trim();
  if (!desc) return showError('Enter what the expense was for.', '#e-desc');
  if (!amount) return showError('Enter an amount.', '#e-amt');
  db.expenses.push({ id: newId(), date: $('#e-date').value || today(), desc, amt: amount });
  save();
  showMessage('Expense added.', '#e-desc');
}

function deleteExpense(id) {
  if (!confirmed('e' + id)) return;
  db.expenses = db.expenses.filter(e => e.id !== id);
  save();
  showMessage('Expense deleted.');
}
