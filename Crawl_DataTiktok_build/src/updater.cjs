// src/updater.cjs — Tự động cập nhật qua GitHub Releases.
//
// Chỉ hoạt động khi đã đóng gói (.exe). Quy trình:
//   1. checkForUpdates(win, {repo, manual}): gọi GitHub API lấy release mới nhất
//      → so sánh version → gửi event về renderer:
//        • 'update-available'      khi có bản mới
//        • 'update-not-available'  khi đã là bản mới nhất (chỉ gửi khi manual)
//        • 'update-error'          khi lỗi (chỉ gửi khi manual)
//   2. downloadAndUpdate({downloadUrl}): tải .exe mới, viết một file .bat thay thế
//      exe rồi khởi động lại app.
//
// REPO lấy theo thứ tự ưu tiên:
//   1. tham số `repo` truyền vào (từ electron-store — cấu hình trong app)
//   2. biến môi trường UPDATE_REPO
//   3. hằng DEFAULT_REPO bên dưới
// Để trống tất cả → updater no-op.
'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');

// Một số máy có AV/proxy can thiệp HTTPS (SSL interception) khiến Node không xác minh
// được chứng chỉ ("unable to verify the first certificate"). Agent này bỏ qua xác minh
// để vẫn gọi được GitHub API + tải file (giống cách xử lý trong sheets.cjs).
const _insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Repo phát hành mặc định, dạng 'Owner/Repo'. Đổi cho khớp repo GitHub của bạn,
// hoặc cấu hình trong app (modal Cập nhật) — giá trị trong app sẽ ghi đè dòng này.
const DEFAULT_REPO = 'datkhac009/Crawl_DataTiktok-releases';

// ⚠ TRẠNG THÁI HIỆN TẠI (2026-07-28): repo phát hành đang PRIVATE nên TỰ CẬP NHẬT KHÔNG
// HOẠT ĐỘNG — updater gọi GitHub API ẨN DANH (không token) và private repo trả 404.
// Đây là quyết định có chủ đích, KHÔNG phải bug đang chờ sửa:
//   • Không thể để repo public vì file .exe CHỨA NGUYÊN app.asar — ai tải về cũng extract
//     ra được trọn mã nguồn (`npx asar extract`), tức public repo = công khai source.
//   • Không nhúng token vào .exe: .exe phát tán tới nhiều máy, token trong đó coi như lộ.
// => Cách đang dùng: CẬP NHẬT THỦ CÔNG (copy .exe mới sang từng máy).
// Muốn bật lại tự cập nhật thì có 2 đường, xem DECISIONS.md QĐ-18.
//
// ⚠ Khi cập nhật tay nhiều máy, phải cập nhật HẾT: TROUBLESHOOTING.md mục 5 ghi rõ máy
// chạy bản cũ lẫn với bản mới vẫn gây TRÙNG DỮ LIỆU trên Sheet.
const PRIVATE_REPO_HINT =
  'Repo phát hành đang ở chế độ PRIVATE nên app không đọc được bản mới (GitHub trả 404 cho '
  + 'truy cập ẩn danh). Hiện đang CẬP NHẬT THỦ CÔNG: tải .exe mới rồi thay trên từng máy. '
  + 'Nhớ cập nhật TẤT CẢ các máy — máy chạy bản cũ lẫn vào sẽ gây trùng dữ liệu trên Sheet.';

// ── CHUẨN HOÁ Ô "GitHub repo phát hành" (2026-08-11) ──
// Người dùng nhập tay ô này trên 5 máy, và đã mất thời gian 2 lần vì cùng một kiểu sai:
// thêm dấu `/` ở cuối → URL thành `/repos/Owner/Repo//releases/latest` → GitHub trả **404**,
// app báo "Không đọc được release" mà không hề nói vì sao. Đo thật:
//   [Hung13010/Crawl_DataTiktok-releases]   -> HTTP 200
//   [Hung13010/Crawl_DataTiktok-releases/]  -> HTTP 404
// Nhận rộng rãi rồi tự cắt về đúng `Owner/Repo`: dán cả URL GitHub cũng được, thừa dấu `/`
// hoặc khoảng trắng cũng được. Rẻ, và xoá hẳn một lớp lỗi vận hành lặp lại.
function normalizeRepo(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '');   // dán cả URL
  s = s.replace(/^\/+|\/+$/g, '');                              // dấu / đầu/cuối
  s = s.replace(/\.git$/i, '');                                 // link clone
  const parts = s.split('/').filter(Boolean);                   // bỏ `//` ở giữa
  if (parts.length < 2) return '';
  return parts[0] + '/' + parts[1];                             // bỏ đuôi /releases/tag/...
}

function _resolveRepo(repo) {
  return normalizeRepo(repo) || normalizeRepo(process.env.UPDATE_REPO) || normalizeRepo(DEFAULT_REPO);
}

function _currentVersion() {
  try { return require('../package.json').version; } catch (_) { return '0.0.0'; }
}

// So sánh semver: trả true nếu a > b.
function isNewer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Kiểm tra cập nhật.
//   manual=true  → là người dùng tự bấm "Kiểm tra"; báo cả khi không có bản mới / lỗi.
//   manual=false → tự kiểm tra lúc khởi động; chỉ báo khi CÓ bản mới (im lặng nếu không).
function checkForUpdates(mainWindow, { repo, manual = false } = {}) {
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };

  let app;
  try { app = require('electron').app; } catch (_) { app = null; }

  // Bản dev (chưa đóng gói) không thể tự thay exe → chỉ cho phép khi manual để test.
  if (app && !app.isPackaged && !manual) return;

  const REPO = _resolveRepo(repo);
  if (!REPO) {
    if (manual) send('update-error', { msg: 'Chưa cấu hình GitHub repo phát hành.' });
    return;
  }

  const options = {
    hostname: 'api.github.com',
    path: `/repos/${REPO}/releases/latest`,
    method: 'GET',
    headers: { 'User-Agent': 'TikTokCrawler-Updater', 'Accept': 'application/vnd.github.v3+json' },
    agent: _insecureAgent,
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode === 404) {
        // 404 có 2 nguyên nhân mà người dùng cần phân biệt được: repo PRIVATE (trường hợp
        // hiện tại — release VẪN CÓ, chỉ là không đọc được khi gọi ẩn danh) hay tên repo sai
        // thật. Thông báo cũ "Không tìm thấy release nào" khiến hiểu sai là chưa phát hành gì.
        if (manual) send('update-error', { msg: `Không đọc được release của "${REPO}". ${PRIVATE_REPO_HINT}` });
        return;
      }
      if (res.statusCode !== 200) {
        console.error('[updater] GitHub API', res.statusCode);
        if (manual) send('update-error', { msg: `GitHub API lỗi (HTTP ${res.statusCode}).` });
        return;
      }
      try {
        const release = JSON.parse(body);
        const latest = (release.tag_name || '').replace(/^v/, '');
        const current = _currentVersion();

        // ── CHO PHÉP CÀI BẢN KHÁC VERSION, KỂ CẢ CŨ HƠN (2026-08-11) ──
        //
        // Vì sao cần: dự án có 2 người, 2 repo phát hành riêng (xem QĐ-18). Người dùng muốn
        // chuyển cả dàn 5 máy sang repo của người kia bằng cách **chỉ đổi ô repo**. Nhưng
        // release mới nhất bên đó là 0.1.55 trong khi máy đang ở 0.1.70 → luật cũ
        // `isNewer(latest, current)` trả false → app báo "Đã là bản mới nhất" và KHÔNG tải gì.
        // Đó đúng là cái bẫy QĐ-18 đã ghi: *"tự báo nhầm đã là bản mới nhất dù thực tế đang
        // chạy code khác hẳn"*. Hệ quả thật: phải đi thay .exe tay trên từng máy.
        //
        // Luật mới: version KHÁC nhau là có thể cài. Không cần lưu thêm trạng thái nào, và
        // KHÔNG sinh vòng lặp — sau khi chuyển sang repo kia thì current == latest (bằng nhau)
        // nên không còn đề nghị gì nữa.
        //
        // ⚠ CHỐT AN TOÀN: hạ version CHỈ được đề nghị khi người dùng **tự bấm Kiểm tra**
        // (`manual`). Lần tự kiểm lúc khởi động tuyệt đối không hạ ngầm — cấu hình sai một ô
        // sẽ âm thầm cho cả dàn máy tụt về bản cũ, mất các tính năng mà không ai hay.
        const older = latest && !isNewer(latest, current) && latest !== current;
        if (!latest || (!isNewer(latest, current) && !(manual && older))) {
          if (manual) send('update-not-available', { current });
          return;
        }

        const exeAsset = (release.assets || []).find(a => /\.exe$/i.test(a.name));
        send('update-available', {
          version: latest,
          current,
          repo: REPO,
          isDowngrade: !!older,   // renderer phải cảnh báo RÕ, không cài lặng lẽ
          changelog: release.body || '',
          download_url: exeAsset ? exeAsset.browser_download_url : null,
        });
      } catch (e) {
        console.error('[updater] Lỗi parse release:', e.message);
        if (manual) send('update-error', { msg: 'Lỗi đọc dữ liệu release.' });
      }
    });
  });
  req.on('error', e => {
    console.error('[updater] Lỗi kết nối:', e.message);
    if (manual) send('update-error', { msg: 'Lỗi kết nối: ' + e.message });
  });
  req.end();
}

// Tải exe mới và áp dụng cập nhật (Windows). Trả { ok } hoặc { ok:false, msg }.
function downloadAndUpdate({ downloadUrl } = {}) {
  return new Promise((resolve) => {
    let app;
    try { app = require('electron').app; } catch (_) { return resolve({ ok: false, msg: 'Không có Electron app.' }); }
    if (!app.isPackaged) return resolve({ ok: false, msg: 'Chỉ cập nhật được ở bản đã đóng gói (.exe).' });
    if (!downloadUrl) return resolve({ ok: false, msg: 'Release không có file .exe để tải.' });

    const os = require('os');
    const { spawn } = require('child_process');
    const { BrowserWindow } = require('electron');

    const tempFile = path.join(os.tmpdir(), 'Crawl_DataTiktok_new.exe');
    const currentDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
    const currentExe = path.join(currentDir, 'Crawl_DataTiktok.exe');
    const batPath = path.join(os.tmpdir(), 'ttcrawler_updater.bat');

    function applyUpdate() {
      const pid = process.pid;
      const bat = [
        '@echo off',
        'title TikTokCrawler Updater',
        'timeout /t 2 /nobreak >nul',
        `taskkill /F /PID ${pid} >nul 2>&1`,
        'taskkill /F /IM Crawl_DataTiktok.exe >nul 2>&1',
        'timeout /t 3 /nobreak >nul',
        'set RETRIES=0',
        ':retry',
        `copy /Y "${tempFile}" "${currentExe}"`,
        'if not errorlevel 1 goto ok',
        'set /a RETRIES+=1',
        'if %RETRIES% GEQ 10 ( echo Cap nhat that bai! & pause & exit /b 1 )',
        'timeout /t 2 /nobreak >nul',
        'goto retry',
        ':ok',
        `del "${tempFile}" >nul 2>&1`,
        `start "" "${currentExe}"`,
        '(goto) 2>nul & del "%~f0"',
      ].join('\r\n');

      fs.writeFile(batPath, bat, 'utf8', (err) => {
        if (err) return resolve({ ok: false, msg: 'Tạo updater.bat thất bại: ' + err.message });
        // QUAN TRỌNG: Electron gói mọi tiến trình con vào 1 Job Object của Windows với cờ
        // "giết hết con khi cha thoát". exec() KHÔNG tách tiến trình mới ra khỏi job đó —
        // nếu app.quit() dọn job TRƯỚC khi cmd/updater.bat kịp "thoát ly" (breakaway), nó
        // bị giết theo NGAY LẬP TỨC → im lặng tắt app, không hiện cmd, không mở lại (bug
        // thực tế: "tải 100% xong đóng luôn không mở lại", chỉ xảy ra trên MỘT SỐ máy vì
        // đây là cuộc đua thời gian phụ thuộc tốc độ máy/Windows). FIX: spawn() với
        // detached:true (+ unref) TRƯỚC khi gọi app.quit() → cho tiến trình đủ thời gian
        // tách khỏi job trước khi Electron bắt đầu thoát.
        const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', batPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
        resolve({ ok: true });
        app.quit();
      });
    }

    function download(url) {
      https.get(url, { headers: { 'User-Agent': 'TikTokCrawler-Updater' }, agent: _insecureAgent }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return download(res.headers.location);
        if (res.statusCode !== 200) return resolve({ ok: false, msg: `HTTP ${res.statusCode}` });

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        const file = fs.createWriteStream(tempFile);
        res.on('data', (chunk) => {
          got += chunk.length;
          const win = BrowserWindow.getAllWindows()[0];
          if (total > 0 && win && !win.isDestroyed()) {
            win.webContents.send('download-progress', Math.round(got / total * 100));
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(applyUpdate));
        file.on('error', (e) => { fs.unlink(tempFile, () => {}); resolve({ ok: false, msg: e.message }); });
      }).on('error', e => resolve({ ok: false, msg: 'Lỗi kết nối: ' + e.message }));
    }

    try { fs.unlinkSync(tempFile); } catch (_) {}
    download(downloadUrl);
  });
}

// ════════ TỰ TẢI FIREFOX KHI THIẾU (2026-07-13) ════════
// Vấn đề: auto-update chỉ thay file .exe, không đụng lib\ms-playwright — máy triển khai
// từ trước THIẾU Firefox (bản build cũ cố tình bỏ ra) nên không trích được cookie từ
// profile Firefox Portable import vào. Giải pháp: build.bat upload firefox-<rev>.zip lên
// release tag cố định "browsers" MỘT LẦN; app lúc khởi động thấy lib\ms-playwright có
// nhưng thiếu firefox-<rev> → tự tải zip về giải nén. Release thường vẫn chỉ có .exe.
function _requiredFirefoxRev() {
  // KHÔNG dùng require('playwright-core/browsers.json') — trường "exports" của package
  // chặn subpath này (ERR_PACKAGE_PATH_NOT_EXPORTED). Đọc thẳng file theo đường dẫn.
  try {
    const file = path.join(__dirname, '..', 'node_modules', 'playwright-core', 'browsers.json');
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ff = (b.browsers || []).find(x => x.name === 'firefox');
    return ff ? String(ff.revision) : null;
  } catch (_) { return null; }
}

async function ensureFirefox(mainWindow, { repo } = {}) {
  let app;
  try { app = require('electron').app; } catch (_) { return; }
  if (!app || !app.isPackaged) return;   // dev dùng %LOCALAPPDATA%\ms-playwright sẵn có

  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  const libDir = path.join(exeDir, 'lib', 'ms-playwright');
  // Chỉ can thiệp khi máy dùng browser bundled (có lib\ms-playwright) — vì khi thư mục này
  // tồn tại, browser.cjs trỏ PLAYWRIGHT_BROWSERS_PATH vào đây, thiếu firefox là lỗi chắc chắn.
  if (!fs.existsSync(libDir)) return;
  const rev = _requiredFirefoxRev();
  if (!rev) return;
  const ffDir = path.join(libDir, `firefox-${rev}`);
  if (fs.existsSync(ffDir)) return;      // đã có, không làm gì

  const REPO = _resolveRepo(repo);
  if (!REPO) return;
  const url = `https://github.com/${REPO}/releases/download/browsers/firefox-${rev}.zip`;
  const os = require('os');
  const zipPath = path.join(os.tmpdir(), `ttcrawler-firefox-${rev}.zip`);
  const tmpExtract = path.join(libDir, `.ffdl-${rev}.tmp`);

  const send = (msg) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('crawl-status', { profileId: null, status: 'info', msg });
      }
    } catch (_) {}
  };

  console.log(`[updater] Thiếu firefox-${rev} trong lib\\ms-playwright — tải từ ${url}`);
  send(`Đang tải Firefox (cần cho trích cookie profile) — chạy nền, app vẫn dùng bình thường...`);

  // Tải zip (theo redirect như download exe).
  const ok = await new Promise((resolve) => {
    function download(u, depth = 0) {
      if (depth > 5) return resolve(false);
      https.get(u, { headers: { 'User-Agent': 'TikTokCrawler-Updater' }, agent: _insecureAgent }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return download(res.headers.location, depth + 1);
        if (res.statusCode !== 200) {
          console.warn(`[updater] Tải Firefox lỗi HTTP ${res.statusCode} (chưa upload firefox-${rev}.zip lên release "browsers"?)`);
          return resolve(false);
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0, lastPct = -10;
        const file = fs.createWriteStream(zipPath);
        res.on('data', (chunk) => {
          got += chunk.length;
          if (total > 0) {
            const pct = Math.round(got / total * 100);
            if (pct >= lastPct + 10) { lastPct = pct; send(`Đang tải Firefox... ${pct}%`); }
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(true)));
        file.on('error', () => { try { fs.unlinkSync(zipPath); } catch (_) {} resolve(false); });
      }).on('error', () => resolve(false));
    }
    try { fs.unlinkSync(zipPath); } catch (_) {}
    download(url);
  });
  if (!ok) { send('Tải Firefox thất bại — sẽ thử lại lần mở app sau.'); return; }

  // Giải nén vào thư mục tạm rồi mới chuyển vào chỗ thật (tránh để lại bản nửa vời nếu lỗi).
  send('Đang giải nén Firefox...');
  const extracted = await new Promise((resolve) => {
    const { execFile } = require('child_process');
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch (_) {}
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
       `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpExtract}' -Force`],
      { windowsHide: true, timeout: 10 * 60 * 1000 },
      (err) => resolve(!err));
  });
  try { fs.unlinkSync(zipPath); } catch (_) {}
  if (!extracted) {
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch (_) {}
    send('Giải nén Firefox thất bại — sẽ thử lại lần mở app sau.');
    return;
  }

  try {
    // Zip chứa thư mục gốc firefox-<rev>/ — chuyển nó vào lib\ms-playwright.
    const inner = path.join(tmpExtract, `firefox-${rev}`);
    const src = fs.existsSync(inner) ? inner : tmpExtract; // phòng zip nén thẳng nội dung
    fs.renameSync(src, ffDir);
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch (_) {}
    console.log(`[updater] Đã cài firefox-${rev} vào lib\\ms-playwright.`);
    send('✅ Đã cài Firefox tự động — giờ có thể trích đăng nhập từ profile Firefox import.');
  } catch (e) {
    try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch (_) {}
    console.warn('[updater] Chuyển Firefox vào chỗ lỗi:', e.message);
    send('Cài Firefox thất bại: ' + e.message);
  }
}

module.exports = { checkForUpdates, downloadAndUpdate, ensureFirefox, DEFAULT_REPO, normalizeRepo, isNewer };
