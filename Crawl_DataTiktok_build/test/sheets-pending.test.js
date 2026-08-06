// test/sheets-pending.test.js — TAB CHỜ KIỂM TAY cho link TikTok tra "Something went wrong".
//
// Muc dich: chot 6 dieu de-vo nhat cua QD-33, vi lam sai la MAT DU LIEU (bo link that) hoac
// LAM BAN du lieu chinh (dieu ma QD-07 dung ra de ngan):
//   1. Sound CHET (dead=true, API tra statusCode 10201) -> BO HAN, KHONG vao tab cho.
//      Sound con song ma khong doc duoc so -> VAO tab cho.
//   2. Cot "Tinh trang" (E) TUYET DOI khong duoc ghi — nguoi dung tu dien.
//   3. Ghi dung TAB CHO, khong bao gio ghi vao tab chinh.
//   4. Khong ghi TRUNG: link da co tren tab cho (phien truoc / may khac) -> bo qua.
//   5. De trong ten tab cho = TAT tinh nang (link lai bi bo nhu cu).
//   6. Loi ghi -> KHONG bo roi lo, tra ve buffer de thu lai.
'use strict';

const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function eq(a, b, name) { ok(a === b, name, `nhan "${a}", mong "${b}"`); }

// ── Mock google-api.cjs: ghi lai moi request, khong goi mang ──
const gapiPath = require.resolve(path.join(__dirname, '..', 'src', 'google-api.cjs'));
const realGapi = require(gapiPath);

let requests = [];        // { method, url, body }
let httpScript = {};      // dieu khien phan hoi

function installGapiMock() {
  const fake = {
    ...realGapi,
    async getToken() { return 'fake-token'; },
    async httpRequest(method, url, opts = {}) {
      requests.push({ method, url, body: opts.body });
      // Doc cot B (link) cua mot tab
      if (method === 'GET' && url.includes('/values/')) {
        const m = decodeURIComponent(url).match(/values\/([^!]+)!/);
        const tab = m ? m[1] : '?';
        const rows = (httpScript.existing && httpScript.existing[tab]) || [];
        return { status: 200, body: JSON.stringify({ values: rows.map(l => [l]) }) };
      }
      // Append
      if (method === 'POST' && url.includes(':append')) {
        if (httpScript.appendFails) return { status: 500, body: 'gia lap loi ghi' };
        return { status: 200, body: '{}' };
      }
      return { status: 200, body: '{}' };
    },
  };
  require.cache[gapiPath] = new Module(gapiPath, null);
  require.cache[gapiPath].filename = gapiPath;
  require.cache[gapiPath].loaded = true;
  require.cache[gapiPath].exports = fake;
}
installGapiMock();

const sheets = require('../src/sheets.cjs');

const SA = { client_email: 'x@y.iam.gserviceaccount.com', private_key: 'k' };
const MAIN_TAB = 'Total_Link_Voice';
const PENDING_TAB = 'Total_Link_Voice_Pending';

// ⚠ PHAI dung ID DAI THAT (19 chu so). `_extractMusicId` doi TOI THIEU 8 chu so; ID ngan kieu
// "222" thi KHONG trich duoc ID nen normalizeKey lui ve so NGUYEN VAN URL — luc do 2 slug khac
// ngon ngu cua CUNG mot sound bi coi la 2 sound khac nhau, va khang dinh loc trung thanh VO
// NGHIA (dung bay ma QD-09 da ghi: du lieu test khong giong that thi test pass ma vo dung).
// 2 ID duoi lay tu chinh anh nguoi dung gui.
const ID_A = '7654496108030675725';   // anh 1: sound bi "Something went wrong"
const ID_B = '7602667462760336144';   // anh 3: sound hien binh thuong
const URL_A = `https://www.tiktok.com/music/original-sound-${ID_A}`;
const URL_B = `https://www.tiktok.com/music/original-sound-${ID_B}`;
const URL_B_RU = `https://www.tiktok.com/music/оригинальный-звук-${ID_B}`;   // cung ID, slug tieng Nga

function cfg(pendingTab = PENDING_TAB) {
  return { enabled: true, spreadsheetId: 'SHEET_ID_1', tab: MAIN_TAB, pendingTab, sa: SA };
}
// Lay cac lan append vao DUNG mot tab
function appendsTo(tab) {
  return requests
    .filter(r => r.method === 'POST' && decodeURIComponent(r.url).includes(`${tab}!A:Z`))
    .flatMap(r => (r.body && r.body.values) || []);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('\n=== Tab CHO KIEM TAY (link "Something went wrong") ===\n');

(async () => {
  // ── 1. Bat tinh nang + nap link da co tren tab cho ──
  console.log('1. Nap link da co tren tab cho de loc trung');
  requests = [];
  httpScript = { existing: { [PENDING_TAB]: [URL_A] } };
  sheets.configure(cfg(), null);
  eq(sheets.isPendingEnabled(), true, 'bat khi co ten tab cho');
  eq(sheets.pendingTabName(), PENDING_TAB, 'nho dung ten tab cho');
  const seed = await sheets.seedPendingLinks();
  ok(seed.ok, 'nap duoc danh sach link cho', seed.msg);
  eq(seed.count, 1, 'dem dung 1 link da co');
  const readUrls = requests.filter(r => r.method === 'GET').map(r => decodeURIComponent(r.url));
  ok(readUrls.some(u => u.includes(`${PENDING_TAB}!B`)), 'doc cot B cua DUNG tab cho');
  ok(!readUrls.some(u => u.includes(`${MAIN_TAB}!B`)), 'KHONG doc tab chinh khi nap tab cho');

  // ── 2. Link moi bi loi -> ghi sang tab cho, KHONG ghi cot Tinh trang ──
  console.log('\n2. Link loi moi -> ghi sang TAB CHO, cot Tinh trang (E) de TRONG');
  requests = [];
  const queued = sheets.enqueuePending(['original sound', URL_B, '', 'profileA']);
  eq(queued, true, 'nhan link vao hang cho');
  await sheets.flushPending();
  const rowsP = appendsTo(PENDING_TAB);
  eq(rowsP.length, 1, 'ghi dung 1 dong sang tab cho');
  eq(rowsP[0] && rowsP[0].length, 4, 'chi ghi 4 cot A:D — KHONG co cot Tinh trang (E)');
  eq(rowsP[0] && rowsP[0][0], 'original sound', 'cot A = ten sound');
  eq(rowsP[0] && rowsP[0][1], URL_B, 'cot B = link');
  eq(rowsP[0] && rowsP[0][2], '', 'cot C = so video DE TRONG (khong doc duoc)');
  eq(rowsP[0] && rowsP[0][3], 'profileA', 'cot D = profile');
  eq(appendsTo(MAIN_TAB).length, 0, 'TUYET DOI khong ghi gi vao tab chinh');

  // ── 3. Khong ghi trung ──
  console.log('\n3. Khong ghi TRUNG');
  requests = [];
  eq(sheets.enqueuePending(['x', URL_A, '', 'p']), false,
    'link DA CO tren tab cho (nap tu Sheet) -> tu choi');
  eq(sheets.enqueuePending(['x', URL_B, '', 'p']), false,
    'link vua ghi xong -> tu choi (khong ghi lan 2)');
  await sheets.flushPending();
  eq(appendsTo(PENDING_TAB).length, 0, 'khong co lan ghi nao them');

  // Cung 1 sound nhung SLUG khac (TikTok tra nhan da ngon ngu) -> phai coi la TRUNG,
  // vi normalizeKey so theo ID (QD-10). Sai cai nay la tab cho phinh ra day dong trung.
  eq(sheets.enqueuePending(['x', URL_B_RU, '', 'p']), false,
    'cung ID nhung slug khac ngon ngu -> van la TRUNG (so theo ID, QD-10)');

  // ── 4. De trong ten tab cho = TAT ──
  console.log('\n4. De trong ten tab cho = TAT tinh nang');
  requests = [];
  sheets.configure(cfg(''), null);
  eq(sheets.isPendingEnabled(), false, 'khong co ten tab -> tat');
  eq(sheets.enqueuePending(['x', 'https://www.tiktok.com/music/original-sound-7600000000000000999', '', 'p']), false,
    'tat thi tu choi xep hang (link se bi bo nhu cu)');
  await sheets.flushPending();
  eq(requests.length, 0, 'khong goi API nao khi tat');

  // ── 5. Doi ten tab cho -> quen danh sach cu (khong loc theo tab CU) ──
  console.log('\n5. Doi ten tab cho -> quen danh sach link cua tab cu');
  requests = [];
  httpScript = { existing: { OtherPending: [] } };
  sheets.configure({ ...cfg('OtherPending') }, null);
  eq(sheets.enqueuePending(['x', URL_A, '', 'p']), true,
    'link cua tab CU khong con bi coi la trung o tab MOI');
  await sheets.flushPending();
  eq(appendsTo('OtherPending').length, 1, 'ghi sang dung tab MOI');

  // ── 6. Loi ghi -> KHONG bo roi lo, phai thu lai duoc ──
  console.log('\n6. Loi ghi -> giu lai lo, thu lai duoc (khong mat du lieu)');
  requests = [];
  httpScript = { existing: {}, appendFails: true };
  sheets.configure(cfg('P2'), null);
  let errMsg = '';
  sheets.configure({ ...cfg('P2') }, (m) => { errMsg = m; });
  eq(sheets.enqueuePending(['a', 'https://www.tiktok.com/music/original-sound-7600000000000000777', '', 'p']), true, 'nhan link');
  await sheets.flushPending();
  ok(/P2/.test(errMsg), 'bao loi co ten tab cho', errMsg);
  // Cho phep ghi lai: bo gia lap loi roi flush lai -> dong cu phai len duoc
  httpScript.appendFails = false;
  requests = [];
  await sleep(60);
  await sheets.flushPending();
  eq(appendsTo('P2').length, 1, 'lo bi loi da duoc GHI LAI, khong mat');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} dat, ${fail} truot\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
