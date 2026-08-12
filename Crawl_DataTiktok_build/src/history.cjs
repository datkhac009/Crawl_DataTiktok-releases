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

// ── GỘP THỐNG KÊ CỦA BẢN PHÁT HÀNH KHÁC (2026-08-12) ──
//
// VÌ SAO CẦN: dự án có 2 repo phát hành và từ v0.1.71 người dùng chuyển qua lại tự do (QĐ-37).
// Bản kia ghi thống kê theo ngày vào khoá `daily_stats` của **cùng một electron-store** (cả hai
// bản đều `app.setName('TikTokCrawler')`), còn bản này ghi `config/history.json`. Hệ quả đã gặp
// thật: cào cả buổi trên bản kia rồi quay về đây thì 📊 Lịch sử chỉ thấy nửa số liệu — nhìn như
// mất dữ liệu, dù thực ra cả hai vẫn nằm nguyên trên đĩa, chỉ là mỗi bản đọc file của mình.
//
// Định dạng bên kia: { 'YYYY-MM-DD': { <profileId>: { n: <tên profile>, c: <số sound> } } }
// May là nó lưu sẵn TÊN profile nên khớp thẳng vào `byProfile` ở đây, không phải tra id → tên.
//
// ⚠ NHẬN OBJECT THUẦN, KHÔNG tự đọc electron-store. Giữ đúng QĐ-23: file này chỉ được require
// `fs`/`path`/`paths.cjs`. `main.js` đã có `store` sẵn nên nó đọc rồi truyền vào đây.
//
// ⚠ CHỐNG CỘNG TRÙNG: ghi lại đã gộp bao nhiêu cho từng (ngày, profile) vào `_mergedFromDailyStats`,
// lần sau chỉ cộng PHẦN CHÊNH. Bắt buộc phải có — hàm này chạy mỗi lần mở app và mỗi lần mở bảng
// Lịch sử, mà số bên kia thì vẫn tăng tiếp mỗi khi người dùng quay sang chạy bản đó.
// Khoá lạ này sống sót qua các lần app tự ghi file vì `_load()` giữ NGUYÊN cả object đọc được
// (`_data = j`) chứ không dựng lại `{ days }` — đừng đổi chỗ đó.
//
// Trả về số sound thực sự cộng thêm (0 = không có gì mới).
function mergeExternalDays(daily) {
  if (!daily || typeof daily !== 'object') return 0;
  const data = _load();
  data.days = data.days || {};
  const merged = data._mergedFromDailyStats || (data._mergedFromDailyStats = {});
  let added = 0;

  for (const dayKey of Object.keys(daily)) {
    // Chỉ nhận đúng dạng ngày — khoá lạ trong store không được tạo ra ngày rác trong bảng.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) continue;
    const profiles = daily[dayKey];
    if (!profiles || typeof profiles !== 'object') continue;

    const day = data.days[dayKey] || (data.days[dayKey] = { valid: 0, byProfile: {} });
    day.byProfile = day.byProfile || {};
    const seen = merged[dayKey] || (merged[dayKey] = {});

    // ⚠ Theo dõi "đã gộp bao nhiêu" theo **profileId** (khoá bên kia), KHÔNG theo tên.
    // Tên KHÔNG duy nhất: 2 profile khác id có thể trùng tên, và mọi bản ghi thiếu tên đều gom
    // vào "(không rõ)". Bản đầu tôi theo dõi theo tên nên cái thứ hai bị coi là "số giảm" rồi bị
    // bỏ — mất số. Test 23/24 bắt đúng lỗi này (12 thay vì 15).
    // Tên chỉ dùng để cộng vào `byProfile` cho khớp định dạng của file này.
    for (const [pid, rec] of Object.entries(profiles)) {
      const name = String((rec && rec.n) || '(không rõ)');
      const now = Number(rec && rec.c) || 0;
      const delta = now - (seen[pid] || 0);
      // delta <= 0: đã gộp rồi, hoặc số bên kia bị giảm (họ xoá lịch sử). KHÔNG trừ ngược —
      // trừ đi là xoá mất số mà CHÍNH bản này đã tự đếm được trong cùng ngày.
      if (delta <= 0) continue;
      day.byProfile[name] = (day.byProfile[name] || 0) + delta;
      day.valid = (day.valid || 0) + delta;
      seen[pid] = now;
      added += delta;
    }
  }

  if (added > 0) _scheduleSave();
  return added;
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

module.exports = { recordSound, getDays, clearAll, flush, todayKey, mergeExternalDays, KEEP_DAYS };
