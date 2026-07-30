// renderer.js — Logic giao diện (chạy trong sandbox, gọi main qua window.api).
// Mô hình: bảng profile, mỗi profile chạy/dừng/log độc lập; bảng dữ liệu chung.
'use strict';

const $ = (id) => document.getElementById(id);

let profilesCache = [];
let profileSettings = {};            // id -> { mode, keyword, headless, originalOnly, minVideos, delayMin, delayMax }
const runningSet = new Set();        // id đang chạy
const profileScanned = {};           // id -> số sound quét được (feed, trước khi check)
const profileChecked = {};           // id -> số sound đã đi qua bước check số video (kể cả '?')
const profileValid = {};             // id -> số sound đạt bộ lọc video, đã đẩy vào bảng kết quả
const profileStatusText = {};        // id -> text trạng thái gần nhất
const profileStatusKind = {};        // id -> 'running'|'stopped'|'error'|''
const profilePhase = {};             // id -> { label, nextLabel, deadlineAt } (chế độ 'cycle' — đếm ngược tới lúc chuyển pha)
const profileLogs = {};              // id -> [dòng log]
let logModalId = null;               // id profile đang mở log (để cập nhật trực tiếp)
let crawlSettingsTargetIds = [];     // id(s) đang chỉnh trong modal cài đặt

const DEFAULT_SETTINGS = {
  mode: 'foryou', keyword: '', headless: false, originalOnly: false,
  minVideos: 1000, maxVideos: 0, delayMin: 2, delayMax: 4, blockImages: true, recycleEvery: 80,
  viewLinks: '', viewPctMin: 40, viewPctMax: 70, viewLikePct: 15,
  viewScrollMin: 20, viewScrollMax: 30,
  cycleScanHours: 5, cycleViewMinutes: 30, cycleBreakMin: 5, cycleBreakMax: 10,
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
  const btn = document.querySelector(`#profileTableBody button[data-act="run"][data-id="${CSS.escape(id)}"]`);
  if (btn) {
    btn.textContent = running ? '■ Dừng' : '▶ Chạy';
    btn.classList.toggle('btn-primary', !running);
  }
  const sel = document.querySelector(`#profileTableBody .mode-select[data-id="${CSS.escape(id)}"]`);
  const kw = document.querySelector(`#profileTableBody .mode-keyword[data-id="${CSS.escape(id)}"]`);
  if (sel) sel.disabled = running;
  if (kw) kw.disabled = running;
  updateRunSelectedBtnState();
}

// Khóa nút "▶ Chạy đã chọn" khi bấm cũng không có tác dụng gì — tránh nhấn nhầm khi phần
// mềm đang chạy. Chỉ khóa khi CHƯA tick gì HOẶC mọi profile đã tick đều đang chạy rồi; tick
// thêm 1 profile chưa chạy là tự mở khóa ngay (vẫn thêm được vào giữa phiên như bình thường).
function updateRunSelectedBtnState() {
  const btn = $('runSelectedBtn');
  if (!btn) return;
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
    minVideos: Math.max(0, parseInt(s.minVideos, 10) || 0),
    maxVideos: Math.max(0, parseInt(s.maxVideos, 10) || 0),
    minDelay: Math.round(dMin * 1000),
    maxDelay: Math.round(dMax * 1000),
    blockImages: !!s.blockImages,
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
    return;
  }
  setRowRunning(id, true);
  updateRowStatus(id, 'running', 'Đang khởi động...');
}

async function stopProfileById(id) {
  if (!runningSet.has(id)) return;
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
  else await startProfileById(id);
}

// ── Hành động hàng loạt ──
async function runSelected() {
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
  for (const id of ids) {
    if (!runningSet.has(id)) await startProfileById(id); // tuần tự để seed Sheet chỉ đọc 1 lần
  }
}

async function stopSelected() {
  const ids = getCheckedIds();
  if (!ids.length) return toast('Tick chọn profile cần dừng.', 'err');
  for (const id of ids) if (runningSet.has(id)) await stopProfileById(id);
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

// Dừng mềm: ngừng quét ngay, check nốt hàng đợi sound rồi mới dừng hẳn (không mất sound).
async function softStopSelected() {
  const ids = getCheckedIds();
  if (!ids.length) return toast('Tick chọn profile cần dừng mềm.', 'err');
  let n = 0;
  for (const id of ids) {
    if (!runningSet.has(id)) continue;
    await api.profileSoftStop(id);
    appendLog(id, 'Dừng mềm: ngừng quét, chờ check nốt hàng đợi...');
    n++;
  }
  if (n) toast(`Đã dừng mềm ${n} profile — sẽ tự dừng hẳn sau khi check nốt hàng đợi.`, 'ok');
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
  $('cfgBlockImages').checked = !!s.blockImages;
  $('cfgRecycleEvery').value = s.recycleEvery;
  $('cfgMinVideos').value = s.minVideos;
  $('cfgMaxVideos').value = s.maxVideos;
  $('cfgDelayMin').value = s.delayMin;
  $('cfgDelayMax').value = s.delayMax;
  // Số luồng đếm đồng thời là cài đặt CHUNG (global store), không theo profile.
  api.storeGet(['count_concurrency']).then(r => {
    $('cfgCountConcurrency').value = (r && r.count_concurrency) || 2;
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
  };
  for (const id of crawlSettingsTargetIds) {
    profileSettings[id] = Object.assign({}, getSettings(id), s);
  }
  // Lưu cài đặt CHUNG: số luồng đếm đồng thời toàn app (1–10).
  const cc = Math.max(1, Math.min(10, parseInt($('cfgCountConcurrency').value, 10) || 2));
  await api.storeSet({ count_concurrency: cc });
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
    $('sheetsSa').value = cfg.saJson || '';
    $('sheetsReseedMin').value = cfg.reseedMinutes || 5;
  } catch {}
}

function readSheetsForm() {
  return {
    enabled: $('sheetsEnabled').checked,
    spreadsheetId: $('sheetsId').value.trim(),
    tab: $('sheetsTab').value.trim() || 'Data',
    saJson: $('sheetsSa').value.trim(),
    reseedMinutes: Math.max(1, parseFloat($('sheetsReseedMin').value) || 5),
  };
}

async function saveSheetsConfig() {
  await api.sheetsSetConfig(readSheetsForm());
  toast('Đã lưu cài đặt Google Sheet.', 'ok');
  $('sheetsModal').classList.remove('open');
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

function initSheets() {
  $('sheetsBtn').addEventListener('click', async () => {
    await loadSheetsConfig();
    $('sheetsTestResult').textContent = '';
    $('sheetsCleanDupResult').textContent = '';
    $('sheetsModal').classList.add('open');
  });
  $('sheetsModalClose').addEventListener('click', () => $('sheetsModal').classList.remove('open'));
  $('sheetsSaveBtn').addEventListener('click', saveSheetsConfig);
  $('sheetsTestBtn').addEventListener('click', testSheets);
  $('sheetsCleanDupBtn').addEventListener('click', cleanSheetDuplicates);
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
  $('updateNewVer').textContent = 'v' + d.version;
  $('updateChangelog').textContent = d.changelog || '(không có ghi chú)';
  $('updateAvailBox').style.display = '';
  const btn = $('updateInstallBtn');
  if (d.download_url) {
    btn.disabled = false;
    setUpdateStatus('Đã có bản mới v' + d.version + '. Nhấn “Cập nhật ngay”.', 'ok');
  } else {
    btn.disabled = true;
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
  api.onCrawlData((d) => addResultRow(d));
  api.onCrawlStatus((s) => {
    if (s.profileId && s.status === 'counts') {
      // Kênh RIÊNG chỉ cập nhật số Quét/Đã check — không đụng badge trạng thái hay log.
      updateProfileCounts(s.profileId, s.scanned, s.checked);
      updateSkippedDup(s.skippedDup);
    } else if (s.profileId && s.status === 'phase') {
      // Kênh RIÊNG báo mốc kết thúc pha hiện tại (mode 'cycle') để renderer tự đếm ngược.
      profilePhase[s.profileId] = { label: s.phaseLabel, nextLabel: s.nextLabel, deadlineAt: s.deadlineAt };
      renderPhaseChip(s.profileId);
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
  await loadProfiles();
  renderProfileTable();

  // ĐỒNG BỘ TRẠNG THÁI CHẠY VỚI BACKEND (2026-07-28): backend là nguồn sự thật duy nhất
  // về profile nào đang crawl. Trước đây renderer chỉ dựa vào sự kiện nhận được, nên hễ
  // lệch một lần là kẹt luôn (nút "■ Dừng" bấm không có tác dụng, "Chạy đã chọn" bị vô
  // hiệu) và cách duy nhất để thoát là khởi động lại app. Reload giao diện (F5 ở bản dev)
  // cũng từng làm mất hết trạng thái đang chạy.
  try {
    const ids = await api.crawlRunningIds();
    for (const id of (ids || [])) {
      setRowRunning(id, true);
      updateRowStatus(id, 'running', 'Đang chạy...');
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
  $('softStopSelectedBtn').addEventListener('click', softStopSelected);
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
  initUpdater();
}

// ── Mở trình duyệt cho 1 profile ──
async function openBrowserFor(id) {
  const block = !!getSettings(id).blockImages;
  toast('Đang mở trình duyệt...' + (block ? ' (chặn ảnh/video)' : ''));
  const res = await api.openBrowser(id, block);
  if (!res.ok) { appendLog(id, 'Lỗi mở trình duyệt: ' + (res.msg || '')); return toast(res.msg || 'Lỗi mở trình duyệt.', 'err'); }
  // Chẩn đoán phiên từ backend: đăng nhập hay khách, cookie lấy từ nguồn nào, lỗi trích gì.
  const si = res.session;
  if (si && si.loggedIn) {
    const srcTxt = { file: 'session đã lưu', bak: 'bản backup session', firefox: 'trích từ Firefox',
      'firefox-retry': 'trích lại từ Firefox (file cũ là phiên khách)', 'chromium-data': 'chromium-data cũ' }[si.source] || si.source;
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
