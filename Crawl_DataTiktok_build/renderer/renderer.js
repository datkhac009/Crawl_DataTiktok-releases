// renderer.js — Logic giao diện (chạy trong sandbox, gọi main qua window.api).
// Mô hình: bảng profile, mỗi profile chạy/dừng/log độc lập; bảng dữ liệu chung.
'use strict';

const $ = (id) => document.getElementById(id);

let profilesCache = [];
let profileSettings = {};            // id -> { mode, keyword, headless, originalOnly, minVideos, delayMin, delayMax }
const runningSet = new Set();        // id đang chạy
// id đang DỪNG MỀM (đã ngừng quét, còn check nốt hàng đợi). `setRowRunning` đọc biến này để
// chọn nhãn nút "■ Dừng" hay "⏹ Dừng ngay", mà nó được gọi RẤT SỚM lúc dựng bảng → khai báo
// phải nằm ở ĐẦU FILE, không được để cạnh `stopProfileById`: `const` nằm dưới sẽ vướng vùng
// chết (TDZ) → ReferenceError → chết cả giao diện. Đúng bẫy QĐ-21 với `_runningSelectedBatch`.
const _draining = new Set();
const profileScanned = {};           // id -> số sound quét được (feed, trước khi check)
const profileChecked = {};           // id -> số sound đã đi qua bước check số video (kể cả '?')
const profileValid = {};             // id -> số sound đạt bộ lọc video, đã đẩy vào bảng kết quả
const profileStatusText = {};        // id -> text trạng thái gần nhất
const profileStatusKind = {};        // id -> 'running'|'stopped'|'error'|''
const profilePhase = {};             // id -> { label, nextLabel, deadlineAt } (chế độ 'cycle' — đếm ngược tới lúc chuyển pha)
const profileLogs = {};              // id -> [dòng log]
let logModalId = null;               // id profile đang mở log (để cập nhật trực tiếp)
let crawlSettingsTargetIds = [];     // id(s) đang chỉnh trong modal cài đặt
// Đang bật LẦN LƯỢT nhiều profile (xem runSelected). Khai báo ở đây, KHÔNG để cạnh
// runSelected phía dưới: updateRunSelectedBtnState() đọc biến này và được gọi rất sớm
// trong lúc dựng bảng → nếu `let` nằm dưới sẽ vướng vùng chết (TDZ) → ReferenceError.
let _runningSelectedBatch = false;
// Mốc hết hạn "chờ IP mới nguội" sau khi đổi VPN (0 = không chờ). Khai báo ở đây vì cùng lý do
// TDZ như trên: applyVpnCooldown() được gọi từ renderProfiles()/updateRunSelectedBtnState().
let _vpnCooldownUntil = 0;
// Khóa nút Chạy trong SUỐT giai đoạn nguy hiểm của việc đổi IP: từ lúc phát hiện feed cạn, qua
// lúc VPN bị tắt, tới hết đếm ngược 59s (người dùng chốt: *"hết 59s thì hiện Chạy để cho chạy
// lại"*). App KHÔNG BAO GIỜ tự đụng vào VPN nữa (bỏ 2026-08-06) nên mọi chuyển tiếp VPN đều do
// người dùng, và bộ canh HMA là chủ duy nhất của cờ này.
let _vpnRunLock = false;
// Vì sao đang khoá — chỉ để chọn nhãn hiện trên nút. 'cycling' = app đang tắt/bật lại VPN;
// 'vpn-off' = VPN đang TẮT (người dùng tự tắt / VPN tụt). Hai ca này người dùng phải xử khác nhau
// nên nhãn phải khác nhau, gộp thành một chữ là bắt họ đoán.
let _vpnLockReason = 'cycling';

const DEFAULT_SETTINGS = {
  mode: 'foryou', keyword: '', headless: false, originalOnly: false, latinTitleOnly: false, notInterested: false,
  minVideos: 1000, maxVideos: 0, delayMin: 2, delayMax: 4, blockImages: true, recycleEvery: 80,
  viewLinks: '', viewPctMin: 40, viewPctMax: 70, viewLikePct: 15,
  viewScrollMin: 20, viewScrollMax: 30,
  cycleScanHours: 5, cycleViewMinutes: 30, cycleBreakMin: 5, cycleBreakMax: 10,
  chromiumProfile: false,
};

const MODE_LABEL = {
  foryou: 'For You', search: 'Tìm kiếm', current: 'Tab đang mở', view: 'Xem video',
  cycle: 'Quét ⇄ Xem',
};

// Tách textarea link video (chế độ Xem video) thành mảng link hợp lệ.
function parseViewLinks(text) {
  return String(text || '').split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => /^https?:\/\//i.test(s));
}

// ── Tiện ích ──
function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _toastTimer = null;
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

function nameOf(id) {
  const p = profilesCache.find(x => x.id === id);
  return p ? p.name : (id || '');
}

function getSettings(id) {
  return Object.assign({}, DEFAULT_SETTINGS, profileSettings[id] || {});
}

async function saveProfileSettings() {
  try { await api.storeSet({ profile_settings: profileSettings }); } catch {}
}

// ── Load profiles + settings ──
async function loadProfiles() {
  try { profilesCache = await api.profilesList(); }
  catch { profilesCache = []; }
}

async function loadSettingsStore() {
  try {
    const s = await api.storeGet(['profile_settings']);
    profileSettings = s.profile_settings || {};
  } catch { profileSettings = {}; }
}

// ══════════════════════════════════════════
// BẢNG PROFILE
// ══════════════════════════════════════════
function modeText(s) {
  let t = MODE_LABEL[s.mode] || s.mode;
  if (s.mode === 'search' && s.keyword) t += `: "${s.keyword}"`;
  if (s.mode === 'view') t += ` (${parseViewLinks(s.viewLinks).length} link)`;
  if (s.mode === 'cycle') t += ` (${s.cycleScanHours}h/${s.cycleViewMinutes}p)`;
  return t;
}

function renderProfileTable() {
  const tb = $('profileTableBody');
  // Vẽ lại bảng làm mất tick checkbox → ghi nhớ các id đang tick để tick lại sau khi vẽ.
  const checkedBefore = new Set(getCheckedIds());
  if (profilesCache.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" class="profile-empty">Chưa có profile. Nhấn "➕ Thêm / Quản lý".</td></tr>';
    updateRunSelectedBtnState();
    return;
  }
  tb.innerHTML = profilesCache.map(p => {
    const s = getSettings(p.id);
    const running = runningSet.has(p.id);
    const statusTxt = profileStatusText[p.id] || 'Chờ';
    const kind = profileStatusKind[p.id] || '';
    const scanned = profileScanned[p.id] || 0;
    const checked = profileChecked[p.id] || 0;
    const valid = profileValid[p.id] || 0;
    const runBtn = running
      ? `<button class="btn btn-sm" data-act="run" data-id="${p.id}">■ Dừng</button>`
      : `<button class="btn btn-sm btn-primary" data-act="run" data-id="${p.id}">▶ Chạy</button>`;
    return `<tr data-id="${p.id}">
      <td><input type="checkbox" class="row-check" data-id="${p.id}" /></td>
      <td class="pname">${escHtml(p.name)}</td>
      <td class="pmode">
        <select class="select input-sm mode-select" data-id="${p.id}" style="width:100%"${running ? ' disabled' : ''}>
          <option value="foryou"${s.mode === 'foryou' ? ' selected' : ''}>For You</option>
          <option value="search"${s.mode === 'search' ? ' selected' : ''}>Tìm kiếm</option>
          <option value="current"${s.mode === 'current' ? ' selected' : ''}>Tab đang mở</option>
          <option value="view"${s.mode === 'view' ? ' selected' : ''}>Xem video</option>
          <option value="cycle"${s.mode === 'cycle' ? ' selected' : ''}>Quét ⇄ Xem</option>
        </select>
        <input class="input input-sm mode-keyword" data-id="${p.id}" placeholder="từ khóa..." value="${escHtml(s.keyword || '')}"${running ? ' disabled' : ''} style="width:100%;margin-top:4px;display:${s.mode === 'search' ? '' : 'none'}" />
      </td>
      <td>
        <span class="pstat-badge ${kind}" data-pid="${p.id}">${escHtml(statusTxt)}</span>
        <div class="pphase" data-pid="${p.id}" style="display:none"></div>
      </td>
      <td class="pscanned" data-pid="${p.id}">${scanned}</td>
      <td class="pchecked" data-pid="${p.id}">${checked}</td>
      <td class="pvalid" data-pid="${p.id}">${valid}</td>
      <td class="prow-actions">
        ${runBtn}
        <button class="btn btn-sm" data-act="settings" data-id="${p.id}" title="Cài đặt riêng">⚙️</button>
        <button class="btn btn-sm" data-act="log" data-id="${p.id}" title="Xem log">📄</button>
        <button class="btn btn-sm" data-act="open" data-id="${p.id}" title="Mở trình duyệt">🦊</button>
        <button class="btn btn-sm" data-act="del" data-id="${p.id}" title="Xóa">✕</button>
      </td>
    </tr>`;
  }).join('');
  // Tick lại các profile đã chọn trước khi vẽ lại (profile bị xóa thì tự mất tick).
  let restored = 0;
  tb.querySelectorAll('.row-check').forEach(c => {
    if (checkedBefore.has(c.dataset.id)) { c.checked = true; restored++; }
  });
  $('selectAll').checked = restored > 0 && restored === profilesCache.length;
  updateRunSelectedBtnState();
  // Vẽ lại bảng tạo chip pha mới ở trạng thái ẩn → khôi phục đếm ngược cho profile đang chạy chu kỳ.
  for (const id of Object.keys(profilePhase)) renderPhaseChip(id);
}

function getCheckedIds() {
  return [...document.querySelectorAll('#profileTableBody .row-check:checked')].map(c => c.dataset.id);
}

function setRowRunning(id, running) {
  if (running) runningSet.add(id); else runningSet.delete(id);
  if (!running) _draining.delete(id);   // dừng hẳn rồi thì quên trạng thái "đang check nốt"
  const btn = document.querySelector(`#profileTableBody button[data-act="run"][data-id="${CSS.escape(id)}"]`);
  if (btn) {
    // Đang check nốt hàng đợi → nhãn phải nói rõ bấm thêm là CẮT NGAY, nếu không người dùng
    // tưởng nút hỏng (bấm Dừng mà profile vẫn chạy) rồi bấm loạn.
    btn.textContent = running ? (_draining.has(id) ? '⏹ Dừng ngay' : '■ Dừng') : '▶ Chạy';
    btn.classList.toggle('btn-primary', !running);
    // ⚠ PHẢI MỞ KHOÁ khi chuyển sang "■ Dừng" (sửa 2026-08-13).
    // Bất biến của app là *"nút Dừng luôn bấm được"* — nhưng trước đây nó chỉ được thi hành ở
    // MỘT chỗ: `applyVpnCooldown()` bỏ qua các hàng đang chạy. Chỗ đó không phủ được đường
    // NGƯỢC LẠI — hàng bị khoá TRƯỚC rồi mới bắt đầu chạy:
    //   1. HMA biến động → applyVpnCooldown() khoá hàng chưa chạy, ghi chữ "⏳ 59s"
    //   2. Profile khởi động → setRowRunning(id, true) đổi chữ thành "■ Dừng"…
    //      …mà KHÔNG mở khoá → nút TẮT nhưng mang chữ "■ Dừng"
    // Và nó KHÔNG TỰ KHỎI: hết 59 giây thì applyVpnCooldown() lại *bỏ qua* đúng hàng này vì
    // giờ nó đã nằm trong `runningSet`. Người dùng mất hẳn đường dừng riêng từng profile
    // (ảnh chụp thật: 4 profile đang quét, cả 4 nút Dừng đều tắt).
    // Đây đúng bài học QĐ-32: một ràng buộc chỉ cài ở MỘT trong nhiều đường dẫn tới nó thì
    // kể như chưa có. Nên thi hành ở CẢ HAI đầu.
    if (running) { btn.disabled = false; btn.title = ''; }
  }
  const sel = document.querySelector(`#profileTableBody .mode-select[data-id="${CSS.escape(id)}"]`);
  const kw = document.querySelector(`#profileTableBody .mode-keyword[data-id="${CSS.escape(id)}"]`);
  if (sel) sel.disabled = running;
  if (kw) kw.disabled = running;
  updateRunSelectedBtnState();
}

// Khóa nút "▶ Chạy ô đã chọn" khi bấm cũng không có tác dụng gì — tránh nhấn nhầm khi phần
// mềm đang chạy. Chỉ khóa khi CHƯA tick gì HOẶC mọi profile đã tick đều đang chạy rồi; tick
// thêm 1 profile chưa chạy là tự mở khóa ngay (vẫn thêm được vào giữa phiên như bình thường).
// ── KHÓA NÚT CHẠY TRONG LÚC CHỜ IP MỚI NGUỘI (người dùng chốt 2026-08-06) ──
// Bản đầu của việc chờ 1 phút chỉ GHI ĐẾM NGƯỢC vào dòng trạng thái. Người dùng thử ở máy mình
// và phát hiện đúng lỗ hổng: *"khi bật lại HMA thì tôi ấn Chạy nó vẫn chạy được luôn"* — tức
// việc chờ chẳng ngăn được gì, đúng cái nó sinh ra để ngăn. Nên phải khóa NÚT thật.
//
// MỌI chỗ ghi chữ lên nút Chạy đều phải gọi applyVpnCooldown() sau đó: renderProfiles() vẽ lại
// cả bảng và setRowRunning() ghi lại nhãn nút — chúng không biết về cooldown thì chỉ cần một
// lần vẽ lại giữa lúc chờ là nút mở khóa trở lại (bài học QĐ-10: 2 chỗ cùng ghi một thứ thì
// chúng SẼ lệch nhau). Đó cũng là lý do hàm này tự truy vấn lại nút chứ không giữ tham chiếu.
// Số giây còn lại của pha CHỜ IP NGUỘI (0 = không ở pha đó).
function vpnCooldownLeft() {
  if (!_vpnCooldownUntil) return 0;
  const left = Math.ceil((_vpnCooldownUntil - Date.now()) / 1000);
  if (left <= 0) { _vpnCooldownUntil = 0; return 0; }
  return left;
}

// Có được phép bật profile lúc này không. KHÓA CẢ HAI PHA của việc đổi IP, không chỉ pha chờ:
//   • pha ĐANG ĐỔI: HMA vừa bị tắt → bật profile lúc này là chạy bằng IP THẬT, nguy hiểm hơn
//     hẳn pha chờ. Chỉ khóa pha chờ thì vẫn hở đúng khoảng nguy hiểm nhất.
//   • pha CHỜ NGUỘI: tránh 5 phiên cũ đồng loạt xuất hiện trên IP vừa đổi.
function vpnRunLocked() { return vpnCooldownLeft() > 0 || _vpnRunLock; }

function applyVpnCooldown() {
  const left = vpnCooldownLeft();
  const locked = vpnRunLocked();
  // Khoá mà KHÔNG có đếm ngược = chưa biết bao lâu → không có số để đếm, chỉ báo trạng thái.
  const vpnOff = _vpnLockReason === 'vpn-off';
  const label = left ? `⏳ ${left}s` : (vpnOff ? '⛔ VPN tắt' : '⏳ đổi IP');
  const tip = !locked ? ''
    : left
      ? `Vừa đổi IP — chờ ${left}s cho IP mới ổn định rồi mới được chạy lại`
        + ' (tránh TikTok coi là đăng nhập dồn dập trên IP vừa đổi).'
      : vpnOff
        ? 'HMA VPN đang TẮT — bật profile lúc này sẽ chạy bằng IP THẬT. Bật lại HMA rồi chờ hết đếm ngược.'
        : 'Đang tắt/bật lại VPN — bật profile lúc này sẽ chạy bằng IP THẬT.';
  // Nút từng hàng. CHỈ khóa nút đang ở trạng thái "▶ Chạy" — nút "■ Dừng" phải luôn bấm được,
  // kể cả trong lúc chờ (người dùng còn phải dừng được profile khác nếu muốn).
  document.querySelectorAll('#profileTableBody button[data-act="run"]').forEach(btn => {
    if (runningSet.has(btn.dataset.id)) return;
    btn.disabled = locked;
    btn.textContent = locked ? label : '▶ Chạy';
    btn.title = tip;
  });
  const g = $('runSelectedBtn');
  if (g) {
    if (locked) { g.disabled = true; g.textContent = label; g.title = tip; }
    else if (g.textContent.startsWith('⏳')) { g.textContent = '▶ Chạy ô đã chọn'; g.title = ''; }
  }
  return left;
}

// Câu giải thích khi người dùng vẫn bấm được (bàn phím, hoặc lọt qua giữa 2 lần vẽ lại).
function vpnLockedMsg() {
  const left = vpnCooldownLeft();
  if (left) return `Vừa đổi IP — chờ ${left}s nữa mới được chạy lại.`;
  return _vpnLockReason === 'vpn-off'
    ? 'HMA VPN đang TẮT — chạy lúc này sẽ dùng IP THẬT. Bật lại HMA rồi chờ hết đếm ngược.'
    : 'Đang tắt/bật lại VPN — chạy lúc này sẽ dùng IP THẬT. App sẽ tự chạy lại khi xong.';
}

function updateRunSelectedBtnState() {
  const btn = $('runSelectedBtn');
  if (!btn) return;
  // Đang đổi IP / chờ IP nguội → khóa hết, applyVpnCooldown() lo nhãn + tooltip.
  if (vpnRunLocked()) { applyVpnCooldown(); return; }
  // Đang bật LẦN LƯỢT nhiều profile → khóa nút, không cho bấm chồng (xem runSelected).
  if (_runningSelectedBatch) {
    btn.disabled = true;
    btn.title = 'Đang bật lần lượt từng profile — chờ xong lượt này.';
    return;
  }
  const ids = getCheckedIds();
  const hasStartable = ids.some(id => !runningSet.has(id));
  btn.disabled = !hasStartable;
  btn.title = !hasStartable
    ? (ids.length ? 'Các profile đã tick đều đang chạy rồi.' : 'Tick chọn ít nhất 1 profile để chạy.')
    : '';
}

function updateRowStatus(id, status, msg) {
  if (status) profileStatusKind[id] = (status === 'running' ? 'run' : status === 'error' ? 'err' : status === 'stopped' ? 'stop' : '');
  if (msg) profileStatusText[id] = msg;
  renderStatusBadge(id);
}

// mm:ss / h:mm dạng ngắn cho đếm ngược trong badge trạng thái.
function formatCountdown(ms) {
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}g${m}p`;
  if (m > 0) return `${m}p${s}s`;
  return `${s}s`;
}

// Badge chỉ hiện message trạng thái gần nhất; đếm ngược pha nằm ở CHIP RIÊNG bên dưới
// (renderPhaseChip) để không bị chìm cuối dòng text dài.
function renderStatusBadge(id) {
  const badge = document.querySelector(`.pstat-badge[data-pid="${CSS.escape(id)}"]`);
  if (!badge) return;
  const txt = profileStatusText[id] || '';
  badge.textContent = txt;
  // Badge bị cắt bằng ellipsis khi cửa sổ hẹp (xem .pstat-badge trong styles.css) → đặt
  // title để hover vẫn đọc được trọn câu; bản đầy đủ luôn có trong log 📄 của profile.
  badge.title = txt;
  badge.className = 'pstat-badge ' + (profileStatusKind[id] || '');
}

// Chip đếm ngược pha (mode 'cycle') — dòng riêng ngay dưới badge trạng thái, luôn hiện khi
// đang trong 1 pha, tự tick mỗi giây phía renderer. Ẩn khi profile không chạy chu kỳ.
function renderPhaseChip(id) {
  const chip = document.querySelector(`.pphase[data-pid="${CSS.escape(id)}"]`);
  if (!chip) return;
  const ph = profilePhase[id];
  if (!ph || !ph.deadlineAt) { chip.style.display = 'none'; chip.textContent = ''; return; }
  const left = ph.deadlineAt - Date.now();
  chip.style.display = '';
  chip.textContent = `⏳ ${ph.label} · còn ${formatCountdown(left)} → ${ph.nextLabel}`;
  chip.title = `Đang ở pha ${ph.label}, chuyển sang pha ${ph.nextLabel} lúc ${new Date(ph.deadlineAt).toLocaleTimeString('vi-VN')}`;
}

// Đếm ngược tự chạy phía renderer (không cần backend gửi lại mỗi giây) — chỉ tick các
// profile đang có pha active (mode 'cycle'), xóa khỏi profilePhase khi dừng/lỗi.
setInterval(() => {
  for (const id of Object.keys(profilePhase)) renderPhaseChip(id);
}, 1000);

// Cập nhật cột "Quét" / "Đã check" từ sự kiện crawl-status kiểu 'counts' (backend gửi mỗi
// khi profile quét thêm 1 sound hoặc check xong 1 sound — kể cả check ra '?').
function updateProfileCounts(id, scanned, checked) {
  if (typeof scanned === 'number') {
    profileScanned[id] = scanned;
    const c = document.querySelector(`.pscanned[data-pid="${CSS.escape(id)}"]`);
    if (c) c.textContent = scanned;
  }
  if (typeof checked === 'number') {
    profileChecked[id] = checked;
    const c = document.querySelector(`.pchecked[data-pid="${CSS.escape(id)}"]`);
    if (c) c.textContent = checked;
  }
}

// ── SỐ DÒNG DATA TRÊN SHEET (2026-08-03, người dùng chốt chỗ này) ──
// Người dùng muốn thay chữ "Đang chạy N profile." (vô ích — bảng phía trên đã cho biết profile
// nào đang chạy) bằng số dòng data thật đang có trên Sheet, LUÔN HIỆN và luôn tự cập nhật (5
// máy cùng đẩy lên nên con số này thay đổi liên tục).
let _lastSheetRows = 0;
// Số dòng Sheet có Ô RIÊNG (#sheetRowsInfo), KHÔNG dùng chung với dòng thông báo nữa.
//
// Trước đây nó ghi vào #crawlStatusMsg nên phải nhường mọi thông báo (QĐ-25: không được xoá
// lỗi trước khi người dùng kịp đọc). Hậu quả: chỉ cần một câu thông tin bất kỳ đậu ở đó —
// "Đã bật đẩy Sheet giữa phiên — nạp 161040 link cũ..." — là số dòng KHÔNG BAO GIỜ hiện lại,
// vì không có gì xoá câu đó đi. Người dùng cần con số này luôn thấy được để biết Sheet đang
// có bao nhiêu data (5 máy cùng đẩy lên).
//
// Tách ô là giải pháp đúng cho CẢ HAI: số dòng luôn hiện và tự cập nhật, thông báo/lỗi vẫn
// nằm nguyên chỗ của nó không bị ai xoá. Không còn phải đánh đổi.
function setSheetRowsStatus(rows) {
  if (typeof rows === 'number') _lastSheetRows = rows;
  const el = $('sheetRowsInfo');
  if (!el) return;
  el.textContent = _lastSheetRows
    ? `Sheet: ${_lastSheetRows.toLocaleString('vi-VN')} dòng data`
    : '';   // chưa đọc được lần nào → để trống, không hiện số bịa
}

// Số đếm SỐNG "Bỏ qua trùng" — dùng CHUNG cho cả phiên (không riêng 1 profile), để người
// dùng thấy ngay lọc trùng đang hoạt động thay vì chỉ biết được lúc "Hoàn tất phiên" (chế
// độ Quét⇄Xem gần như không bao giờ tới lúc đó).
function updateSkippedDup(n) {
  if (typeof n !== 'number') return;
  const el = $('dupSkippedBadge');
  if (el) el.textContent = `Bỏ qua trùng: ${n}`;
}

// Tăng số "Hợp lệ" (sound đạt bộ lọc video, vừa đẩy vào bảng kết quả) — gọi khi nhận
// 1 dòng crawl-data cho profile đó.
function bumpValidCount(id) {
  profileValid[id] = (profileValid[id] || 0) + 1;
  const c = document.querySelector(`.pvalid[data-pid="${CSS.escape(id)}"]`);
  if (c) c.textContent = profileValid[id];
}

// Xóa số Quét/Đã check/Hợp lệ của 1 profile về 0 — gọi khi profile BẮT ĐẦU MỘT LƯỢT CHẠY
// MỚI (backend cũng reset localCount/localChecked mỗi lần crawlOneProfile chạy lại từ đầu).
function resetProfileCounts(id) {
  profileScanned[id] = 0;
  profileChecked[id] = 0;
  profileValid[id] = 0;
  const c1 = document.querySelector(`.pscanned[data-pid="${CSS.escape(id)}"]`);
  const c2 = document.querySelector(`.pchecked[data-pid="${CSS.escape(id)}"]`);
  const c3 = document.querySelector(`.pvalid[data-pid="${CSS.escape(id)}"]`);
  if (c1) c1.textContent = '0';
  if (c2) c2.textContent = '0';
  if (c3) c3.textContent = '0';
}

// ── Bắt đầu / dừng 1 profile ──
async function startProfileById(id) {
  if (runningSet.has(id)) return;
  // Bấm Chạy trong lúc đang đếm ngược = "chạy ngay, khỏi chờ". Huỷ hẹn để không có 2 đường cùng bật.
  // KHÔNG xoá `streak`: nếu vẫn bị cắt tiếp thì lần nghỉ sau vẫn phải dài hơn.
  const keep = _starve[id] && _starve[id].streak;
  cancelStarveRestart(id);
  if (keep) _starve[id] = { streak: keep, until: 0, tick: null };
  // Profile ĐẦU TIÊN của phiên → làm mới bảng. Backend song song cũng reset bộ đếm
  // và nạp lại link cũ từ Sheet vào bộ nhớ để lọc trùng (main.js đọc Sheet khi
  // chưa có profile nào chạy). Nếu thêm profile vào phiên đang chạy thì giữ nguyên bảng.
  if (runningSet.size === 0) clearResults();
  const s = getSettings(id);
  if (s.mode === 'search' && !String(s.keyword || '').trim()) {
    toast(`"${nameOf(id)}": chưa nhập từ khóa. Mở ⚙️ để nhập.`, 'err');
    openSettingsModal([id]);
    return;
  }
  const viewLinks = (s.mode === 'view' || s.mode === 'cycle') ? parseViewLinks(s.viewLinks) : [];
  if ((s.mode === 'view' || s.mode === 'cycle') && !viewLinks.length) {
    toast(`"${nameOf(id)}": chưa dán link sound để xem. Mở ⚙️ để dán danh sách.`, 'err');
    openSettingsModal([id]);
    return;
  }
  let dMin = Math.max(0, parseFloat(s.delayMin) || 0);
  let dMax = Math.max(0, parseFloat(s.delayMax) || 0);
  if (dMax < dMin) dMax = dMin;
  const params = {
    profileId: id,
    mode: s.mode,
    keyword: String(s.keyword || '').trim(),
    headless: !!s.headless,
    originalOnly: !!s.originalOnly,
    latinTitleOnly: !!s.latinTitleOnly,
    notInterested: !!s.notInterested,
    minVideos: Math.max(0, parseInt(s.minVideos, 10) || 0),
    maxVideos: Math.max(0, parseInt(s.maxVideos, 10) || 0),
    minDelay: Math.round(dMin * 1000),
    maxDelay: Math.round(dMax * 1000),
    blockImages: !!s.blockImages,
    chromiumProfile: !!s.chromiumProfile,
    recycleEvery: s.recycleEvery === 0 ? 0 : Math.max(0, parseInt(s.recycleEvery, 10) || 80),
    viewLinks,
    viewPctMin: Math.max(1, Math.min(100, parseInt(s.viewPctMin, 10) || 40)),
    viewPctMax: Math.max(1, Math.min(100, parseInt(s.viewPctMax, 10) || 70)),
    viewLikePct: Math.max(0, Math.min(100, parseInt(s.viewLikePct, 10) || 0)),
    viewScrollMin: Math.max(0, parseInt(s.viewScrollMin, 10) || 0),
    viewScrollMax: Math.max(0, parseInt(s.viewScrollMax, 10) || 0),
    cycleScanHours: Math.max(0.1, parseFloat(s.cycleScanHours) || 5),
    cycleViewMinutes: Math.max(1, parseFloat(s.cycleViewMinutes) || 30),
    cycleBreakMin: Math.max(0, parseFloat(s.cycleBreakMin) || 0),
    cycleBreakMax: Math.max(0, parseFloat(s.cycleBreakMax) || 0),
  };
  resetProfileCounts(id);
  appendLog(id, 'Đang khởi động...');
  const res = await api.profileStart(params);
  if (!res.ok) {
    toast(`"${nameOf(id)}": ${res.msg}`, 'err');
    appendLog(id, 'Lỗi: ' + res.msg);
    // BACKEND BẢO ĐANG CHẠY mà giao diện lại hiện nút "▶ Chạy" = UI đang LỆCH với backend.
    // Phải tự chữa NGAY: đưa hàng về trạng thái ĐANG CHẠY để nút đổi thành "■ Dừng" — nếu không,
    // người dùng KHÔNG có cách nào dừng nó (bấm Chạy thì bị từ chối, mà nút Dừng thì không hiện),
    // và cách duy nhất thoát là khởi động lại app.
    // Đã gặp thật (log 2026-08-07): TikTok hủy phiên giữa chừng → status 'error' làm hàng đổi về
    // "▶ Chạy" trong khi backend vẫn giữ profile → bế tắc. Đây là bản đối xứng của lớp tự chữa
    // sẵn có ở stopProfileById (backend bảo KHÔNG chạy → gỡ đánh dấu).
    if (/đang chạy/i.test(res.msg || '')) {
      setRowRunning(id, true);
      updateRowStatus(id, 'running', 'Đang chạy (backend xác nhận) — bấm ■ Dừng nếu muốn dừng.');
      appendLog(id, 'Giao diện đang lệch với backend — đã đưa hàng về trạng thái ĐANG CHẠY để bấm Dừng được.');
    }
    return;
  }
  setRowRunning(id, true);
  updateRowStatus(id, 'running', 'Đang khởi động...');
}

// Bấm "■ Dừng" = DỪNG MỀM: ngừng quét ngay nhưng CHECK NỐT hàng đợi rồi mới dừng hẳn.
// Người dùng chốt 2026-08-13: *"quét được 300 check đang ở 260, ấn dừng là nó dừng luôn — đúng
// ra phải đợi check xong 40 link nữa"*. Số sound mất khi dừng cứng = cột Quét − cột Đã check
// (USER_GUIDE), với hàng đợi 20/profile × 6 profile là mất tới ~120 sound mỗi lần dừng.
//
// ⚠ ĐƯỜNG THOÁT BẮT BUỘC — bấm lần thứ HAI thì cắt ngay. Không có nó thì có 2 ca kẹt thật:
//   1. VPN tụt lúc 3h sáng → phải dừng NGAY vì mọi request đang đi bằng IP thật (QĐ-32).
//   2. TikTok chặn trang đếm → hàng đợi gần như không tiêu được: QĐ-35 đo thật **20 sound cần
//      6–7 tiếng**. Dừng mềm lúc đó = profile không bao giờ dừng.
// Backend đã sẵn sàng cho việc này: `countLoop` chạy `while (!stop.requested)` nên dừng cứng
// giữa lúc đang check nốt vẫn cắt tức thì, và `softStopProfile` tự bỏ qua nếu đã dừng cứng rồi.
//
// `opts.force = true` cho các đường TỰ ĐỘNG (feed cạn / chặn trang đếm) — chúng phải dừng dứt
// điểm để còn hẹn bật lại, mà ca "chặn trang đếm" thì drain vốn không bao giờ xong.
async function stopProfileById(id, opts = {}) {
  // NGƯỜI DÙNG bấm Dừng = họ tiếp quản → huỷ hẹn tự-bật-lại-sau-khi-bị-cắt-feed, kể cả khi profile
  // đang trong lúc đếm ngược (lúc đó nó KHÔNG nằm trong runningSet nên phải xoá TRƯỚC dòng return
  // bên dưới, không thì bấm Dừng lúc đang chờ sẽ không huỷ được gì).
  // ⚠ handleFeedStarved cũng gọi hàm này, nhưng nó đặt hẹn SAU khi await xong nên không tự xoá.
  cancelStarveRestart(id, 'người dùng bấm Dừng');
  // Người dùng bấm Dừng = tiếp quản → huỷ luôn hẹn chạy lại CẢ NHÓM (sau đổi IP / sau VPN tụt).
  // Không huỷ thì app tự bật lại đúng nhóm họ vừa tắt.
  cancelGroupRetry('người dùng bấm Dừng');
  if (_vpnCycling) _vpnCancelRestart = true;
  _vpnDownGroup = [];
  if (!runningSet.has(id)) { _draining.delete(id); return; }

  // Lần bấm ĐẦU = mềm. Lần bấm THỨ HAI (đang check nốt) = người dùng muốn cắt ngay.
  if (!opts.force && !_draining.has(id)) {
    _draining.add(id);
    setRowRunning(id, true);            // vẽ lại nhãn nút → "⏹ Dừng ngay"
    updateRowStatus(id, 'running', 'Dừng mềm: check nốt hàng đợi rồi dừng...');
    appendLog(id, 'Dừng mềm: ngừng quét NGAY, check nốt sound còn trong hàng đợi rồi mới dừng hẳn.'
      + ' Bấm "⏹ Dừng ngay" nếu muốn cắt luôn (sẽ mất số sound chưa check).');
    const soft = await api.profileSoftStop(id);
    if (soft && soft.ok === false) {    // backend bảo không chạy → đồng bộ lại UI như đường cứng
      _draining.delete(id);
      setRowRunning(id, false);
      updateRowStatus(id, 'stopped', 'Chờ');
      appendLog(id, 'Profile không chạy — đã đồng bộ lại trạng thái giao diện.');
    }
    return;
  }

  _draining.delete(id);
  appendLog(id, 'Đang dừng...');
  // Đặt badge TRƯỚC await: backend phát 'stopped' gần như tức thì, nếu đặt sau await thì
  // dòng này GHI ĐÈ mất thông báo "Đã dừng." vừa nhận được → badge kẹt ở "Đang dừng..."
  // dù profile đã dừng xong (bug 2026-07-28).
  updateRowStatus(id, 'running', 'Đang dừng...');
  const res = await api.profileStop(id);
  // Backend báo profile KHÔNG chạy = UI đang lệch trạng thái với backend. Phải tự chữa
  // NGAY, vì sẽ không còn sự kiện 'stopped' nào tới nữa → hàng kẹt vĩnh viễn ở
  // "Đang dừng..." kèm nút "■ Dừng", không cách nào bấm Chạy lại được.
  if (res && res.ok === false) {
    setRowRunning(id, false);
    updateRowStatus(id, 'stopped', 'Chờ');
    appendLog(id, 'Profile không chạy — đã đồng bộ lại trạng thái giao diện.');
  }
}

async function toggleProfile(id) {
  if (runningSet.has(id)) await stopProfileById(id);
  else {
    // Chặn ở ĐÂY nữa, không chỉ dựa vào `disabled` của nút: một lần vẽ lại bảng đúng vào lúc
    // này, hay bàn phím/khả năng truy cập, đều có thể lọt qua nút đã khóa. Đây là cửa duy nhất
    // để người dùng bật 1 profile từ bảng nên khóa ở đây là kín.
    if (vpnRunLocked()) {
      applyVpnCooldown();
      return toast(vpnLockedMsg(), 'err');
    }
    await startProfileById(id);
  }
}

// ── Hành động hàng loạt ──
// BẬT LẦN LƯỢT, KHÔNG bật ồ ạt (2026-07-31). Trước đây vòng lặp có `await` nhưng
// `crawler.startProfile()` trả về NGAY sau khi dựng xong (vòng crawl chạy nền, không await)
// → 5 profile thực chất khởi động gần như CÙNG LÚC: 5 context cùng tải trang TikTok trên 1
// Chromium dùng chung (QĐ-02) làm CPU/RAM dội lên, sinh ra đúng hiện tượng "1-2 profile
// ngẫu nhiên bị đứng, không quét" mà bản v0.1.49 chỉ vá được phần ngọn (nới trần chờ
// page.evaluate lên 15s). Giờ chờ profile vừa bật QUÉT ĐƯỢC sound đầu tiên rồi mới bật
// profile kế tiếp — có trần thời gian để 1 profile hỏng không chặn cả dàn.
const STAGGER_MIN_MS = 3000;    // luôn nghỉ tối thiểu, tránh 2 profile chạm feed cùng lúc
const STAGGER_MAX_MS = 25000;   // trần chờ: quá hạn thì bật tiếp, không kẹt vô hạn

// Chờ profile `id` "ấm máy": quét được ≥1 sound, hoặc đã dừng/lỗi, hoặc quá trần.
async function waitProfileWarmedUp(id) {
  const t0 = Date.now();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  while (Date.now() - t0 < STAGGER_MAX_MS) {
    await sleep(500);
    if (!runningSet.has(id)) return 'stopped';            // dừng/lỗi → bật tiếp ngay
    if ((profileScanned[id] || 0) > 0) {                  // đã quét được → xong
      const left = STAGGER_MIN_MS - (Date.now() - t0);
      if (left > 0) await sleep(left);
      return 'scanning';
    }
  }
  return 'timeout';
}

// Bật lần lượt một NHÓM profile. DÙNG CHUNG cho "▶ Chạy đã chọn" và cho việc bật lại sau khi
// đổi IP (handleFeedStarved) — tách ra để không có 2 bản sao logic bật-lần-lượt, đúng bài học
// QĐ-10: có ≥2 bản sao của cùng một logic thì chúng SẼ lệch nhau.
async function startProfilesStaggered(ids, { btn = null } = {}) {
  const todo = ids.filter(id => !runningSet.has(id));
  try {
    for (let i = 0; i < todo.length; i++) {
      const id = todo[i];
      if (runningSet.has(id)) continue;   // vừa được bật bằng đường khác
      if (btn && todo.length > 1) btn.textContent = `▶ Đang bật ${i + 1}/${todo.length}...`;
      await startProfileById(id);         // tuần tự để seed Sheet chỉ đọc 1 lần
      if (i === todo.length - 1) break;   // profile cuối → không cần chờ thêm
      if (!runningSet.has(id)) continue;  // bật thất bại → sang profile kế tiếp ngay
      $('crawlStatusMsg').textContent =
        `Đang bật lần lượt ${i + 1}/${todo.length} — chờ "${nameOf(id)}" quét được rồi mới bật profile kế tiếp...`;
      await waitProfileWarmedUp(id);
    }
  } finally {
    // XÓA tin nhắn tiến trình khi xong lượt (2026-08-03): trước đây nó KẸT LẠI mãi ở
    // "Đang bật lần lượt 2/5..." dù cả 5 profile đã chạy từ lâu — vừa sai vừa CHIẾM CHỖ của
    // thông tin hữu ích hơn trên cùng dòng trạng thái đó.
    const msg = $('crawlStatusMsg');
    if (msg && msg.textContent.startsWith('Đang bật lần lượt')) msg.textContent = '';
  }
  return todo.length;
}

async function runSelected() {
  if (_runningSelectedBatch) return;   // đang bật lần lượt — chặn bấm chồng
  // Đang đổi IP / chờ IP nguội → không cho bật (xem applyVpnCooldown).
  if (vpnRunLocked()) {
    applyVpnCooldown();
    return toast(vpnLockedMsg(), 'err');
  }
  const ids = getCheckedIds();
  if (!ids.length) return toast('Tick chọn ít nhất 1 profile.', 'err');
  // Cảnh báo chạy dài: nhiều profile ở chế độ HIỆN render video liên tục → ngốn RAM/CPU
  // rất lớn, chạy qua đêm dễ cạn bộ nhớ. Khuyên bật "Chạy ẩn" trong ⚙.
  const visibleCount = ids.filter(id => {
    const s = getSettings(id);
    return s.mode !== 'current' && !s.headless;
  }).length;
  if (visibleCount >= 3) {
    toast(`⚠ ${visibleCount} profile chạy chế độ HIỆN — chạy lâu/qua đêm nên bật "Chạy ẩn" trong ⚙ để nhẹ máy.`, 'err');
  }

  const btn = $('runSelectedBtn');
  const btnText = btn ? btn.textContent : '';
  _runningSelectedBatch = true;
  updateRunSelectedBtnState();
  try {
    await startProfilesStaggered(ids, { btn });
  } finally {
    _runningSelectedBatch = false;
    if (btn) btn.textContent = btnText;
    updateRunSelectedBtnState();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// TIKTOK CẮT FEED → 2 ĐƯỜNG, cả hai đều TỰ CHẠY LẠI (QĐ-32)
// ══════════════════════════════════════════════════════════════════════════
// Người dùng treo máy qua đêm (*"nhiều khi tôi treo máy nên không thể ấn Chạy thủ công được"*) nên
// MỌI đường đều phải tự phục hồi — dừng hẳn mà không ai bấm lại là mất cả đêm sản lượng.
//
//   Công tắc "Tự đổi IP" BẬT  → DỪNG HẾT profile → tắt/bật lại HMA VPN → chờ 59s → chạy lại cả nhóm
//   Công tắc TẮT              → dừng ĐÚNG profile đó → nghỉ 5/15/30 phút → tự bật lại chính nó
//
// ── ⚠ VÌ SAO LUÔN DỪNG HẾT (không có tuỳ chọn "chỉ dừng 1") ──
// Bản đầu cho phép chỉ dừng 1 profile nếu máy không rò rỉ IPv6. Người dùng chỉ ra đúng lỗ hổng mà
// phép đo IPv6 KHÔNG che được: 4 profile kia vẫn đang chạy, chúng bắt đầu phiên quét trên IP A rồi
// GIỮA CHỪNG bị chuyển sang IP B. Với TikTok, một phiên đang hoạt động bỗng đổi IP giữa lúc quét là
// đúng khuôn "tài khoản bị chiếm" mà QĐ-15 gọi là nguyên nhân số 1 khiến nó huỷ phiên.
// Rò rỉ IPv6 chỉ là MỘT trong hai vấn đề; "đổi IP giữa phiên" là vấn đề còn lại và nó xảy ra kể cả
// khi không có IPv6 nào. Nên nhánh "dừng 1" bị xoá hẳn, không để làm tuỳ chọn.
// Backend (`ipcMain.handle('vpn-cycle')`) cũng chốt lại: còn profile nào chạy là TỪ CHỐI đổi IP.
//
// ── Vì sao DỪNG rồi BẬT LẠI, không "tạm dừng tại chỗ" (backend vốn có backoff 5/15/30 phút) ──
//   • Dựng lại context = trang feed mới, cookie nạp lại, vân tay áp lại → TikTok thấy một phiên
//     MỞ MỚI thay vì một phiên đang bị siết cố cào tiếp.
//   • Bật lại đi qua `waitForCorrectCountry` (ip-guard, QĐ-17) → VPN tụt lúc không ai trông thì
//     profile TỰ CHỜ đúng vùng chứ không chạy sai nước. "Tạm dừng tại chỗ" không có bước này.
//
// ── VPN TẮT (do người dùng, hay tự tụt) → CŨNG DỪNG HẾT ──
// Người dùng báo 2026-08-06: *"khi tôi tắt HMA thì vẫn thấy các profile chạy... Tắt HMA là dừng hết
// luôn không cho chạy"*. Bản trước chỉ CẢNH BÁO, không dừng — mà cảnh báo thì vô nghĩa khi họ treo
// máy: mỗi giây profile còn chạy là một giây gửi request bằng IP THẬT.
// Cùng một nguyên tắc với đoạn trên: VPN tắt = không profile nào được chạy, không có ngoại lệ.
// Xem `watchVpnTunnel` ở khối dưới.

// Thời gian để IP mới "nguội" trước khi cho profile chạy lại (người dùng chốt: ~1 phút).
const VPN_COOLDOWN_MS = 60 * 1000;

let _vpnAutoCycle = false;   // công tắc trong ⚙ (chung toàn app)
let _vpnCycling = false;     // đang chạy một lượt đổi IP → chống chạy chồng

// Người dùng bấm Dừng trong lúc app đang chờ → phải huỷ, không được cứ thế bật lại.
let _vpnCancelRestart = false;
function scanStopRequested() { return _vpnCancelRestart; }

// Nhóm profile bị app dừng vì VPN TẮT — để tự bật lại khi VPN lên (xem watchVpnTunnel).
let _vpnDownGroup = [];

// Nghỉ bao lâu trước khi tự bật lại, TĂNG DẦN theo số lần bị cắt LIÊN TIẾP: 5 → 15 → 30 phút
// (giữ mức cuối). Cùng thang với backoff cũ của backend — đó là con số đã dùng thật, không phải
// đoán mới. Tăng dần vì bị cắt lại ngay nghĩa là TikTok đang siết nặng: thử dày chỉ siết thêm.
// ⚠ KHÔNG dùng process.env ở đây: renderer chạy trong sandbox (contextIsolation) nên `process`
// không tồn tại — viết vào là ReferenceError làm chết cả giao diện.
const STARVE_RESTART_WAITS = [5 * 60000, 15 * 60000, 30 * 60000];

// profileId -> { streak, until, tick }  (streak = số lần bị cắt LIÊN TIẾP, để tăng dần thời gian)
const _starve = {};

// Xoá hẹn bật lại. Gọi khi NGƯỜI DÙNG tự can thiệp (bấm Chạy / bấm Dừng) — họ đã tiếp quản thì app
// không được tự ý bật lại nữa.
function cancelStarveRestart(id, why) {
  const st = _starve[id];
  if (!st) return;
  if (st.tick) clearInterval(st.tick);
  delete _starve[id];
  if (why) appendLog(id, `Đã huỷ hẹn tự chạy lại (${why}).`);
}

// Đếm ngược có hiển thị, huỷ được. Ghi vào dòng trạng thái mỗi giây để người dùng thấy rõ app đang
// CHỜ CÓ CHỦ ĐÍCH, không phải treo (bài học QĐ-21: vòng chờ im lặng bị báo là bug).
async function waitBeforeRestart(ids) {
  // Mốc dùng CHUNG cho dòng trạng thái và cho nút Chạy — một nguồn sự thật, không thể lệch nhau.
  _vpnCooldownUntil = Date.now() + VPN_COOLDOWN_MS;
  try {
    for (;;) {
      if (_vpnCancelRestart) return;
      const left = applyVpnCooldown();   // vừa cập nhật nút, vừa trả số giây còn lại
      if (!left) return;
      const m = `⏳ Chờ ${left}s cho IP mới ổn định rồi mới chạy lại ${ids.length} profile`
        + ' (tránh TikTok coi là đăng nhập dồn dập trên IP vừa đổi)...';
      $('crawlStatusMsg').textContent = m;
      if (left % 15 === 0) for (const id of ids) appendLog(id, m);
      await new Promise(r => setTimeout(r, 1000));
    }
  } finally {
    // Mở khóa kể cả khi bị huỷ giữa chừng hoặc ném lỗi — bỏ sót là nút Chạy KẸT KHÓA vĩnh viễn.
    _vpnCooldownUntil = 0;
    applyVpnCooldown();
    updateRunSelectedBtnState();
  }
}

// ── ĐƯỜNG ĐỔI IP: dừng HẾT → tắt/bật lại HMA → chờ 59s → chạy lại cả nhóm ──
// ⚠ LUÔN dừng HẾT, không có nhánh "chỉ dừng 1" (xem lý do ở đầu khối): IP là của cả máy, nên để
// profile nào chạy tiếp là nó bị đổi IP GIỮA PHIÊN.
async function cycleIpAndRestart(profileId) {
  if (_vpnCycling) return;
  _vpnCycling = true;
  _vpnCancelRestart = false;   // bắt đầu lượt mới → xoá cờ huỷ của lượt trước
  _vpnRunLock = true;          // khoá nút Chạy NGAY — từ đây VPN sắp bị tắt
  _vpnLockReason = 'cycling';
  applyVpnCooldown();
  // Nhớ ĐÚNG nhóm đang chạy để bật lại y như cũ (không bật thừa profile người dùng đã tắt tay).
  const was = [...runningSet];
  const say = (m) => {
    $('crawlStatusMsg').textContent = m;
    for (const id of was) appendLog(id, m);
  };
  try {
    say(`⛔ "${nameOf(profileId)}" bị TikTok cắt feed — DỪNG HẾT ${was.length} profile để đổi IP.`
      + ' IP là của cả máy nên không thể đổi cho riêng một profile: để profile nào chạy tiếp là nó'
      + ' bị đổi IP giữa phiên, đúng thứ TikTok dùng để hủy phiên.');
    await api.profilesStopAll();

    // Chờ BACKEND xác nhận đã dừng SẠCH. Không tin `runningSet` của renderer — backend là nguồn sự
    // thật duy nhất về profile nào đang chạy (bài học đồng bộ trạng thái 2026-07-28).
    let still = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await new Promise(r => setTimeout(r, 1000));
      try { still = (await api.crawlRunningIds()) || []; } catch { still = []; }
      if (!still.length) break;
    }
    if (still.length) {
      say(`⚠ HỦY đổi IP: còn ${still.length} profile chưa dừng sau 90s. Tắt VPN lúc này sẽ để lọt`
        + ' request bằng IP thật và làm mất phiên — thà không đổi IP.');
      toast('Hủy đổi IP — còn profile chưa dừng.', 'err');
      scheduleGroupRetry(was, STARVE_RESTART_WAITS[0]);
      return;
    }

    say('Đang tắt HMA VPN rồi bật lại để lấy IP mới (nối lại đúng server cũ — HMA cấp IP khác'
      + ' mỗi lần kết nối nên không cần đổi city)...');
    const r = await api.vpnCycle({ profileId });

    if (r && r.ok) {
      say('✅ ' + r.msg);
      toast('Đã đổi IP — đang chạy lại profile.', 'ok');
    } else if (r && r.skipped === 'rate') {
      // Bị giới hạn nhịp thì VPN KHÔNG bị đụng tới → vẫn đang bật, bật lại profile là an toàn.
      say('⏭ ' + r.msg + ' Chạy lại profile với IP hiện tại.');
    } else {
      // Lỗi khác: VPN có thể ĐANG TẮT → TUYỆT ĐỐI không bật lại ngay, sẽ chạy bằng IP thật.
      // Nhưng cũng KHÔNG bỏ mặc: người dùng treo máy, nên hẹn thử lại cả nhóm. `fireGroupRetry`
      // chỉ bật khi VPN đã ổn định (bộ canh HMA giữ cờ khoá suốt lúc VPN tắt).
      say('⚠ Đổi IP thất bại: ' + ((r && r.msg) || 'không rõ lý do')
        + ' — KHÔNG bật lại ngay vì VPN có thể đang tắt. Sẽ tự thử lại sau khi VPN ổn định.');
      toast('Đổi IP thất bại — sẽ tự thử lại. Xem log 📄.', 'err');
      scheduleGroupRetry(was, STARVE_RESTART_WAITS[0]);
      return;
    }

    // ── CHỜ CHO IP "NGUỘI" TRƯỚC KHI CHẠY LẠI (người dùng chốt 2026-08-06) ──
    // 5 profile khởi động lại gần như cùng lúc trên MỘT IP vừa mới xuất hiện = 5 phiên đăng nhập cũ
    // bỗng chuyển sang IP mới trong vài giây — đúng khuôn "tài khoản bị chiếm" (QĐ-15).
    // Việc chờ này ĐỘC LẬP với `startProfilesStaggered` (QĐ-21): cái đó giãn các profile ra để không
    // tranh CPU, còn cái này giãn CẢ NHÓM ra khỏi thời điểm IP vừa đổi.
    if (!scanStopRequested()) await waitBeforeRestart(was);
    if (scanStopRequested()) { say('Đã hủy chạy lại (người dùng bấm dừng trong lúc chờ).'); return; }

    // HẾT GIỜ CHỜ → MỞ KHÓA nút Chạy ngay, trước khi app tự bật lại (người dùng chốt: *"hết 59s thì
    // hiện Chạy để cho chạy lại"*).
    _vpnRunLock = false;
    applyVpnCooldown();
    updateRunSelectedBtnState();

    await startProfilesStaggered(was);
  } catch (e) {
    say('⚠ Lỗi trong lúc đổi IP: ' + e.message);
    scheduleGroupRetry(was, STARVE_RESTART_WAITS[0]);
  } finally {
    // MỞ KHÓA ở đây là bắt buộc, kể cả trên mọi đường `return` sớm phía trên. Thiếu là nút kẹt
    // "⏳ đổi IP" mãi và người dùng không còn cách nào bật profile bằng tay.
    _vpnCycling = false;
    _vpnRunLock = false;
    _vpnCooldownUntil = 0;
    applyVpnCooldown();
    updateRunSelectedBtnState();
  }
}

// ── HẸN THỬ LẠI CẢ NHÓM ──
// Dùng khi đường đổi IP không đi tới đích (đổi IP thất bại, còn profile chưa dừng, VPN tụt...).
// Vì sao cần: người dùng TREO MÁY. Bỏ mặc nhóm ở trạng thái dừng = mất cả đêm sản lượng mà không ai
// thấy. Một hẹn cho CẢ NHÓM (không phải mỗi profile một hẹn) để chúng không cùng bật một lúc.
let _groupRetry = null;   // { ids, until, tick }
function cancelGroupRetry(why) {
  if (!_groupRetry) return;
  if (_groupRetry.tick) clearInterval(_groupRetry.tick);
  const ids = _groupRetry.ids;
  _groupRetry = null;
  if (why) for (const id of ids) appendLog(id, `Đã huỷ hẹn chạy lại cả nhóm (${why}).`);
}
function scheduleGroupRetry(ids, waitMs) {
  cancelGroupRetry();
  if (!ids || !ids.length) return;
  _groupRetry = { ids: [...ids], until: Date.now() + waitMs, tick: null };
  const render = () => {
    const cur = _groupRetry;
    if (!cur) return;
    const left = cur.until - Date.now();
    if (left > 0) {
      for (const id of cur.ids) {
        if (!runningSet.has(id)) updateRowStatus(id, 'stopped', `⏸ Chờ chạy lại sau ${formatCountdown(left)}`);
      }
      return;
    }
    clearInterval(cur.tick);
    cur.tick = null;
    fireGroupRetry();
  };
  _groupRetry.tick = setInterval(render, 1000);
  render();
}
async function fireGroupRetry() {
  const cur = _groupRetry;
  if (!cur) return;
  // VPN chưa ổn định → chưa bật, kiểm lại mỗi 5 giây (VPN tắt là do người dùng nên có thể hết bất
  // cứ lúc nào; hẹn thưa làm nhóm nằm chờ vô ích sau khi VPN đã lên).
  if (vpnRunLocked()) {
    cur.until = Date.now() + 5000;
    for (const id of cur.ids) {
      if (!runningSet.has(id)) updateRowStatus(id, 'stopped', '⏸ Chờ VPN ổn định rồi chạy lại...');
    }
    cur.tick = setInterval(() => {
      const c = _groupRetry;
      if (!c) return;
      if (Date.now() >= c.until) { clearInterval(c.tick); c.tick = null; fireGroupRetry(); }
    }, 1000);
    return;
  }
  const ids = cur.ids.filter(id => !runningSet.has(id));
  _groupRetry = null;
  if (!ids.length) return;
  for (const id of ids) appendLog(id, '⏱ Hết giờ chờ — tự chạy lại cả nhóm.');
  try {
    await startProfilesStaggered(ids);
  } catch (e) {
    for (const id of ids) appendLog(id, '⚠ Chạy lại cả nhóm thất bại: ' + e.message);
    scheduleGroupRetry(ids, STARVE_RESTART_WAITS[STARVE_RESTART_WAITS.length - 1]);
  }
}

async function handleFeedStarved(profileId) {
  if (!runningSet.has(profileId)) return;   // đã dừng bằng đường khác
  // Công tắc BẬT → đường đổi IP (dừng HẾT + tắt/bật HMA + chạy lại cả nhóm).
  // Công tắc TẮT → đường nhẹ (dừng riêng profile đó + nghỉ 5/15/30 phút).
  if (_vpnAutoCycle) return cycleIpAndRestart(profileId);
  return stopAndScheduleRestart(profileId, 'bị TikTok cắt feed');
}

// ── TIKTOK CHẶN TRANG ĐẾM KÉO DÀI → cũng dừng profile đó rồi tự bật lại (2026-08-07) ──
// Log người dùng: bước đếm bị chặn, app backoff 30s → 2p → 5p rồi **kẹt ở mức 5 phút MÃI MÃI**
// (`failStreak` không bao giờ reset vì mọi lần thử đều lỗi). Mỗi sound còn được giữ 3 vòng nên mất
// ~18–22 phút/sound; hàng đợi 20 sound ⇒ **6–7 tiếng**. Suốt thời gian đó vòng quét đứng hẳn vì
// hàng đợi đầy. Đo thật: 40 phút → Quét 24 · Đã check 3 · **Hợp lệ 0**.
//
// ⚠ TUYỆT ĐỐI KHÔNG đi đường đổi IP cho ca này, kể cả khi công tắc "Tự đổi IP" đang bật:
// chặn này là theo **TÀI KHOẢN**, không phải theo IP — bằng chứng trong chính ảnh người dùng gửi:
// 5 profile khác trên CÙNG máy vẫn đếm bình thường (88/74, 144/126, 136/111). Đổi IP cả máy để
// chữa một tài khoản là dừng oan 5 profile khoẻ, mà vẫn không chữa được gì.
async function handleCountBlocked(profileId) {
  if (!runningSet.has(profileId)) return;
  return stopAndScheduleRestart(profileId, 'bị TikTok chặn trang đếm kéo dài');
}

// Đường NHẸ dùng chung: dừng đúng profile đó + hẹn tự bật lại 5 → 15 → 30 phút.
async function stopAndScheduleRestart(profileId, why) {
  const prev = _starve[profileId];
  // `streak` phải sống qua lần dừng: đếm số lần bị cắt LIÊN TIẾP để giãn thời gian nghỉ.
  const streak = ((prev && prev.streak) || 0) + 1;
  const waitMs = STARVE_RESTART_WAITS[Math.min(streak - 1, STARVE_RESTART_WAITS.length - 1)];

  // Dùng formatCountdown (đã có, dùng chung với chip pha chu kỳ) thay vì `Math.round(ms/60000)`:
  // cách cũ ra "0 phút" với mọi khoảng dưới 30 giây — vô nghĩa, và test đã bắt đúng lỗi này.
  const waitTxt = formatCountdown(waitMs);
  const m = `⛔ "${nameOf(profileId)}" ${why} (lần ${streak} liên tiếp) — DỪNG profile`
    + ` này, sẽ TỰ BẬT LẠI sau ${waitTxt}.`;
  $('crawlStatusMsg').textContent = m;
  appendLog(profileId, m);
  toast(`"${nameOf(profileId)}" ${why} — tự bật lại sau ${waitTxt}.`, 'err');

  try {
    // ⚠ BẮT BUỘC `force` — đây là đường TỰ ĐỘNG, không phải người dùng bấm:
    //  · "chặn trang đếm": chính bước đếm đang hỏng nên drain KHÔNG BAO GIỜ xong (QĐ-35: 20
    //    sound cần 6–7 tiếng) → dừng mềm ở đây là profile treo vĩnh viễn, mất trọn đêm.
    //  · "feed cạn": phải dừng dứt điểm rồi mới hẹn bật lại; drain kéo dài làm lệch hẹn.
    await stopProfileById(profileId, { force: true });
  } catch (e) {
    appendLog(profileId, '⚠ Lỗi khi dừng profile: ' + e.message);
  }
  // ⚠ Đặt hẹn SAU khi dừng: `stopProfileById` xoá mọi hẹn đang có (người dùng bấm Dừng thì phải
  // huỷ hẹn), nên đặt trước sẽ bị chính nó xoá mất.
  scheduleStarveRestart(profileId, waitMs, streak);
}

function scheduleStarveRestart(id, waitMs, streak) {
  cancelStarveRestart(id);
  const st = { streak, until: Date.now() + waitMs, tick: null };
  _starve[id] = st;
  // Đếm ngược HIỆN RA badge trạng thái mỗi giây. Vòng chờ im lặng luôn bị báo là "app treo"
  // (bài học QĐ-21) — mà lần này còn chờ tới 30 phút.
  const render = () => {
    const cur = _starve[id];
    if (!cur) return;
    const left = cur.until - Date.now();
    if (left > 0) {
      updateRowStatus(id, 'stopped',
        `⏸ Bị cắt feed — tự bật lại sau ${formatCountdown(left)}`);
      return;
    }
    clearInterval(cur.tick);
    cur.tick = null;
    fireStarveRestart(id);
  };
  st.tick = setInterval(render, 1000);
  render();
}

async function fireStarveRestart(id) {
  const st = _starve[id];
  if (!st) return;                          // đã bị huỷ
  if (runningSet.has(id)) { delete _starve[id]; return; }   // người dùng đã tự bật
  // VPN đang tắt / đang trong 59s chờ IP nguội → KHÔNG bật (sẽ chạy bằng IP thật, hoặc dồn đăng
  // nhập lên IP vừa đổi). Hẹn lại sau 30 giây rồi kiểm tiếp — không bỏ luôn ý định bật lại.
  if (vpnRunLocked()) {
    // Kiểm lại mỗi 5 giây — VPN tắt là do NGƯỜI DÙNG nên có thể hết bất cứ lúc nào; hẹn thưa
    // (vd 30s) làm profile nằm chờ vô ích sau khi VPN đã lên. 5 giây đủ nhạy mà không tốn gì
    // (chỉ đọc một cờ trong bộ nhớ, không gọi IPC).
    st.until = Date.now() + 5000;
    updateRowStatus(id, 'stopped', '⏸ Bị cắt feed — chờ VPN ổn định rồi tự bật lại...');
    appendLog(id, 'Tới giờ tự bật lại nhưng VPN đang tắt/đang chờ IP nguội — kiểm lại sau 5s.');
    st.tick = setInterval(() => {
      const cur = _starve[id];
      if (!cur) return;
      if (Date.now() >= cur.until) { clearInterval(cur.tick); cur.tick = null; fireStarveRestart(id); }
    }, 1000);
    return;
  }
  // GIỮ `streak` để lần cắt kế tiếp nghỉ dài hơn. Nó chỉ được xoá khi profile quét lại được bình
  // thường (xem chỗ nhận status 'running' có số sound mới) hoặc khi người dùng tự can thiệp.
  const streak = st.streak;
  if (st.tick) clearInterval(st.tick);
  delete _starve[id];
  appendLog(id, `⏱ Hết giờ nghỉ — tự bật lại "${nameOf(id)}" (lần cắt liên tiếp thứ ${streak}).`);
  try {
    await startProfileById(id);
    // Bật xong thì khôi phục `streak` để lần cắt sau còn giãn tiếp. `startProfileById` không biết
    // gì về starve nên phải tự đặt lại ở đây.
    if (runningSet.has(id)) _starve[id] = { streak, until: 0, tick: null };
  } catch (e) {
    appendLog(id, '⚠ Tự bật lại thất bại: ' + e.message + ' — thử lại sau.');
    scheduleStarveRestart(id, STARVE_RESTART_WAITS[STARVE_RESTART_WAITS.length - 1], streak);
  }
}
// ══════════════════════════════════════════════════════════════════════════
// CANH HMA DO NGƯỜI DÙNG TỰ TẮT/BẬT (2026-08-06)
// ══════════════════════════════════════════════════════════════════════════
// LỖI ĐÃ GẶP: đếm ngược + khoá nút chỉ chạy trong `handleFeedStarved()`, tức CHỈ khi APP tự đổi
// IP. Người dùng tự tay tắt/bật HMA thì app không hề biết → nút "▶ Chạy" vẫn sáng, bấm là vào
// ngay trên IP vừa đổi. Họ gửi ảnh: HMA vừa `ON 00:00:02`, 5 profile đã dừng, mà cả 5 nút Chạy
// lẫn nút "Chạy ô đã chọn" đều sáng bình thường.
//
// Lý do phải CANH thay vì chờ HMA thông báo: HMA không có kênh nào bắn sự kiện ra ngoài cho
// app khác. Nhưng trạng thái đường hầm đọc được MIỄN PHÍ từ `os.networkInterfaces()` — xem
// `tunnelState()` trong vpn-hma.cjs (đo thật: bật → adapter "HMA VPN WireGuard" có IPv4
// 10.252.32.18). So sánh cả ĐỊA CHỈ nên nối lại mà adapter không mất vẫn nhận ra được.
const VPN_WATCH_EVERY_TICK = 2;   // 1 tick = 1 giây → poll đường hầm 2 giây/lần
let _tunnelPrev = undefined;      // undefined = CHƯA có mốc so sánh (xem dưới)
let _vpnWasLocked = false;

async function watchVpnTunnel() {
  let t = null;
  try { t = await api.vpnTunnel(); } catch (_) { return; }
  if (!t) return;
  const now = t.up ? (t.address || 'up') : 'down';

  // LẦN ĐẦU chỉ LẤY MỐC, tuyệt đối không hành động. Nếu không, máy mở app lúc HMA đang tắt (hoặc
  // máy không cài HMA) sẽ bị coi là "VPN vừa sập" → khoá nút Chạy ngay khi mở app, không bấm được
  // gì. Chỉ hành động khi thấy trạng thái ĐỔI.
  if (_tunnelPrev === undefined) { _tunnelPrev = now; return; }
  if (now === _tunnelPrev) return;
  const prev = _tunnelPrev;
  _tunnelPrev = now;

  // (Trước đây có nhánh "app đang tự đổi IP thì đứng ngoài". Không cần nữa: app KHÔNG BAO GIỜ tự
  // đụng vào VPN — mọi thay đổi VPN đều do người dùng, nên bộ canh là chủ duy nhất của việc khoá.)

  if (now === 'down') {
    // VPN vừa SẬP (người dùng tắt, hoặc tụt). Khoá ngay: bật profile lúc này là chạy IP thật.
    _vpnRunLock = true;
    _vpnLockReason = 'vpn-off';
    _vpnCooldownUntil = 0;
    applyVpnCooldown();
    // ⚠ DỪNG HẾT, không chỉ cảnh báo (người dùng chốt 2026-08-06: *"khi tôi tắt HMA thì vẫn thấy
    // các profile chạy... Tắt HMA là dừng hết luôn không cho chạy"*). Cảnh báo là vô nghĩa khi họ
    // treo máy: mỗi giây profile còn chạy là một giây gửi request bằng IP THẬT.
    // App đang tự đổi IP thì nó đã dừng hết trước khi tắt VPN → chỗ này thành no-op, không xung đột.
    const wasRunning = [...runningSet];
    const running = wasRunning.length;
    let m = '⛔ HMA VPN vừa TẮT — đã khoá nút Chạy (chạy lúc này là dùng IP THẬT).';
    if (running) {
      m += ` ĐANG DỪNG HẾT ${running} profile.`;
      // Máy CÓ IPv6 công khai thì nguy hiểm hơn hẳn: đường hầm HMA chỉ định tuyến IPv4, nên lúc
      // VPN tắt, IPv6 đi THẲNG ra internet bằng IP thật (đo thật: lọt trong 241ms) trong khi
      // profile vẫn khai múi giờ London/Seoul — đúng mâu thuẫn "IP nước này, giờ nước khác".
      // Nói rõ ra vì hai ca cần mức khẩn cấp khác nhau: không có IPv6 thì chỉ là lỗi mạng tạm
      // thời, có IPv6 thì đang LỘ NƯỚC THẬT.
      try {
        const risk = await api.vpnIpv6Risk();
        if (risk && risk.risky) {
          const addr = (risk.addresses && risk.addresses[0] && risk.addresses[0].address) || '?';
          m += ` Máy này CÓ IPv6 công khai (${addr}) nên chúng đang LỘ IP THẬT ra TikTok, không chỉ`
            + ' lỗi mạng — dừng càng sớm càng tốt (tắt IPv6: TROUBLESHOOTING mục 17).';
        } else if (risk && !risk.unknown) {
          m += ' Máy đã tắt IPv6 nên chúng chỉ bị lỗi mạng, không lộ IP thật.';
        }
      } catch (_) { /* không hỏi được thì thôi, phần cảnh báo chính đã có */ }
    }
    $('crawlStatusMsg').textContent = m;
    for (const id of wasRunning) appendLog(id, m);
    toast(running ? `HMA đã tắt — đang DỪNG HẾT ${running} profile.` : 'HMA đã tắt — đã khoá nút Chạy.', 'err');
    if (running) {
      // Nhớ nhóm để tự bật lại khi VPN lên — người dùng treo máy, VPN tụt lúc 3h sáng mà không ai
      // bật lại thì mất cả đêm. Bấm ■ Dừng lúc đang chờ sẽ huỷ (xem cancelGroupRetry).
      _vpnDownGroup = wasRunning;
      try {
        await api.profilesStopAll();
      } catch (e) {
        for (const id of wasRunning) appendLog(id, '⚠ Lỗi khi dừng vì VPN tắt: ' + e.message);
      }
    }
    return;
  }

  // ── VPN vừa LÊN (bật lại, hoặc nối lại nên IP trong hầm đổi) ──
  _vpnRunLock = false;
  _vpnLockReason = 'cycling';
  _vpnCooldownUntil = Date.now() + VPN_COOLDOWN_MS;
  applyVpnCooldown();
  const m = `✅ HMA VPN vừa BẬT LẠI (${t.address || 'đường hầm đã lên'}) — chờ`
    + ` ${Math.round(VPN_COOLDOWN_MS / 1000)}s cho IP mới ổn định rồi mới cho chạy profile`
    + ' (tránh TikTok coi là đăng nhập dồn dập trên IP vừa đổi).';
  $('crawlStatusMsg').textContent = m;
  for (const id of Object.keys(profileLogs)) appendLog(id, m);
  if (prev === 'down') toast('HMA đã bật lại — chờ 60s rồi mới chạy được.', 'ok');

  // App đang tự đổi IP thì CHÍNH NÓ lo việc bật lại (cycleIpAndRestart) — đứng ngoài để không có
  // hai đường cùng bật một nhóm.
  if (_vpnCycling) { _vpnDownGroup = []; return; }

  // Nhóm bị app dừng vì VPN tắt → hẹn bật lại sau đúng 59 giây chờ IP nguội. `fireGroupRetry` tự
  // kiểm `vpnRunLocked()` nên nếu VPN lại tụt trong lúc chờ thì nó dừng lại chứ không bật bừa.
  if (_vpnDownGroup.length) {
    const group = _vpnDownGroup;
    _vpnDownGroup = [];
    for (const id of group) appendLog(id, `Sẽ tự chạy lại sau khi hết ${Math.round(VPN_COOLDOWN_MS / 1000)}s chờ IP nguội.`);
    scheduleGroupRetry(group, VPN_COOLDOWN_MS);
  }
}

// MỘT bộ đếm duy nhất lo cả 2 việc: vẽ đếm ngược trên nút (mỗi giây) và canh đường hầm (2 giây).
// Gộp lại để không có 2 timer cùng ghi vào nút — đúng bài học QĐ-10.
let _vpnTick = 0;
let _vpnWatcherOn = false;
function startVpnWatcher() {
  // Chặn chạy 2 bộ đếm: init() có thể chạy lại (bản dev bấm 🔄 Reload nạp lại giao diện). Hai
  // interval cùng poll + cùng ghi nút là đúng bẫy QĐ-10, và tick đôi làm đếm ngược nhảy 2 giây.
  if (_vpnWatcherOn) return;
  _vpnWatcherOn = true;
  setInterval(async () => {
    _vpnTick++;
    const locked = vpnRunLocked();
    if (locked) applyVpnCooldown();
    else if (_vpnWasLocked) {
      // Vừa hết giờ → mở khoá đúng MỘT lần. Không gọi vô điều kiện mỗi giây để khỏi ghi đè nhãn
      // nút của các luồng khác (vd "▶ Đang bật 2/5..." của runSelected).
      applyVpnCooldown();
      updateRunSelectedBtnState();
    }
    _vpnWasLocked = locked;
    if (_vpnTick % VPN_WATCH_EVERY_TICK === 0) await watchVpnTunnel();
  }, 1000);
}

async function stopSelected() {
  const ids = getCheckedIds();
  if (!ids.length) return toast('Tick chọn profile cần dừng.', 'err');
  // Việc HUỶ tự-chạy-lại-sau-đổi-IP nằm trong stopProfileById (một chỗ duy nhất, che cả nút
  // "■ Dừng" trên từng hàng).
  const live = ids.filter((id) => runningSet.has(id));
  for (const id of live) await stopProfileById(id);
  // Nói rõ app đang CHỜ CÓ CHỦ Ý, không phải nút hỏng. Vòng chờ im lặng luôn bị báo là "app
  // treo" (QĐ-21) — mà ở đây profile còn chạy tiếp vài phút sau khi bấm Dừng nên càng dễ hiểu lầm.
  const pending = live.filter((id) => _draining.has(id));
  if (pending.length) {
    const left = pending.reduce((s, id) => s + Math.max(0, (profileScanned[id] || 0) - (profileChecked[id] || 0)), 0);
    toast(`Đang check nốt ${left} sound của ${pending.length} profile rồi mới dừng hẳn.`
      + ` Cần cắt luôn thì bấm "⏹ Dừng ngay ô đã chọn".`, 'ok');
  }
}

// Kiểm tra phiên đăng nhập THẬT: mở TikTok hỏi thẳng từng profile (không đếm cookie trong
// file — đã có tiền lệ cookie đủ mà TikTok vẫn cho vào chế độ khách).
async function verifyLogins() {
  const ids = getCheckedIds();
  const n = ids.length || profilesCache.length;
  if (!n) return toast('Chưa có profile nào.', 'err');
  const btn = $('verifyLoginsBtn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '⏳ Đang kiểm tra...';
  toast(`Đang kiểm tra ${n} profile — mỗi profile mất ~20 giây, vui lòng đợi.`);
  try {
    const res = await api.verifyLogins(ids);
    const r = (res && res.results) || [];
    const guest = r.filter(x => x.state === 'guest');
    const ok = r.filter(x => x.state === 'logged-in').length;
    for (const x of r) appendLog(x.id, `Kiểm tra phiên: ${x.msg}`);
    if (guest.length) {
      toast(`${ok} profile OK · ${guest.length} CẦN ĐĂNG NHẬP LẠI: ${guest.map(x => x.name).join(', ')}`, 'err');
    } else {
      toast(`Tất cả ${ok} profile đều còn đăng nhập.`, 'ok');
    }
  } catch (e) {
    toast('Lỗi kiểm tra: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// CẮT NGAY: vứt hàng đợi, dừng tức thì. Từ 2026-08-13 nút "■ Dừng" mặc định là dừng MỀM, nên
// đây là đường thoát tường minh cho ca cần gấp — nhất là VPN tụt, lúc đó mỗi giây profile còn
// chạy là một giây gửi request bằng IP THẬT (QĐ-32), không thể ngồi chờ check nốt hàng đợi.
async function forceStopSelected() {
  const ids = getCheckedIds().filter((id) => runningSet.has(id));
  if (!ids.length) return toast('Tick chọn profile cần dừng.', 'err');
  const lost = ids.reduce((s, id) => s + Math.max(0, (profileScanned[id] || 0) - (profileChecked[id] || 0)), 0);
  // Đây là hành động MẤT DỮ LIỆU không hoàn tác được → phải xác nhận, cùng nguyên tắc với
  // 🧹 Dọn trùng (QĐ-20). Nói thẳng số sound sẽ mất chứ không nói chung chung.
  if (lost > 0 && !confirm(`Cắt ngay ${ids.length} profile?\n\n`
    + `⚠ ${lost} sound đã quét mà CHƯA check số video sẽ bị BỎ HẲN.\n\n`
    + `Muốn giữ thì bấm Huỷ rồi dùng "■ Dừng ô đã chọn" (check nốt rồi mới dừng).`)) return;
  for (const id of ids) await stopProfileById(id, { force: true });
  toast(`Đã cắt ngay ${ids.length} profile${lost > 0 ? ` — bỏ ${lost} sound chưa check.` : '.'}`, 'ok');
}

// ══════════════════════════════════════════
// MODAL CÀI ĐẶT (1 hoặc nhiều profile)
// ══════════════════════════════════════════
function updateCfgModeUI() {
  const mode = $('cfgMode').value;
  const isView = mode === 'view';
  const isCycle = mode === 'cycle';
  $('cfgKeywordRow').style.display = mode === 'search' ? '' : 'none';
  $('cfgCurrentHint').style.display = mode === 'current' ? '' : 'none';
  // Danh sách link Xem: cần cho CẢ 'view' (xem hết rồi dừng) LẪN 'cycle' (pha Xem của chu kỳ).
  $('cfgViewRow').style.display = (isView || isCycle) ? '' : 'none';
  $('cfgCycleSection').style.display = isCycle ? '' : 'none';
  $('cfgHeadless').disabled = mode === 'current';
  // Chế độ Xem video (THUẦN, không phải cycle): ẩn các mục không có tác dụng (sound/lọc/
  // đếm/chặn media) vì không hề quét. Chế độ 'cycle' vẫn CẦN các mục này cho pha Quét.
  $('cfgSoundSection').style.display = isView ? 'none' : '';
  $('cfgPerfSection').style.display = isView ? 'none' : '';
  $('cfgFilterSection').style.display = isView ? 'none' : '';
  $('cfgCountSection').style.display = isView ? 'none' : '';
  $('cfgDelayTitle').textContent = isView ? 'Nghỉ giữa 2 lần cuộn / 2 video'
    : isCycle ? 'Delay (cuộn khi Quét / nghỉ khi Xem)'
    : 'Delay mỗi lần cuộn';
}

// Ô tick này hiển thị theo đúng tiêu đề mục "Hiển thị trình duyệt": TICK = hiện cửa sổ
// (Visible), BỎ TICK = chạy ẩn (Headless) — ngược dấu với field `headless` lưu trong
// cấu hình (xem openSettingsModal/saveCrawlSettings), vì trước đây ô tick + chữ đi NGƯỢC
// với tiêu đề mục (tick lại nghĩa là chạy ẩn) gây hiểu nhầm "bật lên mà vẫn hiện trình duyệt".
function updateCfgHeadlessLabel() {
  $('cfgHeadlessLabel').textContent = $('cfgHeadless').checked ? 'Chạy bật trình duyệt (Visible)' : 'Chạy ẩn (Headless)';
}

function openSettingsModal(ids) {
  if (!ids || !ids.length) return toast('Tick chọn profile để cài đặt.', 'err');
  crawlSettingsTargetIds = ids;
  $('crawlSettingsTarget').textContent = ids.length === 1
    ? nameOf(ids[0])
    : `${ids.length} profile đã chọn`;
  const s = getSettings(ids[0]); // mẫu từ profile đầu
  $('cfgMode').value = s.mode;
  $('cfgKeyword').value = s.keyword || '';
  $('cfgViewLinks').value = s.viewLinks || '';
  $('cfgViewPctMin').value = s.viewPctMin;
  $('cfgViewPctMax').value = s.viewPctMax;
  $('cfgViewLikePct').value = s.viewLikePct;
  $('cfgViewScrollMin').value = s.viewScrollMin;
  $('cfgViewScrollMax').value = s.viewScrollMax;
  $('cfgCycleScanHours').value = s.cycleScanHours;
  $('cfgCycleViewMinutes').value = s.cycleViewMinutes;
  $('cfgCycleBreakMin').value = s.cycleBreakMin;
  $('cfgCycleBreakMax').value = s.cycleBreakMax;
  $('cfgHeadless').checked = !s.headless;  // tick = hiện trình duyệt = NGƯỢC dấu với `headless`
  $('cfgOriginalOnly').checked = !!s.originalOnly;
  $('cfgLatinTitleOnly').checked = !!s.latinTitleOnly;
  $('cfgNotInterested').checked = !!s.notInterested;
  $('cfgBlockImages').checked = !!s.blockImages;
  $('cfgRecycleEvery').value = s.recycleEvery;
  $('cfgMinVideos').value = s.minVideos;
  $('cfgMaxVideos').value = s.maxVideos;
  $('cfgDelayMin').value = s.delayMin;
  $('cfgDelayMax').value = s.delayMax;
  // Chế độ profile Chromium riêng: RIÊNG TỪNG PROFILE (QĐ-28) — đọc từ cài đặt của profile
  // đang mở, KHÔNG phải store chung. Trước đây để chung nên mở ⚙ ở profile nào cũng thấy tick
  // sẵn → tưởng app tự bật hết.
  $('cfgChromiumProfile').checked = !!s.chromiumProfile;
  // Số luồng đếm đồng thời là cài đặt CHUNG (global store), không theo profile.
  // ⚠ Ghi rõ "(toàn app)" ngay trên tiêu đề mục — bài học QĐ-28: đặt cài đặt toàn app vào modal
  // mở-từ-một-profile mà không nói rõ thì người dùng hiểu là của riêng profile đó.
  api.storeGet(['count_concurrency', 'show_count_tab', 'vpn_auto_cycle', 'count_mode']).then(r => {
    $('cfgCountConcurrency').value = (r && r.count_concurrency) || 2;
    $('cfgShowCountTab').checked = !!(r && r.show_count_tab);
    $('cfgVpnAutoCycle').checked = !!(r && r.vpn_auto_cycle);
    $('cfgCountMode').value = (r && r.count_mode) === 'patient' ? 'patient' : 'fast';
  });
  updateCfgModeUI();
  updateCfgHeadlessLabel();
  $('crawlSettingsModal').classList.add('open');
}

async function saveCrawlSettings() {
  let pctMin = Math.max(1, Math.min(100, parseInt($('cfgViewPctMin').value, 10) || 40));
  let pctMax = Math.max(1, Math.min(100, parseInt($('cfgViewPctMax').value, 10) || 70));
  if (pctMax < pctMin) pctMax = pctMin;
  let scrMin = Math.max(0, parseInt($('cfgViewScrollMin').value, 10) || 0);
  let scrMax = Math.max(0, parseInt($('cfgViewScrollMax').value, 10) || 0);
  if (scrMax < scrMin) scrMax = scrMin;
  const s = {
    mode: $('cfgMode').value,
    keyword: $('cfgKeyword').value.trim(),
    viewLinks: $('cfgViewLinks').value,
    viewPctMin: pctMin,
    viewPctMax: pctMax,
    viewLikePct: Math.max(0, Math.min(100, parseInt($('cfgViewLikePct').value, 10) || 0)),
    viewScrollMin: scrMin,
    viewScrollMax: scrMax,
    headless: !$('cfgHeadless').checked,  // tick = hiện trình duyệt = NGƯỢC dấu với `headless`
    originalOnly: $('cfgOriginalOnly').checked,
    latinTitleOnly: $('cfgLatinTitleOnly').checked,
    notInterested: $('cfgNotInterested').checked,
    blockImages: $('cfgBlockImages').checked,
    recycleEvery: Math.max(0, parseInt($('cfgRecycleEvery').value, 10) || 0),
    minVideos: Math.max(0, parseInt($('cfgMinVideos').value, 10) || 0),
    maxVideos: Math.max(0, parseInt($('cfgMaxVideos').value, 10) || 0),
    delayMin: Math.max(0, parseFloat($('cfgDelayMin').value) || 0),
    delayMax: Math.max(0, parseFloat($('cfgDelayMax').value) || 0),
    cycleScanHours: Math.max(0.1, parseFloat($('cfgCycleScanHours').value) || 5),
    cycleViewMinutes: Math.max(1, parseFloat($('cfgCycleViewMinutes').value) || 30),
    // parseFloat||0 giữ được giá trị 0 (0 = không nghỉ); max tự nâng lên >= min khi chạy.
    cycleBreakMin: Math.max(0, parseFloat($('cfgCycleBreakMin').value) || 0),
    cycleBreakMax: Math.max(0, parseFloat($('cfgCycleBreakMax').value) || 0),
    chromiumProfile: $('cfgChromiumProfile').checked,
  };
  for (const id of crawlSettingsTargetIds) {
    profileSettings[id] = Object.assign({}, getSettings(id), s);
  }
  // Lưu cài đặt CHUNG toàn app: số luồng đếm đồng thời (1–10) + tự đổi IP khi bị cắt feed.
  const cc = Math.max(1, Math.min(10, parseInt($('cfgCountConcurrency').value, 10) || 2));
  _vpnAutoCycle = $('cfgVpnAutoCycle').checked;
  await api.storeSet({
    count_concurrency: cc,
    vpn_auto_cycle: _vpnAutoCycle,
    // Chế độ đếm số video — RIÊNG TỪNG MÁY, áp ngay cho sound kế tiếp.
    count_mode: $('cfgCountMode').value === 'patient' ? 'patient' : 'fast',
    // Hiện cửa sổ tab đếm — chỉ để chẩn đoán, áp cho lần mở trình duyệt đếm tiếp theo.
    show_count_tab: $('cfgShowCountTab').checked,
  });
  await saveProfileSettings();
  renderProfileTable();
  $('crawlSettingsModal').classList.remove('open');
  toast(crawlSettingsTargetIds.length > 1
    ? `Đã lưu cài đặt cho ${crawlSettingsTargetIds.length} profile.`
    : 'Đã lưu cài đặt.', 'ok');
}

// ══════════════════════════════════════════
// LOG RIÊNG TỪNG PROFILE
// ══════════════════════════════════════════
function appendLog(id, line) {
  if (!id || !line) return;
  if (!profileLogs[id]) profileLogs[id] = [];
  const now = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  profileLogs[id].push(`[${now}] ${line}`);
  if (profileLogs[id].length > 500) profileLogs[id].splice(0, profileLogs[id].length - 500);
  if (logModalId === id) {
    const body = $('profileLogBody');
    body.textContent = profileLogs[id].join('\n');
    body.scrollTop = body.scrollHeight;
  }
}

function openLog(id) {
  logModalId = id;
  $('profileLogTitle').textContent = nameOf(id);
  const body = $('profileLogBody');
  body.textContent = (profileLogs[id] || []).join('\n') || '(chưa có log)';
  $('profileLogModal').classList.add('open');
  body.scrollTop = body.scrollHeight;
}

// ══════════════════════════════════════════
// BẢNG DỮ LIỆU CHUNG
// ══════════════════════════════════════════
let crawlResults = [];

// Xóa sạch bảng dữ liệu thu thập (gọi khi bắt đầu một PHIÊN mới — đồng bộ với việc
// backend reset _collected + nạp lại seed lọc trùng từ Sheet).
function clearResults() {
  crawlResults = [];
  $('resultBody').innerHTML = '';
  $('crawlCount').textContent = '0 sound';
  updateSkippedDup(0);
}

function addResultRow(d) {
  d.count = d.count || '';
  crawlResults.push(d);
  const tr = document.createElement('tr');

  const idxTd = document.createElement('td');
  idxTd.className = 'result-idx';
  idxTd.textContent = crawlResults.length;

  const nameTd = document.createElement('td');
  nameTd.textContent = d.name || '(không tên)';

  const countTd = document.createElement('td');
  countTd.className = 'result-count';
  countTd.textContent = (d.count === 0 || d.count) ? d.count : '?';

  const linkTd = document.createElement('td');
  const a = document.createElement('a');
  a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = d.url;
  linkTd.appendChild(a);

  const profileTd = document.createElement('td');
  profileTd.className = 'result-profile';
  profileTd.textContent = d.profileName || '';

  tr.append(idxTd, nameTd, linkTd, countTd, profileTd);
  const body = $('resultBody');
  body.appendChild(tr);
  // Giới hạn số dòng DOM hiển thị (chạy qua đêm chục nghìn dòng → renderer ngốn RAM).
  // Dữ liệu ĐẦY ĐỦ vẫn nằm trong crawlResults — Xuất Excel / Đẩy lên Sheet không mất gì.
  while (body.children.length > 5000) body.removeChild(body.firstChild);

  $('crawlCount').textContent = crawlResults.length + ' sound';

  if (d.profileId) {
    bumpValidCount(d.profileId);
    appendLog(d.profileId, `+ sound: ${d.name || '(không tên)'} (${countTd.textContent})`);
  }
}

// ══════════════════════════════════════════
// QUẢN LÝ PROFILE (modal thêm/import/sửa/xóa)
// ══════════════════════════════════════════
function renderProfileList() {
  const list = $('profileList');
  if (profilesCache.length === 0) {
    list.innerHTML = '<div class="profile-empty">Chưa có profile nào.</div>';
    return;
  }
  list.innerHTML = profilesCache.map(p => `
    <div class="profile-item" data-id="${p.id}">
      <div class="profile-item-info">
        <div class="profile-item-name">${escHtml(p.name)}</div>
        ${p.note ? `<div class="profile-item-note">${escHtml(p.note)}</div>` : ''}
      </div>
      <button class="btn btn-sm" data-act="rename" data-id="${p.id}">Sửa</button>
      <button class="btn btn-sm" data-act="delete" data-id="${p.id}">Xóa</button>
    </div>`).join('');

  list.querySelectorAll('[data-act="rename"]').forEach(b =>
    b.addEventListener('click', () => renameProfile(b.dataset.id)));
  list.querySelectorAll('[data-act="delete"]').forEach(b =>
    b.addEventListener('click', () => deleteProfile(b.dataset.id)));
}

async function renderImportFolders() {
  const sel = $('importFolderSelect');
  let folders = [];
  try { folders = await api.profilesListFolders(); } catch {}
  const available = folders.filter(f => !f.used);
  sel.innerHTML = '';
  if (available.length === 0) {
    sel.innerHTML = '<option value="">— Không có folder chưa gán —</option>';
    return;
  }
  sel.innerHTML = '<option value="">— Chọn folder để import —</option>' +
    available.map(f => `<option value="${escHtml(f.name)}">${escHtml(f.name)}</option>`).join('');
}

async function addProfile() {
  const input = $('newProfileName');
  const name = input.value.trim();
  if (!name) return toast('Nhập tên profile.', 'err');
  const res = await api.profilesAdd({ name });
  if (!res.ok) return toast(res.msg || 'Lỗi tạo profile.', 'err');
  input.value = '';
  await refreshAll();
  toast('Đã tạo profile.', 'ok');
}

async function importFolder() {
  const folderName = $('importFolderSelect').value;
  if (!folderName) return toast('Chọn folder để import.', 'err');
  const res = await api.profilesAdd({ folderName });
  if (!res.ok) return toast(res.msg || 'Lỗi import.', 'err');
  await refreshAll();
  toast('Đã import folder.', 'ok');
}

async function importFromDisk() {
  const sourcePath = await api.selectFolder();
  if (!sourcePath) return;
  const suggested = sourcePath.split(/[\\/]/).filter(Boolean).pop() || 'profile';
  const name = prompt('Tên hiển thị cho profile:', suggested);
  if (name === null) return;
  toast('Đang sao chép profile...');
  const res = await api.profilesImportPath({ name: name.trim() || suggested, sourcePath, move: false });
  if (!res.ok) return toast(res.msg || 'Lỗi import.', 'err');
  await refreshAll();
  toast('Đã import profile từ ổ đĩa.', 'ok');
}

async function renameProfile(id) {
  const p = profilesCache.find(x => x.id === id);
  if (!p) return;
  const name = prompt('Tên mới:', p.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return toast('Tên không hợp lệ.', 'err');
  const res = await api.profilesUpdate({ id, name: trimmed });
  if (!res.ok) return toast(res.msg || 'Lỗi đổi tên.', 'err');
  await refreshAll();
  toast('Đã đổi tên.', 'ok');
}

async function deleteProfile(id) {
  const p = profilesCache.find(x => x.id === id);
  if (!p) return;
  if (runningSet.has(id)) return toast('Profile đang chạy — dừng trước khi xóa.', 'err');
  if (!confirm(`Xóa profile "${p.name}"?`)) return;
  const deleteFolder = confirm('Xóa luôn dữ liệu profile trên đĩa?\n(OK = xóa folder, Cancel = chỉ gỡ khỏi danh sách)');
  const res = await api.profilesDelete({ id, deleteFolder });
  if (!res.ok) return toast(res.msg || 'Lỗi xóa.', 'err');
  await refreshAll();
  toast('Đã xóa profile.', 'ok');
}

async function refreshAll() {
  await loadProfiles();
  renderProfileTable();
  renderProfileList();
  await renderImportFolders();
}

// ══════════════════════════════════════════
// GOOGLE SHEET SETTINGS
// ══════════════════════════════════════════
async function loadSheetsConfig() {
  try {
    const cfg = await api.sheetsGetConfig();
    $('sheetsEnabled').checked = !!cfg.enabled;
    $('sheetsId').value = cfg.spreadsheetId || '';
    $('sheetsTab').value = cfg.tab || 'Data';
    $('sheetsPendingTab').value = cfg.pendingTab || '';
    $('sheetsSa').value = cfg.saJson || '';
    $('sheetsReseedMin').value = cfg.reseedMinutes || 10;
  } catch {}
}

function readSheetsForm() {
  return {
    enabled: $('sheetsEnabled').checked,
    spreadsheetId: $('sheetsId').value.trim(),
    tab: $('sheetsTab').value.trim() || 'Data',
    // Tab chờ kiểm tay (QĐ-33) — để trống = tắt.
    pendingTab: $('sheetsPendingTab').value.trim(),
    saJson: $('sheetsSa').value.trim(),
    reseedMinutes: Math.max(1, parseFloat($('sheetsReseedMin').value) || 10),
  };
}

async function saveSheetsConfig() {
  // Nút này CÓ THỂ chờ lâu: khi đang chạy, backend xả nốt buffer + đọc lại Sheet trước khi
  // đổi cấu hình — với Sheet 161k dòng và Google API đang chậm thì mất hàng chục giây. Trước
  // đây không có phản hồi nào nên bấm xong tưởng nút chết (người dùng báo "click không thấy
  // phản hồi gì"), rồi bấm lại nhiều lần. Phải khoá nút + nói đang làm gì NGAY.
  const btn = $('sheetsSaveBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang lưu...';
  try {
    await api.sheetsSetConfig(readSheetsForm());
    toast('Đã lưu cài đặt Google Sheet.', 'ok');
    $('sheetsModal').classList.remove('open');
  } catch (e) {
    toast('Lưu cài đặt Sheet lỗi: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function testSheets() {
  const btn = $('sheetsTestBtn');
  const result = $('sheetsTestResult');
  btn.disabled = true;
  result.textContent = 'Đang kiểm tra...';
  const res = await api.sheetsTest(readSheetsForm());
  btn.disabled = false;
  result.textContent = res.msg || (res.ok ? 'OK' : 'Lỗi');
  result.style.color = res.ok ? 'var(--ok)' : 'var(--primary-hover)';
}

// Dọn trùng: bước 1 chỉ QUÉT (không đổi gì) để hiện xem trước; xác nhận rồi mới xoá thật
// (bước 2 tự đọc lại từ đầu, không tin kết quả quét cũ — xem sheets.cjs cleanDuplicates()).
async function cleanSheetDuplicates() {
  const btn = $('sheetsCleanDupBtn');
  const result = $('sheetsCleanDupResult');
  btn.disabled = true;
  result.style.color = '';
  result.textContent = '⏳ Đang quét toàn bộ Sheet (có thể mất vài phút với Sheet lớn)...';
  try {
    const scan = await api.sheetsScanDuplicates();
    if (!scan.ok) {
      result.textContent = scan.msg || 'Quét thất bại.';
      result.style.color = 'var(--primary-hover)';
      return;
    }
    if (!scan.toDeleteCount) {
      result.textContent = `Không có trùng — đã kiểm tra ${scan.totalRows} dòng.`;
      result.style.color = 'var(--ok)';
      return;
    }
    const ok = confirm(
      `Tìm thấy ${scan.dupGroupCount} link bị trùng trên tổng ${scan.totalRows} dòng.\n`
      + `Sẽ XOÁ ${scan.toDeleteCount} dòng thừa (mỗi link giữ lại đúng 1 dòng — ưu tiên dòng có ghi chú tay ở cột E trở đi).\n\n`
      + `Xác nhận xoá? (không thể hoàn tác)`
    );
    if (!ok) { result.textContent = 'Đã huỷ — chưa xoá gì.'; return; }

    result.textContent = '⏳ Đang xoá dòng trùng...';
    const clean = await api.sheetsCleanDuplicates();
    if (!clean.ok) {
      result.textContent = clean.msg || 'Xoá thất bại.';
      result.style.color = 'var(--primary-hover)';
      return;
    }
    result.textContent = `Đã xoá ${clean.deleted} dòng trùng (${clean.dupGroupCount} nhóm link).`;
    result.style.color = 'var(--ok)';
  } catch (e) {
    result.textContent = 'Lỗi: ' + e.message;
    result.style.color = 'var(--primary-hover)';
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════
// KHO LINK CỤC BỘ — known_links.txt cạnh .exe (2026-08-11)
// ══════════════════════════════════════════
// Hiện đường dẫn + số khoá mỗi lần mở modal ☁, để người dùng biết file nằm đâu mà không phải
// mở File Explorer đi tìm. force=true khi bấm "Đọc lại file" (sau khi tự sửa bằng Notepad).
async function showLinkStoreInfo(force) {
  const el = $('linkStoreInfo');
  if (!el) return;
  try {
    const r = await api.linkStoreInfo(!!force);
    el.textContent = r && r.ok
      ? `Đang giữ ${r.count.toLocaleString('vi-VN')} link — ${r.path}`
      : `Không đọc được kho: ${(r && r.msg) || 'lỗi không rõ'}`;
  } catch (e) {
    el.textContent = 'Không đọc được kho: ' + e.message;
  }
}

async function importSheetToLinkStore() {
  const btn = $('linkStoreImportBtn');
  const out = $('linkStoreResult');
  btn.disabled = true;
  out.style.color = '';
  out.textContent = '⏳ Đang đọc toàn bộ cột Link trên Sheet (Sheet lớn có thể mất vài phút)...';
  try {
    const r = await api.linkStoreImportSheet();
    if (!r || !r.ok) {
      out.textContent = (r && r.msg) || 'Nạp thất bại.';
      out.style.color = 'var(--primary-hover)';
      return;
    }
    out.style.color = 'var(--ok)';
    out.textContent = r.added
      ? `Đã ghi thêm ${r.added.toLocaleString('vi-VN')} link mới vào kho (${r.before.toLocaleString('vi-VN')} → ${r.total.toLocaleString('vi-VN')}). Đọc ${r.sheetRows.toLocaleString('vi-VN')} dòng Sheet.`
      : `Kho đã có đủ — không link nào mới trong ${r.sheetRows.toLocaleString('vi-VN')} dòng Sheet. Tổng ${r.total.toLocaleString('vi-VN')} link.`;
    showLinkStoreInfo();
  } catch (e) {
    out.textContent = 'Lỗi: ' + e.message;
    out.style.color = 'var(--primary-hover)';
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════
// LỊCH SỬ THU THẬP THEO NGÀY
// ══════════════════════════════════════════
// Số liệu do main process ghi vào config/history.json mỗi khi có 1 sound vào bảng
// (xem src/history.cjs). Ở đây chỉ đọc ra và hiển thị.
function _fmtDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

// Trạng thái rỗng / đang tải / lỗi — chiếm cả bảng, căn giữa cho gọn.
function _historyPlaceholder(icon, text) {
  $('historySummary').innerHTML = '';
  // Ẩn cả khung tổng kết: để trống nó vẫn chiếm một dải trắng giữa tiêu đề và bảng.
  $('historySummarySection').style.display = 'none';
  const body = $('historyBody');
  body.innerHTML = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 3;
  td.className = 'history-empty';
  const i = document.createElement('span');
  i.className = 'history-empty-icon';
  i.textContent = icon;
  td.appendChild(i);
  td.appendChild(document.createTextNode(text));
  tr.appendChild(td);
  body.appendChild(tr);
}

function renderHistory(days) {
  const body = $('historyBody');
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

  if (!days.length) {
    _historyPlaceholder('📭', 'Chưa có dữ liệu — số liệu sẽ được ghi lại từ lần chạy tiếp theo.');
    return;
  }

  body.innerHTML = '';
  for (const d of days) {
    const tr = document.createElement('tr');
    const isToday = d.date === todayKey;
    if (isToday) tr.classList.add('is-today');

    const tdDate = document.createElement('td');
    tdDate.className = 'history-date';
    tdDate.appendChild(document.createTextNode(_fmtDate(d.date)));
    if (isToday) {
      const tag = document.createElement('span');
      tag.className = 'history-today-tag';
      tag.textContent = 'hôm nay';
      tdDate.appendChild(tag);
    }

    const tdNum = document.createElement('td');
    tdNum.className = 'history-num';
    tdNum.textContent = d.valid.toLocaleString('vi-VN');

    const tdBy = document.createElement('td');
    tdBy.className = 'history-profiles';
    // Sắp giảm dần để profile năng suất nhất hiện trước.
    const pairs = Object.entries(d.byProfile || {}).sort((a, b) => b[1] - a[1]);
    tdBy.textContent = pairs.length ? pairs.map(([n, v]) => `${n}: ${v}`).join('  ·  ') : '—';
    if (pairs.length) tdBy.title = pairs.map(([n, v]) => `${n}: ${v}`).join('\n');

    tr.append(tdDate, tdNum, tdBy);
    body.appendChild(tr);
  }

  // Tổng kết nhanh: hôm nay / 7 ngày / tổng đang lưu + trung bình mỗi ngày CÓ CHẠY (chia cho
  // số ngày thực sự thu được sound, không chia đều cả ngày nghỉ — nếu không con số vô nghĩa).
  const total = days.reduce((s, d) => s + d.valid, 0);
  const todayVal = (days.find(d => d.date === todayKey) || { valid: 0 }).valid;
  const last7 = days.slice(0, 7).reduce((s, d) => s + d.valid, 0);
  const activeDays = days.filter(d => d.valid > 0).length;
  const avg = activeDays ? Math.round(total / activeDays) : 0;

  $('historySummarySection').style.display = '';
  const sum = $('historySummary');
  sum.innerHTML = '';
  const cards = [
    ['Hôm nay', todayVal, 'is-today'],
    ['7 ngày gần nhất', last7, ''],
    [`Tổng ${days.length} ngày`, total, 'is-total'],
    ['TB ngày có chạy', avg, ''],
  ];
  for (const [label, val, cls] of cards) {
    const box = document.createElement('div');
    box.className = 'hstat' + (cls ? ' ' + cls : '');
    const l = document.createElement('div');
    l.className = 'hstat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'hstat-value';
    v.textContent = val.toLocaleString('vi-VN');
    box.append(l, v);
    sum.appendChild(box);
  }
}

async function openHistoryModal() {
  _historyPlaceholder('⏳', 'Đang đọc lịch sử...');
  $('historyModal').classList.add('open');
  try {
    const r = await api.historyGet(60);
    if (!r.ok) { _historyPlaceholder('⚠', 'Lỗi đọc lịch sử: ' + (r.msg || '')); return; }
    renderHistory(r.days || []);
  } catch (e) {
    _historyPlaceholder('⚠', 'Lỗi đọc lịch sử: ' + e.message);
  }
}

function initHistory() {
  $('historyBtn').addEventListener('click', openHistoryModal);
  $('historyModalClose').addEventListener('click', () => $('historyModal').classList.remove('open'));
  $('historyCloseBtn').addEventListener('click', () => $('historyModal').classList.remove('open'));
  $('historyClearBtn').addEventListener('click', async () => {
    // Xóa dữ liệu THẬT, không hoàn tác được → bắt buộc xác nhận (cùng nguyên tắc với
    // nút "Dọn trùng trên Sheet").
    if (!confirm('Xóa TOÀN BỘ số liệu lịch sử trên máy này?\n\nKhông thể hoàn tác.')) return;
    const r = await api.historyClear();
    if (r && r.ok) { toast('Đã xóa lịch sử.', 'ok'); renderHistory([]); }
    else toast('Xóa lịch sử thất bại: ' + ((r && r.msg) || ''), 'err');
  });
}

function initSheets() {
  $('sheetsBtn').addEventListener('click', async () => {
    await loadSheetsConfig();
    $('sheetsTestResult').textContent = '';
    $('sheetsCleanDupResult').textContent = '';
    $('linkStoreResult').textContent = '';
    $('sheetsModal').classList.add('open');
    showLinkStoreInfo();   // không await: modal phải mở ngay, số khoá điền vào sau
  });
  $('sheetsModalClose').addEventListener('click', () => $('sheetsModal').classList.remove('open'));
  $('sheetsSaveBtn').addEventListener('click', saveSheetsConfig);
  $('sheetsTestBtn').addEventListener('click', testSheets);
  $('sheetsCleanDupBtn').addEventListener('click', cleanSheetDuplicates);
  $('linkStoreImportBtn').addEventListener('click', importSheetToLinkStore);
  $('linkStoreReloadBtn').addEventListener('click', () => showLinkStoreInfo(true));
  $('linkStoreOpenBtn').addEventListener('click', async () => {
    const out = $('linkStoreResult');
    try {
      const r = await api.linkStoreOpen();
      if (!r || !r.ok) { out.textContent = 'Không mở được file: ' + ((r && r.msg) || ''); out.style.color = 'var(--primary-hover)'; }
      else { out.textContent = 'Đã mở file. Sửa xong bấm "🔄 Đọc lại file" để app nạp lại.'; out.style.color = ''; }
    } catch (e) { out.textContent = 'Lỗi: ' + e.message; out.style.color = 'var(--primary-hover)'; }
  });
}

// ══════════════════════════════════════════
// AUTO-UPDATE
// ══════════════════════════════════════════
let _pendingUpdate = null;

function openUpdateModal() { $('updateModal').classList.add('open'); }
function closeUpdateModal() { $('updateModal').classList.remove('open'); }

function setUpdateStatus(msg, type = '') {
  const el = $('updateStatus');
  el.textContent = msg;
  el.style.color = type === 'err' ? 'var(--primary-hover)' : type === 'ok' ? 'var(--ok)' : 'var(--text-dim)';
}

function showUpdateAvailable(d) {
  _pendingUpdate = d;
  // HẠ VERSION (đổi sang repo phát hành khác — xem updater.cjs) phải nhìn KHÁC HẲN bản nâng
  // cấp bình thường. Người dùng bấm "Cập nhật ngay" theo phản xạ; nếu không nói rõ đây là đi
  // LÙI thì họ mất các tính năng chỉ có ở bản đang chạy mà không hề biết.
  $('updateNewVer').textContent = d.isDowngrade
    ? `v${d.version}  ⚠ CŨ HƠN bản đang chạy (v${d.current})`
    : 'v' + d.version;
  $('updateChangelog').textContent = d.changelog || '(không có ghi chú)';
  $('updateAvailBox').style.display = '';
  const btn = $('updateInstallBtn');
  if (d.download_url) {
    btn.disabled = false;
    btn.textContent = d.isDowngrade ? '⬇ Chuyển sang bản này (hạ version)' : '⬆ Cập nhật ngay';
    setUpdateStatus(
      d.isDowngrade
        ? `⚠️ Đây là HẠ VERSION: v${d.current} → v${d.version}, từ repo "${d.repo || '?'}". `
          + 'Chỉ làm nếu bạn CHỦ Ý chuyển sang bản phát hành của repo đó — bản đang chạy có thể '
          + 'có tính năng mà bản kia không có. Dữ liệu (profiles, config, known_links.txt) không bị đụng.'
        : 'Đã có bản mới v' + d.version + '. Nhấn “Cập nhật ngay”.',
      d.isDowngrade ? 'err' : 'ok');
  } else {
    btn.disabled = true;
    btn.textContent = '⬆ Cập nhật ngay';
    setUpdateStatus('Có bản mới nhưng release thiếu file .exe để tải.', 'err');
  }
  openUpdateModal();
}

async function loadUpdateRepo() {
  try {
    const r = await api.updateGetRepo();
    $('updateRepoInput').value = r.repo || '';
    $('updateRepoDefault').textContent = r.default || '(chưa đặt)';
  } catch {}
}

async function checkUpdatesManual() {
  $('updateAvailBox').style.display = 'none';
  $('updateProgressBox').style.display = 'none';
  $('updateInstallBtn').disabled = true;
  _pendingUpdate = null;
  setUpdateStatus('Đang kiểm tra...');
  await api.checkUpdates();
}

async function installUpdate() {
  if (!_pendingUpdate || !_pendingUpdate.download_url) return;
  // HẠ VERSION phải xác nhận tường minh. Cùng nguyên tắc với 🧹 Dọn trùng (QĐ-20): việc khó
  // đảo ngược thì bắt buộc có bước xác nhận, không dựa vào việc người dùng đọc dòng trạng thái.
  if (_pendingUpdate.isDowngrade && !confirm(
      `HẠ VERSION: v${_pendingUpdate.current} → v${_pendingUpdate.version}\n`
      + `Repo: ${_pendingUpdate.repo || '?'}\n\n`
      + 'Bản đang chạy CÓ THỂ có tính năng mà bản kia không có. Chỉ làm nếu bạn chủ ý chuyển '
      + 'sang bản phát hành của repo đó.\n\n'
      + 'Dữ liệu KHÔNG bị đụng: profiles/, config/, known_links.txt giữ nguyên.\n\n'
      + 'Xác nhận chuyển?')) {
    setUpdateStatus('Đã huỷ — vẫn giữ bản đang chạy.', 'ok');
    return;
  }
  $('updateInstallBtn').disabled = true;
  $('updateLaterBtn').disabled = true;
  $('updateCheckBtn').disabled = true;
  $('updateProgressBox').style.display = '';
  $('updateProgressBar').style.width = '0%';
  $('updateProgressPct').textContent = '0%';
  setUpdateStatus('Đang tải...');
  const res = await api.downloadAndUpdate({ downloadUrl: _pendingUpdate.download_url });
  if (!res.ok) {
    $('updateInstallBtn').disabled = false;
    $('updateLaterBtn').disabled = false;
    $('updateCheckBtn').disabled = false;
    $('updateProgressBox').style.display = 'none';
    setUpdateStatus(res.msg || 'Cập nhật thất bại.', 'err');
    toast(res.msg || 'Cập nhật thất bại.', 'err');
  }
}

function initUpdater() {
  $('updateBtn').addEventListener('click', async () => {
    setUpdateStatus('Nhấn “Kiểm tra” để tìm bản mới.');
    await loadUpdateRepo();
    openUpdateModal();
  });
  $('updateModalClose').addEventListener('click', closeUpdateModal);
  $('updateLaterBtn').addEventListener('click', closeUpdateModal);
  $('updateCheckBtn').addEventListener('click', checkUpdatesManual);
  $('updateInstallBtn').addEventListener('click', installUpdate);
  $('updateRepoSaveBtn').addEventListener('click', async () => {
    await api.updateSetRepo($('updateRepoInput').value.trim());
    toast('Đã lưu repo. Nhấn “Kiểm tra” lại.', 'ok');
  });

  api.onUpdateAvailable((d) => showUpdateAvailable(d));
  api.onUpdateNotAvailable((d) => setUpdateStatus('✅ Bạn đang dùng bản mới nhất (v' + (d.current || '') + ').', 'ok'));
  api.onUpdateError((d) => setUpdateStatus('⚠️ ' + (d.msg || 'Lỗi kiểm tra cập nhật.'), 'err'));
  api.onDownloadProgress((p) => {
    $('updateProgressBar').style.width = p + '%';
    $('updateProgressPct').textContent = p + '%';
  });
}

// ══════════════════════════════════════════
// SỰ KIỆN CRAWL (data + status)
// ══════════════════════════════════════════
function initCrawlEvents() {
  api.onCrawlData((d) => {
    addResultRow(d);
    // Thu được sound HỢP LỆ = feed của profile đó đang chạy tốt → xoá chuỗi "bị cắt liên tiếp" để
    // lần cắt sau lại bắt đầu nghỉ từ 5 phút, không nhảy thẳng lên 30 phút.
    // Dùng crawl-data (sound đã qua bộ lọc) thay vì status 'running': status 'running' còn phát
    // trong cả lúc thoát kẹt/backoff nên không chứng minh được feed đã hồi.
    const st = d && d.profileId && _starve[d.profileId];
    if (st && !st.tick) delete _starve[d.profileId];
  });
  api.onCrawlStatus((s) => {
    if (!s.profileId && s.status === 'sheet-rows') {
      setSheetRowsStatus(s.sheetRows);
    } else if (s.profileId && s.status === 'counts') {
      // Kênh RIÊNG chỉ cập nhật số Quét/Đã check — không đụng badge trạng thái hay log.
      updateProfileCounts(s.profileId, s.scanned, s.checked);
      updateSkippedDup(s.skippedDup);
    } else if (s.profileId && s.status === 'phase') {
      // Kênh RIÊNG báo mốc kết thúc pha hiện tại (mode 'cycle') để renderer tự đếm ngược.
      profilePhase[s.profileId] = { label: s.phaseLabel, nextLabel: s.nextLabel, deadlineAt: s.deadlineAt };
      renderPhaseChip(s.profileId);
    } else if (s.profileId && s.status === 'feed-starved') {
      // TikTok cắt feed của profile này (QĐ-31). Status RIÊNG vừa là log cho người đọc vừa là
      // tín hiệu máy. Giữ hàng ở trạng thái ĐANG CHẠY (profile vẫn sống, đang tạm dừng) — dùng
      // 'error' ở đây sẽ làm hàng đổi về nút "▶ Chạy" dù profile chưa dừng.
      updateRowStatus(s.profileId, 'running', s.msg);
      appendLog(s.profileId, s.msg);
      // DỪNG LUÔN profile đó (người dùng chốt 2026-08-06, thay cho việc tự đổi IP — xem
      // handleFeedStarved). Không còn công tắc nào: cắt feed là dừng, khỏi hỏi.
      handleFeedStarved(s.profileId);
    } else if (s.profileId && s.status === 'count-blocked') {
      // TikTok chặn TRANG ĐẾM của profile này quá lâu (2026-08-07). Cùng cách xử với feed cạn:
      // dừng profile đó rồi tự bật lại 5/15/30 phút.
      // ⚠ Giống 'feed-starved', PHẢI giữ hàng ở 'running' — dùng 'error' sẽ làm hàng đổi về nút
      // "▶ Chạy" trong khi profile chưa dừng, đúng cái bẫy đã gây bế tắc ngày 2026-08-07.
      updateRowStatus(s.profileId, 'running', s.msg);
      appendLog(s.profileId, s.msg);
      handleCountBlocked(s.profileId);
    } else if (s.profileId && s.status === 'verify') {
      // Kết quả "🔑 Kiểm tra đăng nhập" — KHÔNG phải trạng thái của luồng crawl.
      // TUYỆT ĐỐI không gọi setRowRunning ở đây: kiểm tra phiên không làm profile chạy.
      // (Xem lý do đầy đủ trong main.js, handler 'verify-logins'.)
      updateRowStatus(s.profileId, s.state === 'guest' ? 'error' : 'verify', s.msg);
      appendLog(s.profileId, s.msg);
      if (s.state === 'guest') toast(`[${nameOf(s.profileId)}] ${s.msg}`, 'err');
    } else if (s.profileId) {
      if (s.status === 'running') setRowRunning(s.profileId, true);
      if (s.status === 'stopped' || s.status === 'error') { setRowRunning(s.profileId, false); delete profilePhase[s.profileId]; renderPhaseChip(s.profileId); }
      updateRowStatus(s.profileId, s.status, s.msg);
      appendLog(s.profileId, s.msg);
      if (s.status === 'error') toast(`[${nameOf(s.profileId)}] ${s.msg}`, 'err');
    } else {
      if (s.msg) $('crawlStatusMsg').textContent = s.msg;
      if (s.status === 'sheet-error') toast(s.msg, 'err');
    }
  });
}

// ══════════════════════════════════════════
// KHỞI TẠO
// ══════════════════════════════════════════
async function init() {
  try { $('appVersion').textContent = 'v' + await api.getVersion(); } catch {}
  try { $('updateCurrentVer').textContent = 'v' + await api.getVersion(); } catch {}

  // Nút Reload chỉ hiện ở bản dev.
  try {
    if (await api.isDev()) {
      const btn = $('reloadBtn');
      btn.hidden = false;
      btn.addEventListener('click', () => api.reloadWindow());
      window.addEventListener('keydown', (e) => {
        if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
          e.preventDefault();
          api.reloadWindow();
        }
      });
    }
  } catch {}

  await loadSettingsStore();
  // Công tắc tự đổi IP là cài đặt toàn app — phải nạp NGAY lúc khởi động, không chờ tới lúc mở ⚙:
  // sự kiện 'feed-starved' có thể tới trước khi người dùng mở modal lần nào.
  try {
    const g = await api.storeGet(['vpn_auto_cycle']);
    _vpnAutoCycle = !!(g && g.vpn_auto_cycle);
  } catch {}
  await loadProfiles();
  renderProfileTable();

  // Canh HMA do NGƯỜI DÙNG tự tắt/bật. Đây là phản ánh trạng thái VPN lên nút
  // bấm — người dùng chốt: *"kể cả app tự động hay là tôi thì đều phải là khi bật lại HMA thì các
  // nút chạy sẽ bị disable trong vòng 59 giây"*.
  // Máy không cài HMA thì `tunnelState()` luôn trả `up:false` → không có chuyển tiếp nào → không
  // khoá gì (xem watchVpnTunnel).
  startVpnWatcher();

  // ĐỒNG BỘ TRẠNG THÁI CHẠY VỚI BACKEND (2026-07-28): backend là nguồn sự thật duy nhất
  // về profile nào đang crawl. Trước đây renderer chỉ dựa vào sự kiện nhận được, nên hễ
  // lệch một lần là kẹt luôn (nút "■ Dừng" bấm không có tác dụng, "Chạy ô đã chọn" bị vô
  // hiệu) và cách duy nhất để thoát là khởi động lại app. Reload giao diện (F5 ở bản dev)
  // cũng từng làm mất hết trạng thái đang chạy.
  try {
    const ids = await api.crawlRunningIds();
    for (const id of (ids || [])) {
      setRowRunning(id, true);
      updateRowStatus(id, 'running', 'Đang chạy...');
    }
  } catch {}

  // TỰ CÀO TIẾP SAU KHI APP TỰ KHỞI ĐỘNG LẠI VÌ BỘ NHỚ (2026-08-17).
  // `_gracefulRestart` bên main dừng mềm cả nhóm rồi khởi động lại trước khi heap đụng trần
  // 4GB. Không có đoạn này thì app mở lên rồi ĐỨNG IM — mà người dùng đang treo máy nên
  // không ai bấm Chạy: mất trọn đêm sản lượng, đúng cái nó sinh ra để tránh.
  // Bật LẦN LƯỢT qua `startProfilesStaggered` (QĐ-21), không bật ồ ạt.
  try {
    const resume = (await api.resumeTake()) || [];
    if (resume.length) {
      // Bỏ profile đã bị xoá trong lúc đó. Chỉ lọc khi đã nạp được danh sách — `profilesCache`
      // rỗng nghĩa là chưa nạp xong, lọc lúc đó sẽ vứt sạch và không cào lại gì cả.
      const alive = profilesCache.length
        ? resume.filter((id) => profilesCache.some((p) => p.id === id))
        : resume;
      if (alive.length) {
        $('crawlStatusMsg').textContent =
          `♻ App vừa tự khởi động lại (bộ nhớ sắp đầy) — đang cào tiếp ${alive.length} profile...`;
        await startProfilesStaggered(alive);
      }
    }
  } catch {}

  // ── Bảng profile: event delegation ──
  $('profileTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'run') toggleProfile(id);
    else if (act === 'settings') openSettingsModal([id]);
    else if (act === 'log') openLog(id);
    else if (act === 'open') openBrowserFor(id);
    else if (act === 'del') deleteProfile(id);
  });
  $('selectAll').addEventListener('change', (e) => {
    document.querySelectorAll('#profileTableBody .row-check').forEach(c => { c.checked = e.target.checked; });
    updateRunSelectedBtnState();
  });
  // Đổi chế độ / từ khóa ngay trên bảng.
  $('profileTableBody').addEventListener('change', async (e) => {
    const el = e.target;
    if (el.classList.contains('row-check')) { updateRunSelectedBtnState(); return; }
    const id = el.dataset.id;
    if (!id) return;
    if (el.classList.contains('mode-select')) {
      profileSettings[id] = Object.assign({}, getSettings(id), { mode: el.value });
      await saveProfileSettings();
      const kw = el.closest('td').querySelector('.mode-keyword');
      if (kw) kw.style.display = el.value === 'search' ? '' : 'none';
    } else if (el.classList.contains('mode-keyword')) {
      profileSettings[id] = Object.assign({}, getSettings(id), { keyword: el.value.trim() });
      await saveProfileSettings();
    }
  });

  // ── Nút hàng loạt ──
  // Đẩy bù dữ liệu trong bảng lên Google Sheet — backend tự lọc, CHỈ đẩy dòng chưa có
  // trên Sheet (so cột Link) → bấm nhiều lần không tạo trùng. Dùng khi tự động đẩy bị
  // nghẽn/lỗi mạng làm lọt dòng.
  $('pushSheetBtn').addEventListener('click', async () => {
    if (!crawlResults.length) return toast('Bảng dữ liệu đang trống — chưa có gì để đẩy.', 'err');
    const btn = $('pushSheetBtn');
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '⏳ Đang đẩy...';
    try {
      const rows = crawlResults.map(d => [d.name || '', d.url || '', d.count ?? '', d.profileName || '']);
      const r = await api.sheetsPushManual(rows);
      if (r.ok) {
        toast(r.pushed > 0
          ? `Đã đẩy ${r.pushed} dòng mới lên Sheet (bỏ qua ${r.skipped} dòng đã có).`
          : `Không có gì mới — cả ${r.skipped} dòng đều đã có trên Sheet.`);
      } else {
        toast(r.msg || 'Đẩy thất bại.', 'err');
      }
    } catch (e) {
      toast('Đẩy thất bại: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });

  // Xuất bảng dữ liệu ra file Excel (CSV UTF-8 BOM).
  $('exportExcelBtn').addEventListener('click', async () => {
    if (!crawlResults.length) return toast('Bảng dữ liệu đang trống — chưa có gì để xuất.', 'err');
    const r = await api.exportResults(crawlResults);
    if (r.ok) toast(`Đã xuất ${r.count} dòng → ${r.path}`);
    else if (!r.canceled) toast(r.msg || 'Xuất thất bại.', 'err');
  });

  $('runSelectedBtn').addEventListener('click', runSelected);
  $('stopSelectedBtn').addEventListener('click', stopSelected);
  $('softStopSelectedBtn').addEventListener('click', forceStopSelected);
  $('verifyLoginsBtn').addEventListener('click', verifyLogins);
  $('settingsSelectedBtn').addEventListener('click', () => openSettingsModal(getCheckedIds()));

  // ── Modal quản lý profile ──
  $('manageProfilesBtn').addEventListener('click', async () => {
    await refreshAll();
    $('profileModal').classList.add('open');
  });
  $('profileModalClose').addEventListener('click', () => $('profileModal').classList.remove('open'));
  $('profileModalDone').addEventListener('click', () => $('profileModal').classList.remove('open'));
  $('addProfileBtn').addEventListener('click', addProfile);
  $('newProfileName').addEventListener('keydown', (e) => { if (e.key === 'Enter') addProfile(); });
  $('importFolderBtn').addEventListener('click', importFolder);
  $('importDiskBtn').addEventListener('click', importFromDisk);

  // ── Modal cài đặt crawl ──
  $('cfgMode').addEventListener('change', updateCfgModeUI);
  $('cfgHeadless').addEventListener('change', updateCfgHeadlessLabel);
  $('crawlSettingsClose').addEventListener('click', () => $('crawlSettingsModal').classList.remove('open'));
  $('crawlSettingsCancel').addEventListener('click', () => $('crawlSettingsModal').classList.remove('open'));
  $('crawlSettingsSave').addEventListener('click', saveCrawlSettings);

  // ── Modal log ──
  $('profileLogClose').addEventListener('click', () => { $('profileLogModal').classList.remove('open'); logModalId = null; });
  $('profileLogDone').addEventListener('click', () => { $('profileLogModal').classList.remove('open'); logModalId = null; });
  $('profileLogClear').addEventListener('click', () => {
    if (logModalId) { profileLogs[logModalId] = []; $('profileLogBody').textContent = '(chưa có log)'; }
  });

  // Thông báo khi user tự đóng cửa sổ Firefox.
  api.onBrowserClosed(() => toast('Trình duyệt đã đóng.'));

  initCrawlEvents();
  initSheets();
  initHistory();
  initUpdater();
}

// ── Mở trình duyệt cho 1 profile ──
async function openBrowserFor(id) {
  const st = getSettings(id);
  const block = !!st.blockImages;
  toast('Đang mở trình duyệt...' + (block ? ' (chặn ảnh/video)' : ''));
  // Gửi kèm chế độ profile Chromium riêng của CHÍNH profile này (QĐ-28) — nếu không, 🦊 mở
  // bằng chế độ khác với lúc crawl thì đăng nhập xong lại "không ăn" sang lượt chạy.
  const res = await api.openBrowser(id, block, !!st.chromiumProfile);
  if (!res.ok) { appendLog(id, 'Lỗi mở trình duyệt: ' + (res.msg || '')); return toast(res.msg || 'Lỗi mở trình duyệt.', 'err'); }
  // Chẩn đoán phiên từ backend: đăng nhập hay khách, cookie lấy từ nguồn nào, lỗi trích gì.
  const si = res.session;
  if (si && si.loggedIn) {
    const srcTxt = { file: 'session đã lưu', bak: 'bản backup session', firefox: 'trích từ Firefox',
      'firefox-retry': 'trích lại từ Firefox (file cũ là phiên khách)', 'chromium-data': 'chromium-data cũ',
      'chromium-profile': 'profile Chromium riêng' }[si.source] || si.source;
    appendLog(id, `Đã mở trình duyệt — ĐÃ đăng nhập TikTok (${srcTxt}, ${si.tiktokCookies} cookie).`);
    toast('Đã mở trình duyệt — đã đăng nhập TikTok.', 'ok');
  } else if (si) {
    const detail = si.error || 'Không tìm thấy cookie đăng nhập (sessionid) từ bất kỳ nguồn nào.';
    appendLog(id, `⚠ Trình duyệt mở ở trạng thái CHƯA đăng nhập. ${detail}`);
    toast('Trình duyệt CHƯA đăng nhập TikTok — xem log 📄 để biết lý do.', 'err');
  } else {
    appendLog(id, 'Đã mở trình duyệt.');
    toast('Đã mở trình duyệt.', 'ok');
  }
}

document.addEventListener('DOMContentLoaded', init);
