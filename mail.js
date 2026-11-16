// Sends email through the customer's own mail account (SMTP). The password is encrypted with the
// operating system (Windows DPAPI) and kept in mail.json, which is not part of the data backups.
const { safeStorage } = require('electron');
const fs = require('fs'), path = require('path');
const nodemailer = require('nodemailer');

module.exports = dir => {
  const file = path.join(dir, 'mail.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; } };
  return {
    get() {
      const c = read();
      return { host: c.host || '', port: c.port || 587, secure: !!c.secure, user: c.user || '', from: c.from || '', hasPass: !!c.pass };
    },
    set(c) {
      const old = read();
      const n = { host: c.host, port: +c.port || 587, secure: !!c.secure, user: c.user, from: c.from, pass: old.pass };
      if (c.pass) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer, so the password cannot be saved.');
        n.pass = safeStorage.encryptString(c.pass).toString('base64');
      }
      fs.writeFileSync(file, JSON.stringify(n));
    },
    async send({ to, subject, text, filename, pdf }) {
      const c = read();
      if (!c.host || !c.user || !c.pass) throw new Error('Set up email in Settings first.');
      const pass = safeStorage.decryptString(Buffer.from(c.pass, 'base64'));
      const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass } });
      await t.sendMail({ from: c.from || c.user, to, subject, text, attachments: pdf ? [{ filename, content: pdf }] : [] });
    }
  };
};
