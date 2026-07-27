// clean-profiles.cjs — Dọn dữ liệu thừa trong từng thư mục profile.
//
// Sau khi chuyển sang mô hình session (session.state.json), profile KHÔNG còn cần
// thư mục Firefox gốc lẫn chromium-data nữa. Script này XÓA mọi thứ trong
// profiles/<folder> TRỪ session.state.json — nhưng CHỈ với profile đã có
// session.state.json chứa cookie TikTok hợp lệ (an toàn: không làm mất login).
//
// Dùng:
//   node clean-profiles.cjs          → xem trước (KHÔNG xóa)
//   node clean-profiles.cjs --apply  → xóa thật
'use strict';

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const KEEP = 'session.state.json';
const PROFILES_DIR = path.join(__dirname, 'profiles');

function dirSize(p) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) total += dirSize(full);
      else { try { total += fs.statSync(full).size; } catch (_) {} }
    }
  } catch (_) {}
  return total;
}

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB'; }

// Session hợp lệ = parse được + có ít nhất 1 cookie domain chứa 'tiktok'.
function hasValidSession(folder) {
  const file = path.join(folder, KEEP);
  if (!fs.existsSync(file)) return false;
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cookies = st.cookies || [];
    return cookies.some(c => String(c.domain || '').toLowerCase().includes('tiktok'));
  } catch (_) { return false; }
}

if (!fs.existsSync(PROFILES_DIR)) {
  console.log('Không thấy thư mục profiles:', PROFILES_DIR);
  process.exit(0);
}

console.log(APPLY ? '=== DỌN THẬT (--apply) ===' : '=== XEM TRƯỚC (chưa xóa) — thêm --apply để xóa thật ===');
let freedTotal = 0;
let cleaned = 0, skipped = 0;

for (const e of fs.readdirSync(PROFILES_DIR, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const folder = path.join(PROFILES_DIR, e.name);

  if (!hasValidSession(folder)) {
    console.log(`\n[BỎ QUA] ${e.name} — chưa có session.state.json hợp lệ (cần 🦊 đăng nhập / chạy 1 lần trước).`);
    skipped++;
    continue;
  }

  const victims = fs.readdirSync(folder, { withFileTypes: true }).filter(x => x.name !== KEEP);
  if (!victims.length) { console.log(`\n[SẠCH] ${e.name} — đã chỉ còn session.state.json.`); continue; }

  let freed = 0;
  console.log(`\n[DỌN] ${e.name} (giữ ${KEEP}):`);
  for (const v of victims) {
    const full = path.join(folder, v.name);
    const sz = v.isDirectory() ? dirSize(full) : (() => { try { return fs.statSync(full).size; } catch (_) { return 0; } })();
    freed += sz;
    console.log(`   - ${v.name}${v.isDirectory() ? '/' : ''}  (${mb(sz)})`);
    if (APPLY) {
      try { fs.rmSync(full, { recursive: true, force: true }); }
      catch (err) { console.log(`     ! Lỗi xóa: ${err.message}`); }
    }
  }
  freedTotal += freed;
  cleaned++;
  console.log(`   => ${APPLY ? 'Đã giải phóng' : 'Sẽ giải phóng'} ${mb(freed)}`);
}

console.log(`\n=== TỔNG: ${cleaned} profile ${APPLY ? 'đã dọn' : 'sẽ dọn'}, ${skipped} bỏ qua, ${APPLY ? 'giải phóng' : 'tiết kiệm'} ${mb(freedTotal)} ===`);
if (!APPLY) console.log('Chạy lại với:  node clean-profiles.cjs --apply   để xóa thật.');
