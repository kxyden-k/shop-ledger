// The "send" panel: one form for emailing or saving any document as a PDF (invoice, quote,
// credit note, purchase order, statement). It sits at the top of whichever tab opened it.
//
// openSend({
//   title, to, hint,          heading, default recipient, small print under the buttons
//   message,                  default email text
//   prepare(to),              called when the user sends: returns {doc, filename, subject}. It may save
//                             first, e.g. an invoice gets its number here. doc is built by documents.js.
//   returnFocus               selector to focus when the panel closes
// })

function openSend(options) {
  ui.send = options;
  ui.afterRender = { focus: '#send-to', scroll: '#send-panel' };
  render();
}

function closeSend() {
  const back = ui.send && ui.send.returnFocus;
  ui.send = null;
  if (back) ui.afterRender = { focus: back };
  render();
}

function sendPanel() {
  const s = ui.send;
  if (!s) return '';
  const missingBusiness = db.biz.name.trim() ? ''
    : `<div class="msg warnbar">Add your business name in Settings first. It is printed at the top of every document. <button type="button" class="btn sm" onclick="goTo('set')">Open settings</button></div>`;
  return card(s.title, `${missingBusiness}
  <div class="row"><label>Send to<input id="send-to" type="email" value="${esc(s.to || '')}" style="width:260px"></label>
  <label>Subject<input id="send-subject" placeholder="Filled in for you if left empty" style="width:300px"></label></div>
  <label style="display:block;margin:8px 0;color:var(--mute);font-size:13px">Message<textarea id="send-message">${esc(s.message)}</textarea></label>
  <div class="row"><button class="btn" onclick="sendDocument('email',this)">Email as PDF</button><button class="btn alt" onclick="sendDocument('save',this)">Save as PDF</button><button class="btn alt" onclick="closeSend()">Close</button></div>
  <p class="empty">${s.hint ? s.hint + ' ' : ''}Press Esc to close.</p>`, 'send-panel');
}

// mode: 'email' | 'save'
async function sendDocument(mode, button) {
  const s = ui.send;
  if (!s) return;
  if (!db.biz.name.trim()) return showError('Add your business name in Settings first.');
  const to = $('#send-to').value.trim();
  if (mode === 'email' && !/^\S+@\S+\.\S+$/.test(to)) return showError('Enter a valid email address to send to.', '#send-to');
  const typedSubject = $('#send-subject').value.trim(), message = $('#send-message').value;
  const { doc, filename, subject } = s.prepare(to);
  const result = await whileBusy(button, mode === 'email' ? 'Sending…' : 'Saving…', () =>
    window.api.document({ doc, biz: db.biz, filename, mode, to, subject: typedSubject || subject, message }));
  if (!result) return;
  if (result.ok) { ui.send = null; showMessage(result.msg); }
  else if (result.msg === 'Save cancelled.') toast(result.msg, false);
  else showError(result.msg); // no redraw, so the message the user wrote is kept for another try
}

const signOff = () => '\n\nKind regards,\n' + db.biz.name;
