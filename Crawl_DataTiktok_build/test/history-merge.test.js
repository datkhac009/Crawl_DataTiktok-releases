// test/history-merge.test.js — Gộp thống kê theo ngày CỦA BẢN PHÁT HÀNH KHÁC vào history.json.
//
// BOI CANH THAT (2026-08-12): tu QD-37 nguoi dung chuyen qua lai giua 2 repo phat hanh. Ban kia
// ghi thong ke vao khoa `daily_stats` cua CUNG mot electron-store (ca hai deu
// `app.setName('TikTokCrawler')`), con ban nay ghi `config/history.json`. Do that tren may
// nguoi dung: 5.852 sound o history.json + 216 sound o daily_stats -> moi ban chi thay MOT NUA,
// nhin nhu mat du lieu du ca hai van nam nguyen tren dia.
//
// ⚠ KHANG DINH QUAN TRONG NHAT: CHONG CONG TRUNG. Ham nay chay MOI LAN mo app va MOI LAN mo bang
// Lich su, ma so ben kia thi van tang tiep moi khi nguoi dung quay sang chay ban do. Khong chong
// trung thi moi lan mo app la so lich su tu phinh len — hong du lieu that, khong the doi nguoc.
//
// Chay: node test/history-merge.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ⚠ CACH LY BAT BUOC, DAT TRUOC MOI require: history.cjs ghi vao <base>/config/history.json, ma
// getBaseDir() o che do dev tro thang vao THU MUC DU AN -> khong cach ly la GHI DE LICH SU THAT.
const SANDBOX = path.join(os.tmpdir(), 'histmerge_' + process.pid + '_' + Date.now());
fs.mkdirSync(path.join(SANDBOX, 'config'), { recursive: true });
process.env.PORTABLE_EXECUTABLE_DIR = SANDBOX;

const SRC = path.join(__dirname, '..', 'src');
const histPath = require.resolve(path.join(SRC, 'history.cjs'));
const pathsPath = require.resolve(path.join(SRC, 'paths.cjs'));

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

let _case = 0;
function fresh(seedHistory) {
  _case++;
  const dir = path.join(SANDBOX, 'c' + _case);
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  process.env.PORTABLE_EXECUTABLE_DIR = dir;
  const file = path.join(dir, 'config', 'history.json');
  if (seedHistory) fs.writeFileSync(file, JSON.stringify(seedHistory, null, 2));
  delete require.cache[histPath];
  delete require.cache[pathsPath];
  return { history: require(histPath), file };
}
const readFile = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Dung dinh dang THAT cua ban kia: { day: { profileId: { n: ten, c: so } } }
const D = (day, list) => ({ [day]: Object.fromEntries(list.map(([id, n, c]) => [id, { n, c }])) });

(async () => {
  console.log('\n=== 1. Gop vao ngay DA CO — cong dung theo tung profile ===');
  {
    // Dung so THAT tren may nguoi dung: 11/08 co 91 sound o ban nay, 62 o ban kia.
    const { history, file } = fresh({ days: { '2026-08-11': { valid: 91, byProfile: {
      'acc1@example.com(May1)': 14, 'acc2@example.com(May1)': 24,
      'acc3@example.com(May1)': 27, 'acc4@example.com(May1)': 12,
      'acc5@example.com(May1)': 8, 'acc6@example.com(May1)': 6 } } } });
    const added = history.mergeExternalDays(D('2026-08-11', [
      ['p_1', 'acc1@example.com(May1)', 21],
      ['p_2', 'acc2@example.com(May1)', 13],
      ['p_3', 'acc4@example.com(May1)', 18],
      ['p_4', 'acc5@example.com(May1)', 4],
      ['p_5', 'acc6@example.com(May1)', 6],
    ]));
    history.flush();
    const d = readFile(file).days['2026-08-11'];
    check('1. tra ve dung so cong them', added === 62, String(added));
    check('2. valid 91 -> 153', d.valid === 153, String(d.valid));
    check('3. cong dung TUNG profile (14+21=35)', d.byProfile['acc1@example.com(May1)'] === 35,
      String(d.byProfile['acc1@example.com(May1)']));
    check('4. profile ben kia KHONG co -> giu nguyen (27)', d.byProfile['acc3@example.com(May1)'] === 27,
      String(d.byProfile['acc3@example.com(May1)']));
    check('5. tong byProfile == valid', Object.values(d.byProfile).reduce((a, b) => a + b, 0) === d.valid);
  }

  console.log('\n=== 2. Ngay CHUA CO -> tao moi ===');
  {
    const { history, file } = fresh({ days: {} });
    const added = history.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 100], ['p_2', 'B', 54]]));
    history.flush();
    const d = readFile(file).days['2026-08-12'];
    check('6. cong them 154', added === 154, String(added));
    check('7. tao ngay moi voi valid = 154', d && d.valid === 154, JSON.stringify(d));
    check('8. co du 2 profile', d.byProfile.A === 100 && d.byProfile.B === 54, JSON.stringify(d.byProfile));
  }

  console.log('\n=== 3. CHONG CONG TRUNG — khang dinh quan trong nhat ===');
  {
    const { history, file } = fresh({ days: {} });
    const daily = D('2026-08-12', [['p_1', 'A', 100]]);
    const a1 = history.mergeExternalDays(daily);
    const a2 = history.mergeExternalDays(daily);   // mo bang Lich su lan 2
    const a3 = history.mergeExternalDays(daily);   // mo lai app
    history.flush();
    const d = readFile(file).days['2026-08-12'];
    check('9. lan 1 cong 100', a1 === 100, String(a1));
    check('10. lan 2 cong 0', a2 === 0, String(a2));
    check('11. lan 3 cong 0', a3 === 0, String(a3));
    check('12. valid van la 100, KHONG phinh len 300', d.valid === 100, String(d.valid));
  }

  console.log('\n=== 4. Ben kia CAO THEM -> chi cong PHAN CHENH ===');
  {
    const { history, file } = fresh({ days: {} });
    history.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 100]]));
    // Nguoi dung quay sang chay ban kia, so tang 100 -> 175.
    const added = history.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 175]]));
    history.flush();
    check('13. chi cong 75 (khong cong lai 175)', added === 75, String(added));
    check('14. valid = 175', readFile(file).days['2026-08-12'].valid === 175);
  }

  console.log('\n=== 5. Ben kia GIAM so (ho xoa lich su) -> KHONG tru nguoc ===');
  {
    // Neu tru nguoc thi xoa mat ca so ma CHINH ban nay tu dem duoc trong cung ngay.
    const { history, file } = fresh({ days: { '2026-08-12': { valid: 50, byProfile: { A: 50 } } } });
    history.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 100]]));   // 50 -> 150
    const added = history.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 30]]));
    history.flush();
    check('15. so giam -> cong 0, khong tru', added === 0, String(added));
    check('16. valid giu nguyen 150', readFile(file).days['2026-08-12'].valid === 150,
      String(readFile(file).days['2026-08-12'].valid));
  }

  console.log('\n=== 6. Dau vao rac KHONG duoc lam hong bang ===');
  {
    const { history, file } = fresh({ days: { '2026-08-12': { valid: 7, byProfile: { A: 7 } } } });
    check('17. null -> 0', history.mergeExternalDays(null) === 0);
    check('18. chuoi -> 0', history.mergeExternalDays('x') === 0);
    check('19. khoa KHONG phai ngay -> bo qua', history.mergeExternalDays({ 'linh tinh': { p: { n: 'A', c: 9 } } }) === 0);
    check('20. gia tri ngay khong phai object -> bo qua', history.mergeExternalDays({ '2026-08-13': 5 }) === 0);
    history.flush();
    const j = readFile(file);
    check('21. khong sinh ngay rac', Object.keys(j.days).join(',') === '2026-08-12', Object.keys(j.days).join(','));
    check('22. so cu con nguyen', j.days['2026-08-12'].valid === 7, String(j.days['2026-08-12'].valid));
  }

  console.log('\n=== 7. Thieu ten profile -> gom vao "(khong ro)", khong mat so ===');
  {
    const { history, file } = fresh({ days: {} });
    const added = history.mergeExternalDays({ '2026-08-12': { p_1: { c: 12 }, p_2: { n: '', c: 3 } } });
    history.flush();
    const d = readFile(file).days['2026-08-12'];
    check('23. van cong du 15', added === 15, String(added));
    check('24. gom vao mot nhom', d.byProfile['(không rõ)'] === 15, JSON.stringify(d.byProfile));
  }

  console.log('\n=== 8. Khoa danh dau PHAI song sot qua vong doc/ghi cua chinh app ===');
  {
    // `_load()` giu NGUYEN object doc duoc (`_data = j`) chu khong dung lai `{days}` — neu ai do
    // sua thanh `{days: j.days}` thi `_mergedFromDailyStats` bi xoa moi lan ghi -> lan mo app sau
    // se CONG TRUNG toan bo. Khang dinh nay khoa dung tinh chat do lai.
    const { history, file } = fresh({ days: {} });
    history.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 40]]));
    history.recordSound('A');            // app tu dem them 1 -> ghi lai ca file
    history.flush();
    const j = readFile(file);
    check('25. khoa danh dau con trong file sau khi app ghi lai',
      !!(j._mergedFromDailyStats && j._mergedFromDailyStats['2026-08-12']),
      Object.keys(j).join(','));

    // Nap lai tu dia (nhu lan mo app sau) roi gop lai -> phai cong 0.
    delete require.cache[histPath];
    const again = require(histPath);
    const added = again.mergeExternalDays(D('2026-08-12', [['p_1', 'A', 40]]));
    check('26. mo app lan sau gop lai -> cong 0 (khong phinh)', added === 0, String(added));
  }

  console.log('\n=== 9. QD-23: history.cjs KHONG duoc phu thuoc electron-store / Google ===');
  {
    const src = fs.readFileSync(path.join(SRC, 'history.cjs'), 'utf8');
    const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    check('27. chi require fs/path/paths.cjs', reqs.every(r => ['fs', 'path', './paths.cjs'].includes(r)), reqs.join(', '));
    // ⚠ PHAI bo COMMENT truoc khi do: chinh phan ghi chu giai thich rang buoc nay co nhac chu
    // "electron-store" ("KHONG tu doc electron-store") nen kiem tren nguyen van se truot OAN.
    // Da bi chinh no lua mot lan.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    check('28. CODE (bo comment) khong dung electron-store / google-api / sheets',
      !/electron-store|google-api|sheets\.cjs/.test(code));
  }

  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n──────── ${pass} OK, ${fail} FAIL ────────`);
  process.exit(fail ? 1 : 0);
})();
