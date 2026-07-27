// src/crawler.cjs — Engine thu thập link sound TikTok.
//
// 4 chế độ (mỗi profile chọn riêng):
//   - 'foryou':  mở For You feed, cuộn, đọc sound của video hiện tại.
//   - 'search':  gõ từ khóa → tab Videos → mở video đầu → cuộn như For You.
//   - 'current': KHÔNG mở/điều hướng gì — cào ngay trên tab đang hiển thị của
//                trình duyệt người dùng đã tự mở (qua nút 🦊). Dừng = giữ browser mở.
//   - 'view':    XEM VIDEO — nhận danh sách link SOUND (/music/) hoặc link video:
//                link sound → mở trang sound, click 1 video ngẫu nhiên trong lưới;
//                rồi xem một tỉ lệ % thời lượng ngẫu nhiên, thỉnh thoảng like, cuộn
//                thêm N lần, nghỉ ngẫu nhiên giữa các link. Hết danh sách → tự dừng.
//                Mỗi profile chạy xem HẾT danh sách (tăng lượt xem theo số profile).
//   - 'cycle':   QUÉT ⇄ XEM TỰ ĐỘNG — luân phiên pha QUÉT For You (opts.cycleScanHours
//                giờ, mặc định 5) → pha XEM (opts.cycleViewMinutes phút, mặc định 30,
//                dùng danh sách viewLinks đã cấu hình sẵn, lặp lại danh sách nếu hết mà
//                chưa hết giờ) → quay lại QUÉT... lặp VÔ HẠN tới khi Dừng. Mỗi profile
//                chạy chu kỳ RIÊNG (không đồng bộ với profile khác).
// Cả 3 dùng chung pipeline: sound → mở trang /music/ lấy số video → lọc ngưỡng
// → đẩy ra (bảng + Google Sheet). Lọc trùng theo link sound.
//
// VÒNG ĐỜI TỪNG PROFILE (như CrawlView): mỗi profile chạy độc lập, có cờ stop riêng,
// start/stop bất kỳ lúc nào. _collected (dedup) + bộ đếm dùng CHUNG cho cả phiên
// (reset khi profile đầu tiên của phiên bắt đầu; phiên = khoảng có ≥1 profile chạy).
'use strict';

const browser = require('./browser.cjs');
const { getProfilePath, loadProfiles } = require('./profiles.cjs');
const { canonicalSoundUrl, normalizeKey } = require('./linkkey.cjs');

const TIKTOK_HOME = 'https://www.tiktok.com/';

// Map<profileId, { stop:{requested}, mode, name }> — các profile đang chạy.
const _active = new Map();

let _scannedThisRun = 0;      // số sound MỚI quét được trong phiên (không tính seed)
let _skippedDup = 0;          // số link bị bỏ vì trùng (cùng phiên HOẶC đã có trên Sheet)
let _seedCount = 0;           // số link nạp sẵn từ Sheet
let _loggedFirstKey = false;  // log 1 lần key đầu tiên để đối chiếu định dạng
const _collected = new Set(); // dedup theo key sound (gồm cả link nạp sẵn từ Sheet)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// ════════ ĐIỀU TIẾT ĐẾM VIDEO TOÀN CỤC (mọi profile dùng chung) ════════
// Vì sao: khi chạy nhiều profile, mỗi profile có countLoop riêng bắn /music/ ĐỒNG THỜI
// từ cùng 1 IP → TikTok rate-limit → chặn trang đếm (log: cả 5 profile kẹt "nghỉ 300s").
// Giải pháp: 1 semaphore CHUNG giới hạn số request đếm cùng lúc + giãn nhịp (min-gap +
// jitter) để rải đều thay vì dội cùng lúc + phạt thích ứng khi bị chặn.
let _countMax = 2;            // số request /music/ đồng thời tối đa TOÀN app (user chỉnh)
let _countActive = 0;         // đang chạy
const _countWaiters = [];     // hàng chờ slot
let _lastCountStart = 0;      // mốc thời gian request đếm gần nhất (để giãn nhịp)
let _countPenalty = 0;        // phạt thích ứng (ms) cộng vào min-gap khi bị chặn
const COUNT_BASE_GAP = 700;   // khoảng cách tối thiểu giữa 2 request đếm (ms)
const COUNT_PENALTY_MAX = 15000;

function setCountConcurrency(n) {
  _countMax = Math.max(1, Math.min(10, parseInt(n, 10) || 2));
  // Có slot mới → đánh thức bớt hàng chờ.
  while (_countActive < _countMax && _countWaiters.length) {
    const w = _countWaiters.shift(); if (w) w();
  }
}

// Xin 1 slot đếm: chờ tới lượt (dưới trần đồng thời) + đảm bảo giãn nhịp toàn cục.
// Trả false nếu bị yêu cầu dừng giữa chừng.
async function acquireCountSlot(stop) {
  while (_countActive >= _countMax && !stop.requested) {
    await new Promise(res => {
      _countWaiters.push(res);
      setTimeout(res, 500); // đánh thức định kỳ để kiểm tra cờ stop
    });
  }
  if (stop.requested) return false;
  _countActive++;
  // Giãn nhịp: cách request trước ít nhất BASE_GAP + phạt + jitter ngẫu nhiên.
  const gap = COUNT_BASE_GAP + _countPenalty + rand(0, 400);
  const wait = _lastCountStart + gap - Date.now();
  if (wait > 0) await interruptibleSleep(wait, stop);
  _lastCountStart = Date.now();
  return true;
}

function releaseCountSlot() {
  _countActive = Math.max(0, _countActive - 1);
  const w = _countWaiters.shift(); if (w) w();
}

// Bị chặn → tăng phạt (chậm lại dần); đọc được → giảm phạt (nhanh lại dần).
function countPenaltyUp() { _countPenalty = Math.min(_countPenalty + 1500, COUNT_PENALTY_MAX); }
function countPenaltyDown() { _countPenalty = Math.max(0, _countPenalty - 500); }

// canonicalSoundUrl + normalizeKey chuyển sang src/linkkey.cjs (2026-07-16) — dùng CHUNG
// với sheets.cjs để 2 nơi không bao giờ lệch định dạng key so trùng nữa.

// Nhận diện "Original Sound" — hỗ trợ CẢ tiếng Anh ("original sound - ...") LẪN
// tiếng Việt ("nhạc nền - ..." — đây là bản địa hóa của original sound trên TikTok VN).
// Dùng 2 dấu hiệu: slug trong link (/music/original-sound- hoặc /music/nhạc-nền-),
// HOẶC tên bắt đầu bằng "original sound" / "nhạc nền".
function isOriginalSound(url, name) {
  let u = String(url || '');
  try { u = decodeURIComponent(u); } catch (_) {}   // giải mã %-encode để bắt slug tiếng Việt
  u = u.toLowerCase();
  if (u.includes('/music/original-sound-') || u.includes('/music/nhạc-nền-')) return true;
  const n = String(name || '').trim().toLowerCase();
  return n.startsWith('original sound') || n.startsWith('nhạc nền');
}

function isProfileRunning(id) { return _active.has(id); }
function isAnyRunning() { return _active.size > 0; }
function runningIds() { return [..._active.keys()]; }

// Resource blocker cho TAB ĐẾM (lấy số video): chặn ảnh/media/font + domain quảng cáo
// → trang /music/ tải nhanh hơn, nhẹ RAM. (Học từ CrawlView.) CHỈ dùng cho tab đếm,
// KHÔNG dùng cho tab cuộn feed (tránh TikTok đổi hành vi / chặn).
const _AD_DENYLIST = [
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'amazon-adsystem.com', 'adnxs.com',
];
const _BLOCKED_TYPES = new Set(['image', 'media', 'font']);

async function attachCountBlocker(page) {
  try {
    await page.route('**/*', (route) => {
      const req = route.request();
      const type = req.resourceType();
      const url = req.url();
      if (_BLOCKED_TYPES.has(type) || _AD_DENYLIST.some(d => url.includes(d))) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });
  } catch (_) {}
}

async function interruptibleSleep(ms, stop) {
  const step = 200;
  for (let waited = 0; waited < ms && !stop.requested; waited += step) {
    await sleep(Math.min(step, ms - waited));
  }
}

// Đọc link + tên sound của video active (gần giữa màn hình nhất).
// Nhận cả 2 dạng link sound:
//   - For You: a[data-e2e="video-music"] (đĩa nhạc xoay)
//   - Trình phát trong trang search: a[aria-label][href*="/music/"] (không có data-e2e)
async function readActiveSound(page) {
  // page.evaluate KHÔNG có timeout — nếu tab đang kẹt/điều hướng nó chờ vô hạn → treo
  // vòng lặp (đặc biệt chế độ 'current' không đóng tab user). Đua với timeout 5s để loop
  // còn quay lại kiểm tra cờ stop.
  const evalPromise = page.evaluate(() => {
    const links = Array.from(document.querySelectorAll(
      'a[data-e2e="video-music"], a[aria-label][href*="/music/"]'));
    const vh = window.innerHeight;
    let best = null, bestDist = Infinity;
    for (const a of links) {
      const r = a.getBoundingClientRect();
      if (r.height === 0) continue;
      const center = r.top + r.height / 2;
      const dist = Math.abs(center - vh / 2);
      if (dist < bestDist) { bestDist = dist; best = a; }
    }
    if (!best) return null;
    const href = best.getAttribute('href') || '';
    let name = best.getAttribute('aria-label') || '';
    name = name.replace(/^.*?\bmusic\b\s*/i, '').trim() || name;
    return { href, name };
  });
  return Promise.race([
    evalPromise.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 5000)),
  ]);
}

// Đọc text số "X videos" trên trang /music/... (vd "31.5K", "8").
// Đua với timeout 5s — page.evaluate không có timeout, tab kẹt/điều hướng dở sẽ treo
// vô hạn (cùng bài học với readActiveSound).
async function readVideoCount(page) {
  const evalPromise = page.evaluate(() => {
    const els = document.querySelectorAll('h1,h2,h3,strong,p,span,div');
    for (const el of els) {
      if (el.children.length !== 0) continue;
      const t = (el.textContent || '').trim();
      const m = t.match(/^([\d.,]+\s*[KMB]?)\s*videos?$/i);
      if (m) return m[1].replace(/\s+/g, '');
    }
    return null;
  });
  return Promise.race([
    evalPromise.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 5000)),
  ]);
}

// "169.1K" → 169100, "1.2M" → 1200000, "8" → 8.
function parseCount(s) {
  const m = String(s).trim().match(/^([\d.,]+)\s*([KMB]?)$/i);
  if (!m) return s;
  let num = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(num)) return s;
  const unit = m[2].toUpperCase();
  if (unit === 'K') num *= 1e3;
  else if (unit === 'M') num *= 1e6;
  else if (unit === 'B') num *= 1e9;
  return Math.round(num);
}

// Số lần cuộn trước khi TẢI LẠI trang để xả RAM. Feed TikTok cuộn mãi sẽ tích DOM +
// buffer video vô tận → RAM phình ~1.5GB/phút (đã đo) → cạn RAM → crash. Reload định kỳ
// xả sạch bộ nhớ tích tụ. ~80 lần cuộn ≈ 3-4 phút (delay 2-3s/lần). Không áp cho chế độ
// 'current' (đó là tab của người dùng, không được tải lại). NGƯỜI DÙNG CHỈNH ĐƯỢC trong
// ⚙️ Cài đặt crawl (per-profile, `opts.recycleEvery`) — hằng số này chỉ còn là MẶC ĐỊNH
// khi chưa cấu hình. 0 = tắt hẳn tự tải lại (chấp nhận rủi ro RAM để đổi lấy không gián đoạn).
const RECYCLE_EVERY_DEFAULT = 80;

// ── Theo dõi tiến độ feed: phát hiện KẸT + thống kê định kỳ (2026-07-26) ──
// Vì sao: log cũ CHỈ ghi khi quét được sound MỚI → dòng "đã quét 0 sound" sau hàng trăm lần
// cuộn có thể là (a) feed chạy tốt nhưng mọi sound gặp đều đã có trong bộ lọc trùng, hoặc
// (b) feed KẸT cứng ở 1 video — hai tình huống khác hẳn nhau mà log KHÔNG phân biệt được
// (user gặp thật: 3 giờ liền "0 sound", không có cách nào biết feed có tiến hay không).
// Tracker đếm số sound KHÁC NHAU gặp được (feed tiến = nhiều sound khác nhau) và số lần đọc
// trúng CÙNG 1 sound liên tiếp (feed đứng = trúng mãi 1 sound).
const STUCK_SAME_SOUND = 20;    // đọc trúng cùng 1 sound bấy nhiêu lần LIÊN TIẾP = coi như KẸT
const FEED_STATS_EVERY = 100;   // cứ bấy nhiêu lần cuộn thì báo cáo thống kê 1 lần
// Số sound KHÁC NHAU liên tiếp phải đọc được thì mới coi là feed ĐÃ CHẠY LẠI ỔN ĐỊNH và hạ
// cấp độ can thiệp về 0. ⚠ Không được hạ ngay khi thấy 1 sound khác: log thật cho thấy trang
// chỉ có 2 video, cách 1 đẩy sang được video B (khác A) → nếu hạ cấp ngay thì lần kẹt sau lại
// bắt đầu từ cách 1, trong khi feed đã bật ngược về A → kẹt vĩnh viễn ở cách 1, không bao giờ
// lên cách 2/3 (bug thật, bắt được từ log user 2026-07-27).
const STUCK_RECOVERED = 5;

function makeFeedTracker() {
  let lastHref = null, sameCount = 0, stuckLevel = 0, progressRun = 0;
  let seen = new Set(), scrolls = 0, fresh = 0;
  return {
    // Ghi nhận 1 vòng cuộn. Trả true nếu nghi feed đang KẸT (cần can thiệp thoát kẹt).
    track(href, isNew) {
      scrolls++;
      if (isNew) fresh++;
      if (href) {
        seen.add(href);
        if (href === lastHref) sameCount++;
        else {
          lastHref = href; sameCount = 1;
          // Chỉ hạ cấp độ khi feed chạy lại ỔN ĐỊNH (nhiều sound khác nhau liên tiếp),
          // không phải chỉ nhích được 1 video rồi bật lại.
          if (++progressRun >= STUCK_RECOVERED) stuckLevel = 0;
        }
      }
      return sameCount >= STUCK_SAME_SOUND;
    },
    // Cấp độ thoát kẹt kế tiếp: 1 → 2 → 3 → quay lại 1 (xoay vòng thay vì kẹt mãi ở cấp 3,
    // vì sau khi tải lại thì cấp 1/2 lại có cơ hội hiệu quả).
    nextStuckLevel() { stuckLevel = stuckLevel >= 3 ? 1 : stuckLevel + 1; return stuckLevel; },
    // Tới mốc báo cáo → trả chuỗi thống kê rồi tự reset; chưa tới → null. Việc reset cũng
    // giữ `seen` luôn nhỏ (tối đa FEED_STATS_EVERY phần tử) — app chạy vô hạn nhiều ngày.
    dueStats() {
      if (scrolls < FEED_STATS_EVERY) return null;
      const s = `cuộn ${scrolls} lần, gặp ${seen.size} sound khác nhau, ${fresh} sound mới`;
      seen = new Set(); scrolls = 0; fresh = 0;
      return s;
    },
    // Sau khi đã xử lý kẹt → cho đếm lại từ đầu, nhưng GIỮ NGUYÊN lastHref.
    // ⚠ Không được xóa lastHref: nếu xóa, vòng đọc kế tiếp thấy href "khác" lastHref(null)
    // sẽ tưởng feed ĐÃ TIẾN → hạ stuckLevel về 0 → leo thang kẹt mãi ở cách 1, không bao
    // giờ lên cách 2/3 (bug đã bị test bắt lúc triển khai). Giữ lastHref thì lần kẹt sau
    // mới phân biệt được "vẫn đúng video cũ" (leo cấp) với "đã sang video mới" (hết kẹt).
    clearStuck() { sameCount = 0; progressRun = 0; },
  };
}

// ── CUỘN SANG VIDEO KẾ TIẾP (2026-07-27) ──
// ⚠ TRƯỚC ĐÂY dùng `page.keyboard.press('ArrowDown')` và nó ĐÃ NGỪNG TÁC DỤNG — kiểm chứng
// trực tiếp trên TikTok thật với profile thật: bấm phím 6 lần liên tiếp, sound đọc được
// KHÔNG ĐỔI lần nào (ở cả viewport 800x600 lẫn 1536x864). Đây là gốc rễ của "feed kẹt".
// CON LĂN CHUỘT thì chạy tốt: 8 lần cuộn ra 6 sound khác nhau, ở cả hai khổ màn hình.
// Nên đổi cuộn bằng con lăn làm cách CHÍNH.
// ── Theo dõi phiên đăng nhập TRONG LÚC CHẠY (2026-07-27) ──
// Kiểm tra lúc bắt đầu là chưa đủ: TikTok có thể hủy phiên giữa chừng (chạy trùng máy, đổi
// vùng VPN, nghi ngờ hoạt động). Trước đây app cứ cào tiếp hàng giờ ở chế độ khách.
// Trả về: 'ok' | 'guest'. Tự chốt phiên VÀNG mỗi lần xác nhận còn đăng nhập.
const LOGIN_RECHECK_MS = 15 * 60 * 1000;
function makeLoginWatcher(page, profilePath) {
  let last = Date.now();
  return async function check() {
    if (Date.now() - last < LOGIN_RECHECK_MS) return 'ok';
    last = Date.now();
    const s = await checkLoginState(page);
    if (s === 'guest') return 'guest';
    if (s === 'logged-in') browser.markSessionVerified(profilePath);
    return 'ok';
  };
}

async function scrollFeed(page) {
  try {
    let vp = null;
    try { vp = page.viewportSize(); } catch (_) {}
    if (!vp) {
      vp = await Promise.race([
        page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => null),
        new Promise(r => setTimeout(() => r(null), 3000)),
      ]);
    }
    const w = (vp && vp.width) || 1280, h = (vp && vp.height) || 720;
    await page.mouse.move(Math.round(w / 2), Math.round(h / 2));
    await page.mouse.wheel(0, h);
    return true;
  } catch (_) { return false; }
}

// ── Kiểm tra ĐÃ ĐĂNG NHẬP hay đang ở chế độ KHÁCH, hỏi thẳng trang TikTok (2026-07-27) ──
// Vì sao cần: cookie `sessionid` còn trong file KHÔNG có nghĩa TikTok còn chấp nhận. Sự cố
// thật: 1 profile thiếu cookie định tuyến → TikTok cho vào chế độ KHÁCH → feed khách chỉ có
// 1-2 video → app cào vô ích 3 tiếng, log chỉ báo "0 sound" nên không ai biết lý do.
// Đã kiểm chứng trên TikTok thật: khách thì có [data-e2e="top-login-button"] (nút "Log in"
// đỏ góc phải trên); đăng nhập rồi thì không có nút đó.
// Trả 'guest' | 'logged-in' | 'unknown' (không kết luận được → KHÔNG chặn crawl).
async function checkLoginState(page) {
  const evalPromise = page.evaluate(() => {
    if (document.querySelector('[data-e2e="top-login-button"]')) return 'guest';
    // Chưa dựng xong giao diện thì đừng kết luận vội.
    if (!document.querySelector('[data-e2e="nav-foryou"], [data-e2e="tiktok-logo"]')) return 'unknown';
    return 'logged-in';
  });
  return Promise.race([
    evalPromise.catch(() => 'unknown'),
    new Promise(r => setTimeout(() => r('unknown'), 5000)),
  ]);
}

// ── Chẩn đoán khi feed kẹt: đọc trạng thái trang để biết VÌ SAO không cuộn được ──
// (2026-07-26) Log thật cho thấy feed kẹt cứng: tải lại → đọc được 1 video → đứng im 20 lần
// → tải lại... vòng luẩn quẩn. Cần biết nguyên nhân thay vì đoán: có lớp che (modal đăng
// nhập/cảnh báo) chặn phím? video không tải được (blockImages chặn media)? con trỏ nhập
// liệu đang ở đâu (phím mũi tên chỉ tới đúng phần tử đang giữ con trỏ)?
async function diagnoseFeed(page) {
  const evalPromise = page.evaluate(() => {
    const links = document.querySelectorAll('a[data-e2e="video-music"], a[aria-label][href*="/music/"]');
    const v = document.querySelector('video');
    const ae = document.activeElement;
    // Lớp che THẬT = phần tử position:fixed phủ >60% màn hình VÀ chặn được thao tác chuột
    // VÀ có nội dung hiển thị (modal đăng nhập, cảnh báo tuổi...).
    // ⚠ Bỏ qua khung chứa thông báo/trang trí: chúng cũng fixed phủ toàn màn nhưng
    // pointer-events:none (không chặn gì) hoặc rỗng — báo nhầm sẽ che mất lớp che thật
    // (thực tế gặp: "TUXToastProvider-centerOutlet" của TikTok bị báo nhầm suốt).
    let overlay = '';
    for (const el of document.querySelectorAll('div,section,dialog')) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue;
      if (s.pointerEvents === 'none' || parseFloat(s.opacity || '1') < 0.05) continue;
      if (!(el.innerText || '').trim() && !el.querySelector('img,svg,video,button,input')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth * 0.6 && r.height > window.innerHeight * 0.6) {
        overlay = String(el.id || el.className || el.tagName).slice(0, 50);
        break;
      }
    }
    return {
      links: links.length,
      // readyState: -1 = không có thẻ video; 0 = chưa tải được tí dữ liệu nào (dấu hiệu
      // media bị chặn); 4 = tải đủ để phát mượt.
      videoReady: v ? v.readyState : -1,
      active: ae ? (ae.tagName + (ae.id ? '#' + ae.id : '')) : 'none',
      overlay,
    };
  });
  const base = await Promise.race([
    evalPromise.catch(() => null),
    new Promise(r => setTimeout(() => r(null), 5000)),
  ]);
  if (!base) return null;
  // Gọi TÁCH RIÊNG: _findNextButtonInPage là hàm phía Node, phải TRUYỀN VÀO page.evaluate
  // để chạy trong trang — không gọi lồng bên trong một evaluate khác được (hàm không tồn
  // tại trong ngữ cảnh trang → lỗi). Biết có nút hay không là mấu chốt để chọn cách thoát kẹt.
  const btn = await Promise.race([
    page.evaluate(_findNextButtonInPage).catch(() => null),
    new Promise(r => setTimeout(() => r(null), 5000)),
  ]);
  base.nextBtn = btn ? btn.label : '';
  return base;
}

// Tìm nút "video kế tiếp" của chính TikTok (mũi tên xuống ở cạnh phải khung video) —
// trả tọa độ tâm + nhãn để bấm bằng CHUỘT THẬT, hoặc null nếu không thấy.
// Vì sao dùng nút của trang: log thật 2026-07-27 chứng minh feed For You KHÔNG phải vùng
// cuộn thường mà là băng chuyền dựng bằng hiệu ứng CSS — `scrollIntoView` và con lăn chuột
// đều VÔ TÁC DỤNG (đã thử, thất bại 100%). Nút điều hướng là điều khiển chính thức của
// trang nên đáng tin nhất.
// HTML thật của nút (user cung cấp 2026-07-27, trang chủ TikTok):
//   <button class="TUXButton TUXButton--capsule ... action-item css-12x5cd4"
//           aria-disabled="false" type="button"><div class="TUXButton-content">
//           <div class="TUXButton-iconContainer"><svg viewBox="0 0 48 48">...
// 3 đặc điểm dùng để nhận diện AN TOÀN:
//   • class `action-item` — riêng của cụm nút điều hướng lên/xuống;
//   • KHÔNG có `data-e2e` ở chính nó lẫn phần tử con — trong khi nút like/bình luận/chia sẻ
//     LUÔN có (vd data-e2e="like-icon") ⇒ loại được nguy cơ bấm nhầm gây like/follow/report;
//   • `aria-disabled="true"` khi không dùng được (nút LÊN lúc đang ở đầu feed) ⇒ bỏ qua.
// Trong cặp lên/xuống, nút XUỐNG nằm THẤP hơn → chọn nút thấp nhất.
// Không tìm thấy thì trả null (KHÔNG bấm bừa nút khác — thà báo không làm được).
function _findNextButtonInPage() {
  const vh = window.innerHeight, vw = window.innerWidth;
  const ok = (el) => {
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return false;
    if (el.hasAttribute('data-e2e') || el.querySelector('[data-e2e]')) return false;
    if (!el.querySelector('svg')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.width <= 130 && r.height >= 20 && r.height <= 130
      && r.top >= 0 && r.bottom <= vh && r.left >= vw * 0.45;   // cụm nút ở nửa phải màn hình
  };
  let list = Array.from(document.querySelectorAll('button.action-item')).filter(ok);
  // Dự phòng nếu TikTok đổi class: chỉ nhận phần tử được đánh dấu rõ là mũi tên.
  if (!list.length) {
    list = Array.from(document.querySelectorAll(
      '[data-e2e*="arrow"], button[aria-label*="next" i], button[aria-label*="Tiếp" i]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return !el.disabled && el.getAttribute('aria-disabled') !== 'true'
          && r.width >= 20 && r.height >= 20 && r.top >= 0 && r.bottom <= vh;
      });
  }
  if (!list.length) return null;
  let best = null, bestTop = -1;
  for (const el of list) {
    const r = el.getBoundingClientRect();
    if (r.top > bestTop) { bestTop = r.top; best = el; }
  }
  const r = best.getBoundingClientRect();
  const cls = String(best.className || '');
  // Nhãn NGẮN GỌN cho log: class đầy đủ của TUXButton rất dài, cắt 40 ký tự chỉ ra chuỗi
  // "TUXButton TUXButton--capsule TUXButton--" vô nghĩa.
  const label = best.getAttribute('data-e2e') || best.getAttribute('aria-label')
    || (cls.includes('action-item') ? 'action-item' : (cls.split(/\s+/)[0] || best.tagName));
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label };
}

// ── Thoát kẹt theo cấp độ tăng dần (user chốt 2026-07-26, chỉnh lại 2026-07-27 theo log thật) ──
// Cấp 1: BẤM NÚT "video kế tiếp" của TikTok bằng chuột thật (điều khiển chính thức của trang).
// Cấp 2: click vào mép khung video để vùng feed NHẬN CON TRỎ NHẬP LIỆU rồi mới gửi phím mũi
//        tên — mô phỏng đúng thao tác user làm thành công (user bấm tay được vì đã click
//        vào trang; app gửi phím khi con trỏ ở BODY thì TikTok bỏ qua).
// Cấp 3: tải lại trang (phương án cuối).
// Trả chuỗi mô tả việc đã làm (để ghi log) hoặc null nếu không làm được gì.
async function unstickFeed(page, level) {
  try {
    if (level === 1) {
      try { await page.keyboard.press('Escape'); } catch (_) {}   // đóng hộp thoại nếu có
      const btn = await Promise.race([
        page.evaluate(_findNextButtonInPage).catch(() => null),
        new Promise(r => setTimeout(() => r(null), 5000)),
      ]);
      if (!btn) return null;
      await page.mouse.click(btn.x, btn.y);
      return `đã bấm nút "${btn.label}"`;
    }
    if (level === 2) {
      // Cuộn MẠNH: 3 nhịp con lăn liên tiếp. Cuộn 1 nhịp đã là cách chính (scrollFeed) nên
      // ở đây phải mạnh hơn mới có ý nghĩa.
      // ⚠ TUYỆT ĐỐI KHÔNG click vào vùng trang để "lấy con trỏ" rồi gửi phím: đã thử trên
      // TikTok thật, click vào trang làm HỎNG trạng thái trang (sau đó không đọc được sound
      // nào nữa) — và phím mũi tên vốn dĩ đã không còn tác dụng.
      for (let i = 0; i < 3; i++) {
        if (!await scrollFeed(page)) break;
        await sleep(700);
      }
      return 'đã cuộn mạnh 3 nhịp con lăn';
    }
  } catch (_) {}
  return null;
}

// Tải lại trang feed để giải phóng RAM, rồi chờ video xuất hiện lại.
async function recyclePage(page, waitSelector, stop) {
  if (stop.requested) return;
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(waitSelector, { timeout: 30000 });
  } catch (_) { /* reload lỗi → bỏ qua, vòng lặp vẫn tiếp tục */ }
}

// Xử lý 1 lần phát hiện kẹt: chẩn đoán → ghi log rõ nguyên nhân → can thiệp theo cấp độ.
// allowReload=false cho chế độ 'current' (tab của NGƯỜI DÙNG — không bao giờ tự tải lại).
// Trả true nếu đã TẢI LẠI (nơi gọi cần reset bộ đếm recycle).
async function handleStuck(page, tracker, { profileId, onStatus, prefix, waitSelector, allowReload, stop }) {
  const diag = await diagnoseFeed(page);
  let level = tracker.nextStuckLevel();
  if (!allowReload && level === 3) level = 1;   // 'current': bỏ qua cấp tải lại, quay về cấp 1
  const info = diag
    ? `${diag.links} link video, video tải ${diag.videoReady}/4, con trỏ ở ${diag.active}`
      + (diag.nextBtn ? `, thấy nút kế tiếp "${diag.nextBtn}"` : ', KHÔNG thấy nút kế tiếp')
      + (diag.overlay ? `, CÓ LỚP CHE "${diag.overlay}"` : '')
    : 'không đọc được trạng thái trang';
  const how = level === 1 ? 'bấm nút video kế tiếp của TikTok'
    : level === 2 ? 'cuộn mạnh 3 nhịp con lăn'
    : 'tải lại trang';
  onStatus(profileId, 'running',
    `⚠ ${prefix}feed KHÔNG chuyển video (${STUCK_SAME_SOUND} lần liên tiếp cùng 1 sound)`
    + ` — ${info} → thử cách ${level}: ${how}...`);
  let reloaded = false;
  if (level === 3) {
    await recyclePage(page, waitSelector, stop);
    reloaded = true;
  } else {
    // Ghi lại KẾT QUẢ can thiệp (bấm được nút gì / không tìm thấy nút) — biết cách nào
    // thực sự chạm được vào trang thay vì chỉ biết "đã thử".
    const done = await unstickFeed(page, level);
    onStatus(profileId, 'running', `   ↳ ${prefix}${done || 'KHÔNG thực hiện được (không tìm thấy điều khiển phù hợp)'}.`);
  }
  tracker.clearStuck();
  return reloaded;
}

// ── Vòng lặp crawl cho 1 profile (nhận cờ `stop` riêng) ──
async function crawlOneProfile(profile, opts, onData, onStatus, stop) {
  const { minDelay, maxDelay, headless, minVideos, maxVideos, mode, keyword, originalOnly, blockImages } = opts;
  // 0 = tắt hẳn tự tải lại feed (người dùng chấp nhận rủi ro RAM để đổi lấy không gián đoạn).
  const recycleEvery = opts.recycleEvery === 0 ? 0 : (opts.recycleEvery || RECYCLE_EVERY_DEFAULT);
  const profilePath = getProfilePath(profile.id);
  if (!profilePath) {
    onStatus(profile.id, 'error', `Profile "${profile.name}" không tìm thấy đường dẫn.`);
    return;
  }
  // CẢNH BÁO CHẠY TRÙNG — nguyên nhân số 1 khiến TikTok hủy phiên đăng nhập (một tài khoản
  // phát ra từ 2 IP = nghi bị chiếm tài khoản). Chỉ cảnh báo, KHÔNG chặn: lock có thể sót
  // lại từ lần app bị giết đột ngột, chặn cứng sẽ làm user không chạy được.
  {
    const busy = browser.checkProfileBusy(profilePath);
    if (busy) {
      onStatus(profile.id, 'running',
        `⚠ Profile này đang được máy "${busy.host}" dùng (nhịp tim ${busy.ago}s trước). `
        + 'Chạy trùng ở 2 nơi sẽ làm TikTok HỦY phiên đăng nhập — hãy tắt bên kia trước.');
    }
  }

  let ctx, page;
  if (mode === 'current') {
    // Dùng đúng trình duyệt người dùng đã mở (qua nút 🦊) — KHÔNG tự launch.
    ctx = browser.getExistingContext(profilePath);
    if (!ctx) {
      onStatus(profile.id, 'error',
        `Profile "${profile.name}" chưa được mở. Hãy nhấn 🦊 "Mở" ở hàng của nó, điều hướng tới trang cần cào, rồi nhấn ▶ Chạy.`);
      return;
    }
    page = await browser.getActivePage(ctx);
    if (!page) {
      onStatus(profile.id, 'error', `Không tìm thấy tab đang mở cho "${profile.name}".`);
      return;
    }
  } else {
    // foryou/search: dùng 1 Firefox CHUNG + 1 context riêng cho profile (tiêm cookie qua
    // storage_state). Nhẹ hơn nhiều so với mỗi profile 1 Firefox persistent.
    try {
      ctx = await browser.acquireProfileContext(profilePath, { headless });
      page = ctx.pages()[0] || await ctx.newPage();
    } catch (e) {
      const locked = /already|use|lock|profile|temporary/i.test(e.message || '');
      const msg = locked
        ? `Profile "${profile.name}" đang được mở ở cửa sổ Firefox khác. Hãy đóng Firefox đó (hoặc nhấn "Đóng") rồi thử lại.`
        : `Không mở được trình duyệt cho "${profile.name}": ${e.message}`;
      if (!stop.requested) onStatus(profile.id, 'error', msg);
      return;
    }
  }

  // Bị Dừng trong lúc CÒN ĐANG KHỞI ĐỘNG trình duyệt (launch Chromium / migration session
  // lần đầu — KHÔNG thể hủy giữa chừng, đây là bước duy nhất "trơ" với nút Dừng): lúc đó
  // stop.aborters chưa tồn tại nên stopProfile() không có gì để hủy. UI đã được báo "Đã
  // dừng" ngay (xem stopProfile) — ở đây chỉ cần thoát sớm, không chạy mode nào nữa;
  // .finally() của startProfile sẽ đóng context (đã lưu session) như bình thường.
  if (stop.requested) return;

  // Hủy NGAY khi nhấn Dừng: đóng TAB feed để mọi thao tác Playwright đang chờ
  // (goto/reload/waitForSelector — timeout tới 45-60s) bị huỷ tức thì → vòng lặp thoát
  // ngay thay vì chờ hết timeout. Đóng tab (không phải cả context) để context còn sống
  // cho releaseProfileContext kịp LƯU session. Chế độ 'current' KHÔNG đóng (tab của user).
  stop.aborters = [];
  if (mode !== 'current') {
    stop.aborters.push(() => { try { page.close(); } catch (_) {} });
  }

  // "Cờ dừng mở rộng" cho các vòng QUÉT/XEM (Dừng mềm 2026-07-16): dừng cứng HOẶC dừng mềm
  // (stop.draining) đều làm các vòng này thoát. countLoop KHÔNG dùng cờ này — khi dừng mềm
  // nó vẫn chạy tiếp tới khi CẠN hàng đợi (check nốt sound tồn đọng) rồi mới kết thúc.
  const scanStop = { get requested() { return stop.requested || !!stop.draining; } };

  // Tùy chọn: chặn ảnh/video/font ngay trên tab cuộn để giảm RAM (mặc định tắt).
  // Chế độ 'view'/'cycle' KHÔNG chặn ở đây — phải tải được video mới xem/tính thời lượng
  // được ('cycle' tự bật/tắt chặn RIÊNG cho từng pha — xem ensureBlocker bên dưới).
  if (blockImages && mode !== 'view' && mode !== 'cycle') { await attachCountBlocker(page); }

  // ════════ Chế độ XEM VIDEO ════════
  // Mở lần lượt từng link trong danh sách, xem ngẫu nhiên trong khoảng % thời lượng đã
  // cài, thỉnh thoảng like theo tỉ lệ, nghỉ ngẫu nhiên giữa 2 video. Hết danh sách → dừng.
  if (mode === 'view') {
    const links = opts.viewLinks || [];
    const pctMin = Math.max(1, Math.min(100, opts.viewPctMin || 40));
    const pctMax = Math.max(pctMin, Math.min(100, opts.viewPctMax || 70));
    const likePct = Math.max(0, Math.min(100, opts.viewLikePct || 0));
    // Cuộn thêm sau video gốc: mỗi link cuộn ngẫu nhiên trong [scrollMin, scrollMax] lần
    // (mỗi lần cuộn chỉ nghỉ theo Delay — KHÔNG xem đủ %). 0 = không cuộn.
    const scrollMin = Math.max(0, opts.viewScrollMin || 0);
    const scrollMax = Math.max(scrollMin, opts.viewScrollMax || 0);
    let watched = 0, liked = 0, failed = 0;

    async function viewLoop() {
      for (let i = 0; i < links.length && !stop.requested; i++) {
        const url = links[i];
        onStatus(profile.id, 'running', `Mở link ${i + 1}/${links.length}...`);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (_) {
          if (stop.requested) break;
          failed++;
          onStatus(profile.id, 'running', `⚠ Không mở được link ${i + 1}/${links.length} — bỏ qua.`);
          await interruptibleSleep(rand(minDelay, maxDelay), stop);
          continue;
        }

        // Link SOUND (/music/): mở trang sound → click 1 video NGẪU NHIÊN trong lưới
        // (selector đã verify: [data-e2e="music-item"] chứa a[href*="/video/"]) → sau đó
        // xem/like/cuộn y hệt link video thường.
        if (/\/music\//i.test(url)) {
          let clicked = false;
          try {
            const grid = page.locator('[data-e2e="music-item"] a[href*="/video/"]');
            await grid.first().waitFor({ timeout: 30000 });
            await interruptibleSleep(rand(800, 2000), stop);   // ngắm trang như người thật
            if (stop.requested) break;
            const n = await grid.count();
            const pick = rand(0, n);
            onStatus(profile.id, 'running',
              `Sound ${i + 1}/${links.length}: chọn video ${pick + 1}/${n} trong lưới...`);
            await grid.nth(pick).click({ timeout: 10000 });
            clicked = true;
          } catch (_) {}
          if (stop.requested) break;
          if (!clicked) {
            failed++;
            onStatus(profile.id, 'running',
              `⚠ Sound ${i + 1}/${links.length}: không thấy video nào trong lưới — bỏ qua.`);
            await interruptibleSleep(rand(minDelay, maxDelay), stop);
            continue;
          }
        }

        // Chờ thẻ <video> tải xong metadata để đọc thời lượng (tối đa ~10s).
        let duration = 0;
        for (let t = 0; t < 20 && !stop.requested; t++) {
          try {
            duration = await page.evaluate(() => {
              const v = document.querySelector('video');
              return (v && isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
            });
          } catch (_) { duration = 0; }
          if (duration > 0) break;
          await sleep(500);
        }
        if (stop.requested) break;

        // Đảm bảo video đang PHÁT (TikTok đôi khi chờ tương tác mới autoplay).
        try {
          await page.evaluate(() => {
            const v = document.querySelector('video');
            if (v && v.paused) v.play().catch(() => {});
          });
        } catch (_) {}

        // Xem một tỉ lệ % ngẫu nhiên trong khoảng đã cài. Không đọc được thời lượng
        // (video lỗi/bị chặn) → xem 10-20s rồi đi tiếp.
        const pct = rand(pctMin, pctMax + 1);
        const watchMs = duration > 0
          ? Math.round(duration * 1000 * pct / 100)
          : rand(10000, 20000);
        onStatus(profile.id, 'running',
          `Đang xem video ${i + 1}/${links.length} — ${Math.round(watchMs / 1000)}s`
          + (duration > 0 ? ` (${pct}% của ${Math.round(duration)}s)` : ' (không đọc được thời lượng)') + '...');
        await interruptibleSleep(watchMs, stop);
        if (stop.requested) break;
        watched++;

        // Thỉnh thoảng like theo tỉ lệ đã cài — CHỈ khi chưa like (aria-pressed).
        if (likePct > 0 && rand(0, 100) < likePct) {
          try {
            const didLike = await page.evaluate(() => {
              const el = document.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]');
              if (!el) return false;
              const btn = el.closest('button') || el;
              if (btn.getAttribute('aria-pressed') === 'true') return false;
              btn.click();
              return true;
            });
            if (didLike) { liked++; await interruptibleSleep(rand(500, 1500), stop); }
          } catch (_) {}
        }

        // Cuộn xuống các video tiếp theo như người thật lướt feed (video sau link gốc).
        // Mỗi lần cuộn chỉ nghỉ theo Delay rồi cuộn tiếp — không xem đủ %.
        if (scrollMax > 0 && !stop.requested) {
          const scrolls = rand(scrollMin, scrollMax + 1);
          for (let sc = 1; sc <= scrolls && !stop.requested; sc++) {
            if (!await scrollFeed(page)) break;
            if (sc % 5 === 0 || sc === scrolls) {
              onStatus(profile.id, 'running',
                `Video ${i + 1}/${links.length}: cuộn ${sc}/${scrolls} lần...`);
            }
            await interruptibleSleep(rand(minDelay, maxDelay), stop);
          }
        }

        // Nghỉ ngẫu nhiên giữa 2 video (dùng chung cài đặt delay của profile).
        if (i < links.length - 1) await interruptibleSleep(rand(minDelay, maxDelay), stop);
      }
    }

    await Promise.race([viewLoop(), stop.promise]);
    stop.stoppedEmitted = true;
    const tail = `${watched}/${links.length} video` + (liked ? `, like ${liked}` : '') + (failed ? `, lỗi ${failed}` : '');
    onStatus(profile.id, 'stopped', stop.requested
      ? `Đã dừng. Xem ${tail}.`
      : `✅ Đã xem xong ${tail}.`);
    return;
  }

  // Hàng đợi sound {url,name} chờ lấy số video.
  // QUEUE_MAX: đếm vốn chậm hơn quét (5-20s vs 2-3s/sound) → không giới hạn thì backlog
  // phình vô hạn qua đêm. Đầy → feedLoop tạm dừng cuộn chờ tab đếm tiêu bớt.
  const soundQueue = [];
  const QUEUE_MAX = 500;
  let localCount = 0;   // số sound profile NÀY tự quét được (feed) — hiển thị cột "Sound"
  let localChecked = 0; // số sound profile NÀY đã ĐI QUA bước đếm video (kể cả trả về '?')
                         // — hiển thị cột "Đã check". Tăng trong countLoop, không phải ở đây.

  // Báo counts hiện tại cho UI (cột Sound + Đã check trong bảng profile). status='counts'
  // là kênh RIÊNG, không kèm text — renderer chỉ cập nhật số, không đụng badge/log.
  function emitCounts() {
    onStatus(profile.id, 'counts', null, { scanned: localCount, checked: localChecked });
  }

  // Thêm 1 sound vào hàng đợi (lọc trùng theo key chuẩn hóa — gồm cả link nạp sẵn).
  // Trả về true nếu THỰC SỰ thêm mới (không phải trùng/bị lọc) — dùng để tránh log lặp
  // dòng "đã quét N sound" khi feed vẫn đứng ở đúng video/sound cũ (chưa cuộn sang video mới).
  function addSound(href, name) {
    if (!href) return false;
    // Rút gọn về link chuẩn NGAY từ đầu vào — bảng kết quả/Sheet/tab đếm đều dùng link ngắn.
    const url = canonicalSoundUrl(href.startsWith('http') ? href : 'https://www.tiktok.com' + href);
    // Bộ lọc Original Sound: bật → bỏ qua sound không phải original (nhạc bản quyền).
    if (originalOnly && !isOriginalSound(url, name)) return false;
    const key = normalizeKey(url);
    if (!key) return false;
    if (!_loggedFirstKey) {
      _loggedFirstKey = true;
      console.log(`[dedup] key sound đầu tiên = "${key}" | url = ${url} | đã có trong cache? ${_collected.has(key)} (cache đang giữ ${_collected.size} key)`);
    }
    if (_collected.has(key)) { _skippedDup++; return false; }
    _collected.add(key);
    _scannedThisRun++;
    localCount++;
    soundQueue.push({ url, name: name || '' });
    emitCounts();
    return true;
  }

  // ── Consumer chung: mở trang sound lấy số video → lọc → đẩy ra ──
  // MỌI chế độ: đếm số video bằng trình duyệt HEADLESS dùng chung (ẩn) — copy cookie từ
  // context của profile để trang /music/ tải đúng. Tránh mở tab đếm trong cửa sổ HIỆN
  // (sẽ nhấp nháy khi liên tục goto sang /music/) và nhẹ hơn.
  //
  // CHỐNG CHẾT QUA ĐÊM (2026-07-04 — app tắt không dấu vết sau ~6h, heap Node OOM):
  //   1. RECYCLE tab đếm sau mỗi COUNT_RECYCLE_EVERY sound: Playwright tích object
  //      Request/Route theo TỪNG lần điều hướng và chỉ giải phóng khi ĐÓNG TAB — tab
  //      đếm goto hàng nghìn lần/đêm mà không đóng → heap phình → V8 abort tức thì
  //      (không catch/log được). Bài học từ CrawlView ADR-009 (recycle mỗi 250 item).
  //   2. BACKOFF khi bị chặn mềm: nhiều sound LIÊN TIẾP đếm fail = TikTok đang chặn
  //      trang /music/ (log 2026-07-04 cho thấy gần như mọi sound đều phải retry suốt
  //      6h) → đấm tiếp chỉ bị chặn sâu hơn + nhân ba lượng điều hướng. Nghỉ tăng dần
  //      30s→2ph→5ph, đọc được 1 lần thì reset.
  const COUNT_RECYCLE_EVERY = 200;
  async function countLoop() {
    let sidePage = null, helper = null;
    async function newCountPage() {
      const p = await helper.ctx.newPage();
      await attachCountBlocker(p);
      return p;
    }
    try {
      // Truyền profilePath để tab đếm dùng ĐÚNG vân tay của profile (cùng cookie thì phải
      // cùng thiết bị, nếu không TikTok thấy 1 phiên chạy trên 2 máy → dễ hủy phiên).
      helper = await browser.acquireCountContext(ctx, profilePath);
      sidePage = await newCountPage();
    } catch (_) { if (helper) await browser.releaseCountContext(helper); return; }
    // Đóng tab đếm khi dừng → huỷ ngay goto đang chờ. Đọc sidePage ĐỘNG (closure) vì
    // tab được recycle định kỳ — phải đóng đúng tab hiện tại.
    if (stop.aborters) stop.aborters.push(() => { try { if (sidePage) sidePage.close(); } catch (_) {} });

    let counted = 0;      // số sound đã xử lý trên tab hiện tại (mốc recycle)
    let failStreak = 0;   // số sound LIÊN TIẾP không đọc được count (mốc backoff)
    const BLOCK_REQUEUE_MAX = 3; // số vòng giữ lại 1 sound khi bị chặn diện rộng trước khi bỏ thật

    // Nghỉ backoff khi bị chặn: 30s → 2ph → 5ph (trần) + jitter 0–50% (so le giữa các
    // profile để không cùng tỉnh dậy → cùng bắn lại → cùng bị chặn = kẹt 300s).
    async function blockBackoff() {
      const waits = [30000, 120000, 300000];
      const base = waits[Math.min(failStreak - 3, waits.length - 1)];
      const w = base + rand(0, Math.floor(base * 0.5));
      onStatus(profile.id, 'running',
        `TikTok đang chặn trang đếm (${failStreak} sound liên tiếp lỗi) — nghỉ ${Math.round(w / 1000)}s...`);
      await interruptibleSleep(w, stop);
    }

    while (!stop.requested) {
      const item = soundQueue.shift();
      if (!item) {
        if (stop.draining) break;   // dừng mềm + hàng đợi đã cạn → check xong, kết thúc
        await interruptibleSleep(400, stop);
        continue;
      }
      if (stop.draining) {
        onStatus(profile.id, 'running', `Dừng mềm: đang check nốt "${item.name}" (còn ${soundQueue.length} sound chờ)...`);
      }
      let raw = null;     // number CHÍNH XÁC từ API, hoặc string "88.1K" từ DOM fallback
      let dead = false;   // sound đã bị xóa/không tồn tại — KHÔNG phải bị chặn
      // XIN SLOT ĐẾM TOÀN CỤC: giới hạn số request /music/ đồng thời trên toàn app +
      // giãn nhịp → không dội IP khi chạy nhiều profile (nguyên nhân kẹt "nghỉ 300s").
      const gotSlot = await acquireCountSlot(stop);
      if (!gotSlot) break;   // đã yêu cầu dừng
      try {
        // ĐỌC QUA API (2026-07-06): trang /music/ tự gọi api/music/detail/ ngay khi tải.
        // Nghe response đó thay vì poll DOM: (a) có số CHÍNH XÁC (videoCount=88100 thay vì
        // text "88.1K" làm tròn), (b) về sớm ~1s, (c) phân biệt được sound CHẾT (API trả
        // body RỖNG — đã verify) với BỊ CHẶN (không có response).
        // Quy trình 2 BƯỚC (user chốt 2026-07-12): API lỗi → đọc GIAO DIỆN (DOM) trên chính
        // trang vừa tải → cả 2 đều lỗi → BỎ LINK LUÔN (không retry, không nhả dòng '?').
        try {
          // Đăng ký nghe TRƯỚC khi điều hướng để không lỡ response.
          const respPromise = sidePage
            .waitForResponse(r => r.url().includes('/api/music/detail/'), { timeout: 20000 })
            .catch(() => null);
          await sidePage.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          const resp = await respPromise;
          if (resp) {
            let body = '';
            try { body = await resp.text(); } catch (_) {}
            let j = null;
            try { j = JSON.parse(body); } catch (_) {}
            if (j && j.statusCode === 0 && j.musicInfo && j.musicInfo.stats
                && typeof j.musicInfo.stats.videoCount === 'number') {
              raw = j.musicInfo.stats.videoCount;
            } else if (!body.trim() || resp.status() === 400
                       || (j && (j.statusCode === 10201 || j.statusCode === 10202))) {
              // Sound chết/không tồn tại — đã verify thực tế: HTTP 400 + statusCode
              // 10201 (hoặc body rỗng). KHÔNG phải bị chặn → không phạt/backoff.
              dead = true;
            }
            // Trường hợp khác (statusCode lạ) → để raw=null, rơi xuống bước đọc DOM.
          }
          // BƯỚC 2: API không có kết quả → đọc GIAO DIỆN (DOM) trên trang vừa tải.
          if (raw === null && !dead && !stop.requested) {
            for (let i = 0; i < 6 && !stop.requested; i++) {
              const t = await readVideoCount(sidePage);
              if (t) { raw = t; break; }
              await sleep(500);
            }
          }
        } catch (_) {}
      } finally {
        releaseCountSlot();
      }

      // Cập nhật chuỗi fail + phạt tốc độ TOÀN CỤC trước khi quyết định bỏ/giữ.
      // Sound CHẾT tính là "server phản hồi bình thường" → không phạt, không backoff.
      if (raw !== null || dead) {
        failStreak = 0;
        countPenaltyDown();   // đọc được → nới tốc độ chung dần
      } else if (!stop.requested) {
        failStreak++;
        countPenaltyUp();     // bị chặn → chậm tốc độ chung dần (mọi profile)
      }

      // FAIL DÂY CHUYỀN (≥3 sound liên tiếp lỗi = TikTok đang chặn cả trang /music/, sound
      // vô tội) → KHÔNG bỏ oan: trả về ĐẦU hàng đợi làm "chim canh", nghỉ backoff rồi thử
      // lại CHÍNH NÓ (đọc được = hết chặn). Tối đa BLOCK_REQUEUE_MAX vòng/sound rồi mới bỏ
      // thật. Fail ĐƠN LẺ (streak 1–2, xung quanh vẫn đọc được) → rơi xuống dưới bỏ luôn
      // (user chốt 2026-07-12); lớp giữ-khi-chặn bổ sung 2026-07-14 sau phân tích rủi ro
      // mất hàng loạt sound trong đợt chặn kéo dài.
      if (raw === null && !dead && !stop.requested && failStreak >= 3
          && (item.blockRetries || 0) < BLOCK_REQUEUE_MAX) {
        item.blockRetries = (item.blockRetries || 0) + 1;
        soundQueue.unshift(item);
        onStatus(profile.id, 'running',
          `Đang bị chặn — giữ lại "${item.name}" thử vòng ${item.blockRetries}/${BLOCK_REQUEUE_MAX} sau khi nghỉ...`);
        await blockBackoff();
        continue;   // KHÔNG tính "đã check", KHÔNG bỏ — tỉnh dậy thử lại chính sound này
      }

      // Tính là "đã check" ngay khi đi qua bước đếm — KỂ CẢ link bị bỏ (chết/không đọc được).
      // Đặt sau finally (không tính item bị bỏ dở vì stop lúc đang xin slot ở trên).
      localChecked++;
      emitCounts();

      // Cả API lẫn DOM đều không ra số → BỎ LINK (không còn dòng '?' trong bảng/Sheet).
      if (raw === null) {
        if (!stop.requested) {
          onStatus(profile.id, 'running', dead
            ? `Bỏ "${item.name}" (sound đã bị xóa/không tồn tại)`
            : `Bỏ "${item.name}" (không lấy được số video — API lẫn giao diện đều lỗi)`);
        }
      } else {
        // API trả number chính xác → dùng thẳng; DOM fallback trả text → parse "88.1K".
        const count = typeof raw === 'number' ? raw : parseCount(raw);
        let emit = true;
        if (typeof count === 'number') {
          if (minVideos > 0 && count < minVideos) {                // bỏ nếu nhỏ hơn ngưỡng tối thiểu
            onStatus(profile.id, 'running', `Bỏ "${item.name}" (${count} < ${minVideos} video)`);
            emit = false;
          } else if (maxVideos > 0 && count > maxVideos) {         // bỏ nếu lớn hơn ngưỡng tối đa
            onStatus(profile.id, 'running', `Bỏ "${item.name}" (${count} > ${maxVideos} video)`);
            emit = false;
          }
        }
        if (emit) onData({ url: item.url, name: item.name, count, profileId: profile.id, profileName: profile.name });
      }

      // (1) RECYCLE tab đếm định kỳ — xả object Playwright tích tụ.
      if (++counted >= COUNT_RECYCLE_EVERY && !stop.requested) {
        counted = 0;
        try { await sidePage.close(); } catch (_) {}
        try {
          sidePage = await newCountPage();
          console.log(`[count] Recycle tab đếm sau ${COUNT_RECYCLE_EVERY} sound (xả bộ nhớ).`);
        } catch (_) { break; }   // context/browser đã đóng → thoát loop
      }

      // (2) Vẫn nghỉ backoff khi đang trong đợt chặn mà sound này đã HẾT vòng giữ (bị bỏ
      // thật sau BLOCK_REQUEUE_MAX lần thử) — tránh đấm tiếp làm TikTok chặn sâu hơn.
      // (Cập nhật failStreak/penalty đã dời lên TRƯỚC khối quyết định bỏ/giữ ở trên.)
      if (raw === null && !dead && !stop.requested && failStreak >= 3) {
        await blockBackoff();
      }
    }
    try { if (sidePage) await sidePage.close(); } catch (_) {}
    if (helper) await browser.releaseCountContext(helper);
  }

  // ════════ Chế độ QUÉT ⇄ XEM TỰ ĐỘNG (chu kỳ lặp) ════════
  // Luân phiên: quét For You trong `cycleScanHours` giờ → chuyển sang xem video (dùng
  // danh sách viewLinks đã cấu hình, lặp lại nếu hết mà chưa hết giờ) trong
  // `cycleViewMinutes` phút → quay lại quét... lặp vô hạn tới khi Dừng. countLoop chạy
  // NỀN LIÊN TỤC suốt cả 2 pha (đếm sound tồn đọng ngay cả khi đang ở pha xem).
  if (mode === 'cycle') {
    // opts.cycleScanHours/cycleViewMinutes đã được startProfile chuẩn hóa (chặn 0/âm/NaN) —
    // KHÔNG áp thêm sàn cứng ở đây (bug cũ: lỡ ép sàn 1 giờ/1 phút đè lên cấu hình thật).
    const scanMs = (opts.cycleScanHours || 5) * 3600000;
    const viewMs = (opts.cycleViewMinutes || 30) * 60000;
    // Nghỉ giải lao giữa 2 pha (user chốt 2026-07-12): cả 2 chiều Quét→Xem và Xem→Quét,
    // thời gian ngẫu nhiên trong khoảng [breakMin, breakMax] phút, max=0 → không nghỉ.
    const brkMinMs = Math.max(0, opts.cycleBreakMin || 0) * 60000;
    const brkMaxMs = Math.max(brkMinMs, (opts.cycleBreakMax || 0) * 60000);
    const links = opts.viewLinks || [];
    const pctMin = Math.max(1, Math.min(100, opts.viewPctMin || 40));
    const pctMax = Math.max(pctMin, Math.min(100, opts.viewPctMax || 70));
    const likePct = Math.max(0, Math.min(100, opts.viewLikePct || 0));
    const scrollMin = Math.max(0, opts.viewScrollMin || 0);
    const scrollMax = Math.max(scrollMin, opts.viewScrollMax || 0);
    let viewWatched = 0, viewLiked = 0;

    // Bật/tắt chặn ảnh/media RIÊNG cho từng pha: pha Quét có thể chặn (giảm RAM), pha
    // Xem BẮT BUỘC không chặn (phải tải được video mới xem/đọc thời lượng).
    let blockerOn = false;
    async function ensureBlocker(want) {
      if (want === blockerOn) return;
      if (want) { await attachCountBlocker(page); } else { try { await page.unroute('**/*'); } catch (_) {} }
      blockerOn = want;
    }

    // Cờ báo phát hiện chế độ khách trong pha Quét → cắt cả chu kỳ (xem cycleLoop).
    let guestDetected = false;
    // ── Pha QUÉT: mở For You, cuộn tới khi hết deadline hoặc Dừng ──
    async function scanPhase(deadlineAt) {
      const stop = scanStop; // Dừng mềm: pha quét coi draining như lệnh dừng (shadow có chủ đích)
      if (blockImages) await ensureBlocker(true);
      onStatus(profile.id, 'running', 'Chu kỳ: mở For You để quét...');
      try {
        await page.goto(TIKTOK_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (e) {
        if (!stop.requested) onStatus(profile.id, 'running', `Chu kỳ [Quét]: lỗi mở TikTok (${e.message}) — bỏ qua pha này.`);
        return;
      }
      let feedReady = false;
      for (let attempt = 0; attempt < 2 && !stop.requested && Date.now() < deadlineAt; attempt++) {
        try {
          await page.waitForSelector('a[data-e2e="video-music"]', { timeout: 30000 });
          feedReady = true;
          break;
        } catch (_) {
          if (attempt === 0 && !stop.requested) {
            // PHẢI ghi log: lần tải lại này đưa feed về đầu, không báo gì thì người dùng
            // thấy tab "tự nhảy lên trên" mà log trắng trơn (bug đã gặp — bản sao từ chế độ
            // For You có dòng log này nhưng lúc chép sang chu kỳ bị rơi mất).
            onStatus(profile.id, 'running', 'Chu kỳ [Quét]: feed chưa hiện, tải lại trang rồi thử lại...');
            try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (_) {}
          }
        }
      }
      if (!feedReady) {
        if (!stop.requested) onStatus(profile.id, 'running', 'Chu kỳ [Quét]: không thấy video nào — bỏ qua pha này.');
        return;
      }
      // Đang ở chế độ KHÁCH thì feed chỉ có 1-2 video, cào cũng vô ích → dừng hẳn, báo rõ.
      {
        const s = await checkLoginState(page);
        if (!stop.requested && s === 'guest') { guestDetected = true; return; }
        if (s === 'logged-in') browser.markSessionVerified(profilePath);
      }
      await page.bringToFront().catch(() => {});

      let scrolls = 0;
      const tracker = makeFeedTracker();
      const watchLogin = makeLoginWatcher(page, profilePath);
      while (!stop.requested && Date.now() < deadlineAt) {
        while (soundQueue.length >= QUEUE_MAX && !stop.requested && Date.now() < deadlineAt) {
          await interruptibleSleep(1000, stop);
        }
        if (stop.requested || Date.now() >= deadlineAt) break;
        // Phiên chết giữa chừng → cắt cả chu kỳ (báo lỗi ở cuối khối cycle).
        if (await watchLogin() === 'guest') { guestDetected = true; return; }
        let data = null;
        try { data = await readActiveSound(page); } catch (_) {}
        const isNew = !!(data && data.href && addSound(data.href, data.name));
        if (isNew) onStatus(profile.id, 'running', `Chu kỳ [Quét]: đã quét ${localCount} sound...`);
        const stuck = tracker.track(data && data.href, isNew);
        const st = tracker.dueStats();
        if (st) onStatus(profile.id, 'running', `Chu kỳ [Quét]: ${st}.`);
        if (stop.requested) break;
        if (stuck) {
          const reloaded = await handleStuck(page, tracker, {
            profileId: profile.id, onStatus, prefix: 'Chu kỳ [Quét]: ',
            waitSelector: 'a[data-e2e="video-music"]', allowReload: true, stop,
          });
          if (reloaded) scrolls = 0;
          continue;
        }
        await scrollFeed(page);
        await interruptibleSleep(rand(minDelay, maxDelay), stop);
        if (recycleEvery > 0 && ++scrolls >= recycleEvery && !stop.requested && Date.now() < deadlineAt) {
          scrolls = 0;
          onStatus(profile.id, 'running', `Chu kỳ [Quét]: tải lại để xả RAM (đã quét ${localCount} sound)...`);
          await recyclePage(page, 'a[data-e2e="video-music"]', stop);
        }
      }
    }

    // ── Pha XEM: lặp qua danh sách viewLinks (lặp lại từ đầu nếu hết mà chưa hết giờ) ──
    async function viewPhase(deadlineAt) {
      const stop = scanStop; // Dừng mềm: pha xem coi draining như lệnh dừng (shadow có chủ đích)
      await ensureBlocker(false);
      if (!links.length) {
        onStatus(profile.id, 'running', 'Chu kỳ [Xem]: chưa cấu hình link để xem — bỏ qua pha này.');
        return;
      }
      onStatus(profile.id, 'running', `Chu kỳ: chuyển sang xem video (${links.length} link đã cấu hình)...`);
      let i = 0;
      while (!stop.requested && Date.now() < deadlineAt) {
        const url = links[i % links.length];
        const label = `${(i % links.length) + 1}/${links.length}`;
        i++;
        onStatus(profile.id, 'running', `Chu kỳ [Xem]: mở link ${label}...`);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (_) {
          if (stop.requested) break;
          await interruptibleSleep(rand(minDelay, maxDelay), stop);
          continue;
        }

        if (/\/music\//i.test(url)) {
          let clicked = false;
          try {
            const grid = page.locator('[data-e2e="music-item"] a[href*="/video/"]');
            await grid.first().waitFor({ timeout: 30000 });
            await interruptibleSleep(rand(800, 2000), stop);
            if (stop.requested || Date.now() >= deadlineAt) break;
            const n = await grid.count();
            const pick = rand(0, n);
            await grid.nth(pick).click({ timeout: 10000 });
            clicked = true;
          } catch (_) {}
          if (stop.requested) break;
          if (!clicked) { await interruptibleSleep(rand(minDelay, maxDelay), stop); continue; }
        }

        let duration = 0;
        for (let t = 0; t < 20 && !stop.requested && Date.now() < deadlineAt; t++) {
          try {
            duration = await page.evaluate(() => {
              const v = document.querySelector('video');
              return (v && isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
            });
          } catch (_) { duration = 0; }
          if (duration > 0) break;
          await sleep(500);
        }
        if (stop.requested) break;
        try {
          await page.evaluate(() => {
            const v = document.querySelector('video');
            if (v && v.paused) v.play().catch(() => {});
          });
        } catch (_) {}

        const pct = rand(pctMin, pctMax + 1);
        const watchMsFull = duration > 0 ? Math.round(duration * 1000 * pct / 100) : rand(10000, 20000);
        // Không xem tràn qua deadline của pha — cắt ngắn nếu sắp hết giờ.
        const watchMs = Math.max(0, Math.min(watchMsFull, deadlineAt - Date.now()));
        onStatus(profile.id, 'running', `Chu kỳ [Xem]: đang xem video ${label} — ${Math.round(watchMs / 1000)}s...`);
        await interruptibleSleep(watchMs, stop);
        if (stop.requested) break;
        viewWatched++;

        if (likePct > 0 && rand(0, 100) < likePct) {
          try {
            const didLike = await page.evaluate(() => {
              const el = document.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]');
              if (!el) return false;
              const btn = el.closest('button') || el;
              if (btn.getAttribute('aria-pressed') === 'true') return false;
              btn.click();
              return true;
            });
            if (didLike) { viewLiked++; await interruptibleSleep(rand(500, 1500), stop); }
          } catch (_) {}
        }

        if (scrollMax > 0 && !stop.requested && Date.now() < deadlineAt) {
          const scrolls = rand(scrollMin, scrollMax + 1);
          for (let sc = 1; sc <= scrolls && !stop.requested && Date.now() < deadlineAt; sc++) {
            if (!await scrollFeed(page)) break;
            await interruptibleSleep(rand(minDelay, maxDelay), stop);
          }
        }
        if (!stop.requested && Date.now() < deadlineAt) await interruptibleSleep(rand(minDelay, maxDelay), stop);
      }
    }

    // countLoop chạy NỀN suốt cả chu kỳ (không bị bó buộc theo deadline từng pha).
    const countLoopDone = countLoop();
    // Báo mốc thời gian kết thúc pha hiện tại cho UI (kênh RIÊNG 'phase', giống 'counts') —
    // renderer tự đếm ngược từ deadlineAt, không cần backend gửi lặp lại mỗi giây.
    function emitPhase(phaseLabel, nextLabel, deadlineAt) {
      onStatus(profile.id, 'phase', null, { phaseLabel, nextLabel, deadlineAt });
    }
    // Giờ:phút:giây theo múi giờ máy — ghi kèm vào dòng log "bắt đầu pha..." để thấy ngay mốc
    // chuyển pha mà KHÔNG cần nhìn badge (khung log không tự đếm ngược, chỉ ghi 1 lần/pha).
    const fmtClock = (ts) => new Date(ts).toLocaleTimeString('vi-VN');
    // Nghỉ giải lao giữa 2 pha: đứng yên tại trang hiện tại (không điều hướng/cuộn — như
    // người rời máy), tab đếm vẫn chạy nền. Chip pha hiện "Nghỉ · còn Xp → <pha kế>".
    async function breakPhase(nextLabel) {
      const stop = scanStop; // Dừng mềm: cắt ngang giờ nghỉ (shadow có chủ đích)
      if (brkMaxMs <= 0 || stop.requested) return;
      const ms = rand(brkMinMs, brkMaxMs + 1);
      const deadline = Date.now() + ms;
      onStatus(profile.id, 'running',
        `Chu kỳ: nghỉ giải lao ${(ms / 60000).toFixed(1)} phút (vào pha ${nextLabel.toUpperCase()} lúc ${fmtClock(deadline)})...`);
      emitPhase('Nghỉ', nextLabel, deadline);
      await interruptibleSleep(ms, stop);
    }
    const cycleLoop = (async () => {
      const stop = scanStop; // Dừng mềm: kết thúc chu kỳ, để countLoop check nốt (shadow có chủ đích)
      let round = 0;
      while (!stop.requested) {
        round++;
        const scanDeadline = Date.now() + scanMs;
        onStatus(profile.id, 'running',
          `Chu kỳ #${round}: bắt đầu pha QUÉT (${(scanMs / 3600000).toFixed(1)} giờ, kết thúc lúc ${fmtClock(scanDeadline)})...`);
        emitPhase('Quét', 'Xem', scanDeadline);
        await scanPhase(scanDeadline);
        if (guestDetected) break;   // chế độ khách → thoát chu kỳ, báo lỗi ở dưới
        if (stop.requested) break;
        await breakPhase('Xem');
        if (stop.requested) break;
        const viewDeadline = Date.now() + viewMs;
        onStatus(profile.id, 'running',
          `Chu kỳ #${round}: bắt đầu pha XEM (${Math.round(viewMs / 60000)} phút, kết thúc lúc ${fmtClock(viewDeadline)})...`);
        emitPhase('Xem', 'Quét', viewDeadline);
        await viewPhase(viewDeadline);
        if (stop.requested) break;
        await breakPhase('Quét');
        if (stop.requested) break;
      }
    })();

    await Promise.race([Promise.all([cycleLoop, countLoopDone]), stop.promise]);
    stop.stoppedEmitted = true;
    if (guestDetected && !stop.requested) {
      onStatus(profile.id, 'error',
        'Profile đang ở chế độ KHÁCH (chưa đăng nhập) — TikTok chỉ cho xem 1-2 video nên không quét được gì. '
        + 'Hãy bấm 🦊 để đăng nhập lại rồi chạy lại.');
      return;
    }
    onStatus(profile.id, 'stopped',
      `Đã dừng (chu kỳ). Quét ${localCount} sound, xem ${viewWatched} video`
      + (viewLiked ? `, like ${viewLiked}` : '') + '.');
    return;
  }

  // ════════ Chế độ CÀO TRÊN TAB ĐANG MỞ ════════
  if (mode === 'current') {
    await page.bringToFront().catch(() => {});
    onStatus(profile.id, 'running', 'Đang cào trên tab đang mở...');

    async function feedLoop() {
      const stop = scanStop; // Dừng mềm: ngừng cuộn ngay, countLoop check nốt (shadow có chủ đích)
      const tracker = makeFeedTracker();
      while (!stop.requested) {
        // Queue đầy → tạm dừng cuộn, chờ tab đếm tiêu bớt (chống backlog vô hạn).
        while (soundQueue.length >= QUEUE_MAX && !stop.requested) {
          await interruptibleSleep(1000, stop);
        }
        let data = null;
        try { data = await readActiveSound(page); } catch (_) {}
        const isNew = !!(data && data.href && addSound(data.href, data.name));
        if (isNew) onStatus(profile.id, 'running', `Đã quét ${localCount} sound...`);
        const stuck = tracker.track(data && data.href, isNew);
        const st = tracker.dueStats();
        if (st) onStatus(profile.id, 'running', st.charAt(0).toUpperCase() + st.slice(1) + '.');
        if (stuck) {
          // Chế độ 'current' = TAB CỦA NGƯỜI DÙNG → chỉ cấp 1/2, tuyệt đối KHÔNG tự tải lại.
          await handleStuck(page, tracker, {
            profileId: profile.id, onStatus, prefix: '',
            waitSelector: null, allowReload: false, stop,
          });
        }
        if (stop.requested) break;
        await scrollFeed(page);
        await interruptibleSleep(rand(minDelay, maxDelay), stop);
      }
    }

    // Đua loop với tín hiệu Dừng: stop → resolve ngay, không chờ loop tháo gỡ (loop nền tự thoát).
    await Promise.race([Promise.all([feedLoop(), countLoop()]), stop.promise]);
    stop.stoppedEmitted = true;
    onStatus(profile.id, 'stopped', `Đã dừng (giữ trình duyệt mở). Quét ${localCount} sound.`);
    return;
  }

  // ════════ Chế độ TÌM KIẾM ════════
  // Gõ tìm kiếm thật: mở trang chủ → bấm nút search → gõ từ khóa → Enter
  // → click tab Videos → click video đầu tiên → cuộn như For You.
  if (mode === 'search') {
    onStatus(profile.id, 'running', `Mở trang chủ để tìm "${keyword}"...`);
    try {
      await page.goto(TIKTOK_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      if (!stop.requested) onStatus(profile.id, 'error', `Lỗi mở TikTok: ${e.message}`);
      return;
    }
    await page.bringToFront().catch(() => {});

    try { await page.click('[data-e2e="nav-search"]', { timeout: 15000 }); } catch (_) {}
    await interruptibleSleep(1200, stop);

    onStatus(profile.id, 'running', `Gõ từ khóa "${keyword}"...`);
    try {
      const input = page.locator('input[data-e2e="search-user-input"]:visible').first();
      await input.click({ timeout: 15000 });
      await input.fill(keyword);
      await interruptibleSleep(500, stop);
      await page.keyboard.press('Enter');
    } catch (e) {
      if (!stop.requested) onStatus(profile.id, 'error', `Không gõ được từ khóa: ${e.message}`);
      return;
    }

    onStatus(profile.id, 'running', 'Chuyển sang tab Videos...');
    try {
      const videosTab = page.locator('[class*="tux-tabbar-item"]').filter({ hasText: /^Videos$/ }).first();
      await videosTab.waitFor({ timeout: 30000 });
      await videosTab.click();
      await interruptibleSleep(1500, stop);
    } catch (_) {
      // Không thấy tab → vẫn thử lấy video từ kết quả hiện tại (tab Top).
    }

    let firstVideo;
    try {
      firstVideo = page.locator(
        '[data-e2e="search_video-item"] a[href*="/video/"], '
        + '[data-e2e="search_top-item"] a[href*="/video/"]').first();
      await firstVideo.waitFor({ timeout: 30000 });
    } catch (_) {
      if (!stop.requested) onStatus(profile.id, 'error', 'Không thấy kết quả video.');
      return;
    }
    onStatus(profile.id, 'running', 'Mở video đầu tiên...');
    try {
      await firstVideo.click();
    } catch (e) {
      if (!stop.requested) onStatus(profile.id, 'error', `Không mở được video đầu tiên: ${e.message}`);
      return;
    }
    try {
      await page.waitForSelector('a[data-e2e="video-music"], a[aria-label][href*="/music/"]', { timeout: 30000 });
    } catch (_) {
      if (!stop.requested) onStatus(profile.id, 'error', 'Không thấy sound trong trình phát.');
      return;
    }

    async function feedLoop() {
      const stop = scanStop; // Dừng mềm: ngừng cuộn ngay, countLoop check nốt (shadow có chủ đích)
      onStatus(profile.id, 'running', 'Bắt đầu thu thập...');
      let scrolls = 0;
      const tracker = makeFeedTracker();
      const SEL = 'a[data-e2e="video-music"], a[aria-label][href*="/music/"]';
      while (!stop.requested) {
        // Queue đầy → tạm dừng cuộn, chờ tab đếm tiêu bớt (chống backlog vô hạn).
        while (soundQueue.length >= QUEUE_MAX && !stop.requested) {
          await interruptibleSleep(1000, stop);
        }
        let data = null;
        try { data = await readActiveSound(page); } catch (_) {}
        const isNew = !!(data && data.href && addSound(data.href, data.name));
        if (isNew) onStatus(profile.id, 'running', `Tìm "${keyword}": đã quét ${localCount} sound...`);
        const stuck = tracker.track(data && data.href, isNew);
        const st = tracker.dueStats();
        if (st) onStatus(profile.id, 'running', `Tìm "${keyword}": ${st}.`);
        if (stop.requested) break;
        if (stuck) {
          const reloaded = await handleStuck(page, tracker, {
            profileId: profile.id, onStatus, prefix: `Tìm "${keyword}": `,
            waitSelector: SEL, allowReload: true, stop,
          });
          if (reloaded) scrolls = 0;
          continue;
        }
        await scrollFeed(page);
        await interruptibleSleep(rand(minDelay, maxDelay), stop);
        if (recycleEvery > 0 && ++scrolls >= recycleEvery && !stop.requested) {
          scrolls = 0;
          onStatus(profile.id, 'running', `Tải lại để xả RAM (đã quét ${localCount} sound)...`);
          await recyclePage(page, SEL, stop);
        }
      }
    }

    // Đua loop với tín hiệu Dừng: stop → resolve ngay, không chờ loop tháo gỡ (loop nền tự thoát).
    await Promise.race([Promise.all([feedLoop(), countLoop()]), stop.promise]);
    stop.stoppedEmitted = true;
    onStatus(profile.id, 'stopped', `Đã dừng. Quét ${localCount} sound.`);
    return;
  }

  // ════════ Chế độ FOR YOU (mặc định) ════════
  onStatus(profile.id, 'running', 'Đang mở trang chủ TikTok...');
  try {
    await page.goto(TIKTOK_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    if (!stop.requested) onStatus(profile.id, 'error', `Lỗi mở TikTok: ${e.message}`);
    return;
  }
  // Chờ feed xuất hiện; nếu chậm/lỗi (đôi khi xảy ra khi chặn video), tải lại 1 lần rồi thử lại.
  let feedReady = false;
  for (let attempt = 0; attempt < 2 && !stop.requested; attempt++) {
    try {
      await page.waitForSelector('a[data-e2e="video-music"]', { timeout: 30000 });
      feedReady = true;
      break;
    } catch (_) {
      if (attempt === 0 && !stop.requested) {
        onStatus(profile.id, 'running', 'Feed chưa hiện, tải lại trang rồi thử lại...');
        try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (_) {}
      }
    }
  }
  if (!feedReady) {
    if (!stop.requested) onStatus(profile.id, 'error', 'Không thấy video nào (có thể bị chặn/đăng nhập lại).');
    return;
  }
  // Chế độ KHÁCH → feed chỉ 1-2 video, cào vô ích → dừng ngay và nói rõ lý do.
  {
    const s = await checkLoginState(page);
    if (!stop.requested && s === 'guest') {
      onStatus(profile.id, 'error',
        'Profile đang ở chế độ KHÁCH (chưa đăng nhập) — TikTok chỉ cho xem 1-2 video nên không quét được gì. '
        + 'Hãy bấm 🦊 để đăng nhập lại rồi chạy lại.');
      return;
    }
    // Đăng nhập THẬT (đã xác minh trên trang, không phải chỉ có cookie) → chốt phiên VÀNG
    // để lần sau phiên hỏng còn có chỗ khôi phục.
    if (s === 'logged-in') browser.markSessionVerified(profilePath);
  }
  await page.bringToFront().catch(() => {});

  async function feedLoop() {
    const stop = scanStop; // Dừng mềm: ngừng cuộn ngay, countLoop check nốt (shadow có chủ đích)
    onStatus(profile.id, 'running', 'Bắt đầu thu thập...');
    let scrolls = 0;
    const tracker = makeFeedTracker();
    const watchLogin = makeLoginWatcher(page, profilePath);
    while (!stop.requested) {
      // Queue đầy → tạm dừng cuộn, chờ tab đếm tiêu bớt (chống backlog vô hạn).
      while (soundQueue.length >= QUEUE_MAX && !stop.requested) {
        await interruptibleSleep(1000, stop);
      }
      // Phiên có thể chết GIỮA CHỪNG → kiểm tra định kỳ, tụt xuống khách thì dừng ngay.
      if (await watchLogin() === 'guest') {
        onStatus(profile.id, 'error',
          'Phiên đăng nhập BỊ HỦY giữa chừng (TikTok chuyển sang chế độ khách) — thường do profile '
          + 'đang chạy trùng ở máy khác hoặc đổi vùng VPN. Hãy bấm 🦊 đăng nhập lại.');
        return;
      }
      let data = null;
      try { data = await readActiveSound(page); } catch (_) {}
      const isNew = !!(data && data.href && addSound(data.href, data.name));
      if (isNew) onStatus(profile.id, 'running', `Đã quét ${localCount} sound...`);
      const stuck = tracker.track(data && data.href, isNew);
      const st = tracker.dueStats();
      if (st) onStatus(profile.id, 'running', st.charAt(0).toUpperCase() + st.slice(1) + '.');
      if (stop.requested) break;
      if (stuck) {
        const reloaded = await handleStuck(page, tracker, {
          profileId: profile.id, onStatus, prefix: '',
          waitSelector: 'a[data-e2e="video-music"]', allowReload: true, stop,
        });
        if (reloaded) scrolls = 0;
        continue;
      }
      await scrollFeed(page);
      await interruptibleSleep(rand(minDelay, maxDelay), stop);
      if (recycleEvery > 0 && ++scrolls >= recycleEvery && !stop.requested) {
        scrolls = 0;
        onStatus(profile.id, 'running', `Tải lại feed để xả RAM (đã quét ${localCount} sound)...`);
        await recyclePage(page, 'a[data-e2e="video-music"]', stop);
      }
    }
  }

  await Promise.race([Promise.all([feedLoop(), countLoop()]), stop.promise]);
  stop.stoppedEmitted = true;
  onStatus(profile.id, 'stopped', `Đã dừng. Quét ${localCount} sound.`);
}

// ── Bắt đầu 1 profile (độc lập). Trả {ok,msg}. ──
// params: { profileId, mode, keyword, minDelay, maxDelay, headless, minVideos, originalOnly, seedUrls }
function startProfile(params, onData, onStatus) {
  const profileId = params.profileId;
  if (!profileId) return { ok: false, msg: 'Thiếu profileId.' };
  if (_active.has(profileId)) return { ok: false, msg: 'Profile đang chạy.' };

  const all = loadProfiles();
  const profile = all.find(p => p.id === profileId);
  if (!profile) return { ok: false, msg: 'Profile không tồn tại.' };

  const mode = params.mode || 'foryou';
  const keyword = (params.keyword || '').trim();
  if (mode === 'search' && !keyword) return { ok: false, msg: 'Chưa nhập từ khóa tìm kiếm.' };

  // Chế độ Xem video / Quét⇄Xem: cần danh sách link video hợp lệ.
  let viewLinks = [];
  if (mode === 'view' || mode === 'cycle') {
    viewLinks = (params.viewLinks || [])
      .map(u => String(u || '').trim())
      .filter(u => /^https?:\/\//i.test(u));
    if (!viewLinks.length) {
      const hint = mode === 'cycle' ? 'dán danh sách link cho pha Xem của chu kỳ' : 'dán danh sách link';
      return { ok: false, msg: `Chưa nhập link sound để xem (mở ⚙️ ${hint}).` };
    }
  }

  // Profile đầu tiên của phiên → reset bộ đếm + nạp seed lọc trùng từ Sheet.
  if (_active.size === 0) {
    _scannedThisRun = 0;
    _skippedDup = 0;
    _loggedFirstKey = false;
    _collected.clear();
    for (const u of (params.seedUrls || [])) { const k = normalizeKey(u); if (k) _collected.add(k); }
    _seedCount = _collected.size;
    console.log(`[dedup] Phiên mới — nạp ${_seedCount} key từ Sheet để lọc trùng.`
      + (_seedCount ? ` Ví dụ: ${[..._collected].slice(0, 3).join(', ')}` : ''));
  }

  // stop.promise resolve ngay khi nhấn Dừng → dùng để "đua" với vòng lặp, phát 'stopped'
  // tức thì kể cả khi một thao tác Playwright còn kẹt (loop nền sẽ tự thoát sau).
  const stop = { requested: false };
  stop.promise = new Promise(res => { stop._resolve = res; });
  // Giữ onStatus để stopProfile()/stopAll() có thể báo "Đã dừng" NGAY LẬP TỨC khi profile
  // còn đang ở bước khởi động (chưa có stop.aborters để hủy) — xem chỗ dùng bên dưới.
  _active.set(profileId, { stop, mode, name: profile.name, onStatus });

  const opts = {
    minDelay: params.minDelay ?? 2000,
    maxDelay: params.maxDelay ?? 3000,
    headless: !!params.headless,
    minVideos: params.minVideos ?? 0,
    maxVideos: params.maxVideos ?? 0,
    mode,
    keyword,
    originalOnly: !!params.originalOnly,
    blockImages: !!params.blockImages,
    recycleEvery: params.recycleEvery === 0 ? 0 : Math.max(0, parseInt(params.recycleEvery, 10) || RECYCLE_EVERY_DEFAULT),
    viewLinks,
    viewPctMin: params.viewPctMin ?? 40,
    viewPctMax: params.viewPctMax ?? 70,
    viewLikePct: params.viewLikePct ?? 0,
    viewScrollMin: params.viewScrollMin ?? 0,
    viewScrollMax: params.viewScrollMax ?? 0,
    // Sàn chỉ để chặn 0/âm/NaN (không ép buộc tối thiểu thực tế) — giữ linh hoạt cho test/cấu hình đặc biệt.
    cycleScanHours: Math.max(0.001, parseFloat(params.cycleScanHours) || 5),
    cycleViewMinutes: Math.max(0.01, parseFloat(params.cycleViewMinutes) || 30),
    // Nghỉ giải lao giữa 2 pha (phút) — 0/không cấu hình = không nghỉ.
    cycleBreakMin: Math.max(0, parseFloat(params.cycleBreakMin) || 0),
    cycleBreakMax: Math.max(0, parseFloat(params.cycleBreakMax) || 0),
  };

  // Chạy nền — KHÔNG await. Mỗi profile độc lập.
  crawlOneProfile(profile, opts, onData, onStatus, stop)
    .catch(e => onStatus(profileId, 'error', e.message))
    .finally(async () => {
      _active.delete(profileId);
      // Nếu đã yêu cầu dừng nhưng chưa kịp phát 'stopped' (vd dừng lúc đang điều hướng
      // ban đầu → thoát sớm) → phát ở đây để UI cập nhật ngay (gỡ trạng thái "Đang dừng...").
      if (stop.requested && !stop.stoppedEmitted) {
        onStatus(profileId, 'stopped', 'Đã dừng.');
      }
      // Đóng context của profile này (trừ chế độ 'current' — giữ trình duyệt user tự mở).
      if (mode !== 'current') {
        try {
          const pp = getProfilePath(profileId);
          if (pp) await browser.releaseProfileContext(pp);
        } catch (_) {}
      }
      // Khi không còn profile nào chạy → báo tổng kết phiên.
      if (_active.size === 0) {
        onStatus(null, 'all-done',
          `Hoàn tất phiên. Đã quét ${_scannedThisRun} sound mới. Bỏ qua ${_skippedDup} link trùng`
          + (_seedCount ? ` (đã nạp ${_seedCount} link cũ từ Sheet)` : '') + '.');
      }
    });

  const label = mode === 'search' ? `tìm "${keyword}"`
    : mode === 'current' ? 'tab đang mở'
    : mode === 'view' ? `xem ${viewLinks.length} video`
    : mode === 'cycle' ? `chu kỳ quét ⇄ xem (${opts.cycleScanHours}h / ${opts.cycleViewMinutes}p)`
    : 'For You';
  return { ok: true, msg: `Đã bắt đầu "${profile.name}" (${label}).` };
}

// ── Dừng 1 profile ──
function stopProfile(profileId) {
  const entry = _active.get(profileId);
  if (!entry) return { ok: false, msg: 'Profile không chạy.' };
  entry.stop.requested = true; // loop tự thoát; trình duyệt đóng trong finally của startProfile
  if (entry.stop._resolve) entry.stop._resolve();   // đua: phát 'stopped' ngay
  // Hủy ngay mọi thao tác Playwright đang chờ (đóng context/tab) → loop nền thoát nhanh,
  // không phải chờ hết timeout của goto/reload/waitForSelector.
  for (const fn of entry.stop.aborters || []) { try { fn(); } catch (_) {} }
  // Profile còn đang KHỞI ĐỘNG trình duyệt (launch Chromium/migration session lần đầu) →
  // stop.aborters CHƯA tồn tại → không có gì để hủy, việc launch sẽ tự chạy hết (không thể
  // hủy giữa chừng). BUỘC DỪNG THEO CẢM NHẬN NGƯỜI DÙNG: báo "Đã dừng" cho UI ngay lập tức
  // thay vì để badge kẹt ở "Đang dừng..." chờ launch xong. Dọn dẹp thật (đóng context vừa
  // mở, lưu session) vẫn chạy ngầm trong .finally() của startProfile khi launch hoàn tất.
  if (!entry.stop.aborters && !entry.stop.stoppedEmitted) {
    entry.stop.stoppedEmitted = true;
    entry.onStatus(profileId, 'stopped', 'Đã dừng.');
  }
  return { ok: true };
}

// ── DỪNG MỀM 1 profile: ngừng quét/xem NGAY nhưng check nốt hàng đợi sound rồi mới dừng ──
// Khác stopProfile (dừng cứng — vứt hàng đợi): chỉ đặt cờ stop.draining. Các vòng quét/xem
// đọc cờ này qua scanStop và thoát; countLoop chạy tới khi CẠN hàng đợi rồi tự kết thúc →
// message 'stopped' phát ra theo đường tự nhiên khi mọi loop xong. Bấm Dừng (cứng) trong
// lúc đang check nốt vẫn cắt ngay lập tức như thường. Mode 'view' không có hàng đợi đếm
// → dừng mềm = dừng cứng luôn.
function softStopProfile(profileId) {
  const entry = _active.get(profileId);
  if (!entry) return { ok: false, msg: 'Profile không chạy.' };
  if (entry.mode === 'view') return stopProfile(profileId);
  if (entry.stop.requested) return { ok: true };   // đã dừng cứng rồi — không làm gì thêm
  if (!entry.stop.draining) {
    entry.stop.draining = true;
    entry.onStatus(profileId, 'running', 'Dừng mềm: ngừng quét, check nốt sound còn trong hàng đợi rồi dừng...');
  }
  return { ok: true };
}

// ── Nạp thêm link cũ vào bộ lọc trùng GIỮA PHIÊN ──
// Dùng khi user bật đẩy Google Sheet lúc đang chạy: nạp link đã có trên Sheet vào
// _collected để không quét/đẩy lại. Sound đã quét trong phiên vẫn giữ nguyên.
function addSeedUrls(urls) {
  let added = 0;
  for (const u of (urls || [])) {
    const k = normalizeKey(u);
    if (k && !_collected.has(k)) { _collected.add(k); added++; }
  }
  _seedCount += added;
  return added;
}

// ── Dừng tất cả profile đang chạy ──
function stopAll() {
  for (const [profileId, entry] of _active.entries()) {
    entry.stop.requested = true;
    if (entry.stop._resolve) entry.stop._resolve();
    for (const fn of entry.stop.aborters || []) { try { fn(); } catch (_) {} }
    // Xem giải thích ở stopProfile(): profile còn đang khởi động → báo dừng ngay cho UI.
    if (!entry.stop.aborters && !entry.stop.stoppedEmitted) {
      entry.stop.stoppedEmitted = true;
      entry.onStatus(profileId, 'stopped', 'Đã dừng.');
    }
  }
  return { ok: true, count: _active.size };
}

module.exports = {
  startProfile,
  stopProfile,
  softStopProfile,
  stopAll,
  isProfileRunning,
  isAnyRunning,
  runningIds,
  addSeedUrls,
  setCountConcurrency,
};
