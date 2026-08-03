// src/history.cjs — LỊCH SỬ THU THẬP THEO NGÀY (mỗi máy tự ghi của mình).
//
// Vì sao cần: Google Sheet không có cột thời gian nên KHÔNG thể đếm lại "hôm nay thu được bao
// nhiêu sound" từ Sheet. Muốn biết sản lượng mỗi ngày thì phải tự ghi lúc thu được.
//
// Đếm gì: mỗi dòng thực sự vào bảng "Dữ liệu thu thập" (= đã qua bộ lọc số video = cột "Hợp
// lệ" = dòng được đẩy lên Sheet). Đây đúng nghĩa "thu được bao nhiêu sound" — KHÔNG đếm số
// lướt hay số sound quét được rồi bị lọc bỏ.
//
// Lưu ở đâu: `<cạnh .exe>/config/history.json`, KHÔNG dùng electron-store. Lý do: dữ liệu này
// người dùng muốn xem/sao lưu/đối chiếu, để cạnh .exe cùng chỗ với profiles/ và logs/ thì
// chép máy hay backup là mang theo được (electron-store nằm sâu trong AppData). Cùng quy ước
// với config/profiles.json — xem DATABASE.md.
//
// Ghi đĩa: gom trong RAM rồi ghi có TRỄ (debounce) — một đêm chạy 5 profile có thể thu vài
// trăm sound, ghi đĩa mỗi sound là vô ích. Ghi atomic (file tạm → đổi tên) để app bị giết
// giữa lúc ghi không để lại file cắt cụt (cùng nguyên tắc với session.state.json, QĐ-04).
//
// ⛔ RÀNG BUỘC BẮT BUỘC (người dùng chốt 2026-08-03): lịch sử CHỈ được lưu TRONG APP, TUYỆT
// ĐỐI KHÔNG ghi/đẩy lên Google Sheet — không thêm tab mới, không thêm cột, không gọi Google
// API ở file này. Lý do: (a) người dùng đã phản đối việc app tự thêm tab lạ trên Sheet của họ
// (xem QĐ-19, tab `_locks` đã phải chuyển sang ẩn), (b) tải Google API đang chính là điểm
// nghẽn (QĐ-20: Sheet >130k dòng gây timeout thật). Vì vậy module này CHỈ require `fs`,
// `path`, `paths.cjs` — nếu thấy ai thêm `google-api.cjs`/`sheets.cjs` vào đây là SAI.
// Hệ quả đã chấp nhận: số liệu là của RIÊNG từng máy, muốn tổng cả dàn thì cộng tay.
'use strict';

const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./paths.cjs');

const SAVE_DEBOUNCE_MS = 5000;
// Giữ bao nhiêu ngày. 400 ngày ≈ hơn 1 năm, file vẫn rất nhỏ (mỗi ngày vài trăm byte) nhưng
// đủ để so sánh cùng kỳ năm trước. Quá hạn thì tự dọn để file không phình vô hạn.
const KEEP_DAYS = 400;

let _data = null;         // { days: { 'YYYY-MM-DD': { valid, byProfile: {name: n} } } }
let _saveTimer = null;
let _dirty = false;

function _file() { return path.join(getConfigDir(), 'history.json'); }

// Ngày theo GIỜ MÁY (không dùng UTC): người dùng nghĩ theo ngày ở chỗ mình, và các VPS đều
// được đặt theo múi giờ vận hành của họ.
function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function _load() {
  if (_data) return _data;
  try {
    const raw = fs.readFileSync(_file(), 'utf8');
    const j = JSON.parse(raw);
    _data = (j && typeof j === 'object' && j.days && typeof j.days === 'object') ? j : { days: {} };
  } catch (_) {
    _data = { days: {} };   // chưa có file / file hỏng → bắt đầu lại, không làm chết app
  }
  return _data;
}

function _writeAtomic(obj) {
  const file = _file();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function _prune(data) {
  const keys = Object.keys(data.days);
  if (keys.length <= KEEP_DAYS) return;
  keys.sort();                                  // 'YYYY-MM-DD' so sánh chuỗi là đúng thứ tự
  for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete data.days[k];
}

function _scheduleSave() {
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    flush();
  }, SAVE_DEBOUNCE_MS);
  if (_saveTimer.unref) _saveTimer.unref();
}

// Ghi ngay xuống đĩa nếu đang có thay đổi chờ. Gọi khi app sắp thoát để không mất dữ liệu.
function flush() {
  if (!_dirty || !_data) return;
  try {
    _prune(_data);
    _writeAtomic(_data);
    _dirty = false;
  } catch (e) {
    console.warn('[history] Ghi lịch sử lỗi:', e.message);
  }
}

// Ghi nhận 1 sound đã thu được (1 dòng vào bảng kết quả).
function recordSound(profileName) {
  const data = _load();
  const key = todayKey();
  const day = data.days[key] || (data.days[key] = { valid: 0, byProfile: {} });
  day.valid++;
  const name = String(profileName || '(không rõ)');
  day.byProfile[name] = (day.byProfile[name] || 0) + 1;
  _scheduleSave();
}

// Trả về danh sách ngày MỚI NHẤT TRƯỚC để renderer hiện bảng.
// [{ date, valid, byProfile: {name: n} }]
function getDays({ limit = 60 } = {}) {
  const data = _load();
  return Object.keys(data.days)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, Math.max(1, limit))
    .map(date => ({
      date,
      valid: data.days[date].valid || 0,
      byProfile: data.days[date].byProfile || {},
    }));
}

function clearAll() {
  _data = { days: {} };
  _dirty = true;
  flush();
}

module.exports = { recordSound, getDays, clearAll, flush, todayKey, KEEP_DAYS };
