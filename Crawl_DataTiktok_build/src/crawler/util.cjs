// src/crawler/util.cjs — Tiện ích thuần (không phụ thuộc Playwright, không giữ trạng thái).
//
// Tách khỏi crawler.cjs (2026-07-28) để engine crawl chỉ còn phần LUỒNG CHẠY, dễ đọc hơn.
// Mọi hàm ở đây đều tất định / không side-effect ngoài việc chờ thời gian.
'use strict';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// Ngủ nhưng CHIA NHỎ thành từng nhịp 200ms để còn kịp phản ứng với nút Dừng.
// Nếu ngủ một phát cả 5 phút (backoff khi bị chặn) thì bấm Dừng phải chờ hết 5 phút.
async function interruptibleSleep(ms, stop) {
  const step = 200;
  for (let waited = 0; waited < ms && !stop.requested; waited += step) {
    await sleep(Math.min(step, ms - waited));
  }
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

module.exports = { sleep, rand, interruptibleSleep, parseCount, isOriginalSound };
