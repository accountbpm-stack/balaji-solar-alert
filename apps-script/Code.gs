/*******************************************************************
 *  BALAJI GROUP – SOLAR PRODUCTION MONITOR  (Apps Script backend)
 *  ---------------------------------------------------------------
 *  - Reads/writes daily production directly in your report sheet
 *    ("BPI Daily" / "SBP Daily production", year blocks "BPI -2026").
 *  - Creates the next year's block + Monthly sheet link automatically.
 *  - Low production → instant email + Telegram alert to the boss.
 *  - Daily evening check + entry reminder, monthly summary on the 1st.
 *
 *  First time: select function "setup" and click Run.
 *  If this script is NOT inside the report Google Sheet, paste the
 *  report sheet URL in REPORT_SHEET_URL below before running setup.
 *******************************************************************/

const REPORT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1n-XifwUudzsUHKxMgPc5kr1jDKnLFxuhQZ6rmT-YptM/edit';   // Solar Production Report

const TZ = 'Asia/Kolkata';
const SH = { SET: 'SPM_Settings', USERS: 'SPM_Users', ALERTS: 'SPM_Alerts', LOG: 'SPM_Log', REPORTS: 'SPM_DailyReports', DEVICES: 'SPM_Devices' };
const ALERT_HEAD = ['Key', 'Date', 'Plant', 'kWh', 'Normal', 'DropPct', 'Type', 'Severity',
  'Status', 'Remark', 'Notified', 'UpdatedBy', 'UpdatedAt', 'CreatedAt'];

const DEFAULT_SETTINGS = {
  companyName: 'Balaji Group',
  plants: [
    { code: 'BPI', name: 'Balaji Packaging Industries', capacityKw: 72,
      dailySheet: 'BPI Daily', monthlySheet: 'BPI Monthly N Yearly  Production ', tag: 'BPI' },
    { code: 'SBP', name: 'Shri Balaji Packaging', capacityKw: 150,
      dailySheet: 'SBP Daily production', monthlySheet: 'SBP Month/year Data', tag: 'SBP' }
  ],
  thresholdPct: 40,        // alert when production is this % below normal
  urgentDays: 2,           // low for this many days in a row → URGENT
  bossEmails: '',          // comma separated
  reminderEmails: '',      // who gets the "entry pending" reminder
  alertOnWeather: false,   // also alert when ALL plants are low (weather)?
  dailyReport: true,       // send the day's report (email + Telegram + app) when all plants are entered
  dailyCheckHour: 19,      // daily check time (24h)
  telegramToken: '',
  telegramChatId: '',
  fcmProjectId: ''         // Firebase project ID – instant push to the Android app
};

/* ============================ ENTRY POINTS ============================ */

function doGet(e) {
  const out = HtmlService.createHtmlOutputFromFile('Index');
  // Android app: opens the web app with ?t=<session token> so the user does not log in twice
  const t = e && e.parameter && e.parameter.t;
  if (t) {
    let valid = false;
    try { auth_(String(t)); valid = true; } catch (err) { }
    if (valid) out.setContent(out.getContent().replace('<head>',
      '<head><script>window.SPM_BOOT_TOKEN=' + JSON.stringify(String(t)) + ';</script>'));
  }
  return out
    .setTitle('Solar Monitor – Balaji Group')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** JSON API for the Android app: POST {action, payload, token} → same as api(). */
function doPost(e) {
  let res;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (['login', 'appAlerts', 'updateAlert', 'logout', 'registerDevice', 'dailyReport'].indexOf(body.action) < 0) throw new Error('Not allowed from app');
    res = api(body.action, body.payload || {}, body.token);
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: links the sheet, creates helper tabs, sets the daily trigger. */
function setup() {
  if (REPORT_SHEET_URL) PropertiesService.getScriptProperties().setProperty('REPORT_SS_ID', idFromUrl_(REPORT_SHEET_URL));
  ensureSheets_();
  installTriggers_();
  const s = getSettings_();
  Logger.log('Linked spreadsheet: ' + ss_().getName());
  Logger.log('Tabs found: ' + ss_().getSheets().map(x => x.getName()).join(' | '));
  s.plants.forEach(p => {
    const sh = plantSheet_(p);
    Logger.log(p.code + ' → ' + (sh ? 'OK, using tab "' + sh.getName() + '", years: ' + Object.keys(blocks_(sh, p.tag)).join(', ')
      : 'NOT FOUND – check the tab name in Settings'));
  });
  Logger.log('Default login → admin / admin123 (change it immediately).');
}

/** Time trigger – runs every evening. */
function dailyCheck() {
  ensureSheets_();
  const s = getSettings_();
  const data = readAll_(s);
  const today = ymd_(new Date());
  const yest = addDays_(today, -1);
  [yest, today].forEach(d => upsertAlertsForDate_(d, data, s, 'system', true));
  notifyPending_(s, data, { includePending: true });

  const missing = s.plants.filter(p => data[p.code][today] == null).map(p => p.code);
  if (missing.length && s.reminderEmails) {
    sendMail_(s.reminderEmails, '⏰ Solar entry pending – ' + fmtDate_(today),
      card_('Today\'s solar entry is pending',
        '<p style="margin:0 0 8px">No entry yet for ' + fmtDate_(today) + ': <b>' + missing.join(', ') + '</b></p>' +
        btn_(appUrl_(), 'Make entry')));
  }
  if (today.slice(8, 10) === '01') {
    const prev = addDays_(today, -1).slice(0, 7);
    try { sendMonthlySummary_(prev, s, data); } catch (e) { log_('system', 'monthlyError', String(e)); }
  }
}

/* ============================ API (frontend) ============================ */

function api(action, payload, token) {
  try {
    ensureSheets_();
    payload = payload || {};
    if (action === 'login') return ok_(login_(payload));
    const user = auth_(token);
    const s = getSettings_();
    switch (action) {
      case 'bootstrap': return ok_(bootstrap_(user, s));
      case 'logout': PropertiesService.getScriptProperties().deleteProperty('S_' + token); return ok_(true);
      case 'changePassword': return ok_(changePassword_(user, payload));
      case 'saveEntries': need_(user, ['admin', 'staff']); return ok_(saveEntries_(payload.rows || [], user, s, payload.source || 'manual'));
      case 'updateAlert': need_(user, ['admin', 'boss']); return ok_(updateAlert_(payload, user));
      case 'emailMonth': need_(user, ['admin', 'boss']); sendMonthlySummary_(payload.month, s, readAll_(s)); return ok_(true);
      case 'saveSettings': need_(user, ['admin']); return ok_(saveSettings_(payload, user));
      case 'saveUser': need_(user, ['admin']); return ok_(saveUser_(payload, user));
      case 'deleteUser': need_(user, ['admin']); return ok_(deleteUser_(payload.username, user));
      case 'installTriggers': need_(user, ['admin']); installTriggers_(); return ok_(true);
      case 'testEmail': need_(user, ['admin']);
        if (!s.bossEmails && !s.reminderEmails) throw new Error('Add a boss or reminder email in Settings first');
        sendMail_(s.bossEmails || s.reminderEmails, '✅ Solar Monitor – test email',
          card_('Test email', '<p>Solar Monitor email alerts are working.</p>' + btn_(appUrl_(), 'Open app')));
        sendTelegram_(s, '✅ Solar Monitor – test message');
        return ok_(true);
      case 'rebuildAlerts': need_(user, ['admin']); return ok_(rebuildAlerts_(payload.days || 60, user, s));
      case 'linkSheet': need_(user, ['admin']); return ok_(linkSheet_(payload.url, user));
      case 'appAlerts': return ok_(appAlerts_(user, s));
      case 'registerDevice': return ok_(registerDevice_(user, payload));
      case 'testPush': need_(user, ['admin']); return ok_(testPush_(s));
      case 'dailyReport': return ok_(dailyReport_(String(payload.date || ''), readAll_(s), s));
      default: throw new Error('Unknown action');
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function ok_(data) { return { ok: true, data: data }; }
function need_(user, roles) { if (roles.indexOf(user.role) < 0) throw new Error('You do not have permission for this'); }

/* ============================ AUTH ============================ */

function login_(p) {
  const users = readUsers_();
  const u = users.find(x => x.username.toLowerCase() === String(p.username || '').trim().toLowerCase());
  if (!u || !u.active || hash_(p.password || '', u.salt) !== u.hash) throw new Error('Wrong username or password');
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(k => { if (k.indexOf('S_') === 0) { try { if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } } });
  props.setProperty('S_' + token, JSON.stringify({ u: u.username, exp: Date.now() + 45 * 24 * 3600 * 1000 }));
  log_(u.username, 'login', '');
  return { token: token };
}

function auth_(token) {
  if (!token) throw new Error('AUTH');
  const raw = PropertiesService.getScriptProperties().getProperty('S_' + token);
  if (!raw) throw new Error('AUTH');
  const sess = JSON.parse(raw);
  if (sess.exp < Date.now()) throw new Error('AUTH');
  const u = readUsers_().find(x => x.username === sess.u);
  if (!u || !u.active) throw new Error('AUTH');
  return { username: u.username, name: u.name, role: u.role };
}

function hash_(pw, salt) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(b);
}

function readUsers_() {
  const v = sheet_(SH.USERS).getDataRange().getValues();
  return v.slice(1).filter(r => r[0]).map((r, i) => ({
    row: i + 2, username: String(r[0]), name: String(r[1] || r[0]), role: String(r[2] || 'staff'),
    salt: String(r[3]), hash: String(r[4]), active: r[5] !== false && String(r[5]).toUpperCase() !== 'FALSE'
  }));
}

function saveUser_(p, actor) {
  const username = String(p.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) throw new Error('Username must be 3-30 letters/numbers');
  if (['admin', 'staff', 'boss'].indexOf(p.role) < 0) throw new Error('Invalid role');
  const sh = sheet_(SH.USERS);
  const users = readUsers_();
  const ex = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (ex) {
    if (ex.role === 'admin' && (p.role !== 'admin' || p.active === false) && users.filter(u => u.role === 'admin' && u.active).length < 2)
      throw new Error('At least one active admin is required');
    sh.getRange(ex.row, 2).setValue(p.name || username);
    sh.getRange(ex.row, 3).setValue(p.role);
    sh.getRange(ex.row, 6).setValue(p.active !== false);
    if (p.password) { const salt = Utilities.getUuid(); sh.getRange(ex.row, 4, 1, 2).setValues([[salt, hash_(p.password, salt)]]); }
  } else {
    if (!p.password || p.password.length < 4) throw new Error('Password must be at least 4 characters');
    const salt = Utilities.getUuid();
    sh.appendRow([username, p.name || username, p.role, salt, hash_(p.password, salt), true, new Date()]);
  }
  log_(actor.username, 'saveUser', username + ' (' + p.role + ')');
  return readUsers_().map(publicUser_);
}

function deleteUser_(username, actor) {
  if (username === actor.username) throw new Error('You cannot delete yourself');
  const u = readUsers_().find(x => x.username === username);
  if (!u) throw new Error('User not found');
  sheet_(SH.USERS).deleteRow(u.row);
  log_(actor.username, 'deleteUser', username);
  return readUsers_().map(publicUser_);
}

function changePassword_(user, p) {
  const u = readUsers_().find(x => x.username === user.username);
  if (hash_(p.oldPassword || '', u.salt) !== u.hash) throw new Error('Current password is wrong');
  if (!p.newPassword || p.newPassword.length < 4) throw new Error('New password must be at least 4 characters');
  const salt = Utilities.getUuid();
  sheet_(SH.USERS).getRange(u.row, 4, 1, 2).setValues([[salt, hash_(p.newPassword, salt)]]);
  log_(user.username, 'changePassword', '');
  return true;
}

function publicUser_(u) { return { username: u.username, name: u.name, role: u.role, active: u.active }; }

/* ============================ SETTINGS ============================ */

function getSettings_() {
  const v = sheet_(SH.SET).getDataRange().getValues();
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  v.slice(1).forEach(r => { if (r[0] && r[1] !== '') { try { s[r[0]] = JSON.parse(r[1]); } catch (e) { s[r[0]] = r[1]; } } });
  s.thresholdPct = Number(s.thresholdPct) || 40;
  s.urgentDays = Number(s.urgentDays) || 2;
  s.plants.forEach(p => { p.capacityKw = Number(p.capacityKw) || 1; p.tag = p.tag || p.code; });
  return s;
}

function saveSettings_(p, actor) {
  const cur = getSettings_();
  const keys = Object.keys(DEFAULT_SETTINGS);
  keys.forEach(k => { if (p[k] !== undefined) cur[k] = p[k]; });
  if (!Array.isArray(cur.plants) || !cur.plants.length) throw new Error('At least one plant is required');
  const sh = sheet_(SH.SET);
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
  sh.getRange(2, 1, keys.length, 2).setValues(keys.map(k => [k, JSON.stringify(cur[k])]));
  if (p.dailyCheckHour !== undefined) { try { installTriggers_(); } catch (e) { } }
  log_(actor.username, 'saveSettings', '');
  return getSettings_();
}

/* ============================ SHEET SYNC ============================ */

function idFromUrl_(u) { const m = String(u).match(/\/d\/([a-zA-Z0-9_-]{20,})/); return m ? m[1] : String(u).trim(); }

let SS_CACHE_ = null;
function ss_() {
  if (SS_CACHE_) return SS_CACHE_;
  const id = PropertiesService.getScriptProperties().getProperty('REPORT_SS_ID') || (REPORT_SHEET_URL ? idFromUrl_(REPORT_SHEET_URL) : '');
  SS_CACHE_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!SS_CACHE_) throw new Error('Report Google Sheet is not linked. Put the sheet URL in REPORT_SHEET_URL (top of Code.gs) and run setup.');
  return SS_CACHE_;
}
function norm_(s) { return String(s || '').toLowerCase().replace(/[\s._-]+/g, ' ').trim(); }

function findSheet_(name) {
  if (!name) return null;
  const ss = ss_();
  const sh = ss.getSheetByName(name);
  if (sh) return sh;
  const n = norm_(name);
  const sheets = ss.getSheets();
  const exact = sheets.find(x => norm_(x.getName()) === n);
  if (exact) return exact;
  // loose match: ignore spaces/punctuation, allow a truncated name
  const k = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const kn = k(name);
  return sheets.find(x => k(x.getName()) === kn) ||
    (kn.length >= 8 ? sheets.find(x => k(x.getName()).indexOf(kn) === 0) : null) || null;
}

/** Plant's daily sheet: by name first, otherwise any tab that has "<TAG> -YYYY" year blocks. */
function plantSheet_(p) {
  const byName = findSheet_(p.dailySheet);
  if (byName && Object.keys(blocks_(byName, p.tag)).length) return byName;
  const auto = ss_().getSheets().find(sh => sh.getName().indexOf('SPM_') !== 0 && Object.keys(blocks_(sh, p.tag)).length);
  return auto || byName || null;
}

function sheet_(name) {
  let sh = ss_().getSheetByName(name);
  if (!sh) { ensureSheets_(); sh = ss_().getSheetByName(name); }
  return sh;
}

let ENSURED_ = false;
function ensureSheets_() {
  if (ENSURED_) return;
  const ss = ss_();
  const mk = (name, head) => {
    let sh = ss.getSheetByName(name);
    if (sh) return { sh: sh, created: false };
    sh = ss.insertSheet(name, ss.getSheets().length);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#fff3d6');
    sh.setFrozenRows(1);
    return { sh: sh, created: true };
  };
  const set = mk(SH.SET, ['Key', 'Value']);
  if (set.created) {
    const keys = Object.keys(DEFAULT_SETTINGS);
    set.sh.getRange(2, 1, keys.length, 2).setValues(keys.map(k => [k, JSON.stringify(DEFAULT_SETTINGS[k])]));
  }
  const us = mk(SH.USERS, ['Username', 'Name', 'Role', 'Salt', 'Hash', 'Active', 'Created']);
  if (us.created) {
    const salt = Utilities.getUuid();
    us.sh.appendRow(['admin', 'Administrator', 'admin', salt, hash_('admin123', salt), true, new Date()]);
  }
  mk(SH.ALERTS, ALERT_HEAD);
  mk(SH.LOG, ['Time', 'User', 'Action', 'Details']);
  mk(SH.REPORTS, ['Date', 'Values', 'Version', 'SentAt', 'SentBy']);
  mk(SH.DEVICES, ['Username', 'PushToken', 'Device', 'Updated']);
  ENSURED_ = true;
}

/** Year blocks in a daily sheet: { 2023: titleRow, 2024: ... } */
function blocks_(sh, tag) {
  const last = sh.getLastRow();
  if (!last) return {};
  const colA = sh.getRange(1, 1, Math.min(last, 3000), 1).getDisplayValues();
  const t = String(tag).replace(/[.\s]/g, '').toUpperCase();
  const out = {};
  colA.forEach((r, i) => {
    const m = String(r[0]).match(/^\s*([A-Za-z.\s]+?)\s*[-–]\s*(\d{4})\s*$/);
    if (m && m[1].replace(/[.\s]/g, '').toUpperCase() === t && !out[m[2]]) out[m[2]] = i + 1;
  });
  return out;
}

/** All plants: { BPI: {'2026-10-04': 46.6, ...}, SBP: {...} } */
function readAll_(s) {
  const today = ymd_(new Date());
  const out = {};
  s.plants.forEach(p => {
    out[p.code] = {};
    const sh = plantSheet_(p);
    if (!sh) return;
    const b = blocks_(sh, p.tag);
    Object.keys(b).forEach(year => {
      const vals = sh.getRange(b[year] + 2, 2, 31, 12).getValues();
      for (let d = 1; d <= 31; d++) {
        for (let m = 1; m <= 12; m++) {
          const v = vals[d - 1][m - 1];
          if (v === '' || v === null || isNaN(Number(v))) continue;
          if (d > daysInMonth_(+year, m)) continue;
          const key = year + '-' + pad_(m) + '-' + pad_(d);
          if (key > today) continue;
          out[p.code][key] = Math.round(Number(v) * 10) / 10;
        }
      }
    });
  });
  return out;
}

function writeValue_(plant, key, kwh) {
  const sh = plantSheet_(plant);
  if (!sh) throw new Error('Daily sheet for ' + plant.code + ' not found ("' + plant.dailySheet + '"). Fix the tab name in Settings → Plants.');
  const y = key.slice(0, 4), m = +key.slice(5, 7), d = +key.slice(8, 10);
  let b = blocks_(sh, plant.tag);
  if (!b[y]) { createYearBlock_(sh, plant, +y); b = blocks_(sh, plant.tag); }
  if (!b[y]) throw new Error('Could not create the ' + plant.code + ' ' + y + ' block');
  sh.getRange(b[y] + 1 + d, 1 + m).setValue(kwh === null ? '' : kwh);
}

/** Creates a new year block by copying the latest one, and links the Monthly sheet. */
function createYearBlock_(sh, plant, year) {
  const b = blocks_(sh, plant.tag);
  const years = Object.keys(b).map(Number).sort((a, c) => a - c);
  if (!years.length) throw new Error('No "' + plant.tag + ' -YYYY" block found in ' + sh.getName());
  const src = b[years[years.length - 1]];
  const newTitle = Math.max.apply(null, years.map(y => b[y])) + 38;
  const need = newTitle + 36;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.getRange(src, 1, 36, 13).copyTo(sh.getRange(newTitle, 1, 36, 13));
  sh.getRange(newTitle, 1).setValue(plant.tag + ' -' + year);
  sh.getRange(newTitle + 2, 2, 31, 12).clearContent();
  sh.getRange(newTitle + 33, 2, 1, 12).clearContent();
  const msh = findSheet_(plant.monthlySheet);
  if (msh) {
    const colA = msh.getRange(1, 1, Math.max(msh.getLastRow(), 1), 1).getDisplayValues();
    const idx = colA.findIndex(r => norm_(r[0]).replace(/\s/g, '') === ('year' + year));
    if (idx >= 0 && !msh.getRange(idx + 1, 2).getFormula() && msh.getRange(idx + 1, 2).getValue() === '') {
      const f = [];
      for (let m = 1; m <= 12; m++) f.push("='" + sh.getName() + "'!" + colLetter_(1 + m) + (newTitle + 35));
      msh.getRange(idx + 1, 2, 1, 12).setFormulas([f]);
    }
  }
  log_('system', 'createYearBlock', plant.code + ' ' + year);
}

/** Admin: point the tool to the report Google Sheet (by URL). */
function linkSheet_(url, user) {
  const id = idFromUrl_(url || '');
  if (!id) throw new Error('Paste the full Google Sheet URL');
  let ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) { throw new Error('Cannot open that sheet – check the URL and that this Google account has edit access'); }
  PropertiesService.getScriptProperties().setProperty('REPORT_SS_ID', id);
  SS_CACHE_ = ss; ENSURED_ = false;
  ensureSheets_();
  log_(user.username, 'linkSheet', ss.getName());
  return { name: ss.getName() };
}

/* ============================ ENTRIES ============================ */

function saveEntries_(rows, user, s, source) {
  if (!rows.length) throw new Error('Nothing to save');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const today = ymd_(new Date());
    const dates = {};
    rows.forEach(r => {
      const p = s.plants.find(x => x.code === r.plant);
      if (!p) throw new Error('Unknown plant: ' + r.plant);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date > today) throw new Error('Invalid or future date: ' + r.date);
      let v = r.kwh;
      if (v === '' || v === null || v === undefined) v = null;
      else {
        v = Math.round(Number(v) * 10) / 10;
        if (isNaN(v) || v < 0) throw new Error('Invalid kWh: ' + r.kwh);
        if (v > p.capacityKw * 14) throw new Error(p.code + ' ' + r.date + ': ' + v + ' kWh is more than the plant capacity allows');
      }
      writeValue_(p, r.date, v);
      dates[r.date] = true;
    });
    SpreadsheetApp.flush();
    const data = readAll_(s);
    const keys = Object.keys(dates).sort();
    const recent = addDays_(today, -3);
    keys.forEach(d => upsertAlertsForDate_(d, data, s, user.username, d >= recent));
    keys.forEach(d => { const n = addDays_(d, 1); if (n <= today && !dates[n]) upsertAlertsForDate_(n, data, s, user.username, n >= recent); });
    const sent = notifyPending_(s, data, { includePending: false });
    let reports = [];
    try { reports = sendDailyReports_(keys.filter(d => d >= recent), data, s, user.username); }
    catch (e) { log_('system', 'dailyReportError', String(e)); }
    log_(user.username, 'saveEntries', source + ': ' + rows.length + ' rows (' + keys[0] + (keys.length > 1 ? ' → ' + keys[keys.length - 1] : '') + ')');
    return { saved: rows.length, notified: sent, reports: reports, alerts: readAlerts_(), data: data };
  } finally { lock.releaseLock(); }
}

/* ============================ ALERT LOGIC ============================ */

function median_(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }

/** Month-wise normal per plant (median of past non-zero days). */
function normals_(data, s) {
  const out = {};
  s.plants.forEach(p => {
    out[p.code] = {};
    const byM = {};
    Object.keys(data[p.code] || {}).forEach(k => { const v = data[p.code][k]; if (v > 0) (byM[k.slice(5, 7)] = byM[k.slice(5, 7)] || []).push(v); });
    for (let m = 1; m <= 12; m++) {
      const arr = byM[pad_(m)] || [];
      out[p.code][pad_(m)] = arr.length >= 8 ? Math.round(median_(arr) * 10) / 10 : Math.round(p.capacityKw * 3.0);
    }
  });
  return out;
}

function isLow_(v, normal, s) { return v != null && v < normal * (1 - s.thresholdPct / 100); }

function classify_(date, data, s, N) {
  const m = date.slice(5, 7);
  const res = {};
  const vals = s.plants.map(p => ({ p: p, v: data[p.code][date], n: N[p.code][m] }));
  const lows = vals.filter(x => isLow_(x.v, x.n, s));
  const missing = vals.filter(x => x.v == null);
  vals.forEach(x => {
    if (!isLow_(x.v, x.n, s)) { res[x.p.code] = null; return; }
    let type;
    if (x.v <= 0) type = 'DOWN';
    else if (s.plants.length > 1 && lows.length === s.plants.length) type = 'WEATHER';
    else if (missing.length) type = 'PENDING';
    else type = 'PLANT';
    res[x.p.code] = { kwh: x.v, normal: x.n, drop: Math.round((1 - x.v / x.n) * 100), type: type };
  });
  return res;
}

function streak_(plantCode, date, data, s, N) {
  let n = 0, d = date;
  for (let i = 0; i < 10; i++) {
    const c = classify_(d, data, s, N)[plantCode];
    if (!c || c.type === 'WEATHER') break;
    n++; d = addDays_(d, -1);
  }
  return n;
}

function upsertAlertsForDate_(date, data, s, by, notifiable) {
  const N = normals_(data, s);
  const cls = classify_(date, data, s, N);
  const sh = sheet_(SH.ALERTS);
  const vals = sh.getDataRange().getValues();
  const idx = {};
  vals.forEach((r, i) => { if (i) idx[r[0]] = i + 1; });
  const now = new Date();
  const deletes = [];
  s.plants.forEach(p => {
    const key = date + '|' + p.code;
    const c = cls[p.code];
    const row = idx[key];
    if (!c) {
      if (row) {
        const r = vals[row - 1];
        if (r[8] === 'Open' && r[10] !== 'Y') deletes.push(row);
        else if (r[6] !== 'CLEARED') sh.getRange(row, 7, 1, 7).setValues([['CLEARED', 'INFO', 'Closed',
          (r[9] ? r[9] + ' | ' : '') + 'Value corrected – now normal', r[10], by, now]]);
      }
      return;
    }
    const st = streak_(p.code, date, data, s, N);
    const sev = c.type === 'WEATHER' ? 'INFO' : (c.type === 'DOWN' || st >= s.urgentDays ? 'URGENT' : 'HIGH');
    if (row) {
      const r = vals[row - 1];
      let notified = r[10], status = r[8];
      if (r[6] !== c.type && notified !== 'Y') notified = notifiable ? '' : 'SKIP';
      if (r[6] === 'CLEARED') { status = 'Open'; notified = notifiable ? '' : 'SKIP'; }
      sh.getRange(row, 4, 1, 8).setValues([[c.kwh, c.normal, c.drop, c.type, sev, status, r[9], notified]]);
      sh.getRange(row, 12, 1, 2).setValues([[by, now]]);
    } else {
      sh.appendRow([key, "'" + date, p.code, c.kwh, c.normal, c.drop, c.type, sev, 'Open', '', notifiable ? '' : 'SKIP', by, now, now]);
    }
  });
  deletes.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

function readAlerts_() {
  const v = sheet_(SH.ALERTS).getDataRange().getValues();
  return v.slice(1).filter(r => r[0]).map((r, i) => ({
    row: i + 2, key: String(r[0]), date: String(r[0]).split('|')[0], plant: String(r[2]),
    kwh: Number(r[3]), normal: Number(r[4]), drop: Number(r[5]), type: String(r[6]), severity: String(r[7]),
    status: String(r[8]), remark: String(r[9] || ''), notified: String(r[10] || ''),
    updatedBy: String(r[11] || ''), updatedAt: r[12] ? Utilities.formatDate(new Date(r[12]), TZ, 'dd-MM-yyyy HH:mm') : ''
  })).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : a.plant.localeCompare(b.plant));
}

function updateAlert_(p, user) {
  const allowed = ['Open', 'Technician Called', 'Resolved', 'No Issue'];
  if (allowed.indexOf(p.status) < 0) throw new Error('Invalid status');
  const a = readAlerts_().find(x => x.key === p.key);
  if (!a) throw new Error('Alert not found');
  const sh = sheet_(SH.ALERTS);
  sh.getRange(a.row, 9, 1, 2).setValues([[p.status, String(p.remark || '').slice(0, 500)]]);
  sh.getRange(a.row, 12, 1, 2).setValues([[user.username, new Date()]]);
  log_(user.username, 'updateAlert', p.key + ' → ' + p.status);
  return readAlerts_();
}

function rebuildAlerts_(days, user, s) {
  const data = readAll_(s);
  const today = ymd_(new Date());
  for (let i = days; i >= 0; i--) upsertAlertsForDate_(addDays_(today, -i), data, s, user.username, false);
  log_(user.username, 'rebuildAlerts', days + ' days');
  return readAlerts_();
}

/** Alerts for the Android app: the same alerts that were sent to the boss by email/Telegram (last 7 days, still Open). */
function appAlerts_(user, s) {
  const from = addDays_(ymd_(new Date()), -7);
  const list = readAlerts_().filter(a => a.notified === 'Y' && a.status === 'Open' && a.type !== 'CLEARED' && a.date >= from)
    .map(a => appAlertObj_(a, s));
  let reports = [];
  if (s.dailyReport !== false) {
    const sent = readReportLog_().filter(r => r.date >= addDays_(ymd_(new Date()), -3));
    if (sent.length) {
      const data = readAll_(s);
      reports = sent.map(r => Object.assign(dailyReport_(r.date, data, s), { id: r.date + '|v' + r.version, version: r.version }));
    }
  }
  return { user: user, canUpdate: ['admin', 'boss'].indexOf(user.role) >= 0, alerts: list, reports: reports, appUrl: appUrl_() };
}

function appAlertObj_(a, s) {
  return {
    id: a.key + '|' + a.type + '|' + a.severity,
    key: a.key, date: a.date, dateText: fmtDate_(a.date), plant: a.plant,
    plantName: (s.plants.find(p => p.code === a.plant) || {}).name || a.plant,
    kwh: a.kwh, normal: a.normal, drop: a.drop, type: a.type, severity: a.severity, action: action_(a)
  };
}

/* ============================ INSTANT PUSH (Firebase) ============================ */

function registerDevice_(user, p) {
  const tok = String(p.fcmToken || '').trim();
  if (tok.length < 20) throw new Error('Invalid device token');
  const sh = sheet_(SH.DEVICES);
  const v = sh.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) if (String(v[i][1]) === tok) sh.deleteRow(i + 1);
  sh.appendRow([user.username, tok, String(p.device || '').slice(0, 80), new Date()]);
  return true;
}

/** Sends a high-priority data message to every phone that has the app. Returns { sent, errors }. */
function pushToApps_(msg) {
  const s = getSettings_();
  const out = { sent: 0, errors: [] };
  if (!s.fcmProjectId) { out.errors.push('Firebase project ID is not set in Settings'); return out; }
  const sh = sheet_(SH.DEVICES);
  const v = sh.getDataRange().getValues();
  const devs = v.slice(1).map((r, i) => ({ row: i + 2, user: String(r[0]), token: String(r[1]) })).filter(d => d.token);
  if (!devs.length) { out.errors.push('No phone registered yet – open the app and log in once'); return out; }
  const body = JSON.stringify(msg);
  if (body.length > 3800) msg = { type: msg.type, refresh: true };
  const at = ScriptApp.getOAuthToken();
  const pid = String(s.fcmProjectId).trim();
  const reqs = devs.map(d => ({
    url: 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(pid) + '/messages:send',
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + at, 'X-Goog-User-Project': pid },
    payload: JSON.stringify({ message: { token: d.token, data: { type: String(msg.type), payload: JSON.stringify(msg) },
      android: { priority: 'HIGH', ttl: '21600s' } } })
  }));
  let res;
  try { res = UrlFetchApp.fetchAll(reqs); } catch (e) { out.errors.push(String(e)); log_('system', 'pushError', String(e)); return out; }
  const dead = [];
  res.forEach((r, i) => {
    const code = r.getResponseCode(), txt = r.getContentText();
    if (code === 200) out.sent++;
    else if (code === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(txt)) dead.push(devs[i].row);
    else out.errors.push(code + ': ' + txt.slice(0, 300));
  });
  dead.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
  if (out.errors.length) log_('system', 'pushError', out.errors[0]);
  return out;
}

function testPush_(s) {
  const r = pushToApps_({ type: 'test', at: new Date().toISOString() });
  if (!r.sent && r.errors.length) throw new Error('Push failed: ' + r.errors[0]);
  return r;
}

/* ============================ DAILY REPORT ============================ */

function readReportLog_() {
  const v = sheet_(SH.REPORTS).getDataRange().getValues();
  return v.slice(1).filter(r => r[0]).map((r, i) => ({
    row: i + 2, date: String(r[0]).replace(/^'/, ''), sig: String(r[1]), version: Number(r[2]) || 1
  }));
}

/** Report for one date: each plant's kWh vs normal + month-to-date. */
function dailyReport_(date, data, s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date');
  const N = normals_(data, s);
  const m = date.slice(5, 7), month = date.slice(0, 7);
  const lyMonth = (+date.slice(0, 4) - 1) + date.slice(4, 7);
  const day = date.slice(8, 10);
  const vals = s.plants.map(p => ({ p: p, v: data[p.code][date], n: N[p.code][m] }));
  const allLow = s.plants.length > 1 && vals.every(x => isLow_(x.v, x.n, s));
  const plants = vals.map(x => {
    let status = 'No entry';
    if (x.v != null) {
      if (x.v <= 0) status = 'Zero';
      else if (isLow_(x.v, x.n, s)) status = allLow ? 'Weather' : 'Very low';
      else if (x.v < x.n * 0.8) status = 'Slightly low';
      else status = 'Normal';
    }
    const ks = Object.keys(data[x.p.code]).filter(k => k.slice(0, 7) === month && k <= date);
    const mtd = ks.reduce((a, k) => a + data[x.p.code][k], 0);
    const lyMtd = Object.keys(data[x.p.code]).filter(k => k.slice(0, 7) === lyMonth && k.slice(8, 10) <= day)
      .reduce((a, k) => a + data[x.p.code][k], 0);
    return {
      code: x.p.code, name: x.p.name, kwh: x.v == null ? null : x.v, normal: x.n,
      pct: x.v == null ? null : Math.round(x.v / x.n * 100), status: status,
      mtdKwh: Math.round(mtd * 10) / 10, mtdDays: ks.length,
      lyMtdKwh: Math.round(lyMtd * 10) / 10, vsLastYearPct: lyMtd ? Math.round((mtd / lyMtd - 1) * 100) : null
    };
  });
  const total = plants.reduce((a, x) => a + (x.kwh || 0), 0);
  const totalNormal = plants.reduce((a, x) => a + x.normal, 0);
  return {
    date: date, dateText: fmtDate_(date), monthText: monName_(month), plants: plants,
    complete: plants.every(x => x.kwh != null),
    totalKwh: Math.round(total * 10) / 10, totalPct: totalNormal ? Math.round(total / totalNormal * 100) : null,
    mtdTotalKwh: Math.round(plants.reduce((a, x) => a + x.mtdKwh, 0) * 10) / 10
  };
}

/** Sends the report for every date that is now complete (all plants entered) and not yet sent with these values. */
function sendDailyReports_(dates, data, s, by) {
  if (s.dailyReport === false || !dates.length) return [];
  const log = readReportLog_();
  const sh = sheet_(SH.REPORTS);
  const out = [];
  dates.forEach(d => {
    const rep = dailyReport_(d, data, s);
    if (!rep.complete) return;
    const sig = rep.plants.map(x => x.code + '=' + x.kwh).join(';');
    const ex = log.find(r => r.date === d);
    if (ex && ex.sig === sig) return;
    const version = ex ? ex.version + 1 : 1;
    rep.version = version; rep.id = d + '|v' + version;
    const to = s.bossEmails || s.reminderEmails;
    if (to) sendMail_(to, '☀️ Solar Daily Report – ' + rep.dateText + (version > 1 ? ' (updated)' : '') +
      ' – ' + rep.plants.map(x => x.code + ' ' + x.kwh + ' kWh').join(', '), reportEmail_(rep));
    sendTelegram_(s, reportTelegram_(rep));
    if (ex) sh.getRange(ex.row, 2, 1, 4).setValues([[sig, version, new Date(), by]]);
    else sh.appendRow(["'" + d, sig, version, new Date(), by]);
    out.push(rep);
  });
  if (out.length) { try { pushToApps_({ type: 'report', reports: out }); } catch (e) { log_('system', 'pushError', String(e)); } }
  return out;
}

const REP_ICON_ = { 'Normal': '✅', 'Slightly low': '🟡', 'Very low': '🔴', 'Weather': '☁️', 'Zero': '⛔', 'No entry': '—' };
const REP_COL_ = { 'Normal': '#067647', 'Slightly low': '#b54708', 'Very low': '#b42318', 'Weather': '#475f84', 'Zero': '#b42318', 'No entry': '#666' };
function kwhTxt_(v) { return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }); }

function reportTelegram_(r) {
  return '☀️ <b>Daily Solar Report – ' + r.dateText + '</b>' + (r.version > 1 ? ' (updated)' : '') + '\n\n' +
    r.plants.map(x => (REP_ICON_[x.status] || '') + ' <b>' + x.code + '</b>: ' + kwhTxt_(x.kwh) + ' kWh (' + x.pct + '% of normal) – ' + x.status).join('\n') +
    '\n\nTotal: <b>' + kwhTxt_(r.totalKwh) + ' kWh</b>\n' + r.monthText + ' so far: ' +
    r.plants.map(x => x.code + ' ' + (x.mtdKwh / 1000).toFixed(2) + ' MWh' +
      (x.vsLastYearPct == null ? '' : ' (' + (x.vsLastYearPct > 0 ? '+' : '') + x.vsLastYearPct + '% vs last year)')).join(' · ');
}

function reportEmail_(r) {
  const td = 'padding:10px;border-bottom:1px solid #eee';
  const rows = r.plants.map(x => '<tr><td style="' + td + '"><b>' + x.code + '</b><br><span style="color:#666;font-size:12px">' + x.name + '</span></td>' +
    '<td style="' + td + ';text-align:right"><b>' + kwhTxt_(x.kwh) + ' kWh</b><br><span style="color:#666;font-size:12px">normal ~' + kwhTxt_(x.normal) + '</span></td>' +
    '<td style="' + td + ';text-align:right;color:' + REP_COL_[x.status] + ';font-weight:700">' + x.pct + '%<br><span style="font-size:12px">' + REP_ICON_[x.status] + ' ' + x.status + '</span></td></tr>').join('');
  const mtd = r.plants.map(x => '<b>' + x.code + '</b> ' + (x.mtdKwh / 1000).toFixed(2) + ' MWh (' + x.mtdDays + ' days' +
    (x.vsLastYearPct == null ? '' : ', <span style="color:' + (x.vsLastYearPct < 0 ? '#b42318' : '#067647') + '">' + (x.vsLastYearPct > 0 ? '+' : '') + x.vsLastYearPct + '% vs last year</span>') + ')').join('<br>');
  return card_('Daily Report – ' + r.dateText + (r.version > 1 ? ' (updated)' : ''),
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows +
    '<tr><td style="padding:10px"><b>Total</b></td><td style="padding:10px;text-align:right"><b>' + kwhTxt_(r.totalKwh) + ' kWh</b></td><td style="padding:10px;text-align:right">' + (r.totalPct == null ? '' : r.totalPct + '%') + '</td></tr></table>' +
    '<p style="font-size:13px;color:#333;margin:12px 0 14px"><b>' + r.monthText + ' so far</b><br>' + mtd + '</p>' +
    btn_(appUrl_(), 'Open Solar Monitor'));
}

/* ============================ NOTIFY ============================ */

function notifyPending_(s, data, opt) {
  const sh = sheet_(SH.ALERTS);
  const list = readAlerts_().filter(a => a.notified === '' && a.status === 'Open' && a.type !== 'CLEARED' &&
    (opt.includePending || a.type !== 'PENDING'));
  const send = [];
  list.forEach(a => {
    if (a.type === 'WEATHER' && !s.alertOnWeather) { sh.getRange(a.row, 11).setValue('SKIP'); return; }
    send.push(a);
  });
  if (!send.length) return 0;
  if (s.bossEmails) {
    const worst = send.slice().sort((a, b) => sevRank_(b.severity) - sevRank_(a.severity))[0];
    const subj = (worst.severity === 'URGENT' ? '🚨 URGENT ' : '🔴 ') + 'Solar Alert – ' +
      send.map(a => a.plant + ' ' + a.drop + '% below normal').join(', ') + ' – ' + fmtDate_(worst.date);
    sendMail_(s.bossEmails, subj, alertEmail_(send, s, data));
  }
  sendTelegram_(s, send.map(a => (a.severity === 'URGENT' ? '🚨 ' : '🔴 ') + '<b>' + a.plant + '</b> ' + fmtDate_(a.date) +
    ': ' + a.kwh + ' kWh (normal ~' + a.normal + ') → <b>' + a.drop + '% below normal</b>\n➡️ ' + action_(a)).join('\n\n'));
  send.forEach(a => sh.getRange(a.row, 11).setValue('Y'));
  try { pushToApps_({ type: 'alert', alerts: send.map(a => appAlertObj_(a, s)) }); } catch (e) { log_('system', 'pushError', String(e)); }
  return send.length;
}

function sevRank_(s) { return { URGENT: 3, HIGH: 2, INFO: 1 }[s] || 0; }

function action_(a) {
  return {
    PLANT: 'Only ' + a.plant + ' is low – get the plant checked (inverter / tripping / panel cleaning).',
    DOWN: a.plant + ' production is ZERO – plant may be down, check immediately.',
    WEATHER: 'All plants are low – most likely weather (clouds/rain).',
    PENDING: 'Other plant\'s entry is not done yet – please get ' + a.plant + ' checked.'
  }[a.type] + (a.severity === 'URGENT' && a.type !== 'DOWN' ? ' (Low for consecutive days)' : '');
}

function alertEmail_(alerts, s, data) {
  const rows = alerts.map(a => {
    const col = a.severity === 'URGENT' ? '#b42318' : a.type === 'WEATHER' ? '#475f84' : '#c4320a';
    return '<tr><td style="padding:10px;border-bottom:1px solid #eee"><b>' + a.plant + '</b><br><span style="color:#666;font-size:12px">' + fmtDate_(a.date) + '</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:right">' + a.kwh + ' kWh<br><span style="color:#666;font-size:12px">normal ~' + a.normal + '</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:right;color:' + col + ';font-weight:700">' + a.drop + '% below</td></tr>' +
      '<tr><td colspan="3" style="padding:0 10px 12px;border-bottom:1px solid #eee;color:' + col + '">➡️ ' + action_(a) + '</td></tr>';
  }).join('');
  const d = alerts[0].date;
  const others = s.plants.map(p => p.code + ': ' + (data[p.code][d] != null ? data[p.code][d] + ' kWh' : '—')).join(' · ');
  return card_('Low solar production',
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows + '</table>' +
    '<p style="color:#666;font-size:12px;margin:10px 0 14px">' + fmtDate_(d) + ' – ' + others + '</p>' +
    btn_(appUrl_(), 'Open app / update status'));
}

function sendMonthlySummary_(month, s, data) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('Invalid month');
  const to = s.bossEmails || s.reminderEmails;
  if (!to) throw new Error('Add the boss email in Settings first');
  const ly = (+month.slice(0, 4) - 1) + month.slice(4);
  const alerts = readAlerts_().filter(a => a.date.slice(0, 7) === month && a.type !== 'CLEARED');
  let rows = '';
  s.plants.forEach(p => {
    const ks = Object.keys(data[p.code]).filter(k => k.slice(0, 7) === month).sort();
    const tot = ks.reduce((a, k) => a + data[p.code][k], 0);
    const lyTot = Object.keys(data[p.code]).filter(k => k.slice(0, 7) === ly).reduce((a, k) => a + data[p.code][k], 0);
    const ch = lyTot ? Math.round((tot / lyTot - 1) * 100) : null;
    const best = ks.reduce((b, k) => !b || data[p.code][k] > data[p.code][b] ? k : b, null);
    const low = alerts.filter(a => a.plant === p.code && a.type !== 'WEATHER').length;
    const wx = alerts.filter(a => a.plant === p.code && a.type === 'WEATHER').length;
    rows += '<tr><td style="padding:10px;border-bottom:1px solid #eee"><b>' + p.code + '</b><br><span style="font-size:12px;color:#666">' + p.capacityKw + ' kW</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:right"><b>' + (tot / 1000).toFixed(2) + ' MWh</b><br><span style="font-size:12px;color:#666">' + ks.length + ' days · avg ' + (ks.length ? Math.round(tot / ks.length) : 0) + ' kWh/day</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:right">' + (ch === null ? '—' : '<span style="color:' + (ch < 0 ? '#b42318' : '#067647') + '">' + (ch > 0 ? '+' : '') + ch + '%</span>') + '<br><span style="font-size:12px;color:#666">vs ' + monName_(ly) + '</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #eee;text-align:right">' + low + ' plant-issue days<br><span style="font-size:12px;color:#666">' + wx + ' weather · best ' + (best ? fmtDate_(best).slice(0, 6) + ' (' + data[p.code][best] + ')' : '—') + '</span></td></tr>';
  });
  sendMail_(to, '☀️ Solar Monthly Report – ' + monName_(month),
    card_('Solar Production – ' + monName_(month),
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows + '</table>' +
      '<p style="margin:14px 0">' + btn_(appUrl_(), 'View full report') + '</p>'));
}

/* ============================ HELPERS ============================ */

function bootstrap_(user, s) {
  const data = readAll_(s);
  const out = {
    user: user, settings: JSON.parse(JSON.stringify(s)), data: data, alerts: readAlerts_(),
    today: ymd_(new Date()), appUrl: appUrl_(),
    spreadsheetName: ss_().getName(),
    plantStatus: s.plants.map(p => {
      const sh = plantSheet_(p);
      return { code: p.code, sheet: sh ? sh.getName() : null, years: sh ? Object.keys(blocks_(sh, p.tag)) : [] };
    })
  };
  if (user.role !== 'admin') delete out.settings.telegramToken;
  if (user.role === 'admin') {
    out.users = readUsers_().map(publicUser_);
    out.sheetNames = ss_().getSheets().map(x => x.getName()).filter(n => n.indexOf('SPM_') !== 0);
  }
  return out;
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(t); });
  const h = Math.min(23, Math.max(0, Number(getSettings_().dailyCheckHour) || 19));
  ScriptApp.newTrigger('dailyCheck').timeBased().atHour(h).everyDays(1).inTimezone(TZ).create();
}

function sendMail_(to, subject, html) {
  if (!to) return;
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: (getSettings_().companyName || 'Balaji Group') + ' Solar Monitor' });
}

function sendTelegram_(s, text) {
  if (!s.telegramToken || !s.telegramChatId || !text) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + s.telegramToken + '/sendMessage',
      { method: 'post', payload: { chat_id: s.telegramChatId, text: text, parse_mode: 'HTML' }, muteHttpExceptions: true });
  } catch (e) { log_('system', 'telegramError', String(e)); }
}

function card_(title, body) {
  return '<div style="font-family:Segoe UI,Arial,sans-serif;background:#f6f5f2;padding:20px">' +
    '<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e7e5df">' +
    '<div style="background:#13233f;color:#fff;padding:14px 18px;font-size:13px">☀️ <b>' + (getSettings_().companyName || 'Balaji Group') + '</b> · Solar Monitor</div>' +
    '<div style="padding:18px"><h2 style="margin:0 0 12px;font-size:18px;color:#13233f">' + title + '</h2>' + body + '</div></div></div>';
}
function btn_(url, label) { return url ? '<a href="' + url + '" style="display:inline-block;background:#f59e0b;color:#13233f;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px">' + label + '</a>' : ''; }
function appUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }
function log_(u, a, d) { try { sheet_(SH.LOG).appendRow([new Date(), u, a, d]); } catch (e) { } }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function addDays_(key, n) { const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10) + n)); return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate()); }
function daysInMonth_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function colLetter_(c) { let s = ''; while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); } return s; }
const MON_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate_(k) { return k.slice(8, 10) + ' ' + MON_[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4); }
function monName_(m) { return MON_[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); }
