// test/sheets-pending.test.js — TAB CHỜ KIỂM TAY cho link TikTok tra "Something went wrong".
//
// Muc dich: chot 6 dieu de-vo nhat cua QD-33, vi lam sai la MAT DU LIEU (bo link that) hoac
// LAM BAN du lieu chinh (dieu ma QD-07 dung ra de ngan):
//   1. Sound CHET (dead=true, API tra statusCode 10201) -> BO HAN, KHONG vao tab cho.
//      Sound con song ma khong doc duoc so -> VAO tab cho.
//   2. Cot "Tinh trang" (E) TUYET DOI khong duoc ghi — nguoi dung tu dien.
//   3. Ghi dung TAB CHO, khong bao gio ghi vao tab chinh.
//   4. Khong ghi TRUNG: link da co tren tab cho (phien truoc / may khac) -> bo qua.
//   5. De trong ten tab cho = DUNG TEN MAC DINH `Total_Link_Voice_Pending` (doi tu "= TAT" sang
//      "= mac dinh" ngay 2026-08-06 — xem PENDING_TAB_DEFAULT trong sheets.cjs). Duong TAT bay gio
//      la XOA/DOI TEN tab tren Sheet: app tu ngung ca phien va bao ro link se bi BO.
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
      const tabOf = () => {
        const m = decodeURIComponent(url).match(/values\/([^!]+)!/);
        return m ? m[1] : '?';
      };
      // TAB KHONG TON TAI: Google tra dung the nay — HTTP 400 + "Unable to parse range".
      // Dung nguyen van chuoi that de sheets.cjs dich duoc thanh cau de hieu (QD-26); doi chuoi
      // nay thanh chu khac la test khong con kiem duoc duong that.
      if (httpScript.missingTab) {
        return { status: 400, body: `Unable to parse range: ${tabOf()}!B:B` };
      }
      // Doc cot B (link) cua mot tab
      if (method === 'GET' && url.includes('/values/')) {
        // Gia lap LOI MANG khi doc lai. Phai lam qua httpScript, KHONG ghi de thuoc tinh
        // `httpRequest` cua module: sheets.cjs da destructure ham do luc require nen gan lai
        // thuoc tinh khong co tac dung (da mac loi nay khi viet test).
        if (httpScript.readFails) throw new Error('gia lap loi mang khi doc');
        const rows = (httpScript.existing && httpScript.existing[tabOf()]) || [];
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
// Anh 2026-08-06: cung 1 sound, VPS hien "Something went wrong" con may chinh hien 262K video.
// Dung 2 ID rieng cho muc 4/4b de khong an theo `_pendingKnown` cua cac muc truoc.
const URL_DEFAULT = 'https://www.tiktok.com/music/original-sound-7385710780424243974';
const URL_MISSING = 'https://www.tiktok.com/music/original-sound-7658028456602361622';

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

  // ── 4. De trong ten tab cho = DUNG TEN MAC DINH (doi nguoc lai, 2026-08-06) ──
  // Truoc day o trong = TAT. Doi vi cau hinh nam o %APPDATA% RIENG TUNG MAY, khong dong bo qua
  // Sheet, ma nguoi dung chay 5 may: ho hoi 3 lan "sao khong thay link nao o tab Pending", moi
  // lan deu vi o trong o dung cai may dang chay. Tinh nang cuu du lieu ma phai bat tay tren 5
  // may thi thuc te la KHONG TON TAI. Thiet hai do duoc: 1 sound 262K video bi bo o VPS.
  console.log('\n4. De trong ten tab cho = DUNG TEN MAC DINH (khong con la TAT)');
  requests = [];
  httpScript = { existing: {} };
  sheets.configure(cfg(''), null);
  eq(sheets.isPendingEnabled(), true, 'o trong -> VAN BAT (khong con tat am tham)');
  eq(sheets.pendingTabName(), PENDING_TAB, 'o trong -> lay dung ten mac dinh Total_Link_Voice_Pending');
  await sheets.seedPendingLinks();   // main.js luon nap truoc khi crawl (cong `_pendingSeeded`)
  eq(sheets.enqueuePending(['x', URL_DEFAULT, '', 'p']), true, 'o trong -> van nhan link');
  await sheets.flushPending();
  eq(appendsTo(PENDING_TAB).length, 1, 'ghi sang tab mac dinh');
  eq(appendsTo(MAIN_TAB).length, 0, 'vao tab mac dinh KHONG lam ban tab chinh');

  // ── 4b. TAB KHONG TON TAI tren Sheet -> NGUNG CA PHIEN, khong ghi lai moi 5 giay ──
  // O trong khong con nghia la tat, nen phai co duong tat khac: xoa/doi ten tab. Duong do PHAI
  // im lang ve API (khong thu lai vo ich) nhung PHAI on ve thong bao (noi ro link se bi BO).
  console.log('\n4b. Tab cho KHONG TON TAI -> ngung ca phien + bao ro hau qua');
  // (i) Phat hien ngay o buoc NAP dau phien — re nhat, 1 lan goi API.
  requests = [];
  httpScript = { existing: {}, missingTab: true };
  sheets.configure(cfg('KhongCoTabNay'), null);
  const seedMiss = await sheets.seedPendingLinks();
  eq(seedMiss.ok, false, 'seed that bai');
  eq(seedMiss.missingTab, 'KhongCoTabNay', 'bao dung TEN TAB thieu (de UI chi dung cho sua)');
  eq(sheets.isPendingEnabled(), false, 'sau do TU NGUNG ca phien');
  requests = [];
  eq(sheets.enqueuePending(['x', URL_MISSING, '', 'p']), false, 'ngung roi -> tu choi xep hang');
  await sheets.flushPending();
  eq(requests.length, 0, 'ngung roi -> KHONG goi API nao nua (khong ngap log moi 5 giay)');

  // (ii) Tab bi xoa GIUA PHIEN (nap dau phien thanh cong, luc GHI moi phat hien). Duong nay khac
  // duong (i) va cung phai tu ngung — neu khong thi lo bi tra ve buffer roi thu lai mai mai.
  requests = [];
  httpScript = { existing: {} };
  let missErr = '';
  sheets.configure(cfg('TabSeBiXoa'), (m) => { missErr = m; });
  ok((await sheets.seedPendingLinks()).ok, 'nap dau phien OK (tab con song)');
  eq(sheets.enqueuePending(['x', URL_MISSING, '', 'p']), true, 'nhan link binh thuong');
  httpScript = { existing: {}, missingTab: true };   // <-- tab bi xoa ngay luc nay
  await sheets.flushPending();
  await sleep(50);
  eq(sheets.isPendingEnabled(), false, 'ghi that bai vi mat tab -> TU NGUNG ca phien');
  ok(/TabSeBiXoa/.test(missErr), 'bao loi co TEN TAB', missErr);
  ok(/BỎ/.test(missErr), 'bao loi noi thang HAU QUA: link se bi BO', missErr);
  requests = [];
  await sheets.flushPending();
  eq(requests.length, 0, 'KHONG thu ghi lai (lo da bi xoa, khong treo timer moi 5 giay)');

  // Sua ten tab -> phai cho thu lai, khong ket o trang thai ngung.
  httpScript = { existing: {} };
  sheets.configure(cfg(PENDING_TAB), null);
  eq(sheets.isPendingEnabled(), true, 'doi ten tab -> xoa co "ngung", cho thu lai');

  // ── 5. Doi ten tab cho -> quen danh sach cu (khong loc theo tab CU) ──
  console.log('\n5. Doi ten tab cho -> quen danh sach link cua tab cu');
  requests = [];
  httpScript = { existing: { OtherPending: [] } };
  sheets.configure({ ...cfg('OtherPending') }, null);
  // Doi tab -> phai NAP LAI danh sach truoc khi ghi (dung nhu main.js lam sau khi luu cau hinh).
  // Truoc 2026-08-06 enqueuePending khong co cong `_pendingSeeded` nen ghi duoc ngay — chinh cho
  // hong do: mot lan doc Sheet that bai la ca phien ghi lai tu dau => tab cho day dong trung.
  eq(sheets.enqueuePending(['x', URL_A, '', 'p']), false,
    'CHUA nap danh sach tab moi -> TU CHOI ghi (khong doan bua la link con moi)');
  await sheets.seedPendingLinks();
  eq(sheets.enqueuePending(['x', URL_A, '', 'p']), true,
    'nap xong -> link cua tab CU khong con bi coi la trung o tab MOI');
  await sheets.flushPending();
  eq(appendsTo('OtherPending').length, 1, 'ghi sang dung tab MOI');

  // ── 6. Loi ghi -> KHONG bo roi lo, phai thu lai duoc ──
  console.log('\n6. Loi ghi -> giu lai lo, thu lai duoc (khong mat du lieu)');
  requests = [];
  httpScript = { existing: {}, appendFails: true };
  sheets.configure(cfg('P2'), null);
  let errMsg = '';
  sheets.configure({ ...cfg('P2') }, (m) => { errMsg = m; });
  await sheets.seedPendingLinks();
  eq(sheets.enqueuePending(['a', 'https://www.tiktok.com/music/original-sound-7600000000000000777', '', 'p']), true, 'nhan link');
  await sheets.flushPending();
  ok(/P2/.test(errMsg), 'bao loi co ten tab cho', errMsg);
  // Cho phep ghi lai: bo gia lap loi roi flush lai -> dong cu phai len duoc
  httpScript.appendFails = false;
  requests = [];
  await sleep(60);
  await sheets.flushPending();
  eq(appendsTo('P2').length, 1, 'lo bi loi da duoc GHI LAI, khong mat');

  // ── 7. CHONG TRUNG LIEN MAY: doc lai TANG DAN + doc lai NGAY TRUOC KHI GHI ──
  // Loi that (nguoi dung gui anh tab cho day dong trung, 2026-08-06): tab cho truoc day chi nap
  // danh sach DUNG MOT LAN luc bat dau phien. Chay 5 may thi may nay khong bao gio thay link may
  // kia ghi SAU DO -> moi may deu tuong link con moi va ghi them mot dong. Tab CHINH khong bi vi
  // no co dung 2 co che duoi (QD-09). Gio tab cho dung y het.
  console.log('\n7. Chong trung LIEN MAY: doc tang dan + doc lai ngay truoc khi ghi');
  const T7 = 'P7';
  const ID_7A = '7600000000000000701';
  const ID_7B = '7600000000000000702';
  const U7A = `https://www.tiktok.com/music/original-sound-${ID_7A}`;
  const U7B = `https://www.tiktok.com/music/original-sound-${ID_7B}`;
  requests = [];
  // Tab cho da co 3 dong san (phien truoc) -> moc doc tiep = dong 4. Cо san du lieu moi kiem duoc
  // duong DOC TANG DAN: tab rong thi moc = 1, ma doc tu dong 1 chinh la doc ca cot (khong phan
  // biet duoc voi "doc lai toan bo").
  httpScript = { existing: { [T7]: [
    'https://www.tiktok.com/music/original-sound-7600000000000000801',
    'https://www.tiktok.com/music/original-sound-7600000000000000802',
    'https://www.tiktok.com/music/original-sound-7600000000000000803',
  ] } };
  sheets.configure(cfg(T7), null);
  const s7 = await sheets.seedPendingLinks();
  ok(s7.ok, 'nap danh sach dau phien (3 dong san co)');
  eq(s7.count, 3, 'dem dung 3 link da co');

  // MAY KHAC ghi U7A len tab cho SAU khi may nay da nap xong. Doc TANG DAN se doc tu dong 4 nen
  // chi thay dong moi nay — dung nhu that.
  httpScript.existing[T7] = [U7A];
  // May nay cung gap U7A -> enqueue duoc (chua biet), nhung LUC GHI phai doc lai va TU BO.
  eq(sheets.enqueuePending(['x', U7A, '', 'p']), true, 'chua biet -> nhan vao hang cho');
  requests = [];
  await sheets.flushPending();
  eq(appendsTo(T7).length, 0,
    'doc lai NGAY TRUOC KHI GHI -> thay may khac vua ghi roi -> TU BO, khong ghi trung');
  ok(requests.some(r => r.method === 'GET' && decodeURIComponent(r.url).includes(`${T7}!B`)),
    'co that su doc lai tab cho truoc khi ghi');

  // Doc TANG DAN: lan doc thu 2 phai bat dau tu MOC (B2 tro di), khong doc lai tu dau.
  const incUrl = requests.filter(r => r.method === 'GET')
    .map(r => decodeURIComponent(r.url)).find(u => u.includes(`${T7}!B`));
  ok(/!B[2-9]\d*:B/.test(incUrl || ''),
    `doc TANG DAN tu moc, khong doc lai toan bo (${incUrl ? incUrl.split('/values/')[1] : '?'})`);

  // Link that su moi -> van ghi binh thuong (khong chan oan).
  eq(sheets.enqueuePending(['y', U7B, '', 'p']), true, 'link that su moi -> nhan');
  requests = [];
  await sheets.flushPending();
  eq(appendsTo(T7).length, 1, 'link moi VAN duoc ghi (khong chan oan)');

  // Doc lai loi mang KHONG duoc chan viec ghi — tha cua ho nhu cu con hon nghen du lieu.
  const ID_7C = '7600000000000000703';
  const U7C = `https://www.tiktok.com/music/original-sound-${ID_7C}`;
  eq(sheets.enqueuePending(['z', U7C, '', 'p']), true, 'nhan link moi');
  requests = [];
  httpScript.readFails = true;
  await sheets.flushPending();
  httpScript.readFails = false;
  ok(requests.some(r => r.method === 'GET'), 'da thu doc lai (va bi loi)');
  eq(appendsTo(T7).length, 1, 'doc lai LOI -> VAN GHI (khong nghen du lieu)');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} dat, ${fail} truot\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
