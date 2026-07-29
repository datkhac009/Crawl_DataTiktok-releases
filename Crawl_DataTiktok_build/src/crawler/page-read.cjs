// src/crawler/page-read.cjs — Đọc dữ liệu từ trang TikTok + cuộn feed.
//
// Nguyên tắc chung của mọi hàm ở đây: `page.evaluate` KHÔNG có timeout — nếu tab đang
// kẹt/điều hướng thì nó chờ VÔ HẠN và treo cả vòng lặp crawl (nặng nhất ở chế độ
// 'current' vì tab đó của người dùng, app không được phép đóng). Vì vậy mọi lời gọi đều
// ĐUA với một timeout để vòng lặp còn quay lại kiểm tra cờ Dừng.
'use strict';

// Đọc link + tên sound của video active (gần giữa màn hình nhất).
// Nhận cả 2 dạng link sound:
//   - For You: a[data-e2e="video-music"] (đĩa nhạc xoay)
//   - Trình phát trong trang search: a[aria-label][href*="/music/"] (không có data-e2e)
async function readActiveSound(page) {
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
// Đây là ĐƯỜNG DỰ PHÒNG: đường chính là nghe response api/music/detail/ (xem QĐ-06) vì
// API cho số chính xác (88100) thay vì text đã làm tròn ("88.1K").
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

// ── CUỘN SANG VIDEO KẾ TIẾP (2026-07-27) ──
// ⚠ TRƯỚC ĐÂY dùng `page.keyboard.press('ArrowDown')` và nó ĐÃ NGỪNG TÁC DỤNG — kiểm chứng
// trực tiếp trên TikTok thật với profile thật: bấm phím 6 lần liên tiếp, sound đọc được
// KHÔNG ĐỔI lần nào (ở cả viewport 800x600 lẫn 1536x864). Đây là gốc rễ của "feed kẹt".
// CON LĂN CHUỘT thì chạy tốt: 8 lần cuộn ra 6 sound khác nhau, ở cả hai khổ màn hình.
// Nên đổi cuộn bằng con lăn làm cách CHÍNH. Xem DECISIONS.md QĐ-13.
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

// Tải lại trang feed để giải phóng RAM, rồi chờ video xuất hiện lại.
async function recyclePage(page, waitSelector, stop) {
  if (stop.requested) return;
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(waitSelector, { timeout: 30000 });
  } catch (_) { /* reload lỗi → bỏ qua, vòng lặp vẫn tiếp tục */ }
}

module.exports = { readActiveSound, readVideoCount, scrollFeed, recyclePage };
