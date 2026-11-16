# Maintenance plan

## 1. How the app is laid out
- `main.js` window, saving, PDFs, auto-update. `invoice.js` the invoice layout. `mail.js` email sending. `security.js` token and PIN checks. `tools/` your admin scripts. `preload.js` the safe bridge. `db.js` data file, backups, migrations (tested). `renderer/index.html` the whole interface.
- **Customer data is never inside the install folder.** It lives in `%APPDATA%\Shop Ledger` (`data.json`, a `backups` folder with one file per day for 30 days, and `app.log`). Installing a new version never touches it. Settings shows this path and has an "Open data folder" button.

## 2. Releasing an update (from your machine)
1. Make the change. Run `npm test` and `npm start` and try it.
2. Raise `version` in `package.json` (1.0.0 → 1.0.1 for fixes, 1.1.0 for features).
3. `git commit`, then `git tag v1.0.1` and `git push --tags`.
4. GitHub Actions builds the installer. When it finishes, the repo's Releases page has `Shop Ledger Setup 1.0.1.exe` and `latest.yml`. Keep every release; never delete old ones.

## 3. Getting the update onto a customer's machine
- **Normal:** nothing to do. A few seconds after the app opens it checks for a newer release, downloads it, and installs it when the app is closed. Settings > Check for updates does the same on demand.
- **Auto-update not working** (no internet, blocked): download the Setup `.exe` from Releases and run it on their machine. It installs over the old version and keeps their data.
- The repo must be **public** for auto-update to work without a token. The code holds no customer data or secrets. If it must be private, use the manual route above.

## 4. Changing what is stored (important)
If a change adds or reshapes saved data (a new field on products, say):
1. In `db.js` raise `SCHEMA` by one and add one entry to `MIGRATIONS` that upgrades old data. Never edit an old entry.
2. Add a test in `test/db.test.js` with a sample of the old shape. `npm test` must pass.
3. Before upgrading a file, the app copies it to `backups\pre-migrate-vN.json`.
The app refuses to open data from a newer version than itself, so an old build can never damage upgraded data.

## 5. Visiting someone else's machine: checklist
Before: confirm the Windows version and that they have internet; note the current version (Settings > About).
1. Open Settings > Open data folder and copy `data.json` and `backups` to a USB stick or cloud folder.
2. Install or update (section 3). Open the app.
3. Check Settings shows the new version, and that products, orders and the dashboard totals match what they had.
4. Make a test change, close and reopen, and confirm it stuck. Delete the test data.
5. Leave them: the version number, where backups are, and how to reach you.

## 6. Rolling back
1. Close the app. Uninstall (data stays). Install the older Setup `.exe` from Releases.
2. If the new version had changed the data structure, the old app will refuse the data. Copy `backups\pre-migrate-vN.json` over `data.json` (with the app closed).
3. Auto-update will offer the new version again. Fix the problem and release a higher version number rather than reusing one.

## 7. Troubleshooting
- Open `app.log` in the data folder. Press Ctrl+Shift+I in the app for the developer console.
- "Data file was damaged": the app loaded yesterday's backup automatically; the damaged file is kept beside it as `data.json.corrupt-...`.
- Windows SmartScreen warns about an unknown publisher: the installer is unsigned. Choose More info > Run anyway. A code-signing certificate removes the warning.
- Antivirus blocks the installer: allow it, or install from the Releases page rather than a forwarded copy.

## 8. Good habits
- Keep the repo in GitHub (it is also your backup of the source). Run `npm outdated` every few months and update Electron for security fixes, then release as above.
- Never release on a Friday or before visiting a customer without testing the installer on a clean machine first.

## 9. Invoices and email (added in 1.1.0)
- Data version 2 added business details, invoice numbers and customer emails. Existing data upgrades automatically on first launch (a `pre-migrate-v1.json` backup is written first).
- Invoice numbers are assigned once (prefix plus a running number) and never change, so the sequence stays unbroken. The counter is `nextInvoice` in `data.json`.
- PDFs are made by the app itself (no extra software). Email goes through the customer's own mail account (SMTP), so each machine needs Settings > Email setup done once, then "Send a test email to myself".
- The email password is encrypted by Windows for that user account and kept in `mail.json` in the data folder. It is **not** in data backups, and it does not move to another computer or Windows user: re-enter it there.
- Gmail needs an app password (2-step verification on). Microsoft 365 accounts may have SMTP sending disabled by their admin.
- If email fails, the error text is shown in the app and written to `app.log`. "Save as PDF" always works without email.
- On a new customer's machine, fill in Settings > Business details before the first invoice.

## 10. Access tokens, revoking access, PIN (added in 1.2.0)
**What it does.** Every installed copy needs an access token that you issue. Tokens are signed with your private key; the app holds only the public key, so nobody can make their own. You can cut off one customer without affecting the others.

**One-time setup (on your machine)**
1. `node tools/keygen.js` creates `keys/private.pem` (secret, never committed, **back it up**: if lost you cannot issue tokens, if leaked anyone can) and `access/public.pem`.
2. Commit `access/public.pem`. Put your GitHub username in `access.config.json` (`revocationUrl`). The repo must be public for that link to work, or point it at any HTTPS file you control.
3. Release as normal. The release build refuses to run without `access/public.pem`.

**Giving someone access:** `node tools/issue-token.js "Customer name" [days]` prints a token. Send it to them; they paste it into the activation screen. Leave out `days` for no expiry. Every token is recorded in `keys/issued.json`.

**Revoking:** `node tools/revoke.js <id>`, then commit and push `access/revoked.json`. The app checks the list when it opens and every 6 hours. Within about 5 to 10 minutes (GitHub caching) of their next check, the app locks and shows the activation screen. `node tools/revoke.js --restore <id>` undoes it, and `--list` shows every token and its status.

**Good to know**
- Their data is never deleted by a revoke. The app just stops opening it, so you can restore access later.
- Offline use is allowed for 14 days after the last successful check (`graceDays`), then the app asks the user to connect to the internet.
- A revoke cannot reach a machine that never goes online, and a token can be copied to another PC. Revoking the token ends all copies. Use an expiry for extra control.
- Everyone updating from 1.1.0 or earlier will see the activation screen on first launch. Issue their tokens before you release 1.2.0.
- Test the flow without installing: `set REQUIRE_ACCESS=1` then `npm start` (PowerShell: `$env:REQUIRE_ACCESS=1; npm start`).

**PIN lock (per machine).** Settings > Security. The PIN is stored hashed, is asked for at start and after 15 idle minutes, and wrong tries are delayed (5 tries, then 30 seconds doubling to 15 minutes). It stops casual access but does not encrypt `data.json`. If someone forgets it, close the app and delete `pin.json` from the data folder.

**Checklist when the key might be compromised:** run keygen again after deleting the old key files, release a new version with the new `public.pem`, and reissue tokens. Old tokens stop working in the new version.

## 11. Backups outside the computer (added in 1.3.0)
**What it does.** In Settings > Backups outside this computer the customer chooses a folder. The app writes `ShopLedger-YYYY-MM-DD.json` (or `.slbk` if password-protected) there once a day, again every hour when something has changed, and when the app closes. One file per day; the newest 30 are kept. Every backup is read back after writing to prove it opens.

**Best folder choice:** a folder inside OneDrive, Google Drive or Dropbox (cloud copy for free), otherwise a USB or network drive.

**Warnings.** A red bar appears on every screen when no folder is chosen, the folder cannot be reached (drive unplugged, cloud folder gone), the last backup failed, or the last backup is more than 3 days old. It has a "Back up now" button.

**Password.** Optional. Encrypted with AES-256-GCM. The password is kept on that machine (encrypted by Windows) so daily backups run unattended. **If it is forgotten, the backups cannot be opened by anyone, including you.** Tell customers to write it down. Changing it only affects new backups; older files still need the old password.

**Restoring (also how to move to a new computer)**
1. Install the app, activate it, then Settings > Restore from a backup file.
2. Pick the file (the dialog opens in the backup folder). Enter its password if asked.
3. Confirm. The current data is first copied to `backups\pre-restore-<time>.json` in the data folder, so a wrong restore can be undone by copying that file over `data.json` with the app closed.
Files from older app versions restore fine and are upgraded automatically; files from a *newer* app version are refused.

**What is not in the backup.** Only business data (products, orders, customers' details on orders, expenses, business details, invoice numbers). The email password, PIN, access token and backup settings stay on the machine, so on a new computer redo Email setup, PIN and the backup folder. The access token is yours to reissue.

**Support checklist:** on a visit, confirm the red bar is absent, click Back up now, open the folder and check today's file is there, and do a trial restore on a spare machine at least once per customer.

## 12. Payments, quotes, credit notes, purchasing and reports (added in 2.0.0)
**Data version 3.** On first launch the app upgrades existing data (after writing `backups\pre-migrate-v2.json`):
- Every order now stores the tax rate it was made under, and a list of payments. Orders that were already Paid, Shipped or Completed are given one payment for their full amount on the order date, so nobody suddenly appears to owe money. Pending orders show as owing.
- New lists: `quotes`, `credits`, `suppliers`, `purchases`, `moves` (stock history), plus the counters `nextQuote`, `nextCredit`, `nextPurchase`. Expenses gain a category.

**How the pieces fit**
- **Payments** are recorded on an order (Orders > Open). Part payments are fine. Choosing the Paid status records whatever is still owed. A cancelled or credited order that was already paid shows "Refund due", settled by recording a refund.
- **Credit notes** are raised from the order they relate to. They take money off that order and off sales on the day they are issued, and can put the goods back in stock. Numbers run CN-0001 upwards and never repeat.
- **Quotes** are saved from the order form ("Save as quote"), do not touch stock, last 30 days, and become an order with "Make order". Numbers run QUO-0001 upwards.
- **Purchase orders** (Purchasing tab) only change stock when "Receive stock" is clicked. Receiving sets the product's cost to the weighted average of old and new stock. Buying stock is deliberately not an expense: its cost counts when the goods are sold.
- **Stock history** (Products > History) lists every change from 2.0.0 onwards. Sales before the upgrade are not listed.
- **Statements** are sent from a customer's panel on the Customers tab. "Who owes you" splits debts by the age of each unpaid order.
- **Reports** can be exported to CSV (opens in Excel) or saved as PDF. The tax report covers tax collected on sales only; the app does not record tax paid on expenses.

**Code map.** Rules are in `renderer/js/ledger.js`, reports in `renderer/js/reports.js`, PDF contents in `renderer/js/documents.js` (all three are tested and have no screen code). `pdf-template.js` turns any document into the printed page.

## 13. Licences screen (developer only, added in 2.0.0)
When you run the app from source (`npm start`) on the machine that has `keys/private.pem`, a **Licences** tab appears. It does the same as the command-line tools in section 10: issue a token (with optional expiry), list every token and its status, revoke and restore.
- It never appears in installed copies: the installer contains neither `tools/` nor `keys/`, and the app only loads this code when it is not packaged.
- A newly issued token is shown once with a Copy button. It is not stored, only its id and name are (`keys/issued.json`).
- Revoking or restoring changes `access/revoked.json` on your machine. It takes effect when that file reaches GitHub: use the "Commit and push now" button in the red bar, or commit and push it yourself.
