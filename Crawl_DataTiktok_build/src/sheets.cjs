// src/sheets.cjs — Đẩy dữ liệu lên Google Sheets (API v4) bằng Service Account.
//
// Cơ chế (học từ CrawlView_App):
//   1. Xác thực: xem src/google-api.cjs (ký JWT RS256 → access_token, cache 55 phút).
//      Phần đó ĐÃ TÁCH RA để sheet-lock.cjs dùng chung — không giữ 2 bản sao (QĐ-10).
//   2. Ghi dữ liệu bằng values:append trên phạm vi A:Z (thêm dòng mới vào cuối tab,
//      dò dòng cuối xét MỌI cột — an toàn khi nhiều máy/tiến trình cùng ghi 1 Sheet).
//   3. Gộp lô: buffer nhiều dòng, flush khi đủ 10 dòng hoặc sau 5 giây.
'use strict';

const {
  httpRequest, getToken, extractSpreadsheetId, SHEETS_BASE,
} = require('./google-api.cjs');

const BATCH_SIZE = 10;
const FLUSH_MS = 5000;

// ── Append nhiều dòng vào cuối tab (atomic phía Google — AN TOÀN khi nhiều máy/tiến
// trình cùng ghi vào một Sheet, vì mỗi request được Google xử lý tuần tự, không có
// khoảng hở "đọc dòng cuối rồi tự ghi cứng" như cách tự tính dòng ở client). ──
//
// LƯU Ý phạm vi: dùng A:Z (không phải A:D) để append DÒ ĐÚNG dòng cuối thật của bảng
// xét MỌI cột — nếu chỉ dùng A:D, khi cột E/F (vd cột Tình trạng người dùng tự điền)
// có dữ liệu dài hơn cột A:D, append sẽ bị đánh lừa và điền NHẦM vào giữa bảng (đã gặp
// thực tế: A:D hết ở dòng 7143, E/F tới 15876 → append ghi đè vào 7144 thay vì 15877).
// Values chỉ có 4 cột (Tên/Link/Video/Profile) — Google chỉ ghi đúng 4 cột đó của dòng
// mới, các cột còn lại (E→Z) của dòng mới vẫn để trống, không ảnh hưởng gì.
async function appendRows(spreadsheetId, tab, rows, sa) {
  if (!rows.length) return;
  const token = await getToken(sa);
  const range = encodeURIComponent(`${tab}!A:Z`);
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${range}:append`
    + `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const resp = await httpRequest('POST', url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: { values: rows },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`append HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  }
}

// ── Đọc cột Link (cột B) đã có sẵn trên tab → mảng link, để lọc trùng ──
// Trần thời gian RIÊNG, dài hơn mặc định (2026-07-29): người dùng thực tế có tab
// >137.000 dòng (nhiều máy cùng đẩy vào 1 Sheet lâu ngày) — 25s (trần chung của
// httpRequest) vẫn không đủ để Google trả hết dữ liệu cho một lần đọc nguyên cột B cỡ đó.
// Cho hàm này một trần dài hơn hẳn (2 phút/lần thử) vì lệnh này KHÔNG nằm trên đường chặn
// "chạy tất cả" (chỉ profile đầu phiên mới gọi, không làm treo các profile sau) và người
// dùng bấm "Đẩy lên Sheet" đã thấy nút chuyển "⏳ Đang đẩy..." nên chờ lâu hơn vẫn ổn.
// Retry 1 lần khi lỗi/timeout: đây là GET thuần đọc, gọi lại không gây trùng dữ liệu.
const READ_LINKS_TIMEOUT_MS = 120000;

// Đọc cột B, có thể chỉ đọc TỪ MỘT DÒNG TRỞ ĐI (đọc phần mới thêm ở cuối).
// Trả `{ links, rawRows }`:
//   links   = danh sách link không rỗng (đã trim)
//   rawRows = SỐ DÒNG THÔ Google trả về (kể cả dòng rỗng) — cần để tính mốc đọc tiếp lần sau.
//             Không dùng links.length được vì nó đã lọc bỏ dòng rỗng → mốc sẽ lệch dần.
//
// (2026-08-03) Vì sao cần đọc TỪNG PHẦN: tab thật đã 156.000 dòng. Đọc lại TOÀN BỘ mỗi lần
// đồng bộ vừa chậm (hàng chục giây) vừa nặng, nên trước đây chỉ dám chạy 5–15 phút/lần —
// chính khoảng hở đó sinh trùng liên máy: máy A đẩy sound X, máy B phải chờ tới lần đọc kế
// tiếp mới biết, trong lúc chờ mà B cũng quét trúng X thì B đẩy X lần nữa. Đọc phần đuôi
// (vài trăm dòng mới) thì rẻ và nhanh → chạy được mỗi phút, thu hẹp cửa sổ trùng hàng chục lần.
async function readLinkColumn(spreadsheetId, tab, sa, { startRow = 1 } = {}) {
  const id = extractSpreadsheetId(spreadsheetId);
  if (!id) return { links: [], rawRows: 0 };
  const from = Math.max(1, parseInt(startRow, 10) || 1);
  const a1 = from > 1 ? `${tab || 'Data'}!B${from}:B` : `${tab || 'Data'}!B:B`;
  const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(a1)}?majorDimension=ROWS`;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await getToken(sa);
      const resp = await httpRequest('GET', url, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeoutMs: READ_LINKS_TIMEOUT_MS,
      });
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`đọc Sheet HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
      }
      let data;
      try { data = JSON.parse(resp.body); } catch (_) { data = {}; }
      const rows = data.values || [];
      return {
        links: rows.map(r => (r && r[0] ? String(r[0]).trim() : '')).filter(Boolean),
        rawRows: rows.length,
      };
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

// Đọc TOÀN BỘ cột Link (giữ nguyên chữ ký cũ — dùng ở đầu phiên và ở nút "Đẩy lên Sheet").
async function readLinks(spreadsheetId, tab, sa) {
  const { links } = await readLinkColumn(spreadsheetId, tab, sa, { startRow: 1 });
  return links;
}

// Khóa so trùng dùng CHUNG với crawler.cjs (src/linkkey.cjs) — trước đây là bản copy
// riêng và ĐÃ TỪNG LỆCH (crawler thêm rút gọn link 2026-07-12, bản ở đây không theo →
// link dài cũ và link ngắn mới bị coi là 2 sound → nút đẩy bù tạo trùng).
const { normalizeKey } = require('./linkkey.cjs');

// ── Link ĐÃ CÓ trên Sheet (từ máy này lẫn máy khác) — chặn trùng LIÊN MÁY ở cửa đẩy ──
// Nạp lúc bắt đầu phiên + cập nhật định kỳ (main.js đọc lại cột B). Mọi đường đẩy tự
// động (enqueue/flush) đều bỏ qua link có trong đây.
const _knownLinks = new Set();
// (2026-07-29) Cờ "đã nạp được ít nhất 1 lần" — Sheet giờ >130.000 dòng, lần đọc đầu phiên
// có thể chậm/lỗi (xem readLinks). NẾU chưa nạp được mà vẫn cho enqueue() đẩy tự động thì
// coi như "không biết link nào đã có" → mọi thứ bị coi là mới → CHÍNH LÀ NGUỒN GÂY TRÙNG
// người dùng gặp phải. Trước khi có lần nạp thành công đầu tiên, enqueue() tạm dừng đẩy tự
// động (dữ liệu vẫn hiện trong bảng ở app, không mất — chỉ chưa lên Sheet), main.js tự thử
// lại đọc mỗi phút cho tới khi thành công.
let _seeded = false;
function isSeeded() { return _seeded; }
function updateKnownLinks(links) {
  let added = 0;
  for (const u of (links || [])) {
    const k = normalizeKey(u);
    if (k && !_knownLinks.has(k)) { _knownLinks.add(k); added++; }
  }
  _seeded = true;
  // Gỡ luôn khỏi buffer đang chờ những link đã lên Sheet bằng đường khác (máy khác đẩy).
  dropFromBuffer(links);
  return added;
}

// ── ĐẨY BÙ THỦ CÔNG: chỉ đẩy những dòng CHƯA có trên Sheet (idempotent) ──
// rows = [[name, url, count, profile], ...] (toàn bộ bảng "Dữ liệu thu thập").
// Đọc lại cột B mới nhất trên Sheet → lọc bỏ dòng đã có → append phần còn lại theo lô.
// Bấm bao nhiêu lần cũng không tạo trùng. Trả { ok, pushed, skipped, total }.
async function pushDedup(cfgRaw, rows) {
  const spreadsheetId = extractSpreadsheetId(cfgRaw.spreadsheetId);
  const tab = cfgRaw.tab || 'Data';
  const sa = cfgRaw.sa;
  if (!spreadsheetId || !sa) return { ok: false, msg: 'Chưa cấu hình Google Sheet (ID/Service Account).' };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, msg: 'Bảng dữ liệu đang trống.' };

  // Link đã có trên Sheet (đọc MỚI ngay lúc bấm — thấy cả những gì máy khác vừa ghi).
  const existing = new Set((await readLinks(spreadsheetId, tab, sa)).map(normalizeKey));

  const fresh = [];
  const seenInBatch = new Set(); // chống trùng ngay trong chính bảng gửi lên
  for (const r of rows) {
    const key = normalizeKey(r && r[1]);
    if (!key || existing.has(key) || seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    fresh.push(r);
  }
  if (!fresh.length) return { ok: true, pushed: 0, skipped: rows.length, total: rows.length };

  // Append theo lô 200 dòng/lần cho nhẹ request.
  for (let i = 0; i < fresh.length; i += 200) {
    await appendRows(spreadsheetId, tab, fresh.slice(i, i + 200), sa);
  }
  return { ok: true, pushed: fresh.length, skipped: rows.length - fresh.length, total: rows.length };
}

// ── DỌN TRÙNG TRÊN SHEET (2026-07-29) ──
// Cơ chế lọc trùng ở enqueue()/pushDedup() chỉ NGĂN trùng phát sinh từ giờ trở đi — không
// dọn được trùng đã LỠ có sẵn trên Sheet (từ trước khi vá isSeeded, hoặc 2 máy cùng phát
// hiện 1 sound đang trend trong lúc cả hai chưa kịp thấy nhau, xem giải thích ở
// DECISIONS.md QĐ-19). Bộ 3 hàm dưới đây quét TOÀN BỘ tab, gom theo Link trùng, xoá dòng
// thừa — bổ sung (không thay thế) cơ chế phòng ngừa ở trên.
//
// Đọc rộng tới cột Z (không chỉ B) để biết dòng nào có dữ liệu người dùng TỰ GHI ở cột E
// trở đi (xem USER_GUIDE.md — "các cột từ E trở đi để trống cho bạn tự dùng") — ưu tiên
// GIỮ LẠI dòng đó khi xoá trùng, tránh xoá nhầm mất ghi chú tay của người dùng.
const SCAN_TIMEOUT_MS = 150000;

async function _fetchAllRows(spreadsheetId, tab, sa) {
  const token = await getToken(sa);
  const range = encodeURIComponent(`${tab || 'Data'}!A:Z`);
  const resp = await httpRequest('GET',
    `${SHEETS_BASE}/${spreadsheetId}/values/${range}?majorDimension=ROWS`,
    { headers: { 'Authorization': `Bearer ${token}` }, timeoutMs: SCAN_TIMEOUT_MS });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`đọc Sheet HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  }
  let data;
  try { data = JSON.parse(resp.body); } catch (_) { data = {}; }
  return data.values || [];
}

async function _getSheetId(spreadsheetId, tab, sa) {
  const token = await getToken(sa);
  const resp = await httpRequest('GET',
    `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { headers: { 'Authorization': `Bearer ${token}` } });
  if (resp.status !== 200) throw new Error(`đọc metadata HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(resp.body); } catch (_) { data = {}; }
  const found = (data.sheets || []).find(s => s.properties && s.properties.title === (tab || 'Data'));
  if (!found) throw new Error(`Không tìm thấy tab "${tab || 'Data'}" trên Sheet.`);
  return found.properties.sheetId;
}

// Điểm "đầy đủ dữ liệu tự ghi" = số ô không rỗng từ cột E (index 4) trở đi.
function _completeness(row) {
  let n = 0;
  for (let i = 4; i < row.length; i++) if (row[i] !== undefined && String(row[i]).trim() !== '') n++;
  return n;
}

// Quét TOÀN BỘ tab, xác định dòng THỪA cần xoá cho mỗi nhóm link trùng — KHÔNG xoá gì ở
// bước này (dùng để hiện xem trước/xác nhận trước khi xoá thật).
async function scanDuplicates(spreadsheetId, tab, sa) {
  const id = extractSpreadsheetId(spreadsheetId);
  if (!id) return { ok: false, msg: 'Thiếu Spreadsheet ID.' };
  const rows = await _fetchAllRows(id, tab, sa);

  const groups = new Map(); // normalizeKey(link) -> [{ rowIndex (1-based, dòng 1 = header), row }]
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const key = normalizeKey(row[1]);
    if (!key) continue;
    const rowIndex = i + 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ rowIndex, row });
  }

  const toDelete = [];
  const sample = [];
  let dupGroupCount = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    dupGroupCount++;
    // Giữ dòng nhiều dữ liệu tự ghi nhất; ngang nhau thì giữ dòng nhỏ hơn (cũ hơn/xuất hiện trước).
    let keep = list[0];
    for (const item of list.slice(1)) {
      const a = _completeness(item.row), b = _completeness(keep.row);
      if (a > b || (a === b && item.rowIndex < keep.rowIndex)) keep = item;
    }
    const deleteRows = list.filter(x => x.rowIndex !== keep.rowIndex).map(x => x.rowIndex);
    toDelete.push(...deleteRows);
    if (sample.length < 20) sample.push({ link: keep.row[1] || '', total: list.length, keepRow: keep.rowIndex, deleteRows });
  }
  toDelete.sort((a, b) => b - a); // GIẢM DẦN — xoá từ dưới lên để không lệch dòng khác

  return {
    ok: true,
    totalRows: rows.length - 1,
    dupGroupCount,
    toDeleteCount: toDelete.length,
    toDeleteRowIndexes: toDelete,
    sample,
  };
}

// Xoá thật các dòng (rowIndexes: mảng số dòng 1-based, header = dòng 1). PHẢI xoá theo thứ
// tự GIẢM DẦN — batchUpdate áp dụng các request tuần tự lên trạng thái hiện có, xoá dòng
// nhỏ trước sẽ làm lệch index của mọi dòng lớn hơn còn lại trong CÙNG 1 lần gọi.
async function deleteRows(spreadsheetId, tab, sa, rowIndexes) {
  const id = extractSpreadsheetId(spreadsheetId);
  if (!id || !Array.isArray(rowIndexes) || !rowIndexes.length) return { ok: true, deleted: 0 };
  const sheetId = await _getSheetId(id, tab, sa);
  const sorted = [...rowIndexes].sort((a, b) => b - a);
  const token = await getToken(sa);

  const CHUNK = 300; // chia nhỏ cho an toàn, tránh 1 request quá lớn
  let deleted = 0;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const slice = sorted.slice(i, i + CHUNK);
    const requests = slice.map(rowIndex => ({
      deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex } },
    }));
    const resp = await httpRequest('POST', `${SHEETS_BASE}/${id}:batchUpdate`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: { requests },
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`xoá dòng HTTP ${resp.status}: ${resp.body.slice(0, 200)} (đã xoá ${deleted}/${sorted.length} dòng trước khi lỗi)`);
    }
    deleted += slice.length;
  }
  return { ok: true, deleted };
}

// Bước THỰC THI — gọi SAU khi người dùng đã xem trước (scanDuplicates) và xác nhận. Tự
// QUÉT LẠI TỪ ĐẦU (không dùng lại kết quả scan cũ) để tránh xoá nhầm nếu Sheet đã đổi giữa
// lúc xem trước và lúc bấm xác nhận (máy khác vừa đẩy/xoá thêm dòng trong lúc đó).
async function cleanDuplicates(spreadsheetId, tab, sa) {
  const scan = await scanDuplicates(spreadsheetId, tab, sa);
  if (!scan.ok || !scan.toDeleteCount) return { ...scan, deleted: 0 };
  const del = await deleteRows(spreadsheetId, tab, sa, scan.toDeleteRowIndexes);
  return { ...scan, deleted: del.deleted };
}

// ── Kiểm tra kết nối: đọc metadata spreadsheet ──
async function testConnection(spreadsheetId, sa) {
  const id = extractSpreadsheetId(spreadsheetId);
  if (!id) return { ok: false, msg: 'Thiếu Spreadsheet ID.' };
  let token;
  try { token = await getToken(sa); }
  catch (e) { return { ok: false, msg: e.message }; }

  const resp = await httpRequest('GET',
    `${SHEETS_BASE}/${id}?fields=properties.title,sheets.properties.title`,
    { headers: { 'Authorization': `Bearer ${token}` } });

  if (resp.status === 200) {
    let title = '';
    let tabs = [];
    try {
      const d = JSON.parse(resp.body);
      title = d.properties?.title || '';
      tabs = (d.sheets || []).map(s => s.properties?.title).filter(Boolean);
    } catch (_) {}
    return { ok: true, msg: `Kết nối OK: "${title}"`, title, tabs };
  }
  if (resp.status === 403) {
    return { ok: false, msg: 'Bị từ chối (403). Hãy chia sẻ Sheet cho email service account (quyền Editor).' };
  }
  if (resp.status === 404) {
    return { ok: false, msg: 'Không tìm thấy Sheet (404). Kiểm tra lại Spreadsheet ID.' };
  }
  return { ok: false, msg: `HTTP ${resp.status}: ${resp.body.slice(0, 200)}` };
}

// ── Batch writer (1 sheet chung cho mọi profile) ──
let _cfg = null;          // { enabled, spreadsheetId, tab, sa }
let _buffer = [];
let _timer = null;
let _flushChain = Promise.resolve();
let _onError = null;      // callback báo lỗi ra UI

function configure(cfg, onError) {
  const next = cfg && cfg.enabled ? {
    enabled: true,
    spreadsheetId: extractSpreadsheetId(cfg.spreadsheetId),
    tab: cfg.tab || 'Data',
    sa: cfg.sa,
  } : null;
  // Đổi sang Sheet/tab KHÁC thì mốc dòng cũ vô nghĩa → phải quên đi để lần sau đọc lại toàn bộ.
  // ⚠ CHỈ khi thực sự đổi: configure() được gọi lại ở MỖI lần bấm Chạy, reset vô điều kiện là
  // lặp lại đúng cái bẫy đã gặp ở sheet-lock (QĐ-19) — mất mốc liên tục, đọc lại toàn bộ mãi.
  const changedTarget = (next && next.spreadsheetId) !== (_cfg && _cfg.spreadsheetId)
    || (next && next.tab) !== (_cfg && _cfg.tab);
  _cfg = next;
  if (changedTarget) _nextRow = 0;
  _onError = onError || null;
}

// ── ĐỌC DỮ LIỆU MỚI NHẤT TỪ SHEET (đọc tăng dần từ mốc dòng) ──
// MỘT NƠI DUY NHẤT giữ mốc `_nextRow`: cả vòng đồng bộ định kỳ (main.js) lẫn bước đẩy
// (flush) đều gọi hàm này. Nếu mỗi nơi tự giữ mốc riêng thì 2 mốc SẼ lệch nhau — đúng bẫy
// QĐ-10 ("có ≥2 bản sao của cùng một logic thì chúng SẼ lệch").
//
// Trả `{ links, rawRows, from, full }` — `links` là phần MỚI đọc được (để nơi gọi nạp thêm
// vào bộ lọc quét của crawler).
let _nextRow = 0;              // 0 = chưa biết mốc → phải đọc toàn bộ
let _refreshInFlight = null;   // gộp các lời gọi trùng nhau, tránh 2 nơi cùng đọc rồi cùng
                               // đẩy mốc lên → nhảy qua mất dòng chưa đọc
async function refreshKnownLinks({ full = false } = {}) {
  if (!_cfg) return { links: [], rawRows: 0, from: 0, full: false };
  if (_refreshInFlight) return _refreshInFlight;   // đang đọc → dùng chung kết quả
  const cfg = _cfg;
  const doFull = full || _nextRow <= 0;
  const from = doFull ? 1 : _nextRow;
  _refreshInFlight = (async () => {
    const r = await readLinkColumn(cfg.spreadsheetId, cfg.tab, cfg.sa, { startRow: from });
    updateKnownLinks(r.links);
    // Mốc kế tiếp: đọc toàn bộ thì bắt đầu từ dòng 1 nên mốc = rawRows + 1; đọc tăng dần thì
    // cộng dồn từ chỗ bắt đầu. Dùng rawRows (số dòng THÔ) chứ KHÔNG dùng links.length —
    // links đã lọc bỏ dòng rỗng nên mốc sẽ lệch dần (có test riêng cho bẫy này).
    _nextRow = doFull ? r.rawRows + 1 : from + r.rawRows;
    return { links: r.links, rawRows: r.rawRows, from, full: doFull };
  })();
  try {
    return await _refreshInFlight;
  } finally {
    _refreshInFlight = null;
  }
}

function isEnabled() { return !!_cfg; }

function enqueue(row) {
  if (!_cfg) return;
  // CHƯA nạp được danh sách link cũ lần nào (xem ghi chú ở _seeded phía trên) → không biết
  // link nào đã có trên Sheet, đẩy lúc này chỉ để tạo trùng. Tạm giữ lại (vẫn hiện trong
  // bảng ở app), main.js tự thử đọc lại mỗi phút, nạp xong sẽ tự đẩy bình thường; muốn đẩy
  // ngay trong lúc chờ thì dùng nút "Đẩy lên Sheet" (tự đọc mới nhất trước khi đẩy).
  if (!_seeded) return;
  const key = normalizeKey(row && row[1]);
  // Chống trùng LIÊN MÁY: link đã có trên Sheet (máy khác đẩy, biết qua lần đọc lại
  // định kỳ) → bỏ ngay từ cửa, kể cả khi máy mình đã tốn công check số video cho nó.
  if (key && _knownLinks.has(key)) return;
  // Chống trùng ngay trong buffer: nếu link này đang chờ đẩy (vd lô lỗi được trả về
  // buffer từ phiên trước, phiên mới quét lại trúng nó) → bỏ, không xếp hàng 2 lần.
  if (key && _buffer.some(r => normalizeKey(r && r[1]) === key)) return;
  _buffer.push(row);
  if (_buffer.length >= BATCH_SIZE) flush();
  else ensureTimer();
}

// Gỡ khỏi buffer những dòng có link nằm trong danh sách đã lên Sheet bằng đường khác
// (nút đẩy bù) — để buffer retry không đẩy lại lần nữa gây trùng.
function dropFromBuffer(links) {
  const keys = new Set((links || []).map(normalizeKey).filter(Boolean));
  if (!keys.size) return;
  _buffer = _buffer.filter(r => !keys.has(normalizeKey(r && r[1])));
}

function ensureTimer() {
  if (_timer) return;
  _timer = setTimeout(() => { _timer = null; flush(); }, FLUSH_MS);
}

function flush() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (!_cfg || !_buffer.length) return _flushChain;
  // Lọc lần cuối trước khi ghi: bỏ dòng đã lên Sheet bằng đường khác trong lúc nằm chờ
  // buffer (máy khác đẩy giữa 2 lần đọc lại) — chốt chặn cuối của chống trùng liên máy.
  const rows = _buffer.filter(r => {
    const k = normalizeKey(r && r[1]);
    return !(k && _knownLinks.has(k));
  });
  _buffer = [];
  if (!rows.length) return _flushChain;
  const cfg = _cfg;
  let pending = rows;   // lô THỰC SỰ sẽ ghi (có thể bị co lại sau khi đọc mới nhất)
  _flushChain = _flushChain
    .then(async () => {
      // ── ĐỌC MỚI NHẤT NGAY TRƯỚC KHI GHI (2026-08-03, người dùng yêu cầu) ──
      // Tình huống người dùng lo đúng: 2 máy quét trúng CÙNG 1 link, máy A check xong đẩy
      // lên trước, máy B check xong đẩy lên sau → TRÙNG. Đọc định kỳ mỗi phút vẫn còn cửa
      // hở trong đúng 1 phút đó. Đọc phần đuôi NGAY TRƯỚC KHI GHI thì máy đẩy sau nhìn thấy
      // dòng máy trước vừa ghi và tự bỏ → cửa hở co xuống còn đúng thời gian của 1 request.
      // Rẻ: chỉ đọc vài dòng mới kể từ mốc, không phải 156.000 dòng.
      // Lỗi mạng ở bước này KHÔNG được chặn việc ghi (thà chấp nhận cửa hở như cũ còn hơn
      // nghẽn/mất dữ liệu) → chỉ ghi log rồi đi tiếp.
      try {
        await refreshKnownLinks();
      } catch (e) {
        console.warn('[sheets] Không đọc được phần mới trước khi ghi (vẫn ghi):', e.message);
      }
      pending = rows.filter(r => {
        const k = normalizeKey(r && r[1]);
        return !(k && _knownLinks.has(k));
      });
      const dropped = rows.length - pending.length;
      if (dropped > 0) {
        console.log(`[sheets] Bỏ ${dropped} dòng trước khi ghi — máy khác vừa đẩy lên trước (chống trùng liên máy).`);
      }
      if (!pending.length) return;
      await appendRows(cfg.spreadsheetId, cfg.tab, pending, cfg.sa);
      // Ghi thành công → các link này giờ ĐÃ có trên Sheet, ghi nhớ để mọi đường đẩy
      // sau (kể cả buffer retry) không bao giờ đẩy lại.
      for (const r of pending) { const k = normalizeKey(r && r[1]); if (k) _knownLinks.add(k); }
    })
    .catch(e => {
      console.error('[sheets] flush lỗi:', e.message);
      // KHÔNG bỏ rơi lô lỗi (trước đây lô lỗi bị mất luôn → "nghẽn" là mất data):
      // trả các dòng về ĐẦU buffer để timer thử đẩy lại sau. Nếu lỗi kéo dài, dữ liệu
      // vẫn nằm chờ trong buffer + user có nút "Đẩy lên Sheet" để đẩy bù thủ công.
      // Chỉ trả lại `pending` — số bị bỏ vì máy khác đã đẩy thì KHÔNG đẩy lại nữa.
      _buffer = pending.concat(_buffer);
      ensureTimer();
      if (_onError) _onError(e.message);
    });
  return _flushChain;
}

async function flushAll() {
  flush();
  await _flushChain;
}

module.exports = {
  testConnection,
  readLinks,
  readLinkColumn,
  refreshKnownLinks,
  extractSpreadsheetId,
  configure,
  isEnabled,
  isSeeded,
  enqueue,
  flush,
  flushAll,
  pushDedup,
  dropFromBuffer,
  updateKnownLinks,
  scanDuplicates,
  deleteRows,
  cleanDuplicates,
};
