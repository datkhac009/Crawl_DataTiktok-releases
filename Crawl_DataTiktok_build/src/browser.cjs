// src/browser.cjs — Khởi chạy CHROMIUM (Playwright) theo từng profile.
//
// MÔ HÌNH SESSION (giống CrawlView_App): mỗi profile lưu đăng nhập trong MỘT file
//   profiles/<folder>/session.state.json  (Playwright storageState = cookies + localStorage).
// KHÔNG dùng thư mục Chromium persistent nữa.
//   - foryou/search: 1 Chromium dùng chung + mỗi profile 1 context tiêm storageState từ file.
//   - 'current' + 🦊 login: 1 Chromium riêng (hiện) + context tiêm storageState; tự lưu lại file.
// Sau mỗi lần dùng → ghi lại storageState (cookie tươi) vào file.
//
// Migration 1 lần (khi file chưa có): trích storageState từ
//   (a) thư mục chromium-data cũ nếu còn → (b) profile Firefox gốc nếu có → ghi ra file.
// chromium-data cũ được GIỮ lại (dự phòng), app không mở nó nữa sau khi đã có file.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const fingerprint = require('./fingerprint.cjs');
const { attachResourceBlocker } = require('./resource-blocker.cjs');

// Tạo context CHO 1 PROFILE với vân tay cố định của profile đó (2026-07-27) — để chép
// profile sang máy khác vẫn giữ nguyên đăng nhập. Xem src/fingerprint.cjs.
// Bộ option context suy từ vân tay — DÙNG CHUNG cho cả 2 chế độ (context thường và
// persistent profile). Tách ra để 2 đường không bao giờ lệch vân tay: tab đếm và tab chính
// xài chung cookie, khác vân tay là "1 phiên đăng nhập, 2 thiết bị" (QĐ-05).
function _profileContextOptions(profilePath, extra = {}) {
  const fp = fingerprint.getFingerprint(profilePath);
  const viewport = { width: fp.screen.width, height: Math.max(600, fp.screen.height - 120) };
  return {
    fp,
    options: { userAgent: _UA, viewport, ...fingerprint.contextOptions(fp), ...extra },
  };
}

async function _newProfileContext(browser, profilePath, extra = {}) {
  const fp = fingerprint.getFingerprint(profilePath);
  // Khổ cửa sổ suy từ vân tay (trừ ~120px cho thanh trình duyệt) thay vì `viewport: null`.
  // ⚠ Vì sao BẮT BUỘC (đo thực tế 2026-07-27): `viewport: null` ở chế độ ẩn cho cửa sổ mặc
  // định chỉ **800x600**. Ở khổ đó TikTok phục vụ BỐ CỤC KHÁC — không có cặp nút mũi tên
  // lên/xuống, feed chỉ dựng 2 video. Ở 1536x864 mới có nút điều hướng ở mép phải.
  // Ngoài ra 800x600 còn MÂU THUẪN với vân tay đang khai báo (screen 1600x900) — cửa sổ
  // to hơn màn hình là bất khả thi, rất dễ bị nhận diện.
  const viewport = { width: fp.screen.width, height: Math.max(600, fp.screen.height - 120) };
  const ctx = await browser.newContext({
    userAgent: _UA,
    viewport,
    ...fingerprint.contextOptions(fp),
    ...extra,
  });
  try { await ctx.addInitScript(fingerprint.initScript, fp); } catch (_) {}
  return ctx;
}

// Map<profilePath, BrowserContext> — context 🦊/login đang mở.
const _contexts = new Map();
// Map<profilePath, Browser> — browser non-persistent tương ứng (để đóng đúng instance).
const _ctxBrowser = new Map();
// Map<profilePath, Promise<BrowserContext>> — guard chống launch trùng.
const _launching = new Map();

const TIKTOK_HOME = 'https://www.tiktok.com';

// Tìm thư mục profile Firefox thật bên trong một folder import (chỉ dùng cho migration).
// - Firefox Portable: profile nằm trong <folder>/Data/profile
// - Profile thường: chính <folder>
function resolveProfileDir(profilePath) {
  const looksLikeProfile = (dir) =>
    fs.existsSync(path.join(dir, 'prefs.js')) ||
    fs.existsSync(path.join(dir, 'cookies.sqlite'));

  const portableInner = path.join(profilePath, 'Data', 'profile');
  if (fs.existsSync(portableInner) && looksLikeProfile(portableInner)) {
    return portableInner;
  }
  return profilePath;
}

// Trỏ Playwright tới browser bundled cạnh exe nếu có (lib/ms-playwright).
function _configureBrowsersPath() {
  try {
    const { app } = require('electron');
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR
      || (app.isPackaged ? path.dirname(process.execPath) : null);
    if (!exeDir) return;
    const bundled = path.join(exeDir, 'lib', 'ms-playwright');
    if (fs.existsSync(bundled)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = bundled;
    }
  } catch (_) {}
}

// ════════ CỜ LAUNCH & USER-AGENT CHUNG ════════
// Cờ launch Chromium an toàn (mượn từ CrawlView _SAFE_LAUNCH_ARGS): giảm RAM/nền, KHÔNG dùng
// --single-process/--disable-gpu (làm lệch fingerprint / dễ bị chặn).
const _CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-component-update',
  '--disable-sync',
  '--no-default-browser-check',
  '--no-first-run',
  '--disable-features=Translate,MediaRouter,OptimizationHints',
];

// User-Agent Chrome THẬT — bắt buộc, nếu không Chromium headless gửi UA "HeadlessChrome"
// → TikTok chặn trang /music/ (trả trang rỗng) → không đọc được số video. Đã kiểm chứng:
// UA mặc định → null; UA thật → đọc count OK.
const _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ════════ SESSION FILE (storageState) ════════
// Đường dẫn file session của 1 profile.
function _stateFile(profilePath) {
  return path.join(profilePath, 'session.state.json');
}

// Thư mục Chromium persistent CŨ (chỉ còn dùng cho migration 1 lần).
function _chromeDir(profilePath) {
  return path.join(profilePath, 'chromium-data');
}

function _hasFirefoxProfile(profilePath) {
  const dir = resolveProfileDir(profilePath);
  return fs.existsSync(path.join(dir, 'prefs.js')) || fs.existsSync(path.join(dir, 'cookies.sqlite'));
}

// Một số tinh chỉnh prefs vô hại cho Firefox (chỉ dùng khi migration trích từ Firefox).
const _PERF_PREFS = { 'dom.ipc.processPrelaunch.enabled': false };
function _firefoxLaunchOptions(headless) {
  return {
    headless: headless === true,
    viewport: null,
    firefoxUserPrefs: {
      'startup.homepage_welcome_url': 'about:blank',
      'browser.startup.homepage': 'about:blank',
      'browser.startup.page': 0,
      'browser.aboutwelcome.enabled': false,
      'browser.shell.checkDefaultBrowser': false,
      'datareporting.policy.dataSubmissionEnabled': false,
      'datareporting.healthreport.uploadEnabled': false,
      'network.proxy.type': 0,
      ..._PERF_PREFS,
    },
  };
}

// Trích storageState từ profile FIREFOX gốc (migration 1 lần).
async function _extractFromFirefox(profilePath) {
  _configureBrowsersPath();
  const { firefox } = require('playwright');
  const dir = resolveProfileDir(profilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const f of ['compatibility.ini', 'Telemetry.ShutdownTime.txt']) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
  }
  const pctx = await firefox.launchPersistentContext(dir, _firefoxLaunchOptions(true));
  try {
    return await pctx.storageState();
  } finally {
    try { await pctx.close(); } catch (_) {}
  }
}

// Trích storageState từ thư mục chromium-data CŨ (migration 1 lần).
async function _extractFromChromeDir(chromeDir) {
  _configureBrowsersPath();
  const { chromium } = require('playwright');
  const ctx = await chromium.launchPersistentContext(chromeDir, {
    headless: true, args: _CHROMIUM_ARGS, viewport: null, userAgent: _UA,
  });
  try {
    return await ctx.storageState();
  } finally {
    try { await ctx.close(); } catch (_) {}
  }
}

// ── Chẩn đoán phiên (2026-07-13): ghi lại nguồn session + lỗi trích để UI hiện rõ,
// thay vì lỗi chỉ nằm trong console ẩn của bản đóng gói. ──
const _sessionInfo = new Map();   // profilePath -> { source, error, loggedIn, tiktokCookies }
const _retriedFirefox = new Set(); // đã thử trích lại từ Firefox trong phiên app này (1 lần/profile)

// Có cookie đăng nhập TikTok thật không (sessionid) — phân biệt phiên KHÁCH (TikTok vẫn
// đặt cả chục cookie dù chưa đăng nhập) với phiên ĐÃ đăng nhập.
function _hasTikTokLogin(state) {
  return !!(state && (state.cookies || []).some(c =>
    c.name === 'sessionid' && String(c.domain || '').includes('tiktok')));
}

// ════════ BẢO VỆ PHIÊN ĐĂNG NHẬP (2026-07-27) ════════
// Sự cố thật: profile rsgweakde533 tự nhiên chạy ở chế độ KHÁCH dù cookie `sessionid` còn
// nguyên và giống hệt Firefox. So sánh phát hiện file session của app THIẾU 8 cookie mà
// Firefox vẫn có, trong đó có nhóm ĐỊNH TUYẾN `tt-target-idc`/`store-idc`/`store-country-*`
// — nhóm cho TikTok biết TRUNG TÂM DỮ LIỆU nào đang giữ phiên. Thiếu chúng, yêu cầu đi tới
// sai máy chủ → máy chủ đó không biết phiên → trả về chế độ khách.
// Nguyên nhân mất: app tự lưu đè file session mỗi 20s bằng cookie hiện có; chỉ cần MỘT lần
// lưu vào đúng lúc trình duyệt đang thiếu cookie là bản tốt mất VĨNH VIỄN, và vì lần sau
// khởi động bằng bản khuyết nên không bao giờ tự hồi phục.
const _AUTH_COOKIES = [
  'sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt', 'uid_tt', 'uid_tt_ss',
  'sid_ucp_v1', 'ssid_ucp_v1', 'multi_sids', 'cmpl_token', 'tt_session_tlb_tag',
  'tt-target-idc', 'tt-target-idc-sign', 'store-idc',
  'store-country-code', 'store-country-code-src', 'store-country-sign',
  'passport_fe_beating_status', 's_v_web_id',
];

// ════════ CHỐNG CHẠY TRÙNG PROFILE (2026-07-27) ════════
// Chạy CÙNG một profile ở 2 nơi cùng lúc là nguyên nhân số 1 khiến TikTok hủy phiên đăng
// nhập (một tài khoản phát ra từ 2 IP = dấu hiệu bị chiếm tài khoản). File `profile.lock`
// ghi máy nào đang dùng + nhịp tim; chép profile sang máy khác thì lock đi theo nên vẫn
// cảnh báo được "profile này đang chạy ở máy X".
const LOCK_STALE_MS = 3 * 60 * 1000;   // quá 3 phút không có nhịp tim = coi như đã tắt
const _lockTimers = new Map();
function _lockFile(profilePath) { return path.join(profilePath, 'profile.lock'); }

// Trả null nếu rảnh; trả {host, pid, ago} nếu ĐANG bị nơi khác giữ.
function checkProfileBusy(profilePath) {
  try {
    const j = JSON.parse(fs.readFileSync(_lockFile(profilePath), 'utf8'));
    const ago = Date.now() - (j.beat || 0);
    if (ago > LOCK_STALE_MS) return null;                      // nhịp tim cũ → đã tắt
    if (j.host === os.hostname() && j.pid === process.pid) return null;  // chính mình
    return { host: j.host || '?', pid: j.pid, ago: Math.round(ago / 1000) };
  } catch (_) { return null; }
}

function _lockAcquire(profilePath) {
  const write = () => {
    try {
      fs.writeFileSync(_lockFile(profilePath),
        JSON.stringify({ host: os.hostname(), pid: process.pid, beat: Date.now() }));
    } catch (_) {}
  };
  write();
  if (!_lockTimers.has(profilePath)) {
    const t = setInterval(write, 30000);   // nhịp tim mỗi 30s
    if (t.unref) t.unref();
    _lockTimers.set(profilePath, t);
  }
}

function _lockRelease(profilePath) {
  const t = _lockTimers.get(profilePath);
  if (t) { clearInterval(t); _lockTimers.delete(profilePath); }
  try { fs.unlinkSync(_lockFile(profilePath)); } catch (_) {}
}

// ════════ SNAPSHOT PHIÊN "VÀNG" (2026-07-27) ════════
// File `session.good.json` = bản sao phiên đã được XÁC MINH đăng nhập THẬT trên trang
// TikTok (không phải chỉ "có cookie trong file" — bài học: cookie còn nguyên mà TikTok vẫn
// cho vào chế độ khách). Chỉ crawler mới được đánh dấu, qua markSessionVerified().
// Khi phiên hiện tại hỏng, đây là đường khôi phục ĐẦU TIÊN — trước cả khi trích lại Firefox.
function _goodFile(profilePath) { return path.join(profilePath, 'session.good.json'); }

// Crawler gọi khi vừa xác minh trang đang ĐĂNG NHẬP → chốt bản phiên hiện tại làm "vàng".
// Chỉ ghi khi bộ cookie thực sự đủ (có sessionid + cookie định tuyến), và không ghi quá dày.
const _lastGoodSave = new Map();
function markSessionVerified(profilePath) {
  try {
    const now = Date.now();
    if (now - (_lastGoodSave.get(profilePath) || 0) < 10 * 60 * 1000) return;  // tối đa 10 phút/lần
    const cur = _readStateFile(_stateFile(profilePath));
    if (!cur || !_hasTikTokLogin(cur)) return;
    const m = _tiktokCookieMap(cur.cookies);
    if (!['tt-target-idc', 'store-idc', 'store-country-code'].some(n => m.has(n))) return;
    fs.writeFileSync(_goodFile(profilePath), JSON.stringify(cur));
    _lastGoodSave.set(profilePath, now);
    console.log(`[browser] Đã chốt phiên VÀNG (đã xác minh đăng nhập): ${path.basename(profilePath)}`);
  } catch (_) { /* best-effort */ }
}

function _tiktokCookieMap(cookies) {
  const m = new Map();
  for (const c of (cookies || [])) {
    if (String(c.domain || '').includes('tiktok')) m.set(c.name, c.value);
  }
  return m;
}

// Trả lý do (chuỗi) nếu bộ cookie MỚI là bước LÙI so với file cũ → không được ghi đè.
// Trả null nếu được phép lưu. Đăng nhập lại bằng tài khoản khác (sessionid đổi) LUÔN được
// phép lưu — nếu chặn thì phiên mới hợp lệ sẽ không bao giờ ghi xuống được.
function _sessionRegression(prev, newCookies) {
  if (!prev) return null;                       // chưa có file cũ → cứ lưu
  const oldM = _tiktokCookieMap(prev.cookies);
  const newM = _tiktokCookieMap(newCookies);
  if (!oldM.size) return null;                  // file cũ không có gì để mất
  const oldSid = oldM.get('sessionid'), newSid = newM.get('sessionid');
  if (newSid && oldSid && newSid !== oldSid) return null;   // đăng nhập MỚI → cho lưu
  if (oldSid && !newSid) return 'phiên mới MẤT cookie đăng nhập (sessionid)';
  const lost = _AUTH_COOKIES.filter(n => oldM.has(n) && !newM.has(n));
  if (lost.length) return `phiên mới thiếu ${lost.length} cookie xác thực/định tuyến (${lost.slice(0, 4).join(', ')}${lost.length > 4 ? '…' : ''})`;
  return null;
}

function _setSessionInfo(profilePath, source, error, state) {
  const tiktokCookies = (state && (state.cookies || []).filter(c => String(c.domain || '').includes('tiktok')).length) || 0;
  _sessionInfo.set(profilePath, { source, error: error || null, loggedIn: _hasTikTokLogin(state), tiktokCookies });
}

function getSessionInfo(profilePath) { return _sessionInfo.get(profilePath) || null; }

// Migration 1 lần → ghi session.state.json. Ưu tiên chromium-data cũ, sau đó Firefox.
async function _migrateToStateFile(profilePath) {
  let state = null;
  let source = 'none', err = null;
  const chromeDir = _chromeDir(profilePath);
  if (fs.existsSync(chromeDir)) {
    try {
      state = await _extractFromChromeDir(chromeDir);
      source = 'chromium-data';
      console.log(`[browser] Migration chromium-data → session.state.json (${path.basename(profilePath)}).`);
    } catch (e) { err = 'Trích từ chromium-data lỗi: ' + e.message; console.warn('[browser]', err); }
  }
  if ((!state || !_hasTikTokLogin(state)) && _hasFirefoxProfile(profilePath)) {
    try {
      const ff = await _extractFromFirefox(profilePath);
      // Chỉ lấy kết quả Firefox nếu nó TỐT HƠN (có đăng nhập) hoặc chưa có gì.
      if (_hasTikTokLogin(ff) || !state) { state = ff; source = 'firefox'; err = null; }
      console.log(`[browser] Migration Firefox → session.state.json (${path.basename(profilePath)}).`);
      if (!_hasTikTokLogin(ff)) {
        err = 'Đã đọc được profile Firefox nhưng cookie trong đó KHÔNG có phiên đăng nhập TikTok (thiếu sessionid).';
      }
    } catch (e) { err = 'Trích từ Firefox lỗi: ' + e.message; console.warn('[browser]', err); }
  }
  if (state) {
    try { fs.writeFileSync(_stateFile(profilePath), JSON.stringify(state)); }
    catch (e) { console.warn('[browser] Ghi session.state.json lỗi:', e.message); }
  }
  _setSessionInfo(profilePath, source, err, state);
  return state || undefined;
}

// Đọc + parse 1 file session, trả object hợp lệ hoặc null (không có/hỏng).
function _readStateFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Coi là hợp lệ nếu có mảng cookies (kể cả rỗng thì vẫn parse được, nhưng ưu tiên có cookie).
    if (obj && Array.isArray(obj.cookies)) return obj;
  } catch (_) { /* file hỏng/cắt cụt */ }
  return null;
}

// Nạp storageState cho profile: đọc file chính, nếu hỏng thử file .bak, nếu vẫn không →
// migration 1 lần. Trả object storageState hoặc undefined (profile chưa đăng nhập).
async function _loadStorageState(profilePath) {
  const file = _stateFile(profilePath);
  let state = _readStateFile(file);
  let source = state ? 'file' : null;
  if (!state) {
    // File chính hỏng/mất → thử bản backup (chống mất đăng nhập khi ghi dở bị cắt cụt).
    const bak = _readStateFile(file + '.bak');
    if (bak) {
      console.warn('[browser] session.state.json hỏng — khôi phục từ .bak:', path.basename(profilePath));
      try { fs.writeFileSync(file, JSON.stringify(bak)); } catch (_) {}
      state = bak;
      source = 'bak';
    }
  }
  if (!state) return _migrateToStateFile(profilePath); // tự ghi _sessionInfo bên trong

  // TỰ SỬA BẪY "PHIÊN KHÁCH" (2026-07-13, user gặp trên máy khác): lần mở đầu trích Firefox
  // lỗi âm thầm → Chromium mở dạng khách → timer 10s ghi cookie KHÁCH vào session.state.json
  // → từ đó file "có cookies" nên không bao giờ đọc Firefox lại. Giờ: file tồn tại nhưng
  // KHÔNG có cookie đăng nhập (sessionid) mà profile Firefox lại có sẵn → thử trích lại
  // 1 LẦN mỗi phiên app; trích ra phiên đăng nhập thật thì dùng + ghi đè file.
  // Ngoài phiên KHÁCH (mất hẳn sessionid), còn bắt cả phiên KHUYẾT: còn sessionid nhưng
  // thiếu cookie ĐỊNH TUYẾN (tt-target-idc/store-idc…) → TikTok vẫn cho vào chế độ khách.
  // Firefox gốc thường vẫn giữ đủ (đã kiểm chứng thực tế) nên trích lại là cứu được.
  const missing = _AUTH_COOKIES.filter(n =>
    !(state.cookies || []).some(c => c.name === n && String(c.domain || '').includes('tiktok')));
  const routingLost = ['tt-target-idc', 'store-idc', 'store-country-code'].filter(n => missing.includes(n));
  const needFix = !_hasTikTokLogin(state) || routingLost.length > 0;

  // ĐƯỜNG KHÔI PHỤC ƯU TIÊN: phiên VÀNG (đã xác minh đăng nhập thật ở lần chạy trước).
  // Đặt TRƯỚC việc trích lại Firefox vì nó chắc chắn hơn — Firefox có thể cũng đã cũ/thiếu.
  if (needFix) {
    const good = _readStateFile(_goodFile(profilePath));
    if (good && _hasTikTokLogin(good)) {
      const gm = _tiktokCookieMap(good.cookies);
      const curM = _tiktokCookieMap(state.cookies);
      const tot = (m) => ['tt-target-idc', 'store-idc', 'store-country-code'].filter(n => m.has(n)).length;
      if (tot(gm) > tot(curM) || !_hasTikTokLogin(state)) {
        _writeStateAtomic(file, JSON.stringify(good));
        console.log(`[browser] Phiên hiện tại hỏng — đã KHÔI PHỤC từ phiên VÀNG (${path.basename(profilePath)}).`);
        _setSessionInfo(profilePath, 'good-snapshot', null, good);
        return good;
      }
    }
  }

  if (needFix && _hasFirefoxProfile(profilePath) && !_retriedFirefox.has(profilePath)) {
    _retriedFirefox.add(profilePath);
    const van = _hasTikTokLogin(state)
      ? `thiếu cookie định tuyến (${routingLost.join(', ')})`
      : 'là phiên KHÁCH (không có sessionid)';
    try {
      const fresh = await _extractFromFirefox(profilePath);
      const freshMap = _tiktokCookieMap(fresh && fresh.cookies);
      const betterRouting = ['tt-target-idc', 'store-idc', 'store-country-code'].some(n => freshMap.has(n));
      // Chỉ thay khi bản Firefox THỰC SỰ TỐT HƠN (có đăng nhập, và bù được cookie đang thiếu).
      if (_hasTikTokLogin(fresh) && (!_hasTikTokLogin(state) || betterRouting)) {
        _writeStateAtomic(file, JSON.stringify(fresh));
        console.log(`[browser] File session ${van} — đã trích lại từ Firefox, đủ hơn (${path.basename(profilePath)}).`);
        _setSessionInfo(profilePath, 'firefox-retry', null, fresh);
        return fresh;
      }
      _setSessionInfo(profilePath, source,
        `File session ${van}; đã đọc profile Firefox nhưng cookie trong đó cũng không đủ để khôi phục.`, state);
    } catch (e) {
      _setSessionInfo(profilePath, source, `File session ${van}; trích lại từ Firefox lỗi: ` + e.message, state);
    }
    return state;
  }
  if (needFix) {
    _setSessionInfo(profilePath, source, _hasTikTokLogin(state)
      ? `Phiên thiếu cookie định tuyến (${routingLost.join(', ')}) — TikTok có thể cho vào chế độ KHÁCH. Nên đăng nhập lại bằng 🦊.`
      : 'Phiên KHÁCH (không có cookie đăng nhập) — cần đăng nhập lại bằng 🦊.', state);
    return state;
  }

  _setSessionInfo(profilePath, source, null, state);
  return state;
}

// Ghi file session AN TOÀN (atomic): ghi ra file tạm → rename đè (rename là thao tác atomic
// trên cùng ổ đĩa) → không bao giờ để lại file chính bị cắt cụt nếu bị giết giữa chừng.
// Trước khi đè, sao file chính hiện tại thành .bak để còn đường khôi phục.
function _writeStateAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);           // ghi trọn vẹn vào tạm trước
  try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (_) {}
  fs.renameSync(tmp, file);              // atomic: file chính luôn nguyên vẹn (cũ hoặc mới)
}

// Lưu phiên đăng nhập = COOKIES (đủ cho TikTok — auth dựa trên cookie). Best-effort.
// KHÔNG dùng ctx.storageState() lúc chạy: để lấy localStorage, Playwright phải MỞ một
// trang tạm cho TỪNG origin rồi đóng → với trình duyệt HIỆN sẽ NHẤP NHÁY cửa sổ liên tục.
// Đọc cookies() không mở trang nào. Giữ lại 'origins' (localStorage) đã có từ migration.
async function _saveSession(profilePath, ctx) {
  try {
    const cookies = await ctx.cookies();
    if (!cookies || !cookies.length) return;   // chưa có gì để lưu (chưa đăng nhập)
    const file = _stateFile(profilePath);
    const prev = _readStateFile(file);
    // ⛔ KHÔNG ghi đè phiên TỐT bằng phiên KHUYẾT (fix 2026-07-27).
    const why = _sessionRegression(prev, cookies);
    if (why) {
      console.warn(`[browser] BỎ QUA lưu session ${path.basename(profilePath)} — ${why}. Giữ nguyên file cũ.`);
      return;
    }
    const origins = (prev && prev.origins) || [];
    _writeStateAtomic(file, JSON.stringify({ cookies, origins }));
  } catch (_) { /* context có thể đã đóng — bỏ qua */ }
}

// ════════ 🦊 LOGIN / CHẾ ĐỘ 'current' — 1 browser riêng + context tiêm session ════════
// Mở Chromium non-persistent (hiện) cho profile, tiêm storageState từ file; tự lưu lại
// định kỳ + khi đóng (đề phòng đóng cửa sổ làm context chết trước khi kịp lưu).
async function getContext(profilePath, { headless = false } = {}) {
  if (!profilePath) throw new Error('Thiếu profilePath');

  const existing = _contexts.get(profilePath);
  if (existing) {
    try {
      const b = existing.browser();
      if (b && b.isConnected() && existing.pages().length > 0) return existing;
      throw new Error('context không dùng được');
    } catch (_) {
      try { await existing.close(); } catch (_) {}
      _contexts.delete(profilePath);
    }
  }

  if (_launching.has(profilePath)) return _launching.get(profilePath);

  // ── Chế độ CHROMIUM PROFILE RIÊNG ──
  // Thư mục profile chỉ cho MỘT Chromium mở. Nếu profile đang crawl thì PHẢI dùng lại đúng
  // context đó cho nút 🦊 (mở thêm sẽ lỗi "already in use"); đăng nhập trong cửa sổ đó cũng
  // ghi thẳng vào profile nên không cần trích cookie gì nữa.
  if (_persistentProfiles) {
    const running = _profileCtx.get(profilePath);
    if (running && running.persistent) {
      try {
        const b = running.ctx.browser();
        if (!b || b.isConnected()) {
          console.log(`[browser] 🦊 dùng lại Chromium profile đang chạy của ${path.basename(profilePath)}.`);
          return running.ctx;
        }
      } catch (_) { /* context đã chết → mở mới bên dưới */ }
    }
    const existingPersist = _contexts.get(profilePath);
    if (existingPersist) {
      try {
        if (existingPersist.pages().length >= 0) return existingPersist;
      } catch (_) { _contexts.delete(profilePath); }
    }
    const ctx = await _launchPersistent(profilePath, false);
    _contexts.set(profilePath, ctx);
    const saveTimer = setInterval(() => { _saveSession(profilePath, ctx); }, 10000);
    ctx.on('close', () => {
      clearInterval(saveTimer);
      _contexts.delete(profilePath);
      _notifyClosed(profilePath);
    });
    return ctx;
  }

  const launchPromise = (async () => {
    _configureBrowsersPath();
    const { chromium } = require('playwright');
    const storageState = await _loadStorageState(profilePath);
    const browser = await chromium.launch({ headless: headless === true, args: _CHROMIUM_ARGS });
    // 🦊 là cửa sổ người dùng tự thao tác → để trang co giãn theo cửa sổ thật (viewport:null),
    // không ép khổ cố định (sẽ thừa viền đen trông rất khó chịu). Vân tay vẫn được áp.
    const ctx = await _newProfileContext(browser, profilePath, { storageState, viewport: null });
    _contexts.set(profilePath, ctx);
    _ctxBrowser.set(profilePath, browser);

    // Tự lưu session định kỳ — đảm bảo cookie mới nhất được giữ kể cả khi user đóng cửa sổ
    // (đóng cửa sổ làm context chết → không kịp lưu lần cuối).
    const saveTimer = setInterval(() => { _saveSession(profilePath, ctx); }, 10000);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(saveTimer);
      _contexts.delete(profilePath);
      _ctxBrowser.delete(profilePath);
      _notifyClosed(profilePath);
    };
    ctx.on('close', async () => {
      await _saveSession(profilePath, ctx);
      cleanup();
      try { await browser.close(); } catch (_) {}
    });
    browser.on('disconnected', cleanup);

    console.log('[browser] Đã mở Chromium (session.state.json) cho', path.basename(profilePath));
    return ctx;
  })()
    .then(ctx => { _launching.delete(profilePath); return ctx; })
    .catch(err => { _launching.delete(profilePath); throw err; });

  _launching.set(profilePath, launchPromise);
  return launchPromise;
}

// Mở profile để đăng nhập/điều hướng thủ công: bật CHROMIUM (hiện) và vào TikTok.
async function openForLogin(profilePath, { blockImages = false } = {}) {
  // Persistent + profile ĐANG CRAWL: getContext() trả về CHÍNH context đang quét. Khi đó
  // TUYỆT ĐỐI không được (a) lấy pages()[0] — đó là tab feed, goto() lên nó là phá vòng quét,
  // (b) chặn ảnh ở mức CONTEXT — sẽ đè lên cả tab quét và cộng dồn mỗi lần bấm 🦊.
  const running = _persistentProfiles ? _profileCtx.get(profilePath) : null;
  const shareWithCrawl = !!(running && running.persistent);

  const ctx = await getContext(profilePath);
  if (blockImages && !shareWithCrawl) await attachResourceBlocker(ctx);
  const page = shareWithCrawl ? await ctx.newPage() : (ctx.pages()[0] || await ctx.newPage());
  if (blockImages && shareWithCrawl) await attachResourceBlocker(page);
  if (shareWithCrawl) {
    // Ghi nhớ để nút ❌ đóng ĐÚNG tab này thay vì đóng cả context đang quét.
    const old = _sharedLoginPage.get(profilePath);
    if (old && old !== page) { try { await old.close(); } catch (_) {} }
    _sharedLoginPage.set(profilePath, page);
    page.on('close', () => {
      if (_sharedLoginPage.get(profilePath) === page) _sharedLoginPage.delete(profilePath);
    });
  }
  try {
    await page.goto(TIKTOK_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.warn('[browser] goto thất bại:', e.message);
  }
  await page.bringToFront().catch(() => {});
  return ctx;
}

// Lấy context ĐANG MỞ SẴN — KHÔNG tự launch. Dùng cho chế độ "cào trên tab đang mở".
function getExistingContext(profilePath) {
  const ctx = _contexts.get(profilePath);
  if (!ctx) return null;
  try {
    const b = ctx.browser();
    if (b && b.isConnected() && ctx.pages().length > 0) return ctx;
  } catch (_) {}
  return null;
}

// Tìm tab đang hiển thị (foreground) trong context — dựa vào visibilityState.
async function getActivePage(ctx) {
  const pages = ctx.pages();
  if (pages.length === 0) return null;
  if (pages.length === 1) return pages[0];
  for (const p of pages) {
    try {
      if (await p.evaluate(() => document.visibilityState === 'visible')) return p;
    } catch (_) {}
  }
  return pages[0];
}

// ════════ CHẾ ĐỘ "CHROMIUM PROFILE RIÊNG" (persistent profile) — TÙY CHỌN ════════
//
// VÌ SAO CÓ (2026-08-04, người dùng chọn "Mức 2"): cách mặc định lưu phiên bằng FILE cookie
// (`session.state.json`, QĐ-03) rồi tiêm vào context mới mỗi lần chạy. Cách đó nhẹ RAM nhưng
// KHÔNG giữ localStorage/IndexedDB/service worker, và sinh ra cả một lớp rủi ro "ghi đè phiên
// tốt bằng phiên khuyết" phải tự phòng thủ (QĐ-04). Persistent profile để CHÍNH CHROMIUM giữ
// toàn bộ trạng thái trên đĩa — giống trình duyệt thật hơn nên TikTok ít hủy phiên hơn.
//
// ⚠ ĐÁNH ĐỔI ĐÃ BIẾT, người dùng chấp nhận: `launchPersistentContext` bắt buộc MỖI PROFILE
// MỘT CHROMIUM RIÊNG → mất lợi ích "1 Chromium dùng chung" (QĐ-02 đo được: 26 tiến trình →
// 13, tiết kiệm ~2GB). Với 5 profile là +450–750MB RAM. Vì vậy đây là TÙY CHỌN TẮT MẶC ĐỊNH,
// bật/tắt trong ⚙ để so số thật trên 1 máy trước khi áp cho cả dàn.
//
// Bù lại một phần: ở chế độ này tab đếm dùng CHUNG context của profile (xem acquireCountContext)
// nên KHÔNG cần mở thêm trình duyệt ẩn riêng để đếm — tiết kiệm lại 1 instance.
// Tab 🦊 đang mở KÉ trong context của một profile đang crawl (chỉ có ở chế độ persistent):
// profilePath → Page. Nhớ lại để ❌ đóng đúng tab, không đóng cả context đang quét.
const _sharedLoginPage = new Map();

let _persistentProfiles = false;
function setPersistentProfiles(on) {
  const next = !!on;
  if (next !== _persistentProfiles) {
    console.log(`[browser] Chế độ profile: ${next ? 'CHROMIUM PROFILE RIÊNG (persistent)' : 'file cookie + Chromium dùng chung'}.`);
  }
  _persistentProfiles = next;
}
function isPersistentProfiles() { return _persistentProfiles; }

// Thư mục Chromium profile đặt BÊN TRONG thư mục profile → chép profile sang máy khác là mang
// theo cả trạng thái đăng nhập (cùng triết lý với fingerprint.json, QĐ-05).
function persistDir(profilePath) { return path.join(profilePath, 'ChromiumProfile'); }

// Giới hạn cache đĩa: persistent profile để lâu sẽ phình vô hạn vì cache. 60MB đủ cho TikTok
// chạy mượt mà không ăn hết đĩa VPS (5 profile × 60MB = 300MB, chấp nhận được).
const _PERSIST_ARGS = ['--disk-cache-size=62914560', '--media-cache-size=10485760'];

// Chromium để lại file khóa khi bị giết đột ngột (mất điện, AV kill, OOM) → lần sau
// launchPersistentContext báo "profile is already in use" dù không có Chromium nào chạy.
// Dọn các file khóa mồ côi trước khi mở. Đây ĐÚNG cái mà QĐ-03 lo khi từ chối persistent
// ("kẹt khóa thư mục profile") — nên phải xử lý hẳn, không bỏ qua.
function _clearStaleLocks(dir) {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    try { fs.rmSync(path.join(dir, f), { force: true, recursive: true }); } catch (_) {}
  }
}

// Mở persistent context cho 1 profile. Lần ĐẦU (thư mục chưa có) thì tiêm cookie đang có từ
// session.state.json vào để KHÔNG mất đăng nhập khi đổi sang chế độ này.
async function _launchPersistent(profilePath, headless) {
  _configureBrowsersPath();
  const { chromium } = require('playwright');
  const dir = persistDir(profilePath);
  const firstRun = !fs.existsSync(path.join(dir, 'Default'));
  fs.mkdirSync(dir, { recursive: true });
  _clearStaleLocks(dir);

  const { fp, options } = _profileContextOptions(profilePath);
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: headless === true,
    args: [..._CHROMIUM_ARGS, ..._PERSIST_ARGS],
    ...options,
  });
  try { await ctx.addInitScript(fingerprint.initScript, fp); } catch (_) {}

  if (firstRun) {
    // DI CƯ MỘT LẦN: mang phiên đang có sang profile Chromium mới. Không có bước này thì bật
    // chế độ mới là mất đăng nhập toàn bộ, phải bấm 🦊 lại từng profile.
    try {
      const state = await _loadStorageState(profilePath);
      const cookies = (state && state.cookies) || [];
      if (cookies.length) {
        await ctx.addCookies(cookies);
        console.log(`[browser] Chromium profile MỚI cho ${path.basename(profilePath)} — đã mang ${cookies.length} cookie từ session.state.json sang.`);
      } else {
        console.warn(`[browser] Chromium profile mới cho ${path.basename(profilePath)} nhưng KHÔNG có cookie để mang sang — cần bấm 🦊 đăng nhập.`);
      }
    } catch (e) {
      console.warn('[browser] Di cư cookie sang Chromium profile lỗi:', e.message);
    }
  }
  return ctx;
}

// ════════ "1 CHROMIUM DÙNG CHUNG + NHIỀU CONTEXT" (foryou/search) ════════
// Tách theo headless (browser-level): profile headless và visible không share chung browser.
const _sharedBrowsers = {};          // 'h'|'v' -> { browser, refs }
const _sharedBrowserLaunching = {};  // 'h'|'v' -> Promise
const _profileCtx = new Map();       // profilePath -> { ctx, headless }

function _sbKey(headless) { return headless ? 'h' : 'v'; }

function _ensureSharedBrowser(headless) {
  const key = _sbKey(headless);
  if (_sharedBrowsers[key]) return Promise.resolve(_sharedBrowsers[key]);
  if (!_sharedBrowserLaunching[key]) {
    _configureBrowsersPath();
    const { chromium } = require('playwright');
    _sharedBrowserLaunching[key] = chromium.launch({ headless: !!headless, args: _CHROMIUM_ARGS })
      .then(b => {
        _sharedBrowsers[key] = { browser: b, refs: 0 };
        delete _sharedBrowserLaunching[key];
        b.on('disconnected', () => { delete _sharedBrowsers[key]; });
        console.log(`[browser] Đã mở Chromium dùng chung (${headless ? 'ẩn' : 'hiện'}).`);
        return _sharedBrowsers[key];
      })
      .catch(err => { delete _sharedBrowserLaunching[key]; throw err; });
  }
  return _sharedBrowserLaunching[key];
}

// Lấy 1 context cho profile trên browser dùng chung (foryou/search). Tiêm session từ file.
async function acquireProfileContext(profilePath, { headless = false } = {}) {
  if (!profilePath) throw new Error('Thiếu profilePath');

  // ── Chế độ CHROMIUM PROFILE RIÊNG: mỗi profile một Chromium + thư mục riêng ──
  if (_persistentProfiles) {
    const ctx = await _launchPersistent(profilePath, headless);
    _lockAcquire(profilePath);
    // VẪN lưu session.state.json định kỳ dù Chromium đã tự giữ trạng thái: giữ một bản sao
    // GỌN (150KB) để (a) chép sang máy khác không phải mang cả thư mục Chromium, (b) cơ chế
    // "phiên VÀNG" (session.good.json) vẫn hoạt động làm đường cứu phiên.
    const saveTimer = setInterval(() => { _saveSession(profilePath, ctx); }, 20000);
    _profileCtx.set(profilePath, { ctx, headless, saveTimer, persistent: true });
    console.log(`[browser] Chromium profile riêng cho ${path.basename(profilePath)} (${headless ? 'ẩn' : 'hiện'}).`);
    return ctx;
  }

  const storageState = await _loadStorageState(profilePath);
  const shared = await _ensureSharedBrowser(headless);
  const ctx = await _newProfileContext(shared.browser, profilePath, { storageState });
  _lockAcquire(profilePath);   // đánh dấu profile đang được máy này dùng
  shared.refs++;
  // LƯU COOKIE ĐỊNH KỲ (mỗi 20s) trong suốt phiên crawl — KHÔNG chỉ lưu lúc đóng. Vì sao:
  // TikTok xoay vòng token phiên (sessionid/sid_guard) trong lúc chạy; nếu app bị giết giữa
  // chừng (vd V8 OOM qua đêm) mà chỉ lưu lúc release thì cookie mới mất → lần sau load cookie
  // cũ đã bị TikTok vô hiệu → OUT SESSION. Lưu định kỳ giữ cookie luôn tươi trên đĩa.
  const saveTimer = setInterval(() => { _saveSession(profilePath, ctx); }, 20000);
  _profileCtx.set(profilePath, { ctx, headless, saveTimer });
  console.log(`[browser] Context cho ${path.basename(profilePath)} (refs=${shared.refs}).`);
  return ctx;
}

// Đóng context của profile; LƯU session trước khi đóng; hết context → đóng luôn browser.
async function releaseProfileContext(profilePath) {
  const h = _profileCtx.get(profilePath);
  if (!h) return;
  _profileCtx.delete(profilePath);
  if (h.saveTimer) clearInterval(h.saveTimer);   // dừng lưu định kỳ trước khi lưu lần cuối
  await _saveSession(profilePath, h.ctx);   // ghi cookie tươi vào session.state.json
  _lockRelease(profilePath);                // nhả khóa: profile này không còn bị máy này dùng
  try { await h.ctx.close(); } catch (_) {}
  // Persistent: đóng context là đóng luôn Chromium của riêng profile đó → không có browser
  // dùng chung nào phải giảm refs.
  if (h.persistent) {
    console.log(`[browser] Đã đóng Chromium profile riêng của ${path.basename(profilePath)}.`);
    return;
  }
  const key = _sbKey(h.headless);
  const shared = _sharedBrowsers[key];
  if (shared) {
    shared.refs--;
    if (shared.refs <= 0) {
      const b = shared.browser;
      delete _sharedBrowsers[key];
      try { await b.close(); } catch (_) {}
      console.log(`[browser] Đã đóng Chromium dùng chung (${key === 'h' ? 'ẩn' : 'hiện'}) — hết context.`);
    }
  }
}

function _notifyClosed(profilePath) {
  try {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('browser-closed', profilePath);
  } catch (_) {}
}

// Resource blocker (chặn ảnh/video/font + domain quảng cáo) đã chuyển sang
// src/resource-blocker.cjs (2026-07-28) — trước đây file này và crawler.cjs mỗi bên giữ
// MỘT BẢN SAO y hệt, đúng cái bẫy DECISIONS.md QĐ-10 đã ghi: 2 bản sao thì sẽ lệch nhau.
// Vẫn re-export ở cuối file để nơi gọi cũ không phải sửa.

// ── Trình duyệt HEADLESS DÙNG CHUNG để đếm số video (chế độ 'current') ──
let _sharedHeadless = null;          // { browser, refs }
let _sharedHeadlessLaunching = null; // Promise khi đang khởi chạy (chống mở trùng)

function _ensureSharedHeadless() {
  if (_sharedHeadless) return Promise.resolve(_sharedHeadless);
  if (!_sharedHeadlessLaunching) {
    _configureBrowsersPath();
    const { chromium } = require('playwright');
    _sharedHeadlessLaunching = chromium.launch({ headless: true, args: _CHROMIUM_ARGS })
      .then(b => {
        _sharedHeadless = { browser: b, refs: 0 };
        _sharedHeadlessLaunching = null;
        b.on('disconnected', () => { _sharedHeadless = null; });
        console.log('[browser] Đã mở trình duyệt headless dùng chung để đếm video.');
        return _sharedHeadless;
      })
      .catch(err => { _sharedHeadlessLaunching = null; throw err; });
  }
  return _sharedHeadlessLaunching;
}

// Lấy 1 context đếm video trên browser headless chung. seedContext = context đang mở
// của profile (để sao chép cookie giữ phiên). Trả handle để trả lại sau khi dùng xong.
// profilePath: dùng ĐÚNG vân tay của profile — tab đếm xài CHUNG cookie với tab chính, nếu
// trình bày vân tay khác thì TikTok thấy "1 phiên đăng nhập, 2 thiết bị" → dễ bị hủy phiên.
async function acquireCountContext(seedContext, profilePath) {
  // ⚠ Persistent: MỘT thư mục Chromium profile chỉ được MỘT Chromium mở tại một thời điểm —
  // mở thêm trình duyệt ẩn trên cùng thư mục sẽ báo "profile is already in use". Nên tab đếm
  // dùng CHUNG context của profile. Lợi thêm: không phải mở 1 instance riêng để đếm, bù lại
  // một phần RAM mà chế độ này tốn thêm. Đánh đổi: nếu chạy CHẾ ĐỘ HIỆN thì tab đếm sẽ hiện
  // trong chính cửa sổ của profile (chạy ẩn thì không thấy gì).
  if (_persistentProfiles && seedContext) {
    return { ctx: seedContext, shared: true };
  }
  const shared = await _ensureSharedHeadless();
  const ctx = profilePath
    ? await _newProfileContext(shared.browser, profilePath)
    : await shared.browser.newContext({ userAgent: _UA });
  try {
    if (seedContext) {
      const cookies = await seedContext.cookies();
      if (cookies && cookies.length) await ctx.addCookies(cookies);
    }
  } catch (e) { console.warn('[browser] copy cookie cho context đếm thất bại:', e.message); }
  shared.refs++;
  return { ctx };
}

// Trả lại context đếm; khi không còn ai dùng → đóng luôn browser headless chung.
async function releaseCountContext(handle) {
  if (!handle) return;
  // Context DÙNG CHUNG với profile (chế độ persistent) → TUYỆT ĐỐI không đóng, đóng là sập
  // luôn cả tab đang quét của profile đó.
  if (handle.shared) return;
  try { await handle.ctx.close(); } catch (_) {}
  if (_sharedHeadless) {
    _sharedHeadless.refs--;
    if (_sharedHeadless.refs <= 0) {
      const b = _sharedHeadless.browser;
      _sharedHeadless = null;
      try { await b.close(); } catch (_) {}
      console.log('[browser] Đã đóng trình duyệt headless dùng chung (hết profile đếm).');
    }
  }
}

// Đóng context 🦊/login của 1 profile (lưu session trước khi đóng) + đóng browser của nó.
async function closeProfile(profilePath) {
  // Tab 🦊 mở ké trong context đang crawl (persistent) → chỉ đóng TAB đó, không đóng context.
  const sharedPage = _sharedLoginPage.get(profilePath);
  if (sharedPage) {
    _sharedLoginPage.delete(profilePath);
    try { await sharedPage.close(); } catch (_) {}
    if (!_contexts.has(profilePath)) return;
  }
  const ctx = _contexts.get(profilePath);
  if (ctx) {
    await _saveSession(profilePath, ctx);
    try { await ctx.close(); } catch (_) {}
  }
  _contexts.delete(profilePath);
  const b = _ctxBrowser.get(profilePath);
  if (b) { try { await b.close(); } catch (_) {} _ctxBrowser.delete(profilePath); }
}

async function closeAll() {
  for (const [pp, pg] of [..._sharedLoginPage.entries()]) {
    _sharedLoginPage.delete(pp);
    try { await pg.close(); } catch (_) {}
  }
  const entries = [..._contexts.entries()];
  _contexts.clear();
  for (const [pp, ctx] of entries) {
    await _saveSession(pp, ctx);
    try { await ctx.close(); } catch (_) {}
  }
  const browsers = [..._ctxBrowser.values()];
  _ctxBrowser.clear();
  await Promise.all(browsers.map(b => b.close().catch(() => {})));
}

// ── KIỂM TRA PHIÊN THẬT của 1 profile: mở trang TikTok rồi hỏi thẳng (2026-07-27) ──
// Không tin "có cookie trong file" nữa — đã có tiền lệ cookie đủ mà TikTok vẫn cho vào chế
// độ khách. Dùng cho nút "Kiểm tra phiên tất cả profile".
// Trả { ok, state: 'logged-in'|'guest'|'unknown', msg }.
async function verifyProfileLogin(profilePath) {
  let ctx = null;
  try {
    const shared = await _ensureSharedHeadless();
    ctx = await _newProfileContext(shared.browser, profilePath,
      { storageState: await _loadStorageState(profilePath) });
    shared.refs++;
    const pg = await ctx.newPage();
    await pg.goto(TIKTOK_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Chờ giao diện dựng xong — kiểm tra sớm quá sẽ ra 'unknown' (đã gặp: 9s chưa đủ, 20s đủ).
    let state = 'unknown';
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 2000));
      state = await pg.evaluate(() => {
        if (document.querySelector('[data-e2e="top-login-button"]')) return 'guest';
        if (!document.querySelector('[data-e2e="nav-foryou"], [data-e2e="tiktok-logo"]')) return 'unknown';
        return 'logged-in';
      }).catch(() => 'unknown');
      if (state !== 'unknown') break;
    }
    if (state === 'logged-in') markSessionVerified(profilePath);
    return {
      ok: true, state,
      msg: state === 'logged-in' ? 'Đã đăng nhập'
        : state === 'guest' ? 'CHẾ ĐỘ KHÁCH — cần đăng nhập lại bằng 🦊'
        : 'Không xác định được (trang tải chậm hoặc bị chặn)',
    };
  } catch (e) {
    return { ok: false, state: 'unknown', msg: 'Lỗi kiểm tra: ' + e.message };
  } finally {
    try { if (ctx) await ctx.close(); } catch (_) {}
    if (_sharedHeadless) {
      _sharedHeadless.refs--;
      if (_sharedHeadless.refs <= 0) {
        const b = _sharedHeadless.browser;
        _sharedHeadless = null;
        try { await b.close(); } catch (_) {}
      }
    }
  }
}

module.exports = {
  setPersistentProfiles,
  isPersistentProfiles,
  persistDir,
  getContext,
  verifyProfileLogin,
  getExistingContext,
  getActivePage,
  acquireProfileContext,
  releaseProfileContext,
  acquireCountContext,
  releaseCountContext,
  attachResourceBlocker,
  openForLogin,
  getSessionInfo,
  markSessionVerified,
  checkProfileBusy,
  closeProfile,
  closeAll,
  TIKTOK_HOME,
};
