// src/linkkey.cjs — Chuẩn hóa link sound, dùng CHUNG cho crawler.cjs (lọc trùng khi quét)
// và sheets.cjs (lọc trùng khi đẩy lên Google Sheet).
//
// Vì sao tách riêng (2026-07-16): trước đây mỗi file giữ một bản copy normalizeKey và đã
// LỆCH NHAU thật — 2026-07-12 crawler được thêm rút gọn link nhưng bản trong sheets.cjs
// không được cập nhật theo → nút đẩy bù coi link dài (cũ trên Sheet) và link ngắn (mới)
// là 2 sound khác nhau → đẩy trùng. Một nguồn duy nhất thì không bao giờ lệch nữa.
'use strict';

// Lấy RIÊNG số ID cuối URL /music/... — nền tảng cho cả rút gọn link lẫn so trùng.
// TikTok chỉ resolve trang sound theo ID số ở cuối, phần chữ (slug) bị bỏ qua hoàn toàn.
function _extractMusicId(u) {
  const clean = String(u || '').trim().split(/[?#]/)[0].replace(/\/+$/, '');
  let dec = clean;
  try { dec = decodeURIComponent(clean); } catch (_) {}
  const m = dec.match(/\/music\/[^/]*-(\d{8,})$/);
  return m ? m[1] : null;
}

// Rút gọn MỌI link /music/ về dạng chuẩn duy nhất /music/original-sound-<id>.
//
// (2026-07-30) TRƯỚC ĐÂY chỉ rút gọn khi slug bắt đầu bằng "original-sound"/"nhạc-nền", còn
// lại giữ nguyên slug. Hậu quả thật người dùng gặp: cùng 1 profile chạy trên 2 máy cho ra
// link ĐỊNH DẠNG KHÁC NHAU — máy này ra link ngắn chuẩn, máy ảo (VPN vùng khác) ra link dài
// dạng `/music/оригинальный-звук-7648030600474299169`. Nguyên nhân KHÔNG phải máy/phiên bản
// khác nhau, mà vì TikTok gắn nhãn "original sound" theo NGÔN NGỮ CỦA NGƯỜI ĐĂNG video —
// video do người Nga đăng thì nhãn là "оригинальный звук", người Thái là "เสียงต้นฉบับ"...
// Feed mỗi máy phục vụ nội dung khác nhau (theo IP/vùng VPN) nên máy nào gặp sound của tác
// giả nước khác thì lọt link dài. Liệt kê nhãn theo từng thứ tiếng là bắt cóc bỏ đĩa (TikTok
// hỗ trợ hàng chục ngôn ngữ) → chuyển hẳn sang rút gọn THEO ID: chỉ cần có ID là ghép về
// một dạng duy nhất, độc lập hoàn toàn với ngôn ngữ/slug.
//
// ⚠ Hệ quả cần biết: link của nhạc CÓ BẢN QUYỀN giờ cũng mang tiền tố "original-sound-".
// Link vẫn mở đúng trang sound đó (TikTok bỏ qua phần chữ), nhưng URL không còn tự phân
// biệt được original hay bản quyền. Việc phân biệt đó thuộc về bộ lọc "Chỉ lấy Original
// Sound" (isOriginalSound trong crawler/util.cjs) và PHẢI xét trên link GỐC trước khi rút
// gọn — xem chú thích ở addSound() trong crawler.cjs.
function canonicalSoundUrl(u) {
  const clean = String(u || '').trim().split(/[?#]/)[0].replace(/\/+$/, '');
  const id = _extractMusicId(clean);
  if (!id) return clean;
  return `https://www.tiktok.com/music/original-sound-${id}`;
}

// Khóa so trùng: dùng ID nếu trích được — chỉ cần cùng ID là cùng 1 sound, bất kể slug khác
// nhau thế nào (khác ngôn ngữ nhãn, khác viết hoa/thường, dấu nháy thẳng/cong, chuẩn hóa
// Unicode khác nhau cho chữ không phải Latin...). Đã gặp thực tế: 1 sound tiếng Thái bị đẩy
// TRÙNG lên Sheet vì 2 lần gặp có slug lệch nhau chút, trong khi so nguyên văn URL không
// nhận ra là cùng sound. Không trích được ID (URL dạng lạ) thì lùi về so nguyên văn.
function normalizeKey(u) {
  const id = _extractMusicId(u);
  if (id) return `music:${id}`;
  return canonicalSoundUrl(u).toLowerCase();
}

module.exports = { canonicalSoundUrl, normalizeKey };
