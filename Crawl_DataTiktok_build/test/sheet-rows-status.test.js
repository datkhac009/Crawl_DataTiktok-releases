// test/sheet-rows-status.test.js — Ô "Sheet: N dòng data" (#sheetRowsInfo).
//
// Vì sao có test này: con số này đã HỎNG HAI LẦN theo cùng một kiểu — nó từng ghi chung vào
// dòng thông báo (#crawlStatusMsg), nên chỉ cần MỘT câu bất kỳ đậu ở đó là con số không bao
// giờ hiện lại nữa, mà không có gì xoá câu đó đi:
//   - lần 1: câu lỗi "Không đọc được Sheet để lọc trùng: ..." kẹt lại sau khi đã sửa đúng
//   - lần 2: câu thông tin "Đã bật đẩy Sheet giữa phiên — nạp 161040 link cũ..." kẹt lại
// Người dùng cần con số này LUÔN thấy được (5 máy cùng đẩy lên Sheet). Nên nó được tách ra ô
// riêng: số dòng luôn hiện, thông báo/lỗi vẫn nằm nguyên chỗ của nó, không ai xoá ai.
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function eq(a, b, name) { ok(a === b, name, `nhan "${a}", mong "${b}"`); }

// ── DOM giả tối thiểu: 2 ô riêng biệt ──
const els = {
  sheetRowsInfo: { textContent: '' },
  crawlStatusMsg: { textContent: 'Chưa chạy' },
};
function $(id) { return els[id] || null; }

// ── Bản sao logic trong renderer.js (mục 7 chốt lại nó không lệch bản gốc) ──
let _lastSheetRows = 0;
function setSheetRowsStatus(rows) {
  if (typeof rows === 'number') _lastSheetRows = rows;
  const el = $('sheetRowsInfo');
  if (!el) return;
  el.textContent = _lastSheetRows
    ? `Sheet: ${_lastSheetRows.toLocaleString('vi-VN')} dòng data`
    : '';
}

console.log('\n=== O "Sheet: N dong data" ===\n');

console.log('1. Chua doc duoc Sheet lan nao -> de TRONG (khong hien so bia)');
setSheetRowsStatus();
eq(els.sheetRowsInfo.textContent, '', 'chua co so -> o trong');

console.log('\n2. Doc thanh cong -> hien so, dinh dang VN');
setSheetRowsStatus(161067);
eq(els.sheetRowsInfo.textContent, 'Sheet: 161.067 dòng data', 'dung dau cham phan cach nghin');

console.log('\n3. BUG THAT (lan 1): loi doc Sheet dang hien -> so dong VAN phai hien');
els.crawlStatusMsg.textContent = 'Không đọc được Sheet để lọc trùng: Không có tab tên "Data"...';
setSheetRowsStatus(161070);
eq(els.sheetRowsInfo.textContent, 'Sheet: 161.070 dòng data', 'so dong khong bi loi chan');
ok(els.crawlStatusMsg.textContent.startsWith('Không đọc được Sheet'),
  'ma cau LOI cung khong bi so dong xoa mat (QD-25 van duoc giu)');

console.log('\n4. BUG THAT (lan 2): cau thong tin dai dang dau o dong trang thai');
els.crawlStatusMsg.textContent = 'Đã bật đẩy Sheet giữa phiên — nạp 161040 link cũ để lọc trùng (4 link mới thêm).';
setSheetRowsStatus(161075);
eq(els.sheetRowsInfo.textContent, 'Sheet: 161.075 dòng data', 'van hien du dong thong bao dang bi chiem');
ok(els.crawlStatusMsg.textContent.startsWith('Đã bật đẩy Sheet'), 'cau thong tin con nguyen');

console.log('\n5. Nhip lap lai (khong co so moi) -> giu nguyen so cu, khong xoa trang');
setSheetRowsStatus();
eq(els.sheetRowsInfo.textContent, 'Sheet: 161.075 dòng data', 'goi khong tham so -> ve lai dung so cu');

console.log('\n6. Sheet TANG (may khac day len) -> cap nhat ngay');
setSheetRowsStatus(161240);
eq(els.sheetRowsInfo.textContent, 'Sheet: 161.240 dòng data', 'doi so khi Sheet doi');

console.log('\n7. CHOT: ban sao tren phai con khop renderer.js / index.html / styles.css');
// Test nay dung ban sao (renderer.js chay trong DOM that, khong require duoc). Ban sao se lech
// AM THAM khi ai sua ban goc — nen doc thang file goc va doi chieu tung diem.
const R = path.join(__dirname, '..', 'renderer');
const js = fs.readFileSync(path.join(R, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(R, 'styles.css'), 'utf8');

ok(html.includes('id="sheetRowsInfo"'), 'index.html co o rieng #sheetRowsInfo');
ok(html.indexOf('id="sheetRowsInfo"') < html.indexOf('id="crawlStatusMsg"'),
  'o so dong dat TRUOC dong thong bao (hien ngay sau 2 badge nhu nguoi dung muon)');
ok(js.includes("const el = $('sheetRowsInfo');"),
  'renderer.js ghi vao #sheetRowsInfo, KHONG ghi vao #crawlStatusMsg nua');
ok(!/function setSheetRowsStatus[\s\S]{0,400}crawlStatusMsg/.test(js),
  'trong setSheetRowsStatus khong con dinh gi toi #crawlStatusMsg');
ok(!js.includes('_statusIsIdle'),
  'da bo han co che "chi ghi khi dong dang ranh" (chinh la nguyen nhan 2 lan hong)');
ok(css.includes('.sheet-rows'), 'styles.css co style cho o rieng');
ok(/\.sheet-rows[^}]*flex:\s*0 0 auto/.test(css),
  'o so dong khong bi co lai -> cau thong bao dai bi cat truoc, khong cat mat con so');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} dat, ${fail} truot\n`);
process.exit(fail === 0 ? 0 : 1);
