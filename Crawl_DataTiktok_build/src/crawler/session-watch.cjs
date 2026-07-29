// src/crawler/session-watch.cjs — Theo dõi phiên đăng nhập TRONG LÚC CRAWL.
//
// Vì sao cần: cookie `sessionid` còn trong file KHÔNG có nghĩa TikTok còn chấp nhận. Sự cố
// thật: 1 profile thiếu cookie định tuyến → TikTok cho vào chế độ KHÁCH → feed khách chỉ có
// 1-2 video → app cào vô ích 3 tiếng, log chỉ báo "0 sound" nên không ai biết lý do.
// Đây là LỚP 4 trong 5 lớp phòng thủ phiên đăng nhập (xem DECISIONS.md QĐ-15).
'use strict';

const browser = require('../browser.cjs');

// ── Kiểm tra ĐÃ ĐĂNG NHẬP hay đang ở chế độ KHÁCH, hỏi thẳng trang TikTok (2026-07-27) ──
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

// Kiểm tra lúc bắt đầu là chưa đủ: TikTok có thể hủy phiên GIỮA CHỪNG (chạy trùng máy, đổi
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

module.exports = { checkLoginState, makeLoginWatcher, LOGIN_RECHECK_MS };
