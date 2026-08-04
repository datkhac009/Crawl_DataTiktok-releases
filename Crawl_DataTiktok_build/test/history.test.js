// test/history.test.js — Kiem chung src/history.cjs (lich su thu thap theo ngay).
//
// Boi canh: Google Sheet khong co cot thoi gian nen KHONG dem lai duoc "hom nay thu bao nhieu
// sound" tu Sheet -> phai tu ghi luc thu duoc. Module nay ghi vao config/history.json canh
// .exe (cung quy uoc voi config/profiles.json) de backup/chep may la mang theo duoc.
//
// Mock paths.cjs de ghi vao thu muc TAM, khong dung vao config/ that cua nguoi dung.
// Chay: node test/history.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const pathsPath = require.resolve(path.join(__dirname, '..', 'src', 'paths.cjs'));
const histPath = require.resolve(path.join(__dirname, '..', 'src', 'history.cjs'));

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// Moi lan goi tao 1 thu muc tam MOI + nap lai history.cjs (de reset trang thai trong RAM).
function freshHistory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-hist-'));
  require.cache[pathsPath] = new Module(pathsPath, null);
  require.cache[pathsPath].filename = pathsPath;
  require.cache[pathsPath].loaded = true;
  require.cache[pathsPath].exports = { getConfigDir: () => dir };
  delete require.cache[histPath];
  return { hist: require(histPath), dir, file: path.join(dir, 'history.json') };
}

(async () => {
  console.log('\n=== 1. Ghi 3 sound -> dem dung, tach theo profile ===');
  {
    const { hist } = freshHistory();
    hist.recordSound('profileA');
    hist.recordSound('profileB');
    hist.recordSound('profileA');
    const days = hist.getDays();
    check('co dung 1 ngay', days.length === 1, JSON.stringify(days));
    check('tong = 3', days[0].valid === 3, String(days[0].valid));
    check('profileA = 2', days[0].byProfile.profileA === 2);
    check('profileB = 1', days[0].byProfile.profileB === 1);
    check('ngay la hom nay', days[0].date === hist.todayKey());
  }

  console.log('\n=== 2. flush() ghi ra file THAT va doc lai duoc (song sot khoi dong lai app) ===');
  {
    const { hist, file } = freshHistory();
    hist.recordSound('p1');
    hist.recordSound('p1');
    check('chua flush thi CHUA co file (ghi co tre, khong ghi dia moi sound)', !fs.existsSync(file));
    hist.flush();
    check('sau flush co file', fs.existsSync(file));
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('file chua dung so lieu', j.days[hist.todayKey()].valid === 2, JSON.stringify(j));
  }

  console.log('\n=== 3. Nap lai tu file co san (mo lai app) -> cong tiep, khong mat so cu ===');
  {
    const { hist, dir, file } = freshHistory();
    hist.recordSound('p1');
    hist.flush();
    // Gia lap mo lai app: nap lai module NHUNG giu nguyen thu muc.
    require.cache[pathsPath].exports = { getConfigDir: () => dir };
    delete require.cache[histPath];
    const hist2 = require(histPath);
    hist2.recordSound('p1');
    hist2.flush();
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('tong = 2 (khong ghi de mat so cu)', j.days[hist2.todayKey()].valid === 2, JSON.stringify(j));
  }

  console.log('\n=== 4. File hong / khong phai JSON -> KHONG lam chet app, bat dau lai tu 0 ===');
  {
    const { dir, file } = freshHistory();
    fs.writeFileSync(file, 'day khong phai json {{{');
    require.cache[pathsPath].exports = { getConfigDir: () => dir };
    delete require.cache[histPath];
    const hist = require(histPath);
    let threw = false;
    try { hist.recordSound('p1'); } catch (_) { threw = true; }
    check('khong nem loi', !threw);
    check('dem lai tu dau', hist.getDays()[0].valid === 1);
  }

  console.log('\n=== 5. getDays(): ngay MOI NHAT truoc + gioi han so ngay ===');
  {
    const { hist, dir, file } = freshHistory();
    hist.recordSound('p1');
    hist.flush();
    // Chen tay vai ngay cu vao file roi nap lai (khong the doi ngay he thong trong test).
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.days['2020-01-01'] = { valid: 5, byProfile: { old: 5 } };
    j.days['2020-01-03'] = { valid: 7, byProfile: { old: 7 } };
    j.days['2020-01-02'] = { valid: 6, byProfile: { old: 6 } };
    fs.writeFileSync(file, JSON.stringify(j));
    require.cache[pathsPath].exports = { getConfigDir: () => dir };
    delete require.cache[histPath];
    const hist2 = require(histPath);

    const days = hist2.getDays();
    check('hom nay dung dau tien (moi nhat truoc)', days[0].date === hist2.todayKey(), JSON.stringify(days.map(d => d.date)));
    const olds = days.filter(d => d.date.startsWith('2020')).map(d => d.date);
    check('cac ngay cu giam dan', JSON.stringify(olds) === JSON.stringify(['2020-01-03', '2020-01-02', '2020-01-01']), JSON.stringify(olds));
    check('limit hoat dong', hist2.getDays({ limit: 2 }).length === 2);
  }

  console.log('\n=== 6. clearAll() xoa sach va ghi ngay xuong dia ===');
  {
    const { hist, file } = freshHistory();
    hist.recordSound('p1');
    hist.flush();
    hist.clearAll();
    check('getDays rong', hist.getDays().length === 0);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    check('file cung da rong', Object.keys(j.days).length === 0, JSON.stringify(j));
  }

  console.log('\n=== 7. Ten profile rong/undefined -> khong lam vo so lieu ===');
  {
    const { hist } = freshHistory();
    hist.recordSound(undefined);
    hist.recordSound('');
    const d = hist.getDays()[0];
    check('van dem = 2', d.valid === 2, String(d.valid));
    check('gop vao nhom "(khong ro)"', d.byProfile['(không rõ)'] === 2, JSON.stringify(d.byProfile));
  }

  console.log('\n=== 8. Don ngay qua han (KEEP_DAYS) khi ghi dia ===');
  {
    const { hist, dir, file } = freshHistory();
    hist.recordSound('p1');
    hist.flush();
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Nhoi nhieu hon KEEP_DAYS ngay cu.
    for (let i = 0; i < hist.KEEP_DAYS + 20; i++) {
      const d = new Date(2020, 0, 1 + i);
      const p = (n) => String(n).padStart(2, '0');
      j.days[`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`] = { valid: 1, byProfile: {} };
    }
    fs.writeFileSync(file, JSON.stringify(j));
    require.cache[pathsPath].exports = { getConfigDir: () => dir };
    delete require.cache[histPath];
    const hist2 = require(histPath);
    hist2.recordSound('p1');     // tao thay doi de flush() thuc su ghi + don
    hist2.flush();
    const j2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    check(`giu toi da ${hist2.KEEP_DAYS} ngay`, Object.keys(j2.days).length <= hist2.KEEP_DAYS,
      `con ${Object.keys(j2.days).length} ngay`);
    check('ngay HOM NAY khong bi don mat', !!j2.days[hist2.todayKey()]);
  }

  // ── Qua 00:00 phai SANG NGAY MOI, dem lai tu 1 ──
  // Nguoi dung yeu cau chot dieu nay (2026-08-04): "23:00 ngay 3/8 thi den 1:00 se la ngay
  // 4/8, sound thu duoc bat dau tu 1 o ngay moi nhat". Bay de-vo: neu ngay duoc tinh MOT LAN
  // (luc nap module hoac luc bat dau phien) thi treo may qua dem se don het sound cua ngay
  // moi vao ngay cu -> con so ca hai ngay deu sai. Phai tinh lai o TUNG lan ghi.
  console.log('\n=== 9. Qua 00:00 -> sang ngay MOI, dem lai tu 1 ===');
  {
    const { hist, file } = freshHistory();
    const RealDate = Date;
    // Gia lap dong ho: 23:00 ngay 03/08/2026 -> 01:00 ngay 04/08/2026 (GIO MAY, khong phai UTC).
    let now = new RealDate(2026, 7, 3, 23, 0, 0);
    global.Date = class extends RealDate {
      constructor(...a) { super(); return a.length ? new RealDate(...a) : new RealDate(now.getTime()); }
      static now() { return now.getTime(); }
    };
    try {
      hist.recordSound('profileA');
      hist.recordSound('profileA');
      hist.recordSound('profileB');
      check('truoc nua dem: khoa ngay la 2026-08-03', hist.todayKey() === '2026-08-03', hist.todayKey());

      now = new RealDate(2026, 7, 4, 1, 0, 0);          // 01:00 hom sau
      check('sau nua dem: khoa ngay tu doi sang 2026-08-04',
        hist.todayKey() === '2026-08-04', hist.todayKey());

      hist.recordSound('profileA');
      await hist.flush();
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      check('ngay CU giu nguyen 3 sound',
        !!j.days['2026-08-03'] && j.days['2026-08-03'].valid === 3, JSON.stringify(j.days['2026-08-03']));
      check('ngay MOI bat dau lai tu 1',
        !!j.days['2026-08-04'] && j.days['2026-08-04'].valid === 1, JSON.stringify(j.days['2026-08-04']));
      check('ngay moi tach rieng theo profile, khong cong don ngay cu',
        j.days['2026-08-04'].byProfile.profileA === 1 && !j.days['2026-08-04'].byProfile.profileB,
        JSON.stringify(j.days['2026-08-04'].byProfile));
      check('la 2 ngay RIENG BIET trong file', Object.keys(j.days).length === 2,
        Object.keys(j.days).join(','));

      // 23:59:59 -> 00:00:00 : ranh gioi sat nhat, de sai nhat.
      now = new RealDate(2026, 7, 4, 23, 59, 59);
      check('23:59:59 van la ngay 04', hist.todayKey() === '2026-08-04', hist.todayKey());
      now = new RealDate(2026, 7, 5, 0, 0, 0);
      check('00:00:00 da sang ngay 05', hist.todayKey() === '2026-08-05', hist.todayKey());
    } finally {
      global.Date = RealDate;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
