// main.js — Electron main process (CommonJS)
//
// Nối các module: quản lý profile (src/profiles), trình duyệt (src/browser),
// auto-update (src/updater) và đăng ký IPC cho renderer.
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const Store = require('electron-store');

const profiles = require('./src/profiles.cjs');
const browser = require('./src/browser.cjs');
const crawler = require('./src/crawler.cjs');
const sheets = require('./src/sheets.cjs');
const sheetLock = require('./src/sheet-lock.cjs');
const history = require('./src/history.cjs');
const { withDeadline } = require('./src/google-api.cjs');
const updater = require('./src/updater.cjs');
const { getLogsDir } = require('./src/paths.cjs');

app.setName(app.isPackaged ? 'TikTokCrawler' : 'TikTokCrawler-Dev');
const store = new Store();

// ── File logger (chỉ production) ──
if (app.isPackaged) {
  const logDir = getLogsDir();
  // Dọn log cũ hơn 7 ngày.
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(logDir)) {
      const fp = path.join(logDir, f);
      if (now - fs.statSync(fp).mtimeMs > 7 * 86400000) fs.unlinkSync(fp);
    }
  } catch (_) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = path.join(logDir, `crawler_${stamp}.log`);
  const write = (level, args) => {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    try { fs.appendFileSync(logFile, `[${time}] [${level}] ${msg}\n`); } catch (_) {}
  };
  const o = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a) => { o.log(...a); write('INFO', a); };
  console.error = (...a) => { o.error(...a); write('ERROR', a); };
  console.warn = (...a) => { o.warn(...a); write('WARN', a); };
}

// ── Bắt mọi lỗi không được catch (crash) → ghi log file (cả dev lẫn build) + hiện hộp thoại ──
// Trước đây dev không ghi log nên crash biến mất không dấu vết. Giờ luôn lưu stack vào logs/crash_*.log.
function logCrash(kind, err) {
  let logPath = '';
  try {
    const dir = getLogsDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logPath = path.join(dir, `crash_${stamp}.log`);
    const detail = err && err.stack ? err.stack : String(err);
    fs.writeFileSync(logPath, `[${kind}] ${new Date().toISOString()}\n${detail}\n`, 'utf8');
  } catch (_) {}
  try { console.error(`[${kind}]`, err); } catch (_) {}
  try {
    dialog.showErrorBox(
      'TikTok Crawler — Lỗi nghiêm trọng',
      `${kind}:\n${err && err.message ? err.message : String(err)}\n\n` +
      (logPath ? `Chi tiết đã lưu tại:\n${logPath}` : '')
    );
  } catch (_) {}
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (reason) => logCrash('unhandledRejection', reason));

// ── HỘP ĐEN (2026-07-25): ghi LÝ DO khi tiến trình con chết + đo bộ nhớ định kỳ ──
// App từng "sập im lặng" dù CPU/RAM cả máy rất thấp — vì trần gây sập là CỦA TỪNG TIẾN
// TRÌNH (heap V8 ~4GB/tiến trình) chứ không phải của cả máy. Electron biết chính xác lý
// do mỗi lần tiến trình con chết ('oom'/'crashed'/'killed'...) — ghi lại để lần sập tới
// mở logs/crawler_*.log là biết ngay. Toàn bộ NGHE THỤ ĐỘNG, không đụng luồng crawl.
app.on('render-process-gone', (_e, wc, details) => {
  console.error('[blackbox] Renderer (giao diện) CHẾT:',
    JSON.stringify({ reason: details.reason, exitCode: details.exitCode }));
});
app.on('child-process-gone', (_e, details) => {
  // GPU/Utility chết Electron thường tự khởi động lại được — vẫn ghi để đối chiếu giờ sập.
  console.error('[blackbox] Tiến trình con CHẾT:',
    JSON.stringify({ type: details.type, name: details.name || '', reason: details.reason, exitCode: details.exitCode }));
});
// Mỗi 5 phút ghi 1 dòng bộ nhớ: heap V8 của main + RAM từng loại tiến trình con.
// V8 OOM chết TỨC THÌ không kịp ghi gì — nên chính DÒNG CUỐI CÙNG trước khi log im bặt
// là bằng chứng: heap main đang leo về ~4000MB = OOM main; một renderer/tab leo cao rồi
// có dòng [blackbox] ...CHẾT reason:"oom" = tab Chromium chết; log dừng đột ngột mà mọi
// số đều thấp = bị bên ngoài giết (AV/Update/mất điện).
setInterval(() => {
  try {
    const mb = (n) => Math.round(n / 1048576);
    const m = process.memoryUsage();
    let procs = '';
    try {
      const sum = {};   // gộp theo loại tiến trình: Tab, GPU, Utility...
      for (const p of app.getAppMetrics()) {
        const t = p.type || '?';
        sum[t] = (sum[t] || 0) + Math.round((p.memory && p.memory.workingSetSize || 0) / 1024);
      }
      procs = Object.entries(sum).map(([t, v]) => `${t} ${v}MB`).join(', ');
    } catch (_) {}
    console.log(`[blackbox] Heap main ${mb(m.heapUsed)}/${mb(m.heapTotal)}MB, RSS ${mb(m.rss)}MB`
      + (procs ? ` | ${procs}` : ''));
  } catch (_) {}
}, 5 * 60 * 1000);

let mainWindow = null;

// Gửi sự kiện xuống giao diện. Đặt ở CẤP MODULE để mọi handler đều dùng được — trước đây
// mỗi handler tự khai báo `send` cục bộ, handler nào quên là lỗi "send is not defined".
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ── KHÓA LIÊN MÁY (chống 1 profile chạy trên 2+ máy) ──
// Khóa được định danh bằng TÊN THƯ MỤC profile, không phải id: id sinh theo thời điểm tạo
// (`p_<timestamp>`) nên MỖI MÁY một id khác nhau dù là cùng profile. Tên thư mục thì giống
// nhau khi chép profile sang máy khác — đó mới là thứ nhận diện được cùng một tài khoản.
function folderOfProfile(profileId) {
  const p = profiles.loadProfiles().find(x => x.id === profileId);
  return p ? (p.folderName || p.id) : null;
}

// Đọc cấu hình Sheet từ store rồi nạp vào sheet-lock. Khóa liên máy KHÔNG phụ thuộc công tắc
// "tự đẩy dữ liệu" — chỉ cần có Spreadsheet ID + Service Account là bật, vì đây là biện pháp
// an toàn cho phiên đăng nhập, không phải tính năng tùy chọn.
function configureSheetLockFromStore() {
  const cfg = store.get('sheets_config') || {};
  let sa = null;
  try { sa = cfg.saJson ? JSON.parse(cfg.saJson) : null; } catch (_) {}
  sheetLock.configure({ spreadsheetId: cfg.spreadsheetId, sa });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Khổ MẶC ĐỊNH 1180x720 (2026-07-28): bảng profile có 8 cột + 5 nút hành động nên cần
    // ~1000px mới hiện trọn không phải cuộn. Khổ cũ 960x600 vừa đúng mức bảng bắt đầu bị
    // bóp — cột "Trạng thái" co còn ~55px, câu log dài xuống 6 dòng rồi bị cắt, và chỉ
    // thấy 1/5 profile (người dùng báo "thu nhỏ là giao diện vỡ").
    width: 1180,
    height: 720,
    // Khổ TỐI THIỂU hạ xuống 720x520: giờ thu nhỏ đã AN TOÀN vì bảng cuộn ngang được
    // (.result-wrap: overflow auto + min-width) thay vì bị cắt mất không cách nào xem.
    minWidth: 720,
    minHeight: 520,
    title: 'TikTok Crawler',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─────────────────────────────────────────
// IPC: App info
// ─────────────────────────────────────────
ipcMain.handle('app-version', () => require('./package.json').version);
ipcMain.handle('is-dev', () => !app.isPackaged);
ipcMain.on('restart-app', () => { app.relaunch(); app.exit(0); });

// Reload cửa sổ (chỉ dùng ở dev). Bỏ qua cache để nạp lại CSS/JS mới nhất.
ipcMain.on('reload-window', () => {
  if (!app.isPackaged && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
});

// ─────────────────────────────────────────
// IPC: Profile manager
// ─────────────────────────────────────────
ipcMain.handle('profiles-list', () => profiles.loadProfiles());
ipcMain.handle('profiles-add', (_e, data) => profiles.addProfile(data));
ipcMain.handle('profiles-import-path', (_e, data) => profiles.importFromPath(data));
ipcMain.handle('profiles-list-folders', () => profiles.listFolders());
ipcMain.handle('profiles-update', (_e, data) => profiles.updateProfile(data));
ipcMain.handle('profiles-delete', (_e, data) => profiles.deleteProfile(data));
ipcMain.handle('profiles-get-path', (_e, id) => profiles.getProfilePath(id));

// ─────────────────────────────────────────
// IPC: Browser control
// ─────────────────────────────────────────
ipcMain.handle('open-browser', async (_e, arg) => {
  try {
    // arg = profileId (cũ) hoặc { profileId, blockImages }
    const profileId = typeof arg === 'object' && arg ? arg.profileId : arg;
    const blockImages = typeof arg === 'object' && arg ? !!arg.blockImages : false;
    if (!profileId) return { ok: false, msg: 'Vui lòng chọn profile trước.' };
    const profilePath = profiles.getProfilePath(profileId);
    if (!profilePath) return { ok: false, msg: 'Profile không tồn tại.' };
    await browser.openForLogin(profilePath, { blockImages });
    // Kèm chẩn đoán phiên (nguồn cookie, đã đăng nhập chưa, lỗi trích Firefox nếu có)
    // để UI hiện rõ — trước đây lỗi migration chỉ nằm trong console ẩn của bản đóng gói.
    return { ok: true, session: browser.getSessionInfo(profilePath) };
  } catch (e) {
    console.error('[open-browser]', e.message);
    return { ok: false, msg: e.message };
  }
});

// Kiểm tra phiên đăng nhập THẬT của nhiều profile (mở TikTok hỏi thẳng, không đếm cookie).
// Chạy tuần tự để không dội TikTok; báo tiến độ về UI qua kênh crawl-status.
ipcMain.handle('verify-logins', async (_e, profileIds) => {
  const ids = Array.isArray(profileIds) && profileIds.length
    ? profileIds : profiles.loadProfiles().map(p => p.id);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const p = profiles.loadProfiles().find(x => x.id === ids[i]);
    if (!p) continue;
    if (crawler.isProfileRunning(p.id)) {
      out.push({ id: p.id, name: p.name, state: 'skip', msg: 'Đang chạy — bỏ qua' });
      continue;
    }
    send('crawl-status', { profileId: null, status: 'info',
      msg: `Đang kiểm tra phiên ${i + 1}/${ids.length}: ${p.name}...` });
    // Báo cho ĐÚNG HÀNG của profile đang kiểm tra: mỗi profile mất 5–25s, trước đây hàng
    // không hiện gì trong lúc chờ nên trông như app đứng máy.
    send('crawl-status', { profileId: p.id, status: 'verify', state: 'checking',
      msg: `⏳ Đang kiểm tra đăng nhập (${i + 1}/${ids.length})...` });
    const pp = profiles.getProfilePath(p.id);
    const r = pp ? await browser.verifyProfileLogin(pp)
      : { state: 'unknown', msg: 'Không tìm thấy thư mục profile' };
    out.push({ id: p.id, name: p.name, state: r.state, msg: r.msg });
    // Kênh RIÊNG 'verify' — KHÔNG dùng 'running'/'error' của luồng crawl (bug 2026-07-28):
    // trước đây profile đăng nhập OK được gửi status 'running', renderer hiểu là "đang crawl"
    // → đánh dấu hàng đang chạy → nút đổi thành "■ Dừng", ô Chế độ bị khóa, "Chạy đã chọn"
    // bị vô hiệu. Bấm Dừng thì backend trả "Profile không chạy" nên không có sự kiện
    // 'stopped' nào tới nữa → hàng kẹt vĩnh viễn ở "Đang dừng...", trông như app treo.
    send('crawl-status', { profileId: p.id, status: 'verify', state: r.state,
      msg: `Kiểm tra phiên: ${r.msg}` });
  }
  const guest = out.filter(r => r.state === 'guest').length;
  send('crawl-status', { profileId: null, status: 'info',
    msg: `Kiểm tra xong ${out.length} profile — ${guest} profile cần đăng nhập lại.` });
  return { ok: true, results: out };
});

ipcMain.handle('close-browser', async (_e, profileId) => {
  try {
    if (profileId) {
      const p = profiles.getProfilePath(profileId);
      if (p) await browser.closeProfile(p);
    } else {
      await browser.closeAll();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
});

// ─────────────────────────────────────────
// IPC: Crawler
// ─────────────────────────────────────────
// Bắt đầu 1 profile độc lập (params kèm cài đặt riêng: mode/keyword/minVideos/delay/...).
ipcMain.handle('profile-start', async (_e, params) => {
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  // Áp số luồng đếm đồng thời toàn app (cài đặt chung, mặc định 2).
  crawler.setCountConcurrency(store.get('count_concurrency') || 2);

  // ── CHẶN CHẠY TRÙNG PROFILE GIỮA CÁC MÁY (2026-07-28) ──
  // Đây là nguyên nhân SỐ 1 khiến TikTok hủy phiên đăng nhập (1 phiên phát từ 2 IP). Khác
  // `profile.lock` (chỉ thấy được trong cùng 1 máy), khóa này ghi lên Google Sheet dùng chung
  // nên các máy thấy nhau. CHẶN thật (không chỉ cảnh báo) vì cảnh báo lúc 3h sáng thì không ai
  // đọc, mà hậu quả là phải bấm 🦊 đăng nhập lại từng profile qua RDP.
  configureSheetLockFromStore();
  {
    const folder = folderOfProfile(params.profileId);
    // TRẦN 8 GIÂY (2026-07-28): sự cố thật — Google API bị treo (không lỗi hẳn, cũng không
    // xong) làm request thứ 2 trong "▶ Chạy đã chọn" không bao giờ resolve; renderer chạy
    // TUẦN TỰ (for...await) nên các profile sau đó không bao giờ được thử, dù profile đầu
    // vẫn chạy bình thường. `withDeadline` đảm bảo bấm Chạy không bao giờ chờ quá 8s/profile
    // cho bước này, dù tầng dưới (httpRequest) có lỗi gì đi nữa.
    const lock = await withDeadline(
      sheetLock.check(folder), 8000,
      { state: 'unknown', msg: 'quá 8s chưa có phản hồi (Google API chậm/treo)' }
    );
    if (lock.state === 'busy') {
      const msg = `⛔ Profile này ĐANG CHẠY ở máy "${lock.host}" (nhịp tim ${lock.ago}s trước). `
        + 'Chạy cùng lúc 2 nơi sẽ làm TikTok HỦY phiên đăng nhập của CẢ HAI. '
        + `Hãy dừng ở máy đó trước; nếu máy đó đã tắt thật thì đợi ~${Math.ceil(sheetLock.STALE_MS / 60000)} phút cho khóa tự hết hạn.`;
      send('crawl-status', { profileId: params.profileId, status: 'error', msg });
      return { ok: false, msg };
    }
    // 'unknown' (mạng/API lỗi/quá giờ) và 'off' (chưa cấu hình Sheet) đều KHÔNG chặn — không
    // được để cả dàn máy đứng im vì Sheet lỗi/chậm tạm thời. Chỉ ghi log để còn truy được.
    if (lock.state === 'unknown') {
      console.warn(`[sheet-lock] Không kiểm được khóa liên máy cho "${folder}" (${lock.msg}) — vẫn cho chạy.`);
    }
    // Ghi nhịp tim NGAY để máy khác thấy liền, không phải chờ nhịp định kỳ 60s.
    // Cùng trần 8s, và KHÔNG chờ nếu lỗi/chậm — nhịp định kỳ 60s sẽ tự bù lại sau.
    if (folder) withDeadline(sheetLock.heartbeat([folder]), 8000, null).catch(() => {});
  }

  // Cấu hình đẩy Google Sheet từ store (nếu bật).
  const sheetsCfg = store.get('sheets_config') || {};
  let sa = null;
  try { sa = sheetsCfg.saJson ? JSON.parse(sheetsCfg.saJson) : null; } catch (_) {}
  sheets.configure(
    { enabled: !!sheetsCfg.enabled, spreadsheetId: sheetsCfg.spreadsheetId, tab: sheetsCfg.tab, sa },
    (msg) => send('crawl-status', { profileId: null, status: 'sheet-error', msg: 'Google Sheet: ' + msg })
  );

  // Lọc trùng với link đã có trên Sheet — CHỈ đọc khi là profile ĐẦU TIÊN của phiên.
  let seedUrls = [];
  if (!crawler.isAnyRunning() && sheetsCfg.enabled && sa && sheetsCfg.spreadsheetId) {
    try {
      // Dùng refreshKnownLinks (không phải readLinks): nó vừa nạp vào bộ lọc ĐẨY vừa ĐẶT MỐC
      // dòng. Nếu chỉ readLinks thì mốc vẫn 0 → lần đẩy đầu tiên lại phải đọc lại 156.000
      // dòng lần nữa (đọc trùng vô ích ngay lúc khởi động).
      const seed = await sheets.refreshKnownLinks({ full: true });
      seedUrls = seed.links;
      send('crawl-status', { profileId: null, status: 'info', msg: `Đã nạp ${seedUrls.length} link từ Sheet để lọc trùng...` });
    } catch (e) {
      // (2026-07-29) Chưa nạp được → sheets.enqueue() tự tạm dừng đẩy realtime cho tới khi
      // nạp thành công (tránh đẩy mù gây trùng). Nói rõ điều đó ra UI để không tưởng nhầm là
      // mất dữ liệu — dữ liệu vẫn hiện trong bảng, tự thử lại mỗi phút, hoặc bấm "Đẩy lên
      // Sheet" để đẩy ngay (nút đó tự đọc lại danh sách mới nhất trước khi đẩy).
      send('crawl-status', {
        profileId: null, status: 'sheet-error',
        msg: 'Không đọc được Sheet để lọc trùng: ' + e.message
          + ' — TẠM DỪNG đẩy tự động lên Sheet (tránh trùng), dữ liệu vẫn hiện trong bảng.'
          + ' App tự thử lại mỗi phút; muốn đẩy ngay thì bấm "Đẩy lên Sheet".',
      });
    }
  }

  return crawler.startProfile(
    { ...params, seedUrls },
    (data) => {
      send('crawl-data', data);
      // Lịch sử theo ngày: đếm ĐÚNG số sound thực sự thu được (dòng vào bảng = cột "Hợp lệ").
      // Ghi ở đây chứ không ở chỗ đẩy Sheet: người dùng có thể tắt đẩy Sheet nhưng vẫn muốn
      // biết sản lượng, và dòng nào vào bảng mới là "thu được".
      try { history.recordSound(data.profileName); } catch (_) {}
      // Đẩy lên Sheet: cột Tên sound | Link | Số video | Profile.
      if (sheets.isEnabled()) sheets.enqueue([data.name || '', data.url || '', data.count ?? '', data.profileName || '']);
    },
    (profileId, status, msg, counts) => {
      send('crawl-status', { profileId, status, msg, ...(counts || {}) });
      if (status === 'all-done') sheets.flushAll().catch(() => {});
      // Nhả khóa liên máy khi profile dừng HẲN.
      // ⚠ CHỈ nghe 'stopped', TUYỆT ĐỐI KHÔNG nghe 'error': canh IP (QĐ-17) dùng status
      // 'error' cho thông báo TẠM DỪNG trong khi profile VẪN ĐANG SỐNG (đang chờ VPN về
      // đúng vùng). Nhả khóa lúc đó là mở đường cho máy khác chạy trùng ngay.
      // Các trường hợp thoát không phát 'stopped' (vd phát hiện chế độ khách) thì khóa tự
      // hết hạn sau 3 phút vì nhịp tim chỉ ghi cho profile ĐANG chạy — an toàn, tự lành.
      if (status === 'stopped' && profileId) {
        const f = folderOfProfile(profileId);
        if (f) sheetLock.release([f]).catch(() => {});
      }
    }
  );
});
// Nhả khóa liên máy khi dừng → máy khác chạy được NGAY, không phải chờ hết 3 phút stale.
// Không await trong handler dừng: nhả khóa là việc gọi mạng, không được làm nút Dừng chậm đi.
ipcMain.handle('profile-stop', (_e, profileId) => {
  const r = crawler.stopProfile(profileId);
  const folder = folderOfProfile(profileId);
  if (folder) sheetLock.release([folder]).catch(() => {});
  return r;
});
// Dừng mềm: ngừng quét ngay nhưng check nốt hàng đợi sound rồi mới dừng hẳn.
// ⚠ KHÔNG nhả khóa ở đây: profile vẫn còn đang check nốt hàng đợi, tức VẪN ĐANG DÙNG phiên
// đăng nhập. Nhả sớm là mở đường cho máy khác chạy trùng ngay lúc đó. Khóa sẽ được nhả khi
// profile dừng hẳn (xem xử lý status 'stopped' trong onStatus của profile-start).
ipcMain.handle('profile-soft-stop', (_e, profileId) => crawler.softStopProfile(profileId));
ipcMain.handle('profiles-stop-all', async () => {
  const running = crawler.runningIds();
  const r = crawler.stopAll();
  const folders = running.map(folderOfProfile).filter(Boolean);
  if (folders.length) sheetLock.release(folders).catch(() => {});
  await sheets.flushAll().catch(() => {});
  return r;
});
ipcMain.handle('crawl-running-ids', () => crawler.runningIds());

// ── Đẩy bù thủ công: chỉ đẩy dòng CHƯA có trên Sheet (lọc trùng theo cột Link) ──
ipcMain.handle('sheets-push-manual', async (_e, rows) => {
  const cfg = store.get('sheets_config') || {};
  // KHÔNG yêu cầu cfg.enabled: nút bấm tay là hành động chủ động của người dùng —
  // công tắc "enabled" chỉ điều khiển việc TỰ ĐỘNG đẩy realtime khi crawl.
  // Chỉ cần đã điền Spreadsheet ID + Service Account trong modal ☁ Google Sheet.
  let sa = null;
  try { sa = cfg.saJson ? JSON.parse(cfg.saJson) : null; } catch (_) {}
  if (!sa || !cfg.spreadsheetId) return { ok: false, msg: 'Chưa cấu hình Spreadsheet ID / Service Account trong "☁ Google Sheet".' };
  try {
    // Xả buffer tự động TRƯỚC (nếu mạng đã ổn, các lô đang chờ retry sẽ lên Sheet →
    // bước đọc dedup phía dưới nhìn thấy chúng, không đẩy lại lần 2).
    await sheets.flushAll().catch(() => {});
    const r = await sheets.pushDedup({ spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, sa }, rows);
    // Mọi dòng vừa gửi qua nút giờ đã có trên Sheet (mới đẩy hoặc vốn đã có) → gỡ chúng
    // khỏi buffer retry để không bị đẩy lại lần nữa gây trùng.
    if (r.ok) sheets.dropFromBuffer((rows || []).map(x => x && x[1]));
    return r;
  } catch (e) {
    return { ok: false, msg: e.message };
  }
});

// ── Dọn trùng trên Sheet (2026-07-29): quét TOÀN BỘ tab, xoá dòng link bị lặp ──
// Tách 2 bước: "scan" chỉ đọc + tính toán (an toàn, không đổi gì), renderer hiện xác nhận
// cho người dùng thấy trước SẼ xoá bao nhiêu dòng; "clean" mới thực sự xoá, và tự đọc lại
// từ đầu (không tin kết quả scan cũ) để tránh xoá nhầm nếu Sheet vừa đổi.
function _sheetsCfgOrErr() {
  const cfg = store.get('sheets_config') || {};
  let sa = null;
  try { sa = cfg.saJson ? JSON.parse(cfg.saJson) : null; } catch (_) {}
  if (!sa || !cfg.spreadsheetId) return { err: { ok: false, msg: 'Chưa cấu hình Spreadsheet ID / Service Account trong "☁ Google Sheet".' } };
  return { cfg, sa };
}
ipcMain.handle('sheets-scan-duplicates', async () => {
  const r = _sheetsCfgOrErr();
  if (r.err) return r.err;
  try { return await sheets.scanDuplicates(r.cfg.spreadsheetId, r.cfg.tab || 'Data', r.sa); }
  catch (e) { return { ok: false, msg: e.message }; }
});
ipcMain.handle('sheets-clean-duplicates', async () => {
  const r = _sheetsCfgOrErr();
  if (r.err) return r.err;
  try { return await sheets.cleanDuplicates(r.cfg.spreadsheetId, r.cfg.tab || 'Data', r.sa); }
  catch (e) { return { ok: false, msg: e.message }; }
});

// ── Lịch sử thu thập theo ngày ──
ipcMain.handle('history-get', (_e, limit) => {
  try { return { ok: true, days: history.getDays({ limit: limit || 60 }) }; }
  catch (e) { return { ok: false, msg: e.message, days: [] }; }
});
ipcMain.handle('history-clear', () => {
  try { history.clearAll(); return { ok: true }; }
  catch (e) { return { ok: false, msg: e.message }; }
});

// ── Google Sheets config + test ──
ipcMain.handle('sheets-get-config', () => store.get('sheets_config') || {});
ipcMain.handle('sheets-set-config', async (_e, cfg) => {
  store.set('sheets_config', cfg);

  // ÁP DỤNG NGAY vào phiên đang chạy (không cần chờ lần Chạy tiếp theo).
  if (crawler.isAnyRunning()) {
    const send = (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    };
    let sa = null;
    try { sa = cfg.saJson ? JSON.parse(cfg.saJson) : null; } catch (_) {}

    // Xả nốt buffer theo cấu hình CŨ trước khi đổi (tránh kẹt dòng khi tắt giữa chừng).
    await sheets.flushAll().catch(() => {});

    sheets.configure(
      { enabled: !!cfg.enabled, spreadsheetId: cfg.spreadsheetId, tab: cfg.tab, sa },
      (msg) => send('crawl-status', { profileId: null, status: 'sheet-error', msg: 'Google Sheet: ' + msg })
    );

    // Bật giữa phiên → nạp link cũ trên Sheet vào bộ lọc trùng (đầu phiên chưa nạp vì lúc đó Sheet tắt).
    if (cfg.enabled && sa && cfg.spreadsheetId) {
      try {
        const links = await sheets.readLinks(cfg.spreadsheetId, cfg.tab || 'Data', sa);
        const added = crawler.addSeedUrls(links);
        sheets.updateKnownLinks(links);
        send('crawl-status', { profileId: null, status: 'info',
          msg: `Đã bật đẩy Sheet giữa phiên — nạp ${links.length} link cũ để lọc trùng (${added} link mới thêm).` });
      } catch (e) {
        send('crawl-status', { profileId: null, status: 'sheet-error',
          msg: 'Bật Sheet giữa phiên nhưng không đọc được link cũ để lọc trùng: ' + e.message });
      }
    } else if (!cfg.enabled) {
      send('crawl-status', { profileId: null, status: 'info', msg: 'Đã tắt tự đẩy Google Sheet (áp dụng ngay).' });
    }
  }
  return { ok: true };
});
ipcMain.handle('sheets-test', async (_e, cfg) => {
  let sa = null;
  try { sa = cfg.saJson ? JSON.parse(cfg.saJson) : null; }
  catch (_) { return { ok: false, msg: 'Service Account JSON không hợp lệ (lỗi cú pháp).' }; }
  if (!sa) return { ok: false, msg: 'Chưa dán Service Account JSON.' };
  try { return await sheets.testConnection(cfg.spreadsheetId, sa); }
  catch (e) { return { ok: false, msg: e.message }; }
});

// ─────────────────────────────────────────
// IPC: Storage (electron-store)
// ─────────────────────────────────────────
ipcMain.handle('store-get', (_e, keys) => {
  const out = {};
  for (const k of keys) out[k] = store.get(k);
  return out;
});
ipcMain.handle('store-set', (_e, data) => {
  for (const [k, v] of Object.entries(data)) store.set(k, v);
  // Đổi số luồng đếm → áp dụng NGAY, kể cả đang chạy (không cần chạy lại).
  if (Object.prototype.hasOwnProperty.call(data, 'count_concurrency')) {
    crawler.setCountConcurrency(data.count_concurrency || 2);
  }
});

// ─────────────────────────────────────────
// IPC: Dialog
// ─────────────────────────────────────────
ipcMain.handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// Xuất bảng "Dữ liệu thu thập" ra file CSV (UTF-8 BOM → Excel mở trực tiếp, tiếng Việt
// không lỗi font). rows = [{name, url, count, profileName}].
ipcMain.handle('export-results', async (_e, rows) => {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, msg: 'Bảng dữ liệu đang trống.' };

  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}`;
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Xuất dữ liệu thu thập',
    defaultPath: `Crawl_DataTiktok_${stamp}.csv`,
    filters: [{ name: 'Excel CSV', extensions: ['csv'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };

  // Escape CSV: bọc "..." nếu chứa dấu phẩy/nháy/xuống dòng; nhân đôi dấu nháy trong chuỗi.
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['#', 'Tên sound', 'Link', 'Số video', 'Profile'];
  const lines = [header.join(',')];
  rows.forEach((d, i) => {
    lines.push([i + 1, esc(d.name), esc(d.url), esc(d.count ?? '?'), esc(d.profileName)].join(','));
  });

  try {
    // BOM (﻿) để Excel nhận đúng UTF-8 (không có → tiếng Việt vỡ font).
    fs.writeFileSync(r.filePath, '﻿' + lines.join('\r\n'), 'utf8');
    return { ok: true, path: r.filePath, count: rows.length };
  } catch (e) {
    return { ok: false, msg: 'Ghi file thất bại: ' + e.message };
  }
});

// ─────────────────────────────────────────
// IPC: Auto-update
// ─────────────────────────────────────────
ipcMain.handle('download-and-update', (_e, params) => updater.downloadAndUpdate(params));
// Người dùng tự bấm "Kiểm tra cập nhật" → báo cả khi không có bản mới / lỗi.
ipcMain.handle('check-updates', () => {
  updater.checkForUpdates(mainWindow, { repo: store.get('update_repo'), manual: true });
  return { ok: true };
});
// Cấu hình repo phát hành (dạng 'Owner/Repo'). Rỗng = dùng mặc định trong updater.cjs.
ipcMain.handle('update-get-repo', () => ({
  repo: store.get('update_repo') || '',
  default: updater.DEFAULT_REPO,
}));
ipcMain.handle('update-set-repo', (_e, repo) => {
  store.set('update_repo', (repo || '').trim());
  return { ok: true };
});

// ─────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  // Tự kiểm tra cập nhật lúc khởi động (im lặng nếu đã là bản mới nhất).
  setTimeout(() => updater.checkForUpdates(mainWindow, { repo: store.get('update_repo') }), 3000);
  // Tự tải Firefox nếu lib\ms-playwright thiếu (máy triển khai từ bản build cũ không kèm
  // Firefox → không trích được cookie profile Firefox Portable). Chạy nền, im lặng khi đủ.
  setTimeout(() => {
    updater.ensureFirefox(mainWindow, { repo: store.get('update_repo') })
      .catch(e => console.warn('[updater] ensureFirefox lỗi:', e.message));
  }, 5000);

  // ── ĐỒNG BỘ LỌC TRÙNG LIÊN MÁY (2026-07-16) ──
  // Nhiều máy cùng ghi 1 Sheet: mỗi máy chỉ nạp link Sheet MỘT LẦN lúc bắt đầu phiên →
  // mù về sound máy khác đẩy sau đó → trùng. Đọc lại cột B định kỳ (mặc định 5 phút,
  // chỉnh qua sheets_config.reseedMinutes): nạp vào bộ lọc quét (addSeedUrls — không
  // quét lại) + bộ nhớ cửa đẩy (updateKnownLinks — gỡ khỏi buffer, flush bỏ qua).
  // Chỉ chạy khi đang crawl + Sheet đang bật; lỗi mạng thì im lặng chờ vòng sau.
  // ── ĐỌC TĂNG DẦN (2026-08-03) — thu hẹp cửa sổ sinh trùng liên máy ──
  // Người dùng gặp thật: 2 máy chạy profile cùng vùng, cả hai đều thấy sound X là "mới" nên
  // cả hai đẩy X lên Sheet → trùng. Gốc rễ là ĐỘ TRỄ BIẾT TIN: đọc lại TOÀN BỘ cột B của tab
  // 156.000 dòng mất hàng chục giây nên chỉ dám chạy 5–15 phút/lần; trong khoảng hở đó máy
  // này mù về những gì máy kia vừa đẩy.
  // Cách sửa: dòng mới LUÔN được append vào CUỐI tab → chỉ cần đọc PHẦN ĐUÔI kể từ mốc lần
  // trước (`_reseedNextRow`). Vài trăm dòng thì rẻ và nhanh → chạy được MỖI PHÚT, cửa sổ trùng
  // co từ 5–15 phút xuống ~1 phút (nhanh hơn 5–15 lần) mà còn NHẸ HƠN cách cũ rất nhiều.
  //
  // Vẫn phải đọc lại TOÀN BỘ thưa hơn (theo `reseedMinutes`) vì mốc dòng có thể LỆCH: nút
  // "🧹 Dọn trùng trên Sheet" xóa dòng làm mọi dòng phía sau dịch lên, hoặc người dùng tự xóa
  // dòng trên Sheet → đọc từ mốc cũ sẽ bỏ sót. Đọc lại toàn bộ để đồng bộ lại mốc.
  // Mốc dòng do `sheets.cjs` giữ (MỘT NƠI DUY NHẤT — xem refreshKnownLinks). Ở đây chỉ quyết
  // định KHI NÀO đọc toàn bộ, và nạp phần link mới vào bộ lọc QUÉT của crawler (sheets.cjs đã
  // tự nạp vào bộ lọc ĐẨY của nó).
  let _reseedBusy = false;
  let _lastFullReseedAt = 0;

  setInterval(async () => {
    if (_reseedBusy || !crawler.isAnyRunning()) return;
    const cfg = store.get('sheets_config') || {};
    if (!cfg.enabled || !cfg.spreadsheetId || !cfg.saJson) return;
    // `reseedMinutes` giờ là chu kỳ ĐỌC LẠI TOÀN BỘ (đồng bộ mốc); phần đuôi đọc mỗi phút.
    const fullEveryMin = Math.max(1, parseFloat(cfg.reseedMinutes) || 10);
    const needFull = Date.now() - _lastFullReseedAt >= fullEveryMin * 60000;

    _reseedBusy = true;
    try {
      const r = await sheets.refreshKnownLinks({ full: needFull });
      if (r.full) _lastFullReseedAt = Date.now();
      if (r.rawRows > 0) {
        const addedScan = crawler.addSeedUrls(r.links);
        if (addedScan > 0 || r.full) {
          console.log(`[reseed] ${r.full ? `Đọc TOÀN BỘ Sheet (${r.rawRows} dòng)` : `Đọc phần mới (${r.rawRows} dòng từ dòng ${r.from})`}`
            + `: +${addedScan} link mới vào bộ lọc quét.`);
        }
      }
    } catch (e) {
      console.warn('[reseed] Đọc lại Sheet lỗi (thử lại vòng sau):', e.message);
    } finally {
      _reseedBusy = false;
    }
  }, 60000);

  // ── NHỊP TIM KHÓA LIÊN MÁY (2026-07-28) ──
  // Ghi nhịp tim cho các profile ĐANG chạy trên máy này lên tab `_locks` để máy khác biết mà
  // không chạy trùng. Chỉ ghi cho profile đang chạy: profile đã dừng tự hết hạn sau 3 phút,
  // nên kể cả app bị giết đột ngột (mất điện, AV kill) khóa cũng tự nhả — không kẹt vĩnh viễn.
  let _beatBusy = false;
  setInterval(async () => {
    if (_beatBusy) return;
    const ids = crawler.runningIds();
    if (!ids.length) return;
    configureSheetLockFromStore();
    if (!sheetLock.isEnabled()) return;   // chưa cấu hình Sheet → không có gì để ghi
    _beatBusy = true;
    try {
      const folders = ids.map(folderOfProfile).filter(Boolean);
      if (folders.length) await sheetLock.heartbeat(folders);
    } finally {
      _beatBusy = false;
    }
  }, sheetLock.BEAT_MS);
});

app.on('window-all-closed', () => {
  browser.closeAll().catch(() => {});
  history.flush();   // ghi nốt lịch sử đang chờ (debounce 5s) — đóng app không mất số liệu
  if (process.platform !== 'darwin') app.quit();
});

// Thoát bằng đường khác (Alt+F4 lúc còn cửa sổ, lệnh quit) cũng phải ghi nốt.
app.on('before-quit', () => { history.flush(); });

app.on('activate', () => { if (mainWindow === null) createWindow(); });
