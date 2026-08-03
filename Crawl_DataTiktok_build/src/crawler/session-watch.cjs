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

// ── KẾT LUẬN "KHÁCH" PHẢI ỔN ĐỊNH mới được tin (2026-07-31) ──
// SỰ CỐ THẬT: "🔑 Kiểm tra đăng nhập" báo ĐÃ ĐĂNG NHẬP, nhưng bấm ▶ Chạy thì báo chế độ
// KHÁCH; dừng rồi chạy lại 2 lần là bình thường. Nguyên nhân là BẤT ĐỐI XỨNG giữa 2 luồng:
//   • verifyProfileLogin() (nút 🔑) đọc trang tối đa 12 lần × 2s = 24s, chú thích trong đó
//     ghi rõ bài học đo được: "kiểm tra sớm quá sẽ ra 'unknown' — 9s chưa đủ, 20s đủ".
//   • Luồng crawl lại chỉ đọc MỘT LẦN DUY NHẤT rồi chốt luôn. Thấy nút "Log in" đúng nhịp
//     TikTok đang hydrate (nút hiện thoáng qua trước khi cookie được áp) là kết luận KHÁCH
//     và DỪNG HẲN cả profile.
// Đúng "2 lần thì được" khớp với hiện tượng phụ thuộc thời điểm: lần sau trang đã có cache
// nên hydrate nhanh hơn, không kịp lộ nút Log in.
//
// Cách xử lý — theo đúng triết lý đã dùng ở ip-guard (2 nhà cung cấp phải ĐỒNG THUẬN) và
// sheet-lock (chỉ chặn khi CHẮC CHẮN): tin ngay tin TỐT, bắt tin XẤU phải ổn định.
//   - Thấy 'logged-in' → tin NGAY (nav đã dựng + không có nút Log in = chắc chắn).
//   - Thấy 'guest'     → CHƯA kết luận, đọc lại tới hết cửa sổ thời gian; chỉ chốt 'guest'
//                        nếu tới cuối vẫn là 'guest' và chưa lần nào thấy 'logged-in'.
//   - 'unknown'        → chờ tiếp trong cửa sổ (giao diện chưa dựng xong).
const STABLE_WINDOW_MS = 20000;   // trần chờ khi giao diện chưa dựng ('unknown'), bằng mức
                                  // verifyProfileLogin đã đo là đủ (9s chưa đủ, 20s đủ)
const STABLE_GAP_MS = 2000;
const GUEST_CONFIRM = 3;          // số lần đọc LIÊN TIẾP cùng nói 'guest' mới được chốt

// Chốt 'guest' cần GUEST_CONFIRM lần đọc LIÊN TIẾP — nhanh (~4-6s cho phiên khách thật)
// nhưng vẫn loại được cái nháy hydrate (nút Log in hiện thoáng 1 nhịp rồi mất).
// `stop`: cờ dừng của profile — BẮT BUỘC tôn trọng, nếu không thì bấm Dừng giữa lúc đang
// đọc lại sẽ phải chờ hết cửa sổ mới phản hồi.
async function checkLoginStateStable(page, { windowMs = STABLE_WINDOW_MS, gapMs = STABLE_GAP_MS, stop = null } = {}) {
  const t0 = Date.now();
  let guestRun = 0;
  while (true) {
    if (stop && stop.requested) return 'unknown';   // đang dừng → không kết luận gì
    const s = await checkLoginState(page);
    if (s === 'logged-in') return 'logged-in';      // tin tốt → tin ngay
    if (s === 'guest') {
      if (++guestRun >= GUEST_CONFIRM) return 'guest';
    } else {
      guestRun = 0;                                 // 'unknown' xen vào → đếm lại từ đầu
    }
    if (Date.now() - t0 >= windowMs) return 'unknown';   // hết trần mà chưa chắc → KHÔNG chặn
    if (stop && stop.requested) return 'unknown';
    await new Promise(r => setTimeout(r, gapMs));
  }
}

// Kiểm tra lúc bắt đầu là chưa đủ: TikTok có thể hủy phiên GIỮA CHỪNG (chạy trùng máy, đổi
// vùng VPN, nghi ngờ hoạt động). Trước đây app cứ cào tiếp hàng giờ ở chế độ khách.
// Trả về: 'ok' | 'guest'. Tự chốt phiên VÀNG mỗi lần xác nhận còn đăng nhập.
const LOGIN_RECHECK_MS = 15 * 60 * 1000;

function makeLoginWatcher(page, profilePath, stop = null) {
  let last = Date.now();
  return async function check() {
    if (Date.now() - last < LOGIN_RECHECK_MS) return 'ok';
    last = Date.now();
    // Dùng bản ỔN ĐỊNH: cắt cả phiên đang chạy tốt hàng giờ chỉ vì 1 lần đọc trúng nhịp
    // hydrate là quá đắt (xem chú thích checkLoginStateStable).
    const s = await checkLoginStateStable(page, { stop });
    if (s === 'guest') return 'guest';
    if (s === 'logged-in') browser.markSessionVerified(profilePath);
    return 'ok';
  };
}

module.exports = { checkLoginState, checkLoginStateStable, makeLoginWatcher, LOGIN_RECHECK_MS };
