// test/linkstore.test.js — Kho link cuc bo (src/linkstore.cjs) + 3 thay doi keo theo trong
// sheets.cjs khi lan doc Sheet chuyen sang chay NEN (2026-08-11).
//
// BOI CANH THAT (do tren may nguoi dung, log 2026-08-10):
//   • Sheet 206.572 dong. `profile-start` AWAIT lan doc tron cot B truoc khi khoi dong crawler
//     -> giao dien dung o "Dang khoi dong..." hang phut, nhin het nhu app treo.
//   • `reseedMinutes = 3` nen app doc TRON 201.000 dong moi 3 phut: 18 lan trong 8 tieng, moi
//     lan thu ve +5..+8 link moi, kem 273 lan Google API timeout 25s.
//
// Sua: kho link cuc bo canh .exe nap TUC THI -> crawl chay ngay, Sheet doc o NEN.
//
// ⚠ HE QUA PHAI CO TEST (day la phan de sai nhat):
//   Truoc day `enqueue()` BO THANG dong khi chua seed (`if (!_seeded) return`). Hoi do vo hai
//   vi cua so "chua seed" gan bang 0. Doc o nen lam cua so dai ra that -> moi sound thu duoc
//   trong luc do se AM THAM khong bao gio len Sheet. Nen gio `enqueue` GIU trong bo dem va
//   `flush` gac khong cho ghi tới khi seed xong. Test 13-17 khoa dung cap hanh vi nay.
//
// Chay: node test/linkstore.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// ⚠ CACH LY BAT BUOC, DAT TRUOC MOI require: linkstore ghi vao <base>/known_links.txt, ma
// getBaseDir() o che do dev tro thang vao THU MUC DU AN. Khong cach ly la ghi de kho link
// THAT cua nguoi dung. paths.cjs uu tien PORTABLE_EXECUTABLE_DIR nen dat bien nay la du.
const SANDBOX = path.join(os.tmpdir(), 'linkstore_test_' + process.pid + '_' + Date.now());
fs.mkdirSync(SANDBOX, { recursive: true });
process.env.PORTABLE_EXECUTABLE_DIR = SANDBOX;

const SRC = path.join(__dirname, '..', 'src');
const storePath = require.resolve(path.join(SRC, 'linkstore.cjs'));
const apiPath = require.resolve(path.join(SRC, 'google-api.cjs'));
const sheetsPath = require.resolve(path.join(SRC, 'sheets.cjs'));
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// Nap lai module sach (xoa cache) + doi thu muc sandbox rieng cho tung kich ban, de kich ban
// truoc khong de lai file anh huong kich ban sau.
let _caseNo = 0;
function fresh() {
  _caseNo++;
  const dir = path.join(SANDBOX, 'c' + _caseNo);
  fs.mkdirSync(dir, { recursive: true });
  process.env.PORTABLE_EXECUTABLE_DIR = dir;
  delete require.cache[storePath];
  delete require.cache[require.resolve(path.join(SRC, 'paths.cjs'))];
  return { store: require(storePath), dir, file: path.join(dir, 'known_links.txt') };
}

// ⚠ Ghep CHUOI, khong cong so: id TikTok vuot Number.MAX_SAFE_INTEGER nen cong so cho ra
// CUNG MOT so voi moi n -> moi link thanh cung 1 link, test pass mot cach VO NGHIA.
const ID = (n) => '76000000000' + String(100000 + n);
const L = (n) => `https://www.tiktok.com/music/original-sound-${ID(n)}`;
const row = (n) => [`sound ${n}`, L(n), 1000, 'profileA'];

// "Sheet" gia lap — cung khuon voi test/sheets-read-before-push.test.js.
// ⚠ PHAI dieu khien qua `ctl` BEN TRONG mock: sheets.cjs destructure `const { httpRequest } =
// require(...)` nen no giu THAM CHIEU CU, gan lai vao module sau khi require khong co tac dung.
function installSheetsMock({ initialRows = ['Link'] } = {}) {
  const state = { rows: initialRows.slice(), appends: [], reads: 0 };
  const ctl = { failRead: false, holdRead: null };
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'FAKE_TOKEN',
    async httpRequest(method, url, opts = {}) {
      const u = decodeURIComponent(url);
      if (u.includes(':append')) {
        const vals = (opts.body && opts.body.values) || [];
        state.appends.push(vals);
        for (const r of vals) state.rows.push(r[1]);
        return { status: 200, body: '{}' };
      }
      state.reads++;
      if (ctl.failRead) return { status: 500, body: '{"error":"gia lap loi doc"}' };
      if (ctl.holdRead) await ctl.holdRead;          // treo lan doc de mo phong Sheet cham
      const m = u.match(/!B(\d+)?:B/);
      const from = m && m[1] ? parseInt(m[1], 10) : 1;
      const slice = state.rows.slice(from - 1);
      let end = slice.length;
      while (end > 0 && !slice[end - 1]) end--;
      return { status: 200, body: JSON.stringify({ values: slice.slice(0, end).map(v => (v ? [v] : [])) }) };
    },
  };
  require.cache[apiPath] = new Module(apiPath, null);
  require.cache[apiPath].filename = apiPath;
  require.cache[apiPath].loaded = true;
  require.cache[apiPath].exports = fake;
  delete require.cache[sheetsPath];
  const sheets = require(sheetsPath);
  sheets.configure({ enabled: true, spreadsheetId: 'ID', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } });
  return { sheets, state, ctl };
}

(async () => {
  console.log('\n=== 1. CACH LY + kho rong ===');
  {
    const { store, dir } = fresh();
    check('1. ghi vao thu muc CACH LY, khong dung du an',
      store.getFilePath().startsWith(dir), store.getFilePath());
    check('2. chua co file -> count = 0', store.count() === 0, String(store.count()));
    check('3. chua co file -> all() rong', store.all().length === 0);
    check('4. load() KHONG tu tao file', !fs.existsSync(store.getFilePath()));
  }

  console.log('\n=== 2. So trung theo ID sound, khong theo nguyen van link ===');
  {
    const { store } = fresh();
    const added = store.addUrls([
      `https://www.tiktok.com/music/original-sound-Nhatty-on-Air-${ID(1)}`,   // slug dai
      `https://www.tiktok.com/music/original-sound-${ID(1)}`,                  // slug ngan
      `https://www.tiktok.com/music/original-sound-${ID(1)}?lang=vi`,          // co query
      `https://www.tiktok.com/music/%D0%BE%D1%80%D0%B8%D0%B3-${ID(1)}`,        // nhan tieng Nga %-encode
      L(2),
    ]);
    check('5. 5 bien the -> chi ghi 2 khoa', added === 2, String(added));
    check('6. count = 2', store.count() === 2, String(store.count()));
  }

  console.log('\n=== 3. Ghi them KHONG ghi de, va khong ghi lai cai da co ===');
  {
    const { store, file } = fresh();
    store.addUrls([L(1), L(2)]);
    const again = store.addUrls([L(1), L(2), L(3)]);
    check('7. lo hai chi ghi them 1 link moi', again === 1, String(again));
    check('8. count = 3', store.count() === 3, String(store.count()));
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(s => s && !s.startsWith('#'));
    check('9. file co dung 3 dong (khong ghi de mat dong cu)', lines.length === 3, JSON.stringify(lines));
  }

  console.log('\n=== 4. Nguoi dung DAN TAY: BOM, ghi chu, dong trong, dan ca dong tu Sheet ===');
  {
    const { store, file } = fresh();
    fs.writeFileSync(file,
      '﻿# ghi chu dau file\n'                              // BOM + comment
      + '\n'                                                     // dong trong
      + L(1) + '\n'
      + `  "${L(2)}"  \n`                                        // co dau nhay + khoang trang
      + `ten sound co so 12345\t${L(3)}\t1500\tprofileA\n`       // dan ca dong tu cot Sheet
      + `sound khac,${L(4)},2000\n`                              // dan CSV
      + '# ' + L(5) + '\n',                                      // bi comment -> khong tinh
      'utf8');
    const keys = store.all();
    check('10. doc dung 4 khoa (bo comment/dong trong)', keys.length === 4, JSON.stringify(keys));
    check('11. BOM khong lam hong khoa dau tien', keys.includes('music:' + ID(1)), JSON.stringify(keys));
    check('12. nhat dung link trong dong dan tu Sheet (TAB)', keys.includes('music:' + ID(3)), JSON.stringify(keys));
    check('13. nhat dung link trong dong CSV', keys.includes('music:' + ID(4)), JSON.stringify(keys));
    check('14. dong bi # KHONG duoc tinh', !keys.includes('music:' + ID(5)), JSON.stringify(keys));
  }

  console.log('\n=== 4b. Dong RAC bi chan (do tren kho that 208.060 dong) ===');
  {
    const { store, file } = fresh();
    // `link` = TIEU DE COT cua Sheet, co that o dong dau kho that cua nguoi dung.
    // normalizeKey() KHONG tu choi no: no roi vao nhanh du phong canonicalSoundUrl() va sinh
    // khoa "link". Phai chan o linkstore.
    fs.writeFileSync(file,
      'link\nLink\nTen sound\n123456\n' + L(1) + '\n'
      + 'https://vt.tiktok.com/ZSabc123/\n',                 // link rut gon -> PHAI giu
      'utf8');
    const keys = store.all();
    check('14b. dong tieu de "link"/"Link" bi chan', !keys.includes('link') && !keys.includes('Link'), JSON.stringify(keys));
    check('14c. chu thuong khong phai link bi chan', !keys.some(k => k === 'ten sound' || k === '123456'), JSON.stringify(keys));
    check('14d. link tiktok that van giu', keys.includes('music:' + ID(1)), JSON.stringify(keys));
    check('14e. link RUT GON vt.tiktok.com van giu (khong siet theo /music/)',
      keys.some(k => k.includes('vt.tiktok.com')), JSON.stringify(keys));
  }

  console.log('\n=== 4f. VONG TRON GHI->NAP LAI phai khop (bay that, gap 2026-08-11) ===');
  {
    // addUrls() ghi ra dang `music:<id>`. Neu keyOfLine() khong nhan dang do (vd them chot
    // "dong phai co tiktok.com" ma dat TRUOC nhanh music:) thi ghi xong nap lai la MAT SACH
    // kho — im lang, khong loi. Da thuc su gay ra loi nay mot lan.
    const { store } = fresh();
    store.addUrls([L(1), L(2), L(3)]);
    const afterReload = store.load(true);
    check('14f. ghi 3 link roi NAP LAI TU DIA -> van du 3',
      afterReload.size === 3, String(afterReload.size));
    check('14g. va dung khoa cu (khong doi dang giua ghi va doc)',
      afterReload.has('music:' + ID(1)), JSON.stringify([...afterReload].slice(0, 3)));
  }

  console.log('\n=== 5. File cu THIEU newline cuoi -> khong duoc dinh dong ===');
  {
    const { store, file } = fresh();
    fs.writeFileSync(file, L(1), 'utf8');       // CO Y khong co '\n' cuoi
    store.addUrls([L(2)]);
    const keys = store.all();
    check('15. van doc ra dung 2 khoa (khong dinh thanh 1 dong rac)',
      keys.length === 2 && keys.includes('music:' + ID(1)) && keys.includes('music:' + ID(2)),
      JSON.stringify(keys));
  }

  console.log('\n=== 6. load(force) doc lai sau khi nguoi dung tu sua file ===');
  {
    const { store, file } = fresh();
    store.addUrls([L(1)]);
    fs.appendFileSync(file, L(2) + '\n', 'utf8');       // sua ngoai app (Notepad)
    check('16. chua force -> van thay 1 (dung cache)', store.count() === 1, String(store.count()));
    store.load(true);
    check('17. sau force -> thay 2', store.count() === 2, String(store.count()));
  }

  console.log('\n=== 7. ensureFile: tao kem ghi chu, va KHONG cat cut file dang co ===');
  {
    const { store, file } = fresh();
    store.ensureFile();
    const head = fs.readFileSync(file, 'utf8');
    check('18. tao file kem ghi chu huong dan', head.includes('#') && head.includes('known_links') === false && head.length > 50, JSON.stringify(head.slice(0, 40)));
    store.addUrls([L(1)]);
    store.ensureFile();                                  // goi lai lan hai
    check('19. goi ensureFile lan hai KHONG cat cut noi dung', store.load(true).size === 1, String(store.count()));
  }

  console.log('\n=== 8. Ghi LOI -> phai LUI lai RAM cho khop dia ===');
  {
    // Bay EISDIR: tao known_links.txt thanh THU MUC -> appendFileSync nem loi.
    const { store, file } = fresh();
    fs.mkdirSync(file, { recursive: true });
    const added = store.addUrls([L(1)]);
    check('20. ghi loi -> tra ve 0', added === 0, String(added));
    // ⚠ Day la khang dinh QUAN TRONG NHAT cua muc nay: neu RAM khong lui, khoa se "co trong
    // bo nho ma khong co tren dia" -> mat vinh vien sau khi tat app.
    check('21. RAM da LUI, khong giu khoa chua ghi duoc',
      !store.load().has('music:' + ID(1)), JSON.stringify([...store.load()]));
  }

  console.log('\n=== 9. addKnownKeys KHONG duoc bat co _seeded ===');
  {
    fresh();
    const { sheets } = installSheetsMock();
    sheets.addKnownKeys(['music:' + ID(1)]);
    // ⚠ Vi sao quan trong: _seeded la thu duy nhat chan viec ghi khi CHUA biet tren Sheet co gi.
    // Kho cuc bo la bo nho RIENG may nay — may khac vua day link moi len thi no khong he biet.
    // Bat co o day = cho ghi trong luc lan doc Sheet con dang chay nen = trung LIEN MAY.
    check('22. nap kho cuc bo KHONG lam _seeded = true', sheets.isSeeded() === false);
    check('23. nhung khoa van vao bo loc day', sheets.knownCount() === 1, String(sheets.knownCount()));
  }

  console.log('\n=== 10. CHUA seed: enqueue GIU dong, flush KHONG ghi ===');
  {
    fresh();
    const { sheets, state } = installSheetsMock({ initialRows: ['Link'] });
    sheets.enqueue(row(1));
    sheets.enqueue(row(2));
    await sheets.flush();
    // Hanh vi CU (truoc 2026-08-11) la BO thang -> sau khi seed xong cung khong bao gio day.
    check('24. chua seed -> KHONG ghi gi len Sheet', state.appends.length === 0, JSON.stringify(state.appends));
    // Gio seed xong roi flush lai: 2 dong phai len duoc.
    await sheets.refreshKnownLinks({ full: true });
    await sheets.flush();
    check('25. seed xong -> 2 dong giu trong bo dem duoc day len', state.appends.length === 1 && state.appends[0].length === 2,
      JSON.stringify(state.appends));
    const links = (state.appends[0] || []).map(r => r[1]);
    check('26. dung 2 link da giu', links.includes(L(1)) && links.includes(L(2)), JSON.stringify(links));
  }

  console.log('\n=== 11. Kho cuc bo van chan trung ngay o cua nhan ===');
  {
    fresh();
    const { sheets, state } = installSheetsMock({ initialRows: ['Link'] });
    sheets.addKnownKeys(['music:' + ID(1)]);       // kho cuc bo da co L(1)
    sheets.enqueue(row(1));
    sheets.enqueue(row(2));
    await sheets.refreshKnownLinks({ full: true });
    await sheets.flush();
    const links = (state.appends[0] || []).map(r => r[1]);
    check('27. L(1) bi chan vi kho cuc bo da co', !links.includes(L(1)), JSON.stringify(links));
    check('28. L(2) van len binh thuong', links.includes(L(2)), JSON.stringify(links));
  }

  console.log('\n=== 12. setOnPushed ban ra dung link vua ghi thanh cong ===');
  {
    fresh();
    const { sheets, state } = installSheetsMock({ initialRows: ['Link'] });
    const seen = [];
    sheets.setOnPushed((urls) => { seen.push(...urls); });
    await sheets.refreshKnownLinks({ full: true });
    sheets.enqueue(row(1));
    await sheets.flush();
    check('29. da ghi len Sheet', state.appends.length === 1, JSON.stringify(state.appends));
    // ⚠ Vi sao can hook nay: neu doi vong dong bo sau doc nguoc ve moi ghi vao kho, app tat
    // truoc vong do la link vua day KHONG co trong kho -> lan sau quet trung se day lan hai.
    check('30. hook nhan dung link vua day', seen.length === 1 && seen[0] === L(1), JSON.stringify(seen));
  }

  console.log('\n=== 13. Hook loi KHONG duoc lam hong lan day da thanh cong ===');
  {
    fresh();
    const { sheets, state } = installSheetsMock({ initialRows: ['Link'] });
    sheets.setOnPushed(() => { throw new Error('hook nem loi'); });
    await sheets.refreshKnownLinks({ full: true });
    sheets.enqueue(row(1));
    let threw = false;
    try { await sheets.flush(); } catch (_) { threw = true; }
    check('31. flush KHONG nem loi ra ngoai', !threw);
    check('32. dong van duoc ghi len Sheet', state.appends.length === 1, JSON.stringify(state.appends));
  }

  // Don sandbox — de lai thi moi lan chay test lai sinh mot thu muc tam.
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n──────── ${pass} OK, ${fail} FAIL ────────`);
  process.exit(fail ? 1 : 0);
})();
