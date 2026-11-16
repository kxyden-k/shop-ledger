// Licences tab: the developer's own screen for issuing and revoking customer access tokens.
// It only appears when the app runs from source on the machine that holds the private signing key
// (see registerLicenceAdmin in main.js). Customers' installed copies never show it.

const licencesAvailable = () => !!(window.api.licences && window.api.licences.available());

// Loaded from the main process when the tab opens; null until then.
let licenceState = null;   // {tokens, unpublished}
let issuedToken = null;    // {name, token}: the token just issued, shown once so it can be copied

async function loadLicences() {
  const result = await window.api.licences.list();
  if (!result.ok) return showError(result.msg);
  licenceState = result;
  render();
}

function licencesScreen() {
  if (!licenceState) { loadLicences(); return card('Licences', emptyNote('Loading…')); }
  const date = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';
  const tones = { active: 'good', expired: 'warn', revoked: 'bad' };
  const tokens = licenceState.tokens, counts = s => tokens.filter(t => t.status === s).length;

  const publishBar = licenceState.unpublished
    ? `<div class="msg warnbar"><b>Not published yet:</b> the revoked list has changes that customers' apps cannot see. <button class="btn sm" onclick="publishLicences(this)">Commit and push now</button></div>`
    : '';
  const issued = issuedToken ? card('Token for ' + esc(issuedToken.name), `
  <p>Send this to the customer. They paste it into the activation screen. It is not stored anywhere, so copy it now.</p>
  <textarea id="lic-token" readonly aria-label="Access token">${esc(issuedToken.token)}</textarea>
  <div class="row" style="margin-top:8px"><button class="btn" id="lic-copy" onclick="copyIssuedToken()">Copy token</button><button class="btn alt" onclick="issuedToken=null;render()">Done</button></div>`, 'lic-issued') : '';

  const rows = tokens.slice().reverse().map(t => `<tr class="${t.status === 'revoked' ? 'cancelled' : ''}"><td>${esc(t.name)}</td><td><code>${esc(t.id)}</code></td><td>${date(t.iat) || '–'}</td><td>${date(t.exp) || 'Never'}</td><td>${tag(t.status[0].toUpperCase() + t.status.slice(1), tones[t.status])}</td>
  <td>${t.status === 'revoked'
    ? `<button class="btn alt sm" data-focus="lic-${esc(t.id)}" onclick="setLicenceRevoked('${esc(t.id)}',false)">Restore access</button>`
    : `<button class="btn del sm${ui.confirming === 'lic' + t.id ? ' armed' : ''}" data-focus="lic-${esc(t.id)}" onclick="setLicenceRevoked('${esc(t.id)}',true)">${ui.confirming === 'lic' + t.id ? 'Confirm revoke' : 'Revoke'}</button>`}</td></tr>`).join('');

  return publishBar + issued + `<div class="grid">${stat('Active licences', counts('active'))}${stat('Expired', counts('expired'))}${stat('Revoked', counts('revoked'))}</div>`
    + card('Issue a licence', `<form class="row" onsubmit="issueLicence();return false">
  <label>Customer name<input id="lic-name" style="width:240px"></label>
  <label>Valid for (days)<input id="lic-days" type="number" min="0" step="1" placeholder="empty = no expiry" style="width:150px"></label>
  <button class="btn">Issue token</button></form>
  <p class="empty">The customer's name is shown inside their app under Settings, Security. Use an expiry for trials or subscriptions; reissue before it runs out.</p>`)
    + card('Issued licences', (rows ? table([th('Customer'), th('Token id'), th('Issued'), th('Expires'), th('Status'), th('')], rows) : emptyNote('No tokens issued yet.'))
      + '<p class="empty">Revoking locks that customer\'s app at its next online check (start-up and every 6 hours) once the list is published. Their data is kept, and restoring access unlocks it again.</p>');
}

async function issueLicence() {
  const name = $('#lic-name').value.trim(), days = $('#lic-days').value;
  if (!name) return showError('Enter the customer name.', '#lic-name');
  if (days && !(+days >= 0)) return showError('Days must be a number, or empty for no expiry.', '#lic-days');
  const result = await window.api.licences.issue({ name, days: +days || 0 });
  if (!result.ok) return showError(result.msg);
  issuedToken = { name, token: result.token };
  licenceState = null;
  ui.afterRender = { scroll: '#lic-issued' };
  showMessage(result.msg, '#lic-copy');
}

function copyIssuedToken() {
  window.api.copyText(issuedToken.token);
  toast('Token copied. Paste it into your message to ' + issuedToken.name + '.', false);
}

async function setLicenceRevoked(id, revoked) {
  if (revoked && !confirmed('lic' + id)) return;
  const result = await window.api.licences.revoke({ id, revoked });
  if (!result.ok) return showError(result.msg);
  licenceState = null;
  showMessage(result.msg);
}

async function publishLicences(button) {
  const result = await whileBusy(button, 'Publishing…', () => window.api.licences.publish());
  if (!result) return;
  licenceState = null;
  if (result.ok) showMessage(result.msg);
  else { render(); showError(result.msg); }
}
