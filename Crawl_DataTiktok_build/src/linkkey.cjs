// src/linkkey.cjs — Chuẩn hóa link sound, dùng CHUNG cho crawler.cjs (lọc trùng khi quét)
// và sheets.cjs (lọc trùng khi đẩy lên Google Sheet).
//
// Vì sao tách riêng (2026-07-16): trước đây mỗi file giữ một bản copy normalizeKey và đã
// LỆCH NHAU thật — 2026-07-12 crawler được thêm rút gọn link nhưng bản trong sheets.cjs
// không được cập nhật theo → nút đẩy bù coi link dài (cũ trên Sheet) và link ngắn (mới)
// là 2 sound khác nhau → đẩy trùng. Một nguồn duy nhất thì không bao giờ lệch nữa.
'use strict';

// Rút gọn link sound original về dạng chuẩn /music/original-sound-<id>: TikTok đôi khi
// nhét cả tên user vào slug ("original-sound-Nhatty-on-Air🎙️-763...") nhưng thực tế chỉ
// resolve theo ID số ở cuối — rút gọn để link đồng nhất trong bảng/Sheet VÀ lọc trùng
// chính xác (cùng 1 sound với 2 slug khác nhau không còn bị tính là 2 sound).
// CHỈ rút gọn slug original-sound / nhạc-nền; link nhạc bản quyền (slug = tên bài hát)
// giữ nguyên.
function canonicalSoundUrl(u) {
  const clean = String(u || '').trim().split(/[?#]/)[0].replace(/\/+$/, '');
  let dec = clean;
  try { dec = decodeURIComponent(clean); } catch (_) {}   // giải mã %-encode (slug tiếng Việt/emoji)
  const m = dec.match(/\/music\/([^/]*)-(\d{8,})$/);
  if (!m) return clean;
  const slug = m[1].toLowerCase();
  if (!slug.startsWith('original-sound') && !slug.startsWith('nhạc-nền')) return clean;
  return `https://www.tiktok.com/music/original-sound-${m[2]}`;
}

// Lấy RIÊNG số ID cuối URL /music/..., dùng CHỈ cho việc SO TRÙNG (không dùng để quyết định
// URL lưu/hiển thị — xem canonicalSoundUrl ở trên, vẫn cố tình giữ nguyên slug cho bài hát
// có bản quyền để dễ đọc).
function _extractMusicId(u) {
  const clean = String(u || '').trim().split(/[?#]/)[0].replace(/\/+$/, '');
  let dec = clean;
  try { dec = decodeURIComponent(clean); } catch (_) {}
  const m = dec.match(/\/music\/[^/]*-(\d{8,})$/);
  return m ? m[1] : null;
}

// Khóa so trùng (2026-07-30): với bài hát có bản quyền, `canonicalSoundUrl` cố tình GIỮ
// NGUYÊN slug tên bài (không rút gọn như original-sound) — nhưng TikTok có lúc trả về slug
// hơi khác nhau cho CÙNG một ID (khác cách viết hoa/thường không xử lý hết, dấu nháy đơn
// thẳng/cong, chuẩn hóa Unicode khác nhau cho chữ không phải Latin...). Nếu so trùng theo
// NGUYÊN VĂN url (kể cả đã lowercase) thì 2 bản ghi CÙNG 1 sound nhưng lệch slug bị coi là
// 2 sound khác nhau — gặp thực tế: 1 sound tiếng Thái bị đẩy trùng lên Sheet dù đã lọc.
// Sửa: nếu trích được ID số ở cuối URL /music/ (đúng 1 lần duy nhất, dùng CHUNG cho original-
// sound lẫn bài hát bản quyền) thì DÙNG ID làm khóa — chỉ cần cùng ID là cùng 1 sound, bất kể
// slug khác nhau thế nào. Không trích được ID (URL dạng lạ) thì lùi về so nguyên văn như cũ.
function normalizeKey(u) {
  const id = _extractMusicId(u);
  if (id) return `music:${id}`;
  return canonicalSoundUrl(u).toLowerCase();
}

module.exports = { canonicalSoundUrl, normalizeKey };
