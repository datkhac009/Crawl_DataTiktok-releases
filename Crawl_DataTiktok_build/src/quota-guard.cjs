// src/quota-guard.cjs — CẦU DAO CHỐNG DỘI QUOTA GOOGLE API (dùng chung toàn app).
//
// VÌ SAO CẦN (2026-08-03, người dùng hỏi đúng chỗ): "nếu lượt call API nhiều quá nó sẽ bị
// nghẽn thì sao". Trước đây app KHÔNG có một dòng nào xử lý 429/quota — gặp là ném lỗi như
// lỗi mạng thường, rồi timer 5s lại thử tiếp → càng dội, càng bị chặn sâu hơn.
//
// GIỚI HẠN CỦA GOOGLE SHEETS API v4 (theo tài liệu Google): 300 request/phút cho mỗi PROJECT
// và **60 request/phút cho mỗi NGƯỜI DÙNG** — "người dùng" ở đây là **danh tính xác thực**,
// tức chính Service Account. ⚠ CẢ 6 VPS đang dùng CHUNG MỘT file Service Account, nên hạn
// 60/phút áp cho TỔNG của cả 6 máy, không phải mỗi máy 60.
//
// Ước lượng thực tế mỗi máy mỗi phút (sau bản vá đọc-trước-khi-ghi):
//   ~1 đọc (đồng bộ định kỳ) + ~2-3 đọc & 2-3 ghi (mỗi lần flush) + 1 đọc & 1 ghi (nhịp tim)
//   ≈ 4-5 đọc, 3-4 ghi  →  ×6 máy ≈ 25-30 đọc, 20-25 ghi mỗi phút → còn dưới 60, nhưng KHÔNG
//   nhiều dư địa. Lúc dồn dập (flush tối đa mỗi 5s) có thể vượt.
//
// CÁCH XỬ LÝ: thấy 429/quota thì MỞ CẦU DAO — tạm ngưng gọi API tự động một lúc để cửa sổ
// quota của Google reset, thay vì thử lại liên tục. Dữ liệu KHÔNG mất: lô đang chờ vẫn nằm
// trong buffer, hết cooldown thì đẩy tiếp.
'use strict';

// Cửa sổ quota của Google tính theo PHÚT → nghỉ 60s là chắc chắn qua cửa sổ đang bị chặn.
const COOLDOWN_MS = 60 * 1000;

let _until = 0;
let _hits = 0;

// Nhận diện lỗi quota/bị chặn tốc độ từ (status, body) của response Google API.
// 429 = Too Many Requests. 403 cũng được Google dùng cho vượt quota, NHƯNG 403 còn nghĩa
// "không có quyền" (chưa chia sẻ Sheet cho service account) — nên với 403 phải soi thêm nội
// dung, không được coi mọi 403 là quota (sẽ che mất lỗi thiếu quyền, rất khó đoán).
function isQuotaError(status, body) {
  if (status === 429) return true;
  if (status !== 403) return false;
  const s = String(body || '').toLowerCase();
  return s.includes('quota') || s.includes('ratelimit') || s.includes('rate limit')
    || s.includes('resource_exhausted') || s.includes('userratelimitexceeded');
}

// Ghi nhận vừa bị chặn → mở cầu dao.
function noteQuotaHit(where = '') {
  _hits++;
  _until = Date.now() + COOLDOWN_MS;
  console.warn(`[quota] Google API báo vượt giới hạn${where ? ' (' + where + ')' : ''}`
    + ` — tạm ngưng gọi tự động ${Math.round(COOLDOWN_MS / 1000)}s (lần thứ ${_hits}).`
    + ' Dữ liệu vẫn nằm chờ, không mất.');
}

// Còn bao nhiêu ms nữa mới được gọi lại (0 = gọi được ngay).
function cooldownRemaining() { return Math.max(0, _until - Date.now()); }
function isCoolingDown() { return cooldownRemaining() > 0; }
function hits() { return _hits; }

// Chỉ dùng cho test.
function _reset() { _until = 0; _hits = 0; }

module.exports = { isQuotaError, noteQuotaHit, cooldownRemaining, isCoolingDown, hits, COOLDOWN_MS, _reset };
