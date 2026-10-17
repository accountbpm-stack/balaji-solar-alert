# Solar Monitor – Setup (one time, ~10 min)

## 1. Add the code
1. Open your **Solar Production Report** Google Sheet (the one with the "BPI Daily" / "SBP Daily production" tabs) → **Extensions → Apps Script**
   - Important: open Apps Script **from inside the report sheet**, not from a new blank sheet.
2. Replace everything in `Code.gs` with the **Code.gs** file
3. Left panel **＋ → HTML** → name it `Index` → paste **Index.html**
4. 💾 Save

## 2. Run setup
1. Function dropdown → **setup** → **Run**
2. Allow permissions (Review permissions → your account → *Advanced → Go to project (unsafe)* → **Allow**)
3. Open **Execution log** – it should show:
   `BPI → OK, using tab "BPI Daily", years: 2023, 2024, 2025, 2026`
   If it says **NOT FOUND**, see *Troubleshooting* below.

## 3. Deploy (get the link)
1. **Deploy → New deployment** → ⚙ **Web app**
2. Execute as: **Me** · Who has access: **Anyone**
3. **Deploy** → copy the **Web app URL** – this is your tool link

## 4. First login
- Open the link → **admin / admin123** → top-right **⋯** → change password
- **Settings**: check *Report sheet* shows ✓ BPI and ✓ SBP; add boss email, your reminder email, Telegram → **Save settings**
- **Settings → Users**: create the boss user (role **boss**) and staff users (role **staff**)
- Click **Build alerts for last 60 days** (no emails are sent for old days)
- Click **Send test email / Telegram**

## 5. Boss's Android phone
Open the link in Chrome → ⋮ menu → **Add to Home screen**. Log in once; it stays logged in.

## 6. Telegram alerts (free)
1. In Telegram open **@BotFather** → `/newbot` → give a name (e.g. *Balaji Solar Alert*) → copy the **token**
2. Boss opens the new bot and taps **Start** (or sends "hi")
3. In a browser open `https://api.telegram.org/bot<TOKEN>/getUpdates` → the number in `"chat":{"id":123456789` is the **chat ID**
   (For a group: add the bot to the group, send a message there, repeat this step – group IDs start with a minus)
4. Paste token + chat ID in Settings → Save → **Send test email / Telegram**

## 7. Office Tools dashboard
- In `solar-monitor.html` replace `PASTE_WEB_APP_URL_HERE` with the Web app URL → put the file in `tools/`
- Add an entry in `config.js` like your other tools (file: `tools/solar-monitor.html`, name: *Solar Monitor*)

## Troubleshooting – "Daily sheet for BPI not found"
The script is not looking at your report sheet. Fix with either option:
- **Settings → Report sheet** → paste your report Google Sheet URL → **Link sheet**, or
- In `Code.gs` (line 15) set `REPORT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/...'` → Save → run **setup** again.
The tool auto-detects tabs that contain year blocks like `BPI -2026` / `SBP -2026`, even if the tab name is different.

## Updating the code later
Deploy → **Manage deployments** → ✏ Edit → Version: **New version** → Deploy (the link stays the same)

## Android app (full-screen alarm)
See **APP_GUIDE.md**. The deployment must have *Who has access: **Anyone*** for the app to work.

## Daily report
When all plants are entered for a day (today or the last 3 days), that day's report is sent once to the boss (email + Telegram) and to the mobile app, and is shown on screen after saving. If a value is changed later, an "updated" report is sent. Turn it off in Settings → "Send daily report".
