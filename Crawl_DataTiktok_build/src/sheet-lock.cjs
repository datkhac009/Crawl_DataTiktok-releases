// src/sheet-lock.cjs — KHÓA LIÊN MÁY: chặn cùng một profile chạy trên 2+ máy.
//
// VẤN ĐỀ (nguyên nhân số 1 khiến TikTok hủy phiên đăng nhập):
// `profile.lock` trong browser.cjs chỉ đọc file NẰM TRONG THƯ MỤC PROFILE CỤC BỘ. Khi mỗi
// VPS giữ một bản copy riêng của profile thì mỗi máy chỉ thấy lock của chính nó → 2 máy chạy
// trùng cùng một profile mà KHÔNG máy nào biết. TikTok thấy 1 phiên phát từ 2 IP → hủy phiên
// của cả hai, phải bấm 🦊 đăng nhập lại từng profile qua RDP.
//
// CÁCH GIẢI: dùng chính Google Sheet mà các máy ĐÃ chia sẻ làm nơi ghi nhịp tim. Không cần
// thêm hạ tầng gì — Service Account + quyền Editor đã có sẵn cho việc đẩy dữ liệu.
//
// BỐ CỤC tab `_locks` (app tự tạo nếu chưa có, ở dạng ẨN — user không muốn thấy tab lạ
// trên Sheet chính; xem "Ẩn tab" bên dưới):
//   A: profile (tên thư mục)   B: host   C: pid   D: beat_ms   E: beat_readable
//
// ẨN TAB (2026-07-28): tab tạo bằng `addSheet` với `hidden: true` nên KHÔNG hiện trên thanh
// tab khi mở Sheet bình thường (menu Sheet nào đó vẫn có thể "Hiện tất cả trang tính" để
// thấy lại nếu cần soi dữ liệu). Nếu phát hiện tab đã tồn tại nhưng CHƯA ẩn (bản cũ trước
// khi có `hidden:true`, hoặc ai đó lỡ bấm hiện lại), app TỰ ẨN LẠI ở lần chạy tiếp theo.
//
// ⚠ MỖI DÒNG LÀ MỘT CẶP (profile, host) — cố ý thiết kế vậy để KHÔNG có tranh chấp ghi:
// máy A chỉ bao giờ ghi dòng của riêng nó, máy B ghi dòng của riêng nó. Nếu dùng 1 dòng cho
// mỗi profile thì 2 máy sẽ ghi đè lẫn nhau.
//
// TRIẾT LÝ XỬ LÝ LỖI (giống ip-guard.cjs): chỉ CHẶN khi chắc chắn.
//   - Đọc được và thấy máy khác có nhịp tim còn tươi (<3 phút) → CHẶN, nói rõ tên máy kia.
//   - Sheet chưa cấu hình / lỗi mạng / lỗi API → KHÔNG chặn (không được để cả dàn máy đứng im
//     chỉ vì Sheet lỗi tạm thời). Chỉ ghi log.
'use strict';

const os = require('os');
const {
  httpRequest, getToken, extractSpreadsheetId, SHEETS_BASE,
} = require('./google-api.cjs');

const LOCK_TAB = '_locks';
// Quá 3 phút không có nhịp tim = coi như máy đó đã tắt. Bằng LOCK_STALE_MS của profile.lock
// cục bộ để 2 cơ chế nói cùng một ngôn ngữ.
const STALE_MS = 3 * 60 * 1000;
// Nhịp ghi. Phải NHỎ HƠN HẲN STALE_MS để mạng chậm 1-2 nhịp không bị coi là đã tắt.
const BEAT_MS = 60 * 1000;
// Cache kết quả đọc: bấm "Chạy đã chọn" 5 profile sẽ gọi check() 5 lần liền — không cache
// thì tốn 5 lần đọc Sheet cho cùng một dữ liệu.
const READ_CACHE_MS = 20 * 1000;

let _cfg = null;            // { spreadsheetId, sa }
let _tabReady = false;
let _readCache = { at: 0, rows: null };

function host() { return os.hostname(); }

// Nhận cùng object cấu hình mà sheets.cjs dùng. KHÔNG cần cờ `enabled`: khóa liên máy là
// biện pháp an toàn, chỉ cần có Spreadsheet ID + Service Account là bật — không phụ thuộc
// việc người dùng có bật tự đẩy dữ liệu hay không.
//
// (2026-07-28) CHỈ reset trạng thái khi cấu hình THỰC SỰ đổi. Hàm này được gọi lại ở MỖI
// lần bấm Chạy (để luôn đọc đúng cấu hình mới nhất từ store) — trước đây reset vô điều
// kiện khiến MỖI profile phải kiểm tra lại "tab _locks đã tồn tại chưa" từ đầu, vừa chậm
// vừa mở rộng cửa sổ đua với nhịp tim định kỳ (2 nơi cùng thấy "chưa có tab" → cùng gửi
// lệnh tạo tab → Google từ chối lệnh thứ hai vì trùng tên → hiện ra như "xung đột").
function configure(cfg) {
  const id = extractSpreadsheetId(cfg && cfg.spreadsheetId);
  const sa = cfg && cfg.sa;
  const next = (id && sa) ? { spreadsheetId: id, sa } : null;
  const changed = JSON.stringify(next) !== JSON.stringify(_cfg);
  _cfg = next;
  if (changed) {
    _tabReady = false;
    _readCache = { at: 0, rows: null };
  }
}

function isEnabled() { return !!_cfg; }

const _range = (a1) => encodeURIComponent(`'${LOCK_TAB}'!${a1}`);

async function _append(rows, token) {
  const url = `${SHEETS_BASE}/${_cfg.spreadsheetId}/values/${_range('A:E')}:append`
    + '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  const r = await httpRequest('POST', url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: { values: rows },
  });
  if (r.status < 200 || r.status >= 300) throw new Error(`append lock HTTP ${r.status}: ${r.body.slice(0, 120)}`);
}

// Đang có 1 lệnh gọi _ensureTab() dở dang thì trả về ĐÚNG promise đó, không tạo thêm lệnh
// mới. (2026-07-28) Nếu không có khóa này: profile-start của 2 profile chạy gần như cùng
// lúc (hoặc trùng với nhịp tim định kỳ) đều thấy tab CHƯA tồn tại → CẢ HAI cùng gửi lệnh
// tạo tab → Google chấp nhận lệnh đầu, từ chối lệnh sau vì trùng tên → hiện ra như "xung
// đột". Đây chính là nguyên nhân thật của sự cố báo lúc 2026-07-28.
let _ensureTabPromise = null;

// Tạo tab `_locks` nếu chưa có (kèm dòng tiêu đề cho người đọc Sheet bằng mắt).
async function _ensureTab() {
  if (_tabReady) return;
  if (_ensureTabPromise) return _ensureTabPromise;
  _ensureTabPromise = (async () => {
    const token = await getToken(_cfg.sa);
    const meta = await httpRequest('GET',
      `${SHEETS_BASE}/${_cfg.spreadsheetId}?fields=sheets.properties(sheetId,title,hidden)`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    if (meta.status !== 200) throw new Error(`đọc metadata HTTP ${meta.status}: ${meta.body.slice(0, 120)}`);
    const allSheets = JSON.parse(meta.body).sheets || [];
    const existing = allSheets.find(s => s.properties && s.properties.title === LOCK_TAB);

    if (existing) {
      // (2026-07-28) TỰ CHỮA: tab tạo từ bản trước khi có `hidden:true` (hoặc ai đó tự bấm
      // hiện lại) — ẩn nó đi ở lần chạy tiếp theo mà không cần người dùng tự vào Sheet sửa.
      if (!existing.properties.hidden) {
        const hide = await httpRequest('POST', `${SHEETS_BASE}/${_cfg.spreadsheetId}:batchUpdate`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: {
            requests: [{
              updateSheetProperties: {
                properties: { sheetId: existing.properties.sheetId, hidden: true },
                fields: 'hidden',
              },
            }],
          },
        });
        if (hide.status >= 200 && hide.status < 300) {
          console.log(`[sheet-lock] Đã ẩn tab "${LOCK_TAB}" (không hiện trên thanh tab nữa).`);
        }
        // Lỗi ẩn không nên chặn cả tính năng khóa — best-effort, thử lại lần sau.
      }
      _tabReady = true;
      return;
    }

    // Tạo MỚI ở dạng ẨN NGAY TỪ ĐẦU (2026-07-28): người dùng không muốn thấy tab lạ trên
    // Sheet chính, nhưng vẫn cần nơi lưu trạng thái dùng chung giữa các máy — đây là cách
    // dung hòa: dữ liệu vẫn ở trong CHÍNH spreadsheet đó (không cần Sheet thứ hai), nhưng
    // không xuất hiện trên thanh tab khi mở bình thường.
    const add = await httpRequest('POST', `${SHEETS_BASE}/${_cfg.spreadsheetId}:batchUpdate`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: { requests: [{ addSheet: { properties: { title: LOCK_TAB, hidden: true } } }] },
    });
    if (add.status < 200 || add.status >= 300) throw new Error(`tạo tab HTTP ${add.status}: ${add.body.slice(0, 120)}`);
    await _append([['profile', 'host', 'pid', 'beat_ms', 'beat_readable']], token);
    _tabReady = true;
    console.log(`[sheet-lock] Đã tạo tab ẩn "${LOCK_TAB}" để chống chạy trùng profile liên máy.`);
  })();
  try {
    await _ensureTabPromise;
  } finally {
    _ensureTabPromise = null;   // xong (dù thành công hay lỗi) → lần sau gọi lại là lệnh mới
  }
}

// Đọc toàn bộ bảng khóa. Trả mảng { rowNo, profile, host, pid, beat }.
async function _readRows({ force = false } = {}) {
  if (!force && _readCache.rows && Date.now() - _readCache.at < READ_CACHE_MS) return _readCache.rows;
  const token = await getToken(_cfg.sa);
  const r = await httpRequest('GET',
    `${SHEETS_BASE}/${_cfg.spreadsheetId}/values/${_range('A:E')}?majorDimension=ROWS`,
    { headers: { 'Authorization': `Bearer ${token}` } });
  // 400 = tab không tồn tại (vd người dùng xóa tay) → cho tạo lại ở lần sau.
  if (r.status === 400) { _tabReady = false; return []; }
  if (r.status !== 200) throw new Error(`đọc lock HTTP ${r.status}: ${r.body.slice(0, 120)}`);
  const values = JSON.parse(r.body).values || [];
  const rows = [];
  values.forEach((v, i) => {
    if (!v || !v[0]) return;
    if (String(v[0]).toLowerCase() === 'profile') return;   // dòng tiêu đề
    rows.push({
      rowNo: i + 1,                    // Sheet đánh số dòng từ 1
      profile: String(v[0]),
      host: String(v[1] || ''),
      pid: String(v[2] || ''),
      beat: Number(v[3]) || 0,
    });
  });
  _readCache = { at: Date.now(), rows };
  return rows;
}

// Ghi nhịp tim cho các profile của MÁY NÀY. beatMs = 0 nghĩa là nhả khóa (máy khác thấy
// stale ngay, không phải chờ 3 phút).
async function _write(profileFolders, beatMs) {
  if (!_cfg || !profileFolders || !profileFolders.length) return;
  await _ensureTab();
  const rows = await _readRows({ force: true });
  const token = await getToken(_cfg.sa);
  const me = host();
  const pid = String(process.pid);
  const readable = beatMs ? new Date(beatMs).toLocaleString('vi-VN') : '(đã nhả)';

  const updates = [];
  const appends = [];
  for (const p of profileFolders) {
    const val = [p, me, pid, beatMs, readable];
    const hit = rows.find(r => r.profile === p && r.host === me);
    if (hit) updates.push({ range: `'${LOCK_TAB}'!A${hit.rowNo}:E${hit.rowNo}`, values: [val] });
    else if (beatMs) appends.push(val);   // nhả khóa mà chưa có dòng thì không cần tạo dòng
  }

  if (updates.length) {
    const r = await httpRequest('POST', `${SHEETS_BASE}/${_cfg.spreadsheetId}/values:batchUpdate`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: { valueInputOption: 'RAW', data: updates },
    });
    if (r.status < 200 || r.status >= 300) throw new Error(`ghi nhịp tim HTTP ${r.status}: ${r.body.slice(0, 120)}`);
  }
  if (appends.length) await _append(appends, token);
  _readCache = { at: 0, rows: null };   // vừa đổi dữ liệu → lần đọc sau phải lấy mới
}

// ── API công khai ──

// Profile này có đang được MÁY KHÁC chạy không?
// Trả { state: 'free' | 'busy' | 'unknown' | 'off', host, pid, ago, msg }
//   'busy'    → máy khác đang chạy, nhịp tim còn tươi → NÊN CHẶN
//   'unknown' → không kiểm được (mạng/API lỗi) → KHÔNG chặn
//   'off'     → chưa cấu hình Sheet → KHÔNG chặn
async function check(profileFolder) {
  if (!_cfg) return { state: 'off' };
  if (!profileFolder) return { state: 'unknown', msg: 'thiếu tên thư mục profile' };
  try {
    await _ensureTab();
    const rows = await _readRows();
    const me = host();
    const now = Date.now();
    const others = rows
      .filter(r => r.profile === profileFolder && r.host && r.host !== me && now - r.beat < STALE_MS)
      .sort((a, b) => b.beat - a.beat);
    if (!others.length) return { state: 'free' };
    const o = others[0];
    return { state: 'busy', host: o.host, pid: o.pid, ago: Math.round((now - o.beat) / 1000) };
  } catch (e) {
    return { state: 'unknown', msg: e.message };
  }
}

// Gọi định kỳ cho các profile ĐANG chạy trên máy này. Lỗi thì im lặng bỏ qua — mất 1 nhịp
// tim không sao (ngưỡng stale 3 phút = chịu được 2 nhịp lỗi liên tiếp).
async function heartbeat(profileFolders) {
  try { await _write(profileFolders, Date.now()); }
  catch (e) { console.warn('[sheet-lock] Ghi nhịp tim lỗi (thử lại nhịp sau):', e.message); }
}

// Nhả khóa khi dừng profile → máy khác chạy được NGAY, không phải chờ hết 3 phút stale.
async function release(profileFolders) {
  try { await _write(profileFolders, 0); }
  catch (e) { console.warn('[sheet-lock] Nhả khóa lỗi (sẽ tự stale sau 3 phút):', e.message); }
}

module.exports = { configure, isEnabled, check, heartbeat, release, BEAT_MS, STALE_MS, LOCK_TAB };
