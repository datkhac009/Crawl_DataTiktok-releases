// test/dup-detect.test.js — DO TRUNG LIEN MAY (2026-08-18)
//
// BOI CANH THAT: nguoi dung chay HAI app tren cung mot Google Sheet — ban nay va ban cua
// Hung13010. Da doc thang `_flushState` trong app.asar cua Hung v0.1.56: no loc trung bang
// `_knownLinks` TRONG BO NHO roi appendRows ngay, KHONG co luot doc lai Sheet truoc khi ghi.
// Ban nay thi co (QD-09). Nen cua sinh trung cua ho rong bang ca mot chu ky doc lai.
//
// ⛔ KHONG the phong ngua "dut diem": Google Sheets khong co phep GIANH QUYEN nguyen tu, va may
// nguoi dung DA VUOT quota ghi (do that: 437 + 607 lan "Quota exceeded") nen doc day hon se lam
// TE HON. Huong di la DO roi bao cao, va chi xoa dong CUA CHINH MINH.
//
// Chay: node test/dup-detect.test.js
'use strict';

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
const apiPath = require.resolve(path.join(SRC, 'google-api.cjs'));
const sheetsPath = require.resolve(path.join(SRC, 'sheets.cjs'));
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log('   OK   ' + label); }
  else { fail++; console.log('   FAIL ' + label + ' ' + extra); }
}

// ⚠ GHEP CHUOI, khong cong so — 76000000000000000 vuot MAX_SAFE_INTEGER nen moi n cho ra CUNG
// mot so, moi link thanh giong nhau, test pass VO NGHIA (bay nay da co that o QD-09).
const L = (n) => 'https://www.tiktok.com/music/original-sound-76000000000' + String(100000 + n);
const row = (n) => ['sound ' + n, L(n), 1000, 'profileA'];

// Sheet gia lap. Diem KHAC bo mock cu: append tra ve `updates.updatedRange` nhu Google THAT, vi
// toan bo tinh nang nay dua vao do de biet minh vua ghi vao DONG NAO (khong suy doan).
function installMock(opts) {
  const o = opts || {};
  const initialRows = o.initialRows || ['Link'];
  const noUpdatedRange = !!o.noUpdatedRange;
  const state = { rows: initialRows.slice(), appends: [], reads: [], deletes: [] };
  const ctl = { injectBeforeAppend: null, injectBeforeRead: null };
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'FAKE_TOKEN',
    async httpRequest(method, url, o2) {
      const opts2 = o2 || {};
      const u = decodeURIComponent(url);
      if (u.indexOf(':batchUpdate') >= 0) {
        state.deletes.push(opts2.body);
        return { status: 200, body: '{}' };
      }
      if (u.indexOf(':append') >= 0) {
        // MAY KHAC cheo dong vao NGAY TRUOC khi ta ghi (dung cua dua duoi mot giay).
        if (ctl.injectBeforeAppend) { state.rows.push.apply(state.rows, ctl.injectBeforeAppend); ctl.injectBeforeAppend = null; }
        const vals = (opts2.body && opts2.body.values) || [];
        const first = state.rows.length + 1;
        for (const r of vals) state.rows.push(r[1]);
        state.appends.push(vals);
        if (noUpdatedRange) return { status: 200, body: '{}' };
        return { status: 200, body: JSON.stringify({
          updates: { updatedRange: 'Data!A' + first + ':D' + (first + vals.length - 1) } }) };
      }
      if (ctl.injectBeforeRead) { state.rows.push.apply(state.rows, ctl.injectBeforeRead); ctl.injectBeforeRead = null; }
      const m = u.match(/!B(\d+)?:B/);
      const from = m && m[1] ? parseInt(m[1], 10) : 1;
      state.reads.push(from);
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
  return { sheets: sheets, state: state, ctl: ctl };
}

(async () => {

console.log('\n=== 1. _scanDupes: tim dung KEY va dung SO DONG ===');
{
  const { sheets } = installMock();
  // Cua so bat dau tu dong 100: [100]=A, [101]=B, [102]=A -> A trung o dong 100 va 102
  const d = sheets._scanDupes([L(1), L(2), L(1)], 100);
  check('tim ra dung 1 nhom trung', d.length === 1, JSON.stringify(d));
  check('dung so dong 100 va 102', !!d[0] && d[0].rows.join(',') === '100,102', JSON.stringify(d[0]));
  check('khong bao trung cho link chi xuat hien 1 lan', !d.some(x => x.rows.length < 2));
}
{
  const { sheets } = installMock();
  // O RONG giua phai KHONG lam lech so dong (dong that = from + i)
  const d = sheets._scanDupes([L(5), '', '', L(5)], 200);
  check('o rong giua khong lam lech so dong',
    d.length === 1 && d[0].rows.join(',') === '200,203', JSON.stringify(d));
}
{
  const { sheets } = installMock();
  check('cua so rong -> khong bao gi', sheets._scanDupes([], 1).length === 0);
  check('mot dong -> khong bao gi', sheets._scanDupes([L(1)], 1).length === 0);
  // Cung ID nhung SLUG khac ngon ngu -> PHAI coi la trung (normalizeKey theo ID, QD-10)
  const d = sheets._scanDupes([
    'https://www.tiktok.com/music/original-sound-7657500232700496848',
    'https://www.tiktok.com/music/original-zvuk-7657500232700496848'], 10);
  check('cung ID khac slug -> VAN nhan ra trung (QD-10)', d.length === 1, JSON.stringify(d));
}

console.log('\n=== 2. _noteMyWrites: ghi nho dung dong, va KHONG DOAN khi thieu ===');
{
  const { sheets } = installMock();
  sheets._noteMyWrites([row(1), row(2), row(3)], { firstRow: 500, lastRow: 502 });
  const d = sheets._scanDupes([L(2), L(2)], 501);
  check('nho dung dong cua minh (dong 501 cho link 2)',
    !!d[0] && d[0].myRow === 501, JSON.stringify(d[0]));
}
{
  const { sheets } = installMock();
  sheets._noteMyWrites([row(9)], null);   // Google khong tra updatedRange
  const d = sheets._scanDupes([L(9), L(9)], 1);
  check('range = null -> KHONG doan bua (myRow phai null)',
    !!d[0] && d[0].myRow === null, JSON.stringify(d[0]));
}
{
  const { sheets } = installMock();
  // Nhieu dong hon range cho phep -> khong duoc ghi tran ra ngoai lastRow
  sheets._noteMyWrites([row(1), row(2), row(3)], { firstRow: 10, lastRow: 11 });
  const d = sheets._scanDupes([L(3), L(3)], 10);
  check('khong ghi nho dong VUOT lastRow', !!d[0] && d[0].myRow === null, JSON.stringify(d[0]));
}

console.log('\n=== 3. Sau khi ghi: MOC keo ve dong dau khoi vua ghi ===');
{
  const { sheets, state } = installMock({ initialRows: ['Link', L(1), L(2), L(3)] });
  await sheets.refreshKnownLinks({ full: true });   // doc #1: 4 dong -> moc = 5
  sheets.enqueue(row(4));
  await sheets.flush();                             // doc #2 (truoc ghi) + ghi vao dong 5
  check('da ghi 1 dong', state.appends.length === 1, JSON.stringify(state.appends));
  await sheets.refreshKnownLinks();                 // doc #3 phai bat dau tu DONG 5
  check('lan doc sau bat dau tu dong 5 (doc LAI dong minh vua ghi)',
    state.reads[2] === 5, 'reads=' + JSON.stringify(state.reads));
}

console.log('\n=== 4. Doc lai KHONG lam moc chay lui / khong ket ===');
{
  const { sheets, state } = installMock({ initialRows: ['Link', L(1)] });
  await sheets.refreshKnownLinks({ full: true });
  sheets.enqueue(row(2));
  await sheets.flush();                             // Sheet gio 3 dong, ta ghi dong 3
  await sheets.refreshKnownLinks();                 // doc lai tu dong 3
  const r1 = state.reads[state.reads.length - 1];
  await sheets.refreshKnownLinks();                 // khong co gi moi
  const r2 = state.reads[state.reads.length - 1];
  check('moc TIEN len sau khi da doc lai (khong ket mai o dong 3)',
    r2 > r1, 'reads=' + JSON.stringify(state.reads));
}

console.log('\n=== 5. DUNG CANH THAT: may khac cheo dong TRUNG ngay truoc khi ta ghi ===');
{
  const { sheets, state, ctl } = installMock({ initialRows: ['Link', L(1)] });
  await sheets.refreshKnownLinks({ full: true });   // moc = 3
  sheets.enqueue(row(7));
  ctl.injectBeforeAppend = [L(7)];                  // may khac ghi L(7) vao dong 3, ta ghi dong 4
  await sheets.flush();
  check('van ghi (cua dua duoi mot giay khong the chan het)', state.appends.length === 1);
  await sheets.refreshKnownLinks();                 // doc lai tu dong 4 -> thay ca dong 3 va 4
  const st = sheets.getDupStats();
  check('phat hien duoc it nhat 1 dong trung', (st.mine + st.others) >= 1, JSON.stringify(st));
  check('CHE DO THU: khong gui lenh xoa nao', state.deletes.length === 0, JSON.stringify(state.deletes));
}

console.log('\n=== 6. Che do thu / bat: doi duoc, mac dinh la THU ===');
{
  const { sheets } = installMock();
  check('mac dinh mode = log (khong tu xoa)', sheets.getDupStats().mode === 'log');
  sheets.setDupMode('on');
  check('bat duoc len on', sheets.getDupStats().mode === 'on');
  sheets.setDupMode('log');
  check('tat ve log duoc', sheets.getDupStats().mode === 'log');
  sheets.setDupMode('rac');
  check('gia tri rac -> ve log (khong bao gio TU BAT xoa)', sheets.getDupStats().mode === 'log');
}

console.log('\n=== 7. Du phong: Google khong tra updatedRange thi van chay ===');
{
  const { sheets, state } = installMock({ initialRows: ['Link', L(1)], noUpdatedRange: true });
  await sheets.refreshKnownLinks({ full: true });
  sheets.enqueue(row(2));
  await sheets.flush();
  check('van ghi duoc binh thuong', state.appends.length === 1);
  await sheets.refreshKnownLinks();
  check('moc van tien (khong ket, khong doc lai tu dau)',
    state.reads[2] >= 3, 'reads=' + JSON.stringify(state.reads));
}

console.log('\n' + '='.repeat(60) + '\nKET QUA: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('LOI:', e); process.exit(1); });
