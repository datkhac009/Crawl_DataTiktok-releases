// src/crawler.cjs — Engine thu thập link sound TikTok (điều phối 5 chế độ crawl).
//
// 5 chế độ (mỗi profile chọn riêng):
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
// Mọi chế độ quét dùng chung pipeline: sound → mở trang /music/ lấy số video → lọc ngưỡng
// → đẩy ra (bảng + Google Sheet). Lọc trùng theo link sound.
//
// VÒNG ĐỜI TỪNG PROFILE: mỗi profile chạy độc lập, có cờ stop riêng, start/stop bất kỳ lúc
// nào. _collected (dedup) + bộ đếm dùng CHUNG cho cả phiên (reset khi profile đầu tiên của
// phiên bắt đầu; phiên = khoảng có ≥1 profile chạy).
//
// ── CẤU TRÚC (tách module 2026-07-28) ──
// File này giữ ĐÚNG phần điều phối: trạng thái phiên, vòng đời profile, và luồng của từng
// chế độ. Các phần dùng chung đã tách ra src/crawler/ để file này không phình vô hạn:
//   crawler/util.cjs           — sleep/rand/interruptibleSleep, parseCount, isOriginalSound
//   crawler/count-throttle.cjs — semaphore đếm video TOÀN APP (chống dội 1 IP)
//   crawler/page-read.cjs      — readActiveSound/readVideoCount/scrollFeed/recyclePage
//   crawler/stuck.cjs          — makeFeedTracker + chẩn đoán & thoát kẹt feed 3 cấp
//   crawler/session-watch.cjs  — checkLoginState + theo dõi phiên giữa lúc chạy
//   ../resource-blocker.cjs    — chặn ảnh/media/font (DÙNG CHUNG với browser.cjs)
'use strict';

const path = require('path');
const browser = require('./browser.cjs');
const fingerprint = require('./fingerprint.cjs');
const ipGuard = require('./ip-guard.cjs');
const { getProfilePath, loadProfiles } = require('./profiles.cjs');
const { canonicalSoundUrl, normalizeKey } = require('./linkkey.cjs');
const { attachResourceBlocker } = require('./resource-blocker.cjs');

const { sleep, rand, interruptibleSleep, parseCount, isOriginalSound } = require('./crawler/util.cjs');
const {
  setCountConcurrency, acquireCountSlot, releaseCountSlot,
  countPenaltyUp, countPenaltyDown,
} = require('./crawler/count-throttle.cjs');
const { readActiveSound, readVideoCount, scrollFeed, recyclePage } = require('./crawler/page-read.cjs');
const { makeFeedTracker, handleStuck, looksStarved } = require('./crawler/stuck.cjs');
const { checkLoginStateStable, makeLoginWatcher } = require('./crawler/session-watch.cjs');

const TIKTOK_HOME = 'https://www.tiktok.com/';

// ── TRẠNG THÁI PHIÊN (dùng chung cho mọi profile đang chạy) ──
// Map<profileId, { stop:{requested}, mode, name, onStatus }> — các profile đang chạy.
const _active = new Map();

let _scannedThisRun = 0;      // số sound MỚI quét được trong phiên (không tính seed)
let _skippedDup = 0;          // số link bị bỏ vì trùng (cùng phiên HOẶC đã có trên Sheet)
let _seedCount = 0;           // số link nạp sẵn từ Sheet
let _loggedFirstKey = false;  // log 1 lần key đầu tiên để đối chiếu định dạng
const _collected = new Set(); // dedup theo key sound (gồm cả link nạp sẵn từ Sheet)

function isProfileRunning(id) { return _active.has(id); }
function isAnyRunning() { return _active.size > 0; }
function runningIds() { return [..._active.keys()]; }

// Số lần cuộn trước khi TẢI LẠI trang để xả RAM. Feed TikTok cuộn mãi sẽ tích DOM +
// buffer video vô tận → RAM phình ~1.5GB/phút (đã đo) → cạn RAM → crash. Reload định kỳ
// xả sạch bộ nhớ tích tụ. ~80 lần cuộn ≈ 3-4 phút (delay 2-3s/lần). Không áp cho chế độ
// 'current' (đó là tab của người dùng, không được tải lại). NGƯỜI DÙNG CHỈNH ĐƯỢC trong
// ⚙️ Cài đặt crawl (per-profile, `opts.recycleEvery`) — hằng số này chỉ còn là MẶC ĐỊNH
// khi chưa cấu hình. 0 = tắt hẳn tự tải lại (chấp nhận rủi ro RAM để đổi lấy không gián đoạn).
const RECYCLE_EVERY_DEFAULT = 80;

// Chu kỳ kiểm lại IP có còn khớp nhãn quốc gia của profile (xem ip-guard.cjs). 5 phút là cân
// bằng: VPN tụt thì phát hiện đủ nhanh, mà không bắn request tra IP quá dày (ip-guard còn
// cache 1 phút nên nhiều profile kiểm cùng lúc cũng chỉ tốn 1 request).
const IP_RECHECK_MS = 5 * 60 * 1000;

// Nhịp kiểm lại TRONG LÚC đang tạm dừng vì IP lệch vùng. Cho ghi đè bằng biến môi trường
// TTC_IP_RETRY_MS để test tự động kiểm được đường "lệch → tự phục hồi" mà không phải chờ
// thật 60 giây. Bản chạy thật KHÔNG set biến này nên luôn dùng 60s.
const IP_PAUSE_RETRY_MS = Number(process.env.TTC_IP_RETRY_MS) || 60000;

// ── FEED CẠN: TikTok không cấp thêm video cho profile/IP này (2026-08-05) ──
// Sự cố thật: 1 máy ảo, profile CÒN đăng nhập (nút 🔑 xác nhận), nhưng trang chỉ có 2 video
// và nút "video kế tiếp" bị TikTok TẮT. App quay vòng thoát kẹt cách 1→2→3 gần 2 giờ, ra
// 0 sound hợp lệ. Bước ĐẾM đã có backoff (30s→2p→5p) từ lâu, còn vòng QUÉT thì KHÔNG có
// backoff nào — đó là lỗ hổng.
//
// ⚠ Nói thẳng giới hạn: KHÔNG có cách nào trong code làm TikTok cấp thêm video. Cuộn không
// thể cuộn tới cái không tồn tại. Đã cân và LOẠI: `window.scrollBy`/synthetic wheel event
// (QĐ-13 — feed là băng chuyền CSS, `scrollIntoView` đã thất bại 100%, và React bỏ qua event
// không trusted); điều hướng thẳng bằng href (chỉ có 1-2 href, hết); gọi thẳng API feed
// (`item_list` cần tham số ký X-Bogus/msToken — đúng lý do QĐ-06 chọn NGHE response thay vì
// GỌI endpoint). Vì vậy mục tiêu ở đây chỉ là: PHÁT HIỆN ĐÚNG, NGỪNG DỘI, và ĐỔI HƯỚNG.
//
// Số lần can thiệp thoát kẹt LIÊN TIẾP (không quét được sound mới nào ở giữa) đủ để coi là
// đã thử hết một vòng 3 cấp mà không hiệu quả. Đếm lại từ 0 ngay khi feed cho ra 1 sound mới.
const STUCK_CYCLE_FULL = 3;

// Backoff khi feed cạn ở chế độ KHÔNG phải chu kỳ: 5 phút → 15 phút → 30 phút (giữ mức cuối).
// Dài hơn hẳn backoff của bước đếm vì đây là siết ở tầng feed/IP, không phải rate-limit ngắn.
// TTC_STARVE_RETRY_MS cho test ghi đè (cùng khuôn TTC_IP_RETRY_MS ở trên).
const STARVE_WAITS = process.env.TTC_STARVE_RETRY_MS
  ? [Number(process.env.TTC_STARVE_RETRY_MS)]
  : [5 * 60000, 15 * 60000, 30 * 60000];

// ══════════════════════════════════════════════════════════════════════════
// HAI CHẾ ĐỘ ĐẾM SỐ VIDEO — chọn theo TỪNG MÁY (người dùng yêu cầu 2026-08-06)
// ══════════════════════════════════════════════════════════════════════════
// VÌ SAO CÓ CÔNG TẮC thay vì chọn một cách: cùng MỘT file .exe chạy trên cả 5 máy, mà máy chính
// (mạnh) và máy ảo (yếu) cần đánh đổi NGƯỢC NHAU:
//
//   'patient' — đúng quy trình bản v0.1.63: chờ API 20 giây, đọc giao diện rất kiên nhẫn, KHÔNG
//               thử lại. Trên máy MẠNH thì kiên nhẫn gần như miễn phí (API về trong ~1s, đọc giao
//               diện xong trong ~3s) nên không mất gì, mà có thêm cơ hội đọc được link chậm.
//   'fast'    — bản hiện tại: chờ API 8 giây, ngân sách đọc giao diện có TRẦN CỨNG, có thử lại.
//               BẮT BUỘC cho máy ảo: đo thật trên VPS lag, 'patient' làm 1 sound lỗi chiếm slot
//               đếm TOÀN APP tới ~28 giây → thông lượng tụt còn ~4 sound/phút trong khi vòng quét
//               cần ~20 → hàng đợi đầy vĩnh viễn → VÒNG QUÉT ĐỨNG → feed ngừng cuộn.
//
// => Không có cách nào đúng cho cả hai loại máy. Nên để người dùng chọn, mặc định 'fast' (an toàn
//    cho máy yếu — chọn sai ở máy mạnh chỉ mất chút cơ hội, chọn sai ở máy yếu là ĐỨNG FEED).
//
// ⚠ MỘT ĐIỂM KHÔNG SAO CHÉP NGUYÊN VĂN: v0.1.63 đọc giao diện bằng "6 vòng × 500ms" — mà mỗi lần
// đọc có trần riêng 5 giây, nên vòng đó KHÔNG CÓ TRẦN THẬT (máy yếu → 30 giây). 'patient' ở đây
// dùng ngân sách 30 giây: trên máy mạnh hành vi y hệt v0.1.63 (6 vòng × ~550ms ≈ 3.3s là xong),
// còn trên máy yếu thì có trần thay vì trôi tự do. Cố ý KHÔNG dựng lại vòng không trần đó.
const COUNT_MODES = {
  fast:    { apiWaitMs: 8000,  domBudgetMs: [2500, 5000],   attempts: 2, retryWaitMs: 2500 },
  patient: { apiWaitMs: 20000, domBudgetMs: [30000, 30000], attempts: 1, retryWaitMs: 2500 },
};
const COUNT_MODE_DEFAULT = 'fast';
let _countMode = COUNT_MODE_DEFAULT;

// Biến môi trường (nếu đặt) GHI ĐÈ chế độ — để soi lỗi mà không phải vào ⚙, và để test chỉnh được.
function _countCfg() {
  const m = COUNT_MODES[_countMode] || COUNT_MODES[COUNT_MODE_DEFAULT];
  const envNum = (k, min) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v >= min ? v : null;
  };
  return {
    apiWaitMs: envNum('TTC_COUNT_API_MS', 1000) ?? m.apiWaitMs,
    domBudgetMs: m.domBudgetMs,
    attempts: envNum('TTC_COUNT_ATTEMPTS', 1) ?? m.attempts,
    retryWaitMs: envNum('TTC_COUNT_RETRY_MS', 0) ?? m.retryWaitMs,
  };
}

function setCountMode(mode) {
  _countMode = COUNT_MODES[mode] ? mode : COUNT_MODE_DEFAULT;
  const c = _countCfg();
  console.log(`[count] Chế độ đếm: ${_countMode} (chờ API ${c.apiWaitMs}ms, ngân sách giao diện`
    + ` ${c.domBudgetMs.join('/')}ms, ${c.attempts} lượt đọc).`);
  return _countMode;
}
function getCountMode() { return _countMode; }

// ── Vòng lặp crawl cho 1 profile (nhận cờ `stop` riêng) ──
// `onPending` (QĐ-33): link TikTok trả "Something went wrong" — không đọc được số video nhưng
// sound VẪN CÒN. Trả về true nếu đã xếp vào tab chờ (để log nói đúng việc đã làm).
async function crawlOneProfile(profile, opts, onData, onStatus, stop, onPending) {
  const { minDelay, maxDelay, headless, minVideos, maxVideos, mode, keyword, originalOnly, blockImages, chromiumProfile } = opts;
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

  // ════════ CANH IP KHỚP NHÃN QUỐC GIA CỦA PROFILE (2026-07-28) ════════
  // Profile "...(US)" luôn khai múi giờ America/New_York + en-US (fingerprint.cjs). Nếu VPN
  // trên VPS tụt thì request đi từ IP nước khác nhưng vẫn khai giờ Mỹ — mâu thuẫn mà QĐ-05
  // ghi là "rất dễ bị nhận diện là dùng proxy". Trước đây app không hề biết, cào tiếp hàng giờ.
  //
  // TẠM DỪNG chứ không dừng hẳn: VPN thường tự kết nối lại sau vài phút, dừng hẳn là mất cả
  // đêm sản lượng trên cả dàn máy. Không tra được IP (mạng lỗi tạm) thì KHÔNG chặn.
  const wantCountry = fingerprint.countryOf(path.basename(profilePath));

  // Trả false nếu bị Dừng trong lúc chờ IP về đúng vùng.
  async function waitForCorrectCountry(prefix = '') {
    if (!wantCountry) return true;   // profile không có nhãn quốc gia → không áp dụng
    let paused = false;
    while (!stop.requested) {
      const r = await ipGuard.check(wantCountry);
      if (r.state !== 'mismatch') {
        if (paused) {
          onStatus(profile.id, 'running',
            `✅ ${prefix}IP đã về đúng vùng (${r.country || '?'}) — chạy tiếp.`);
        }
        return true;
      }
      if (!paused) {
        paused = true;
        onStatus(profile.id, 'error',
          `⚠ ${prefix}TẠM DỪNG: IP hiện tại ở ${r.country} nhưng profile khai (${r.want}). `
          + `Chạy tiếp sẽ để lộ mâu thuẫn "IP nước này, giờ nước khác" — thường do VPN tụt. `
          + `App tự kiểm lại mỗi 60s và chạy tiếp ngay khi VPN về đúng vùng.`);
      }
      await interruptibleSleep(IP_PAUSE_RETRY_MS, stop);
    }
    return false;
  }

  if (!await waitForCorrectCountry()) return;

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
      ctx = await browser.acquireProfileContext(profilePath, { headless, persistent: chromiumProfile });
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
  if (blockImages && mode !== 'view' && mode !== 'cycle') { await attachResourceBlocker(page); }

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
  //
  // (2026-07-31) HẠ 500 → 20. Người dùng gặp "Quét 60 mà Đã check chỉ 5" và tưởng lỗi.
  // Không phải lỗi: bước đếm video bị ĐIỀU TIẾT TOÀN CỤC (count-throttle.cjs, mặc định 2
  // request /music/ đồng thời cho CẢ APP) để TikTok không chặn trang đếm — nên khi chạy 5
  // profile, tốc độ đếm chỉ bằng ~1/5 tốc độ quét. Trần 500 cho backlog phình rất to trước
  // khi quét tự dừng lại, tạo ra khoảng cách lớn giữa 2 cột, và số chênh đó chính là số
  // sound MẤT nếu bấm Dừng cứng.
  // Hạ xuống 20: quét TỰ ĐIỀU TIẾT theo tốc độ đếm → 2 cột luôn đi sát nhau, mất ít dữ liệu
  // hơn khi dừng cứng. KHÔNG làm giảm tổng sản lượng vì đếm vẫn là cổ chai (quét nhanh hơn
  // chỉ để dồn hàng đợi rồi mất). Muốn CẢ HAI nhanh hơn thì phải nâng "Số luồng đếm video
  // đồng thời" trong ⚙ — đánh đổi: càng cao càng dễ bị TikTok chặn trang đếm.
  const soundQueue = [];
  const QUEUE_MAX = 20;

  // ── NHỊP CUỘN TỰ GIÃN THEO ÁP LỰC HÀNG ĐỢI (2026-08-06) ──
  //
  // VẤN ĐỀ: trước đây vòng quét chạy HẾT TỐC cho tới lúc hàng đợi đầy 20/20, rồi **ĐỨNG HẲN** ở
  // nhánh chờ. Người dùng thấy đúng cái đó: 4 profile kẹt `Quét − Đã check = 21`, feed đứng im 8
  // phút ở một video. Hành vi kiểu bật/tắt (chạy hết tốc → dừng hẳn) là thứ gây ra hiện tượng
  // "đứng feed", chứ không phải TikTok chặn.
  //
  // CÁCH SỬA: thay ngưỡng bật/tắt bằng **giãn dần**. Hàng đợi càng đầy thì nghỉ giữa 2 lần cuộn
  // càng lâu, nên vòng quét TỰ khớp tốc độ với bước đếm và **hiếm khi tới được ngưỡng đầy**.
  //   dưới 50%  → nhịp bình thường (máy khoẻ gần như luôn ở đây)
  //   75%       → ×2.5
  //   100%      → ×4
  // Vì sao đây là cách đúng: bước đếm là cổ chai có thật, không thể xoá. Nhưng "chậm dần" giữ feed
  // LUÔN CHUYỂN ĐỘNG — vừa không mất sound nào (khác với cuộn qua mà không thu), vừa không để một
  // video mở đứng hàng phút (bản thân việc đó cũng là tín hiệu bất thường với TikTok).
  //
  // ⚠ KHÔNG bỏ hẳn ngưỡng đầy: nó là chốt chống hàng đợi phình vô hạn. Chỉ là giờ rất ít khi tới.
  function queuePressureFactor() {
    const p = soundQueue.length / QUEUE_MAX;
    if (p < 0.5) return 1;
    return 1 + (Math.min(p, 1) - 0.5) * 6;
  }

  let localCount = 0;   // số sound profile NÀY tự quét được (feed) — hiển thị cột "Sound"
  let localChecked = 0; // số sound profile NÀY đã ĐI QUA bước đếm video (kể cả trả về '?')
                         // — hiển thị cột "Đã check". Tăng trong countLoop, không phải ở đây.

  // Báo counts hiện tại cho UI (cột Sound + Đã check trong bảng profile). status='counts'
  // là kênh RIÊNG, không kèm text — renderer chỉ cập nhật số, không đụng badge/log.
  function emitCounts() {
    // skippedDup: DÙNG CHUNG cho cả phiên (không riêng profile này) — để renderer hiện
    // được 1 số đếm sống "Bỏ qua trùng: N" (2026-07-29, người dùng không thấy lọc trùng
    // đang hoạt động vì trước đây số này chỉ báo 1 lần lúc "Hoàn tất phiên", mà chế độ
    // Quét⇄Xem gần như không bao giờ tới lúc đó).
    onStatus(profile.id, 'counts', null, { scanned: localCount, checked: localChecked, skippedDup: _skippedDup });
  }

  // Thêm 1 sound vào hàng đợi (lọc trùng theo key chuẩn hóa — gồm cả link nạp sẵn).
  // Trả về true nếu THỰC SỰ thêm mới (không phải trùng/bị lọc) — dùng để tránh log lặp
  // dòng "đã quét N sound" khi feed vẫn đứng ở đúng video/sound cũ (chưa cuộn sang video mới).
  function addSound(href, name) {
    if (!href) return false;
    const rawUrl = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;
    // Rút gọn về link chuẩn NGAY từ đầu vào — bảng kết quả/Sheet/tab đếm đều dùng link ngắn.
    const url = canonicalSoundUrl(rawUrl);
    // Bộ lọc Original Sound: bật → bỏ qua sound không phải original (nhạc bản quyền).
    // ⚠ PHẢI xét `rawUrl` (link GỐC), KHÔNG được xét `url` đã rút gọn: từ 2026-07-30
    // canonicalSoundUrl() ghép MỌI link về dạng `/music/original-sound-<id>` (kể cả nhạc bản
    // quyền) nên nếu xét link đã rút gọn thì isOriginalSound() luôn thấy "original-sound-"
    // → bộ lọc này MẤT TÁC DỤNG HOÀN TOÀN, mọi nhạc bản quyền đều lọt.
    if (originalOnly && !isOriginalSound(rawUrl, name)) return false;
    const key = normalizeKey(url);
    if (!key) return false;
    if (!_loggedFirstKey) {
      _loggedFirstKey = true;
      console.log(`[dedup] key sound đầu tiên = "${key}" | url = ${url} | đã có trong cache? ${_collected.has(key)} (cache đang giữ ${_collected.size} key)`);
    }
    if (_collected.has(key)) { _skippedDup++; emitCounts(); return false; }
    _collected.add(key);
    _scannedThisRun++;
    localCount++;
    soundQueue.push({ url, name: name || '' });
    emitCounts();
    return true;
  }

  // ════════ VÒNG QUÉT FEED DÙNG CHUNG cho mọi chế độ quét ════════
  // GỘP 4 BẢN SAO (2026-07-28): foryou / search / current / pha QUÉT của cycle trước đây
  // mỗi chế độ giữ MỘT bản `feedLoop` gần như y hệt (đọc sound → track kẹt → cuộn →
  // recycle), chỉ khác vài tham số. DECISIONS.md QĐ-10 đã ghi bài học: "khi có ≥2 bản sao
  // của cùng một logic, chúng SẼ lệch nhau" — và nó ĐÃ xảy ra thật với chính 4 bản này:
  //   • bản chu kỳ từng RƠI MẤT dòng log "feed chưa hiện, tải lại trang rồi thử lại" khi
  //     chép từ For You (comment trong scanPhase còn ghi lại sự cố đó);
  //   • bản 'current' THIẾU `if (stop.requested) break;` trước khối thoát kẹt → bấm Dừng
  //     vẫn phải chờ handleStuck chạy xong (tới ~10s) mới thoát được;
  //   • bản 'current' sau khi thoát kẹt còn cuộn thêm 1 nhịp, còn 3 bản kia thì `continue`.
  // Gộp về MỘT nguồn nên 3 điểm lệch trên tự hết, và lần sau sửa vòng quét chỉ sửa 1 chỗ.
  //
  // Chỉ tham số hoá những gì THỰC SỰ khác nhau giữa các chế độ:
  //   prefix        tiền tố log ('' | 'Tìm "kw": ' | 'Chu kỳ [Quét]: ')
  //   waitSelector  selector chờ sau khi tải lại trang (null với 'current' — không tải lại)
  //   allowReload   cho phép thoát kẹt cấp 3 = tải lại trang (false cho TAB CỦA NGƯỜI DÙNG)
  //   recycle       có tự tải lại định kỳ để xả RAM hay không ('current': KHÔNG)
  //   watchLogin    có theo dõi phiên đăng nhập giữa lúc chạy hay không
  //   deadlineAt    mốc phải dừng (chỉ pha QUÉT của chu kỳ dùng; Infinity = chạy tới khi Dừng)
  //   onGuestMidRun xử lý riêng khi phát hiện tụt xuống chế độ khách giữa lúc chạy
  //   startMsg      dòng log mở đầu (null = nơi gọi đã tự báo trước khi vào vòng)
  //
  // TRẢ VỀ lý do kết thúc, để nơi gọi xử lý KHÁC NHAU cho từng chế độ:
  //   undefined       — hết deadline / bị Dừng (đường bình thường)
  //   'guest'         — tụt xuống chế độ khách giữa lúc chạy
  //   'feed-starved'  — TikTok không cấp thêm video (chu kỳ: nhảy sang pha XEM;
  //                     chế độ khác: tạm dừng có backoff rồi thử lại)
  async function runScanLoop({
    prefix = '',
    waitSelector = null,
    allowReload = true,
    recycle = true,
    watchLogin: enableWatchLogin = false,
    deadlineAt = Infinity,
    onGuestMidRun = null,
    startMsg = null,
  }) {
    // Dừng mềm: vòng quét coi `draining` như lệnh dừng, nhưng countLoop vẫn check nốt hàng
    // đợi. Shadow biến `stop` một dòng — CÓ CHỦ ĐÍCH, xem QĐ-11 (tránh phải sửa hàng chục
    // điều kiện rải rác, rủi ro sót).
    const stop = scanStop;
    if (startMsg) onStatus(profile.id, 'running', startMsg);
    let scrolls = 0;
    // Số lần can thiệp thoát kẹt LIÊN TIẾP mà feed không cho ra sound mới nào. Quét được 1
    // sound mới là bằng chứng feed còn sống → đếm lại từ 0.
    let stuckStreak = 0;
    const tracker = makeFeedTracker();
    // Truyền `stop` để lần đọc lại phiên (tới 20s) không làm nút Dừng phản hồi chậm.
    const watchLogin = enableWatchLogin ? makeLoginWatcher(page, profilePath, stop) : null;
    let lastIpCheck = Date.now();   // vừa kiểm ở đầu crawlOneProfile nên chưa cần kiểm lại ngay

    while (!stop.requested && Date.now() < deadlineAt) {
      // VPN có thể tụt GIỮA LÚC ĐANG CHẠY → kiểm lại định kỳ, lệch vùng thì tạm dừng tại chỗ
      // (không thoát vòng) và tự chạy tiếp khi VPN về đúng vùng.
      if (wantCountry && Date.now() - lastIpCheck >= IP_RECHECK_MS) {
        lastIpCheck = Date.now();
        if (!await waitForCorrectCountry(prefix)) break;
        lastIpCheck = Date.now();   // đặt lại sau khi chờ, tránh kiểm dồn ngay vòng sau
      }
      // Queue ĐẦY HẲN → mới tạm dừng cuộn (chống backlog vô hạn). Nhờ nhịp cuộn tự giãn ở cuối
      // vòng (queuePressureFactor) thì hiếm khi tới được đây — trước đây chạy hết tốc rồi ĐỨNG HẲN.
      // (2026-07-31) BÁO RA UI: trước đây vòng chờ này im lặng hoàn toàn — cột Quét đứng yên
      // mà không có dòng trạng thái nào, trông y như app bị treo (người dùng báo đúng hiện
      // tượng này). Giờ nói rõ đang chờ bước đếm, có kèm số sound còn trong hàng đợi.
      let waitedForQueue = false;
      while (soundQueue.length >= QUEUE_MAX && !stop.requested && Date.now() < deadlineAt) {
        if (!waitedForQueue) {
          waitedForQueue = true;
          onStatus(profile.id, 'running',
            `${prefix}Tạm dừng cuộn — chờ đếm số video cho ${soundQueue.length} sound đang xếp hàng...`);
        }
        await interruptibleSleep(1000, stop);
      }
      if (waitedForQueue && !stop.requested) {
        onStatus(profile.id, 'running', `${prefix}Đếm đã theo kịp — cuộn tiếp...`);
      }
      if (stop.requested || Date.now() >= deadlineAt) break;

      // Phiên có thể chết GIỮA CHỪNG → kiểm tra định kỳ (15 phút/lần), tụt xuống khách thì
      // dừng ngay thay vì cào vô ích hàng giờ.
      if (watchLogin && await watchLogin() === 'guest') {
        if (onGuestMidRun) onGuestMidRun();
        return;
      }

      let data = null;
      try { data = await readActiveSound(page); } catch (_) {}
      const isNew = !!(data && data.href && addSound(data.href, data.name));
      if (isNew) {
        stuckStreak = 0;   // feed cho ra sound mới = còn sống, không phải cạn
        onStatus(profile.id, 'running', prefix
          ? `${prefix}đã quét ${localCount} sound...`
          : `Đã quét ${localCount} sound...`);
      }
      const stuck = tracker.track(data && data.href, isNew);
      const st = tracker.dueStats();
      if (st) {
        onStatus(profile.id, 'running', prefix
          ? `${prefix}${st}.`
          : st.charAt(0).toUpperCase() + st.slice(1) + '.');
      }
      if (stop.requested) break;

      if (stuck) {
        const { reloaded, diag } = await handleStuck(page, tracker, {
          profileId: profile.id, onStatus, prefix,
          waitSelector, allowReload, stop,
          noHref: !(data && data.href),
        });
        if (reloaded) scrolls = 0;
        stuckStreak++;

        // ── FEED CẠN? Cần ĐỦ CẢ 4 điều kiện mới kết luận ──
        // (1) đang kẹt (đã có, mới vào được nhánh này)
        // (2)+(3) trang chỉ còn ≤2 video VÀ không có nút "xuống" dùng được → looksStarved()
        // (4) đã thử hết một vòng 3 cấp thoát kẹt mà feed vẫn không cho sound mới nào
        // Thiếu bất kỳ điều nào là KHÔNG kết luận — feed vừa tải lại cũng có lúc tạm 1-2
        // video, kết luận sớm sẽ làm profile khoẻ tự tạm dừng oan.
        if (stuckStreak >= STUCK_CYCLE_FULL && looksStarved(diag)) {
          // Điều kiện cuối: phải chắc KHÔNG phải chế độ khách. Tốn tới 20s nhưng chỉ chạy
          // đúng 1 lần ở thời điểm đã bế tắc, và nếu là khách thì cách chữa khác hoàn toàn
          // (bấm 🦊 đăng nhập lại) nên báo sai hướng là đẩy người dùng đi sai đường.
          const s = await checkLoginStateStable(page, { stop });
          if (stop.requested) break;
          if (s === 'guest') {
            if (onGuestMidRun) onGuestMidRun();
            return 'guest';
          }
          // Status RIÊNG 'feed-starved' (không phải 'running'): nó vừa là dòng log cho người
          // đọc, vừa là TÍN HIỆU MÁY để renderer quyết định có tắt/bật lại HMA VPN rồi chạy
          // lại hay không (xem handleFeedStarved trong renderer.js). Gộp làm một message để
          // không phát 2 lần cùng một việc.
          // ⚠ KHÔNG dùng 'error': renderer coi 'error' là đã dừng → hàng đổi về nút "▶ Chạy"
          // trong khi profile vẫn sống (cùng cái bẫy đã ghi ở runScanLoopWithStarveBackoff).
          onStatus(profile.id, 'feed-starved',
            `⛔ ${prefix}TikTok KHÔNG cấp thêm video cho profile này — trang chỉ còn `
            + `${diag.links} video`
            + (diag.nextBtnDisabled ? ' và nút "video kế tiếp" ĐANG BỊ TẮT' : ' và không có nút "video kế tiếp"')
            + `, đã thử ${stuckStreak} lượt thoát kẹt đều không hiệu quả. Phiên đăng nhập vẫn TỐT`
            + ' — cuộn thêm chỉ làm TikTok siết nặng hơn.');
          return 'feed-starved';
        }
        continue;   // vừa can thiệp để nhảy video → không cuộn thêm nhịp nữa
      }

      await scrollFeed(page);
      // NHỊP CUỘN TỰ GIÃN THEO ÁP LỰC HÀNG ĐỢI (2026-08-06) — xem queuePressureFactor().
      await interruptibleSleep(Math.round(rand(minDelay, maxDelay) * queuePressureFactor()), stop);

      if (recycle && recycleEvery > 0 && ++scrolls >= recycleEvery
          && !stop.requested && Date.now() < deadlineAt) {
        scrolls = 0;
        onStatus(profile.id, 'running',
          `${prefix}Tải lại feed để xả RAM (đã quét ${localCount} sound)...`);
        await recyclePage(page, waitSelector, stop);
      }
    }
  }

  // ── Quét + TỰ TẠM DỪNG KHI FEED CẠN (cho chế độ KHÔNG phải chu kỳ) ──
  // Chế độ chu kỳ có pha XEM để nhảy sang; For You / Tìm kiếm / Tab đang mở thì không, nên
  // ở đây tạm dừng có backoff tăng dần rồi tải lại thử tiếp — theo đúng khuôn ip-guard
  // (TẠM DỪNG chứ không dừng hẳn, vì siết thường tự hết sau một lúc; dừng hẳn là mất cả đêm
  // sản lượng) và khuôn backoff của bước đếm.
  //
  // ⚠ Dùng status 'running' cho dòng tạm dừng, KHÔNG dùng 'error': renderer coi 'error' là
  // đã dừng (setRowRunning(false) + xoá chip pha) nên hàng sẽ đổi về nút "▶ Chạy" trong khi
  // profile VẪN đang sống → bấm vào bị từ chối "Profile đang chạy". (Đường canh IP hiện đang
  // dùng 'error' cho thông báo TẠM DỪNG nên có đúng cái vênh này — không sửa ở đây để giữ
  // phạm vi thay đổi hẹp, nhưng đừng lặp lại nó.)
  //
  // ⚠ KHÔNG tải lại trang khi allowReload === false (chế độ 'current' — tab của NGƯỜI DÙNG).
  async function runScanLoopWithStarveBackoff(opts) {
    for (let attempt = 0; !scanStop.requested; attempt++) {
      const reason = await runScanLoop(opts);
      if (reason !== 'feed-starved' || scanStop.requested) return reason;

      const wait = STARVE_WAITS[Math.min(attempt, STARVE_WAITS.length - 1)];
      onStatus(profile.id, 'running',
        `⏸ ${opts.prefix || ''}Tạm dừng ${Math.round(wait / 60000) || 1} phút rồi thử lại.`
        + ' Nếu lặp lại nhiều lần thì nguyên nhân ở NGOÀI app: đổi IP/VPN (khác thành phố/ASN,'
        + ' không chỉ khác quốc gia) hoặc chuyển profile này sang chế độ Tìm kiếm — đó là đường'
        + ' lấy video khác, For You bị siết không có nghĩa Tìm kiếm cũng bị.');
      await interruptibleSleep(wait, scanStop);
      if (scanStop.requested) return 'stopped';

      if (opts.allowReload !== false) {
        onStatus(profile.id, 'running', `${opts.prefix || ''}Hết giờ tạm dừng — tải lại feed rồi thử tiếp...`);
        await recyclePage(page, opts.waitSelector, scanStop);
      } else {
        onStatus(profile.id, 'running', `${opts.prefix || ''}Hết giờ tạm dừng — thử đọc lại tab đang mở...`);
      }
    }
    return 'stopped';
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
  // ── GHÉP vòng quét với vòng đếm ──
  //
  // ⚠ LỖI THẬT ĐÃ GẶP (2026-08-07, log người dùng): vòng quét kết thúc vì TikTok hủy phiên giữa
  // chừng (chế độ khách) → `runScanLoop` return. Nhưng `countLoop` là vòng VÔ HẠN, chỉ thoát khi
  // `stop.requested` hoặc `stop.draining` — cả hai đều KHÔNG được đặt. Nên:
  //     Promise.all([scanLoop(xong), countLoop(chạy mãi)])  →  KHÔNG BAO GIỜ resolve
  //     → `crawlOneProfile` không kết thúc → khối `finally` không chạy → `_active` GIỮ profile MÃI
  //     → mọi lần bấm ▶ Chạy đều bị từ chối "Profile đang chạy."
  // Tệ hơn: renderer nhận status 'error' nên đổi hàng về nút "▶ Chạy" → người dùng KHÔNG bấm được
  // "■ Dừng" nữa (stopProfileById thoát sớm vì hàng không còn trong runningSet). Bế tắc hoàn toàn,
  // chỉ khởi động lại app mới thoát. Đúng hiện tượng người dùng báo: dừng/chạy lại, xoá
  // ChromiumProfile, đăng nhập lại — đều vô ích.
  //
  // CÁCH SỬA: vòng quét xong thì báo vòng đếm "check nốt hàng đợi rồi thoát" (`stop.draining`).
  // Dùng `draining` chứ KHÔNG dùng `requested`: sound đã quét được mà chưa đếm vẫn được check nốt,
  // không mất dữ liệu — đúng ngữ nghĩa Dừng mềm sẵn có (QĐ-11).
  function joinScanAndCount(scanPromise) {
    return Promise.race([
      Promise.all([
        // ⚠ Đặt trên `stop`, KHÔNG phải `scanStop`: `scanStop` chỉ là object có getter đọc lại
        // `stop.requested || stop.draining`, gán vào nó không tới được `countLoop` (nó đọc
        // `stop.draining`). Gán nhầm chỗ thì bản vá này im lặng vô tác dụng.
        scanPromise.then(
          (r) => { stop.draining = true; return r; },
          (e) => { stop.draining = true; throw e; },   // lỗi cũng phải nhả vòng đếm
        ),
        countLoop(),
      ]),
      stop.promise,
    ]);
  }

  async function countLoop() {
    let sidePage = null, helper = null;
    async function newCountPage() {
      const p = await helper.ctx.newPage();
      await attachResourceBlocker(p);
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
      let oddStatus = null;  // statusCode TikTok trả về mà ta chưa biết nghĩa (để log — xem dưới)
      let stopped = false;   // đã yêu cầu dừng giữa chừng → thoát hẳn countLoop
      let holdingSlot = false;   // ĐANG giữ slot đếm hay không (nhả đúng 1 lần, xem finally)
      const cfg = _countCfg();   // chốt thông số theo chế độ đếm cho ĐÚNG sound này
      try {
        // ĐỌC QUA API (2026-07-06): trang /music/ tự gọi api/music/detail/ ngay khi tải.
        // Nghe response đó thay vì poll DOM: (a) có số CHÍNH XÁC (videoCount=88100 thay vì
        // text "88.1K" làm tròn), (b) về sớm ~1s, (c) phân biệt được sound CHẾT (API trả
        // body RỖNG — đã verify) với BỊ CHẶN (không có response).
        // Quy trình 2 BƯỚC (user chốt 2026-07-12): API lỗi → đọc GIAO DIỆN (DOM) trên chính
        // trang vừa tải → cả 2 đều lỗi → không nhả dòng '?' vào dữ liệu.
        //
        // Thông số lấy theo CHẾ ĐỘ ĐẾM của máy này (xem COUNT_MODES). Đọc MỘT LẦN ở đây, không
        // đọc lại giữa các lượt — để một sound không bị đổi luật giữa dòng nếu người dùng vừa
        // đổi cài đặt.
        // THỬ LẠI TRỌN VÒNG (2026-08-06, cfg.attempts): xem lý do ở chỗ khai COUNT_MODES.
        // KHÔNG mâu thuẫn QĐ-07 ("không retry"): QĐ-07 chặn việc GHI SỐ KHÔNG CHẮC vào dữ liệu
        // — thử lại rồi đọc được SỐ THẬT không tạo dữ liệu bẩn nào.
        //
        // ⚠ NHẢ SLOT TRONG LÚC CHỜ giữa 2 lượt (sửa 2026-08-06, cùng ngày). Bản đầu GIỮ NGUYÊN
        // slot suốt các lượt với lý do "TikTok đang lỗi thì chậm lại là đúng hướng" — LÝ LẼ ĐÓ
        // SAI, vì slot đếm là tài nguyên **TOÀN APP** (chỉ 2 slot cho mọi profile), không phải
        // của riêng sound này. Giữ slot lúc ngủ = chặn cả 5 profile trên máy.
        for (let attempt = 1; attempt <= cfg.attempts; attempt++) {
          if (stop.requested || raw !== null || dead) break;
          // ── CHỈ THỬ LẠI KHI CÒN THỪA SỨC (2026-08-06) ──
          // Thử lại là thứ ĐÁNG CÓ nhưng KHÔNG đáng đánh đổi việc feed đứng hẳn. Khi hàng đợi đã
          // quá nửa, bước đếm chính là cổ chai — lúc đó thử lại làm mọi thứ tệ đi: vòng quét bị
          // chặn ở nhánh chờ hàng đợi và feed NGỪNG CUỘN (đo thật trên máy ảo: 4 profile đứng
          // yên 8 phút, hàng đợi đầy 20/20 cả 4).
          // Bỏ lượt 2 KHÔNG mất link: nó vẫn vào TAB CHỜ, và link ở tab chờ vẫn được thử lại ở
          // phiên sau (QĐ-33). Đổi lại feed chạy tiếp — quét được sound mới đáng giá hơn.
          if (attempt > 1 && soundQueue.length >= QUEUE_MAX / 2) {
            onStatus(profile.id, 'running',
              `"${item.name}": bỏ lượt thử lại vì đang tắc hàng đợi (${soundQueue.length}/${QUEUE_MAX})`
              + ' — ưu tiên cho feed chạy tiếp, link vẫn vào tab chờ.');
            break;
          }
          if (attempt > 1) {
            onStatus(profile.id, 'running', `"${item.name}": TikTok trả trang lỗi`
              + ` — thử lại lượt ${attempt}/${cfg.attempts}...`);
            if (holdingSlot) { releaseCountSlot(); holdingSlot = false; }
            await interruptibleSleep(cfg.retryWaitMs, stop);
            if (stop.requested) { stopped = true; break; }
          }
          if (!holdingSlot) {
            if (!await acquireCountSlot(stop)) { stopped = true; break; }
            holdingSlot = true;
          }
          try {
            // Đăng ký nghe TRƯỚC khi điều hướng để không lỡ response.
            const respPromise = sidePage
              .waitForResponse(r => r.url().includes('/api/music/detail/'), { timeout: cfg.apiWaitMs })
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
              } else if (j && typeof j.statusCode === 'number') {
                // statusCode LẠ → KHÔNG coi là sound chết (chưa biết nghĩa thì đừng bỏ oan),
                // rơi xuống bước đọc DOM. Nhưng phải GHI LẠI: trước đây ca này bị bỏ qua trong
                // im lặng nên `10203` (đo thật 2026-08-06: body chỉ 205 byte, không có
                // musicInfo) tồn tại bao lâu cũng không ai biết. Có log mới phân loại đúng được.
                oddStatus = `${j.statusCode} (body ${body.length} byte)`;
              }
            }
            // BƯỚC 2: API không có kết quả → đọc GIAO DIỆN (DOM) trên trang vừa tải.
            //
            // ⚠ NGÂN SÁCH TÍNH BẰNG ĐỒNG HỒ, KHÔNG ĐẾM VÒNG (sửa 2026-08-06, cùng ngày).
            // Bản đầu đếm vòng ("6 vòng × 500ms = 3s"). SAI trên máy yếu: mỗi `readVideoCount`
            // có trần RIÊNG 5 giây, nên 6 vòng có thể thành **30 giây**, 12 vòng thành 60 giây —
            // suốt thời gian đó nó GIỮ slot đếm **toàn app** (chỉ có 2 slot cho mọi profile).
            //
            // Hậu quả đo được (VPS lag ~800ms/evaluate): 1 sound lỗi chiếm slot ~28 giây →
            // thông lượng đếm tụt còn ~4 sound/phút, trong khi vòng quét cuộn ra ~20 sound/phút
            // → hàng đợi (QUEUE_MAX=20) đầy vĩnh viễn → vòng quét đứng ở nhánh chờ hàng đợi →
            // **FEED NGỪNG CUỘN**. Đúng hiện tượng người dùng báo: "nó cứ dừng mãi ở 1 video"
            // trên máy ảo trong khi máy chính bình thường.
            //
            // Đếm vòng thì chi phí phụ thuộc máy CHẬM ĐẾN ĐÂU; đếm giờ thì có trần cứng.
            // Lượt 2 kiên nhẫn hơn vì link đã đáng ngờ, nhưng vẫn có trần.
            if (raw === null && !dead && !stop.requested) {
              const budget = cfg.domBudgetMs[Math.min(attempt - 1, cfg.domBudgetMs.length - 1)];
              const until = Date.now() + budget;
              while (!stop.requested) {
                // Truyền trần cho TỪNG lần gọi = phần ngân sách còn lại. Không truyền thì mặc
                // định 5s, tức MỘT lần gọi đã vượt ngân sách 2.5s → ngân sách chỉ là hình thức.
                const t = await readVideoCount(sidePage, Math.max(500, until - Date.now()));
                if (t) { raw = t; break; }
                if (Date.now() + 400 >= until) break;   // hết ngân sách → thôi, đừng ngủ vô ích
                await sleep(400);
              }
            }
          } catch (_) {}
        }
      } finally {
        // Nhả ĐÚNG MỘT LẦN và chỉ khi thực sự đang giữ. Vòng thử lại nhả slot lúc ngủ rồi xin
        // lại, nên nhả vô điều kiện ở đây sẽ nhả THỪA → semaphore tưởng còn chỗ → nhiều hơn 2
        // request /music/ chạy song song, đúng thứ QĐ-21 sinh ra để chặn.
        if (holdingSlot) { releaseCountSlot(); holdingSlot = false; }
      }
      if (stopped) break;   // đã yêu cầu dừng giữa chừng
      // Chỉ báo khi thực sự KHÔNG đọc được — statusCode lạ mà lượt sau đọc ra số thì không cần ồn.
      if (oddStatus && raw === null && !dead && !stop.requested) {
        onStatus(profile.id, 'running',
          `"${item.name}": TikTok trả statusCode lạ ${oddStatus} — không đọc được số video.`);
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

      // Cả API lẫn DOM đều không ra số → KHÔNG vào dữ liệu chính (giữ QĐ-07: không có dòng
      // '?' nào lọt vào bảng/Sheet).
      //
      // NHƯNG (2026-08-06, QĐ-33): sound CHƯA CHẾT thì không bỏ hẳn nữa — đẩy sang TAB CHỜ để
      // người kiểm tay. Người dùng mở tay các link bị bỏ và thấy trang `/music/` hiện
      // "Something went wrong": sound VẪN TỒN TẠI (header còn tác giả + số video), chỉ là TikTok
      // lỗi lúc dựng trang. Bỏ hẳn là mất dữ liệu thật.
      //
      // Phân biệt 2 ca — KHÁC NHAU hoàn toàn về cách xử:
      //   dead = true  → sound đã bị XÓA thật (API trả 400 + statusCode 10201, đã verify).
      //                  Bỏ hẳn, KHÔNG đưa vào tab chờ: không có gì cho người kiểm.
      //   dead = false → không đọc được số nhưng sound còn sống → TAB CHỜ.
      if (raw === null) {
        let queued = false;
        if (!dead && onPending) {
          // Cột "Số video" để TRỐNG (không đọc được), cột "Tình trạng" (E) do NGƯỜI DÙNG tự
          // điền nên tuyệt đối không ghi gì vào đó.
          queued = !!onPending({
            url: item.url, name: item.name, count: '',
            profileId: profile.id, profileName: profile.name,
          });
        }
        if (!stop.requested) {
          onStatus(profile.id, 'running', dead
            ? `Bỏ "${item.name}" (sound đã bị xóa/không tồn tại)`
            : queued
              ? `⏳ "${item.name}" → tab CHỜ kiểm tay (TikTok lỗi trang, không đọc được số video)`
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
      if (want) { await attachResourceBlocker(page); } else { try { await page.unroute('**/*'); } catch (_) {} }
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
      // Bản ỔN ĐỊNH — tránh báo KHÁCH oan lúc trang đang hydrate (xem session-watch.cjs).
      {
        const s = await checkLoginStateStable(page, { stop });
        if (!stop.requested && s === 'guest') { guestDetected = true; return; }
        if (s === 'logged-in') browser.markSessionVerified(profilePath);
      }
      await page.bringToFront().catch(() => {});

      // Phiên chết giữa chừng → cắt cả chu kỳ (báo lỗi ở cuối khối cycle, không báo ở đây).
      const reason = await runScanLoop({
        prefix: 'Chu kỳ [Quét]: ',
        waitSelector: 'a[data-e2e="video-music"]',
        watchLogin: true,
        deadlineAt,
        onGuestMidRun: () => { guestDetected = true; },
      });

      // FEED CẠN → KẾT THÚC PHA QUÉT SỚM, để cycleLoop đi tiếp sang nghỉ → pha XEM.
      // Đây là cách xử lý TỐT NHẤT có sẵn, và nó dùng đúng máy móc đã có sẵn:
      //   • hết dội TikTok ngay (thay vì quay vòng thoát kẹt hết phần còn lại của pha Quét —
      //     đã đo thật: gần 2 giờ cho ra 0 sound hợp lệ);
      //   • pha XEM là hoạt động GIỐNG NGƯỜI THẬT nhất app có (mở link sound, xem 40-70%
      //     thời lượng, thỉnh thoảng like) nên có cơ hội để TikTok nới lại;
      //   • hết pha Xem thì vòng sau TỰ THỬ QUÉT LẠI — đúng nghĩa "chạy lại", nhưng cách nhau
      //     hàng chục phút thay vì vài giây như dừng-rồi-chạy-lại (càng dội càng bị siết sâu).
      // KHÔNG đặt guestDetected: phiên vẫn tốt, không được cắt cả chu kỳ.
      if (reason === 'feed-starved' && !stop.requested) {
        onStatus(profile.id, 'running',
          'Chu kỳ [Quét]: kết thúc pha QUÉT SỚM vì TikTok không cấp thêm video — chuyển sang '
          + 'pha XEM luôn. Vòng sau sẽ tự thử quét lại.');
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

    // ⚠ CÙNG cái bẫy như 3 chế độ kia (xem joinScanAndCount): `cycleLoop` kết thúc vì phát hiện
    // chế độ khách, nhưng `countLoopDone` là vòng vô hạn → Promise.all treo mãi → profile kẹt
    // "đang chạy" cho tới khi khởi động lại app. Ở đây countLoop đã được tạo TRƯỚC nên không dùng
    // joinScanAndCount được, phải tự đặt cờ draining y hệt.
    await Promise.race([
      Promise.all([
        cycleLoop.then(
          (r) => { stop.draining = true; return r; },
          (e) => { stop.draining = true; throw e; },
        ),
        countLoopDone,
      ]),
      stop.promise,
    ]);
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

    // Chế độ 'current' = TAB CỦA NGƯỜI DÙNG → thoát kẹt chỉ cấp 1/2 (allowReload:false),
    // và TUYỆT ĐỐI không tự tải lại định kỳ để xả RAM (recycle:false) vì đó là tab họ đang xem.
    // Đua loop với tín hiệu Dừng: stop → resolve ngay, không chờ loop tháo gỡ (loop nền tự thoát).
    await joinScanAndCount(
      runScanLoopWithStarveBackoff({ waitSelector: null, allowReload: false, recycle: false }));
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

    // Trang search có trình phát riêng: link sound ở đây KHÔNG có data-e2e="video-music"
    // nên selector phải nhận cả 2 dạng (xem readActiveSound).
    // Đua loop với tín hiệu Dừng: stop → resolve ngay, không chờ loop tháo gỡ (loop nền tự thoát).
    await joinScanAndCount(
      runScanLoopWithStarveBackoff({
        prefix: `Tìm "${keyword}": `,
        waitSelector: 'a[data-e2e="video-music"], a[aria-label][href*="/music/"]',
        startMsg: 'Bắt đầu thu thập...',
      }));
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
  // Dùng bản ỔN ĐỊNH (đọc lại tới 20s) — bằng mức nút 🔑 "Kiểm tra đăng nhập" đang dùng.
  // Trước đây chỉ đọc 1 lần nên gặp đúng nhịp TikTok hydrate là báo KHÁCH oan, dừng cả
  // profile; dừng rồi chạy lại 2 lần thì hết. Xem chú thích ở session-watch.cjs.
  {
    const s = await checkLoginStateStable(page, { stop });
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

  await joinScanAndCount(
    runScanLoopWithStarveBackoff({
      waitSelector: 'a[data-e2e="video-music"]',
      watchLogin: true,
      startMsg: 'Bắt đầu thu thập...',
      onGuestMidRun: () => onStatus(profile.id, 'error',
        'Phiên đăng nhập BỊ HỦY giữa chừng (TikTok chuyển sang chế độ khách) — thường do profile '
        + 'đang chạy trùng ở máy khác hoặc đổi vùng VPN. Hãy bấm 🦊 đăng nhập lại.'),
    }));
  stop.stoppedEmitted = true;
  onStatus(profile.id, 'stopped', `Đã dừng. Quét ${localCount} sound.`);
}

// ── Bắt đầu 1 profile (độc lập). Trả {ok,msg}. ──
// params: { profileId, mode, keyword, minDelay, maxDelay, headless, minVideos, originalOnly,
//           chromiumProfile, seedUrls }
function startProfile(params, onData, onStatus, onPending) {
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
    // Chế độ profile Chromium riêng — RIÊNG TỪNG PROFILE (QĐ-28), không phải cài đặt chung.
    chromiumProfile: !!params.chromiumProfile,
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
  crawlOneProfile(profile, opts, onData, onStatus, stop, onPending)
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
  setCountMode,
  getCountMode,
  COUNT_MODES,
};
