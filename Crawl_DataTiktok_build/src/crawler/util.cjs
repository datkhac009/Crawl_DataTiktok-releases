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

// Nhãn "original sound" theo NGÔN NGỮ CỦA NGƯỜI ĐĂNG video — TikTok bản địa hóa nhãn này
// theo tác giả, không theo người xem.
//
// (2026-07-30) TRƯỚC ĐÂY chỉ có tiếng Anh + tiếng Việt. Hậu quả thật: sound gốc của tác giả
// nước khác (bằng chứng người dùng gửi: `/music/оригинальный-звук-7648030600474299169`) bị
// coi là NHẠC BẢN QUYỀN → khi bật "Chỉ lấy Original Sound" thì bị LOẠI OAN. Feed mỗi máy
// phục vụ nội dung theo IP/vùng VPN khác nhau, nên máy ảo chạy VPN vùng khác gặp nhiều sound
// của tác giả nước ngoài hơn → sản lượng thấp hơn máy khác dù cùng profile, cùng phiên bản.
//
// ⚠ Danh sách này là BEST-EFFORT, KHÔNG đầy đủ và tôi không kiểm chứng được từng chuỗi khớp
// đúng 100% với chuỗi TikTok thật cho mọi ngôn ngữ. Thiếu một nhãn nào thì sound đó bị loại
// oan khi bật bộ lọc (không gây dữ liệu sai, chỉ mất sản lượng) → gặp link lạ dạng
// `/music/<chữ nước ngoài>-<id>` thì bổ sung vào đây. Ngược lại, thêm nhãn sai cũng vô hại
// (chỉ là không bao giờ khớp). Việc RÚT GỌN LINK thì KHÔNG phụ thuộc danh sách này —
// `canonicalSoundUrl` làm theo ID nên độc lập hoàn toàn với ngôn ngữ.
const ORIGINAL_SOUND_LABELS = [
  'original sound',       // en
  'nhạc nền',             // vi
  'оригинальный звук',    // ru
  'звук оригіналу',       // uk
  'sonido original',      // es
  'som original',         // pt
  'son original',         // fr
  'originalton',          // de
  'audio originale',      // it
  'origineel geluid',     // nl
  'suara asli',           // id
  'bunyi asal',           // ms
  'เสียงต้นฉบับ',           // th
  'orihinal na sound',    // fil
  'özgün ses',            // tr
  'الصوت الأصلي',          // ar
  'צליל מקורי',            // he
  'मूल ध्वनि',              // hi
  'অরিজিনাল সাউন্ড',        // bn
  'オリジナル楽曲',          // ja
  '오리지널 사운드',         // ko
  '原声',                  // zh
];

// Nhận diện "Original Sound" (sound gốc do người dùng tự đăng) — phân biệt với nhạc có bản
// quyền. Dùng 2 dấu hiệu: slug trong link (`/music/<nhãn>-`) HOẶC tên bắt đầu bằng nhãn đó.
//
// ⚠ PHẢI truyền link GỐC (chưa qua canonicalSoundUrl): từ 2026-07-30 canonicalSoundUrl ghép
// MỌI link về `/music/original-sound-<id>` kể cả nhạc bản quyền, nên truyền link đã rút gọn
// vào đây sẽ luôn trả true → bộ lọc mất tác dụng. Xem chú thích ở addSound() (crawler.cjs).
function isOriginalSound(url, name) {
  let u = String(url || '');
  try { u = decodeURIComponent(u); } catch (_) {}   // giải mã %-encode để bắt slug không phải ASCII
  u = u.toLowerCase();
  const n = String(name || '').trim().toLowerCase();
  for (const label of ORIGINAL_SOUND_LABELS) {
    // Trong slug, TikTok thay khoảng trắng bằng dấu gạch ngang ("original sound" →
    // "original-sound-", "оригинальный звук" → "оригинальный-звук-").
    if (u.includes(`/music/${label.replace(/\s+/g, '-')}-`)) return true;
    if (n.startsWith(label)) return true;
  }
  return false;
}

module.exports = { sleep, rand, interruptibleSleep, parseCount, isOriginalSound, ORIGINAL_SOUND_LABELS };
