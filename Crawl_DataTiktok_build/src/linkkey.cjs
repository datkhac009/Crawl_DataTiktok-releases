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

// Khóa so trùng: rút gọn về link chuẩn rồi đồng nhất hoa/thường. Link cũ dạng dài trên
// Sheet và link mới rút gọn cho ra CÙNG key.
function normalizeKey(u) {
  return canonicalSoundUrl(u).toLowerCase();
}

module.exports = { canonicalSoundUrl, normalizeKey };
