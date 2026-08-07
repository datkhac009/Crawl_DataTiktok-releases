// src/crawler/stuck.cjs — PHÁT HIỆN & THOÁT KẸT FEED + thống kê tiến độ cuộn.
//
// ── Theo dõi tiến độ feed: phát hiện KẸT + thống kê định kỳ (2026-07-26) ──
// Vì sao: log cũ CHỈ ghi khi quét được sound MỚI → dòng "đã quét 0 sound" sau hàng trăm lần
// cuộn có thể là (a) feed chạy tốt nhưng mọi sound gặp đều đã có trong bộ lọc trùng, hoặc
// (b) feed KẸT cứng ở 1 video — hai tình huống khác hẳn nhau mà log KHÔNG phân biệt được
// (user gặp thật: 3 giờ liền "0 sound", không có cách nào biết feed có tiến hay không).
// Tracker đếm số sound KHÁC NHAU gặp được (feed tiến = nhiều sound khác nhau) và số lần đọc
// trúng CÙNG 1 sound liên tiếp (feed đứng = trúng mãi 1 sound).
'use strict';

const { sleep } = require('./util.cjs');
const { scrollFeed, recyclePage } = require('./page-read.cjs');

const STUCK_SAME_SOUND = 20;    // đọc trúng cùng 1 sound bấy nhiêu lần LIÊN TIẾP = coi như KẸT
const FEED_STATS_EVERY = 100;   // cứ bấy nhiêu lần cuộn thì báo cáo thống kê 1 lần

// ── TRẦN THỜI GIAN đọc trúng cùng 1 sound (2026-08-06) ──
// Vì sao cần thêm bên cạnh việc đếm lần: nhịp cuộn giờ **TỰ GIÃN** theo áp lực hàng đợi (tới ×4 —
// xem queuePressureFactor trong crawler.cjs), nên 20 lần đọc có thể mất **tới 5 phút** mới tới
// ngưỡng. Đếm bằng đồng hồ thì thời gian phản ứng KHÔNG phụ thuộc nhịp cuộn nữa.
//
// ⚠ Vẫn đòi tối thiểu STUCK_SAME_MIN lần đọc: người dùng có thể đặt delay rất lớn (vd 30s), lúc đó
// 90 giây chỉ vừa đủ 3 lần đọc — kết luận kẹt từ 1–2 lần đọc là báo oan.
//
// ⚠ CỐ Ý đo "cùng 1 sound bao lâu", KHÔNG đo "bao lâu không có sound MỚI": người dùng đã nạp
// 173.000 link để lọc trùng, nên feed khoẻ vẫn có thể hàng phút không ra sound mới nào — đo cái đó
// là báo oan hàng loạt (đúng bài học của chính bộ tracker này, xem chú thích đầu file).
const STUCK_SAME_MS = 90000;
const STUCK_SAME_MIN = 5;

// Trần chờ page.evaluate() khi chẩn đoán/thoát kẹt. (2026-07-30) TRƯỚC ĐÂY 5000ms — quá
// ngắn khi nhiều profile CÙNG chế độ ẩn/hiện dùng CHUNG 1 Chromium (QĐ-02): 5 context cùng
// tải nặng trang TikTok (React SPA) một lúc trên VPS giới hạn CPU có thể khiến evaluate()
// của 1-2 context (ngẫu nhiên, tùy context nào "thua" trong tranh chấp CPU) mất hơn 5s dù
// trang KHÔNG hề hỏng — chỉ đang chậm. Bị chẩn đoán nhầm thành "không đọc được trạng thái
// trang" → kích hoạt thoát kẹt (bấm nút/cuộn/tải lại) → tải lại trang lại càng tốn thêm CPU
// đúng lúc đang tranh chấp → vòng luẩn quẩn. Nới lên 15s để có đủ thời gian cho trang thật
// sự đang chậm (không phải hỏng) kịp phản hồi, tránh chẩn đoán nhầm hàng loạt khi chạy nhiều
// profile cùng lúc.
const EVALUATE_TIMEOUT_MS = 15000;
// Số sound KHÁC NHAU liên tiếp phải đọc được thì mới coi là feed ĐÃ CHẠY LẠI ỔN ĐỊNH và hạ
// cấp độ can thiệp về 0. ⚠ Không được hạ ngay khi thấy 1 sound khác: log thật cho thấy trang
// chỉ có 2 video, cách 1 đẩy sang được video B (khác A) → nếu hạ cấp ngay thì lần kẹt sau lại
// bắt đầu từ cách 1, trong khi feed đã bật ngược về A → kẹt vĩnh viễn ở cách 1, không bao giờ
// lên cách 2/3 (bug thật, bắt được từ log user 2026-07-27).
const STUCK_RECOVERED = 5;

function makeFeedTracker() {
  let lastHref = null, sameCount = 0, stuckLevel = 0, progressRun = 0;
  let sameSince = Date.now();   // từ lúc nào bắt đầu đọc trúng `lastHref` (cho trần thời gian)
  let seen = new Set(), scrolls = 0, fresh = 0;
  return {
    // Ghi nhận 1 vòng cuộn. Trả true nếu nghi feed đang KẸT (cần can thiệp thoát kẹt).
    // (2026-07-28) TRƯỚC ĐÂY chỉ đếm khi href KHÁC null (`if (href) {...}`) — nghĩa là
    // đọc null (KHÔNG tìm thấy sound nào) liên tục KHÔNG BAO GIỜ bị coi là kẹt, vì
    // sameCount không hề nhích. Sự cố thật: 5 profile "gặp 0 sound khác nhau" suốt ~40
    // phút liên tục, không 1 dòng cảnh báo/chẩn đoán nào vì nhánh này chưa từng chạy.
    // Giờ so khớp với lần đọc TRƯỚC kể cả khi cả hai đều là null — null lặp lại cũng
    // tích lũy thành kẹt như cùng 1 sound lặp lại.
    track(href, isNew) {
      scrolls++;
      if (isNew) fresh++;
      if (href) seen.add(href);
      if (href === lastHref) {
        sameCount++;
      } else {
        lastHref = href; sameCount = 1; sameSince = Date.now();
        // Chỉ hạ cấp độ khi đọc được SOUND THẬT khác trước (không phải chỉ đổi từ/sang
        // null) — feed chạy lại ỔN ĐỊNH nghĩa là có sound mới, không phải chỉ hết null.
        if (href && ++progressRun >= STUCK_RECOVERED) stuckLevel = 0;
      }
      // KẸT nếu đủ MỘT trong hai: đủ số lần đọc, HOẶC đã quá lâu trên cùng 1 sound (xem
      // STUCK_SAME_MS — cần thiết vì nhịp cuộn tự giãn làm cách đếm-lần phản ứng chậm).
      return sameCount >= STUCK_SAME_SOUND
        || (sameCount >= STUCK_SAME_MIN && Date.now() - sameSince >= STUCK_SAME_MS);
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
    // ⚠ PHẢI reset cả `sameSince`: không reset thì sau lần can thiệp đầu tiên, đồng hồ vẫn tính
    // từ lúc cũ → vòng đọc kế tiếp đã quá 90s → báo kẹt NGAY, không cho cách vừa thử có cơ hội
    // tỏ hiệu quả. Đúng cái bẫy mà chính chú thích này đã cảnh báo với `lastHref`.
    clearStuck() { sameCount = 0; progressRun = 0; sameSince = Date.now(); },
  };
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
    new Promise(r => setTimeout(() => r(null), EVALUATE_TIMEOUT_MS)),
  ]);
  if (!base) return null;
  // Gọi TÁCH RIÊNG: _findNextButtonInPage là hàm phía Node, phải TRUYỀN VÀO page.evaluate
  // để chạy trong trang — không gọi lồng bên trong một evaluate khác được (hàm không tồn
  // tại trong ngữ cảnh trang → lỗi). Biết có nút hay không là mấu chốt để chọn cách thoát kẹt.
  const btn = await Promise.race([
    page.evaluate(_findNextButtonInPage).catch(() => null),
    new Promise(r => setTimeout(() => r(null), EVALUATE_TIMEOUT_MS)),
  ]);
  // `nextBtn` chỉ mang nhãn của nút DÙNG ĐƯỢC (giữ đúng nghĩa cũ cho dòng log).
  // 2 cờ mới tách rạch ròi 2 ca trước đây cùng ra chuỗi rỗng — xem _findNextButtonInPage.
  base.nextBtn = (btn && !btn.disabled) ? btn.label : '';
  base.nextBtnDisabled = !!(btn && btn.disabled);
  base.nextBtnMissing = !btn;
  base.nextBtnLabel = btn ? btn.label : '';
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
//
// ── TÁCH 2 CA TRƯỚC ĐÂY BỊ GỘP (2026-08-05) ──
// Trước đây hàm này loại nút `aria-disabled="true"` ngay trong bộ lọc rồi trả `null`, nên
// log chỉ in được một câu duy nhất `KHÔNG thấy nút kế tiếp` cho HAI tình huống có ý nghĩa
// khác hẳn nhau:
//   • KHÔNG có nút nào       → có thể TikTok đổi bố cục, hoặc trang chưa dựng xong.
//   • CÓ nút nhưng đang TẮT  → chính TikTok đang nói "KHÔNG CÒN VIDEO NÀO NỮA". Đây là
//     bằng chứng TRỰC TIẾP của feed cạn, và cuộn thêm bao nhiêu cũng vô ích.
// Sự cố thật dẫn tới việc tách (2026-08-05): 1 máy ảo có profile còn đăng nhập tốt (nút 🔑
// xác nhận) nhưng feed chỉ có 2 video; app quay vòng cách 1→2→3 gần 2 giờ, ra 0 sound hợp lệ,
// mà log chỉ nói "KHÔNG thấy nút kế tiếp" nên không ai biết là feed cạn hay cơ chế cuộn hỏng.
//
// Trả về:
//   null                         — không có nút nào (kể cả nút đang tắt)
//   { x, y, label }              — nút DÙNG ĐƯỢC (bấm được)
//   { disabled: true, label }    — có nút nhưng TikTok đang TẮT nó
function _findNextButtonInPage() {
  const vh = window.innerHeight, vw = window.innerWidth;
  // HÌNH DẠNG/VỊ TRÍ hợp lệ — xét cho MỌI ứng viên, chưa quan tâm bật/tắt.
  // ⚠ Điều kiện `data-e2e` là lớp an toàn THẬT: nút like/bình luận/chia sẻ LUÔN có data-e2e,
  // loại chúng ra mới không có nguy cơ bấm nhầm gây like/follow/report. Giữ nguyên.
  const shape = (el) => {
    if (el.hasAttribute('data-e2e') || el.querySelector('[data-e2e]')) return false;
    if (!el.querySelector('svg')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.width <= 130 && r.height >= 20 && r.height <= 130
      && r.top >= 0 && r.bottom <= vh && r.left >= vw * 0.45;   // cụm nút ở nửa phải màn hình
  };
  const isDisabled = (el) => el.getAttribute('aria-disabled') === 'true' || el.disabled;

  let list = Array.from(document.querySelectorAll('button.action-item')).filter(shape);
  // Dự phòng nếu TikTok đổi class: chỉ nhận phần tử được đánh dấu rõ là mũi tên.
  if (!list.length) {
    list = Array.from(document.querySelectorAll(
      '[data-e2e*="arrow"], button[aria-label*="next" i], button[aria-label*="Tiếp" i]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width >= 20 && r.height >= 20 && r.top >= 0 && r.bottom <= vh;
      });
  }
  if (!list.length) return null;

  // Nhãn NGẮN GỌN cho log: class đầy đủ của TUXButton rất dài, cắt 40 ký tự chỉ ra chuỗi
  // "TUXButton TUXButton--capsule TUXButton--" vô nghĩa.
  const labelOf = (el) => {
    const cls = String(el.className || '');
    return el.getAttribute('data-e2e') || el.getAttribute('aria-label')
      || (cls.includes('action-item') ? 'action-item' : (cls.split(/\s+/)[0] || el.tagName));
  };
  const lowest = (arr) => {
    let best = null, bestTop = -1;
    for (const el of arr) {
      const r = el.getBoundingClientRect();
      if (r.top > bestTop) { bestTop = r.top; best = el; }
    }
    return best;
  };

  const usable = list.filter(el => !isDisabled(el));
  if (!usable.length) return { disabled: true, label: labelOf(lowest(list)) };

  const best = lowest(usable);
  const r = best.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: labelOf(best) };
}

// Số link video tối đa còn coi là "feed đã cạn". Feed khoẻ dựng nhiều video (đo thật: profile
// khoẻ gặp 94 sound khác nhau/100 lần cuộn); feed bị siết chỉ còn 1-2 video và không bao giờ
// nạp thêm.
const MAX_STARVED_LINKS = 2;

// TikTok KHÔNG CÒN CẤP VIDEO cho profile/IP này hay không — suy từ kết quả diagnoseFeed.
//
// ⚠ KHÔNG kết luận khi `diag` là null ("không đọc được trạng thái trang"): đó là tình huống
// KHÔNG BIẾT, và cả app đi theo một triết lý duy nhất — chỉ kết luận khi CHẮC CHẮN (xem
// ip-guard.cjs: 2 nhà cung cấp phải đồng thuận; session-watch.cjs: 'guest' phải ổn định 3 lần;
// sheet-lock.cjs: lỗi mạng thì KHÔNG chặn). Báo oan ở đây sẽ làm profile khoẻ tự tạm dừng.
//
// Đây CHỈ là 1 trong 4 điều kiện — nơi gọi (runScanLoop) còn phải thấy feed đã kẹt, đã thử
// đủ một vòng 3 cấp thoát kẹt không hiệu quả, và không phải chế độ khách.
function looksStarved(diag) {
  if (!diag) return false;
  if (typeof diag.links !== 'number' || diag.links > MAX_STARVED_LINKS) return false;
  return diag.nextBtnDisabled === true || diag.nextBtnMissing === true;
}

// ── Thoát kẹt theo cấp độ tăng dần (user chốt 2026-07-26, chỉnh lại 2026-07-27 theo log thật) ──
// Cấp 1: BẤM NÚT "video kế tiếp" của TikTok bằng chuột thật (điều khiển chính thức của trang).
// Cấp 2: cuộn MẠNH 3 nhịp con lăn liên tiếp.
// Cấp 3: tải lại trang (phương án cuối) — do handleStuck gọi recyclePage.
// Trả chuỗi mô tả việc đã làm (để ghi log) hoặc null nếu không làm được gì.
async function unstickFeed(page, level) {
  try {
    if (level === 1) {
      try { await page.keyboard.press('Escape'); } catch (_) {}   // đóng hộp thoại nếu có
      const btn = await Promise.race([
        page.evaluate(_findNextButtonInPage).catch(() => null),
        new Promise(r => setTimeout(() => r(null), EVALUATE_TIMEOUT_MS)),
      ]);
      if (!btn) return null;
      // Nút đang TẮT thì TUYỆT ĐỐI không bấm: TikTok tắt nó vì không còn video để chuyển tới,
      // bấm vào không có tác dụng gì. Nói rõ ra để log phân biệt được với "không có nút".
      if (btn.disabled) return `KHÔNG bấm được: nút "${btn.label}" đang bị TikTok TẮT (hết video)`;
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

// Xử lý 1 lần phát hiện kẹt: chẩn đoán → ghi log rõ nguyên nhân → can thiệp theo cấp độ.
// allowReload=false cho chế độ 'current' (tab của NGƯỜI DÙNG — không bao giờ tự tải lại).
//
// Trả `{ reloaded, diag }`:
//   reloaded — đã TẢI LẠI trang (nơi gọi cần reset bộ đếm recycle)
//   diag     — kết quả chẩn đoán (null nếu không đọc được trang). Trả ra ngoài để nơi gọi
//              quyết định được việc LỚN HƠN một lần thoát kẹt: nhiều lần kẹt liên tiếp mà
//              trang chỉ còn 1-2 video và nút kế tiếp đang tắt = feed cạn, phải đổi hướng
//              thay vì quay vòng cách 1→2→3 vô hạn (xem looksStarved + runScanLoop).
async function handleStuck(page, tracker, { profileId, onStatus, prefix, waitSelector, allowReload, stop, noHref }) {
  const diag = await diagnoseFeed(page);
  let level = tracker.nextStuckLevel();
  if (!allowReload && level === 3) level = 1;   // 'current': bỏ qua cấp tải lại, quay về cấp 1
  // 3 CA cho nút kế tiếp, trước đây 2 ca cuối bị gộp thành cùng một câu (xem
  // _findNextButtonInPage): "đang TẮT" nghĩa là chính TikTok nói hết video — khác hoàn toàn
  // với "không tìm thấy nút" (có thể do đổi bố cục / trang chưa dựng xong).
  const btnInfo = !diag ? ''
    : diag.nextBtn ? `, thấy nút kế tiếp "${diag.nextBtn}"`
    : diag.nextBtnDisabled ? `, nút kế tiếp "${diag.nextBtnLabel}" ĐANG BỊ TẮT (TikTok báo hết video)`
    : ', KHÔNG thấy nút kế tiếp';
  const info = diag
    ? `${diag.links} link video, video tải ${diag.videoReady}/4, con trỏ ở ${diag.active}`
      + btnInfo
      + (diag.overlay ? `, CÓ LỚP CHE "${diag.overlay}"` : '')
    : 'không đọc được trạng thái trang';
  const how = level === 1 ? 'bấm nút video kế tiếp của TikTok'
    : level === 2 ? 'cuộn mạnh 3 nhịp con lăn'
    : 'tải lại trang';
  // Nguyên nhân khác nhau cần log khác nhau: "cùng 1 sound" (đọc trúng lặp, feed còn
  // video nhưng đứng yên) khác hẳn "không đọc được sound nào" (href null liên tục — vd
  // lớp che/đổi bố cục/chặn trang) — gộp chung dễ hiểu nhầm là feed vẫn còn video.
  const reason = noHref
    ? `KHÔNG đọc được sound nào (${STUCK_SAME_SOUND} lần liên tiếp)`
    : `feed KHÔNG chuyển video (${STUCK_SAME_SOUND} lần liên tiếp cùng 1 sound)`;
  onStatus(profileId, 'running',
    `⚠ ${prefix}${reason}`
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
  return { reloaded, diag };
}

module.exports = {
  makeFeedTracker,
  diagnoseFeed,
  unstickFeed,
  handleStuck,
  looksStarved,
  STUCK_SAME_SOUND,
  STUCK_SAME_MS,
  STUCK_SAME_MIN,
  FEED_STATS_EVERY,
  STUCK_RECOVERED,
  MAX_STARVED_LINKS,
};
