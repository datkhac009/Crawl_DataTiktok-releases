// test/sheets-read-before-push.test.js — Kiem chung: ĐỌC MỚI NHẤT NGAY TRƯỚC KHI GHI.
//
// BOI CANH THAT (2026-08-03, nguoi dung neu dung y): "2 may chu quet cung 1 link, may kia
// quet check xong day len truoc, xong may kia quet check xong day len -> bi trung".
// Doc dinh ky moi phut van con cua ho trong dung 1 phut do. Cach dong gan het cua ho: ngay
// TRUOC KHI ghi, doc lai phan duoi Sheet -> may day SAU nhin thay dong may truoc vua ghi va
// tu bo. Re vi chi doc vai dong moi ke tu moc, khong phai 156.000 dong.
// Chay: node test/sheets-read-before-push.test.js
'use strict';

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
const apiPath = require.resolve(path.join(SRC, 'google-api.cjs'));
const sheetsPath = require.resolve(path.join(SRC, 'sheets.cjs'));
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// ⚠ Ghep CHUOI, khong cong so: 76000000000000000 vuot Number.MAX_SAFE_INTEGER (~9.007e15)
// nen `76000000000000000 + n` cho ra CUNG MOT so voi moi n -> moi L(n) thanh cung 1 link,
// test se pass mot cach VO NGHIA. Da bi chinh loi nay lua mot lan (2026-08-03).
const L = (n) => `https://www.tiktok.com/music/original-sound-76000000000${String(100000 + n)}`;
const row = (n) => [`sound ${n}`, L(n), 1000, 'profileA'];

// "Sheet" gia lap: mang cot B, ho tro doc theo range B<n>:B va append.
// `ctl` la object DIEU KHIEN SONG (doi duoc giua cac buoc):
//   ctl.failRead      = true  -> moi lan doc tra loi
//   ctl.injectOnRead  = <n>   -> NGAY TRUOC lan doc thu n, chen ctl.injectLinks vao Sheet
//                               (mo phong MAY KHAC vua day len dung khoanh khac do)
// Phai dem theo LAN DOC, khong dung co boolean: lan doc dau tien la doc seed, neu tiem o do
// thi kich ban sai hoan toan (da bi chinh loi nay lua mot lan).
function installMock({ initialRows = ['Link'] } = {}) {
  const state = { rows: initialRows.slice(), appends: [], reads: [] };
  const ctl = { failRead: false, injectOnRead: null, injectLinks: [] };
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
        for (const r of vals) state.rows.push(r[1]);   // cot B = link
        return { status: 200, body: '{}' };
      }
      const readNo = state.reads.length + 1;
      if (ctl.injectOnRead === readNo) state.rows.push(...ctl.injectLinks);
      if (ctl.failRead) { state.reads.push(-1); return { status: 500, body: '{"error":"gia lap loi doc"}' }; }
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
  return { sheets, state, ctl };
}

(async () => {
  console.log('\n=== 1. Link that su moi -> VAN duoc ghi len Sheet ===');
  {
    const { sheets, state } = installMock({ initialRows: ['Link', L(1)] });
    await sheets.refreshKnownLinks({ full: true });        // doc #1 (seed) + dat moc
    sheets.enqueue(row(2));
    await sheets.flush();                                  // doc #2 (truoc khi ghi) roi ghi
    check('da ghi 1 dong', state.appends.length === 1 && state.appends[0].length === 1, JSON.stringify(state.appends));
    check('dung link moi', state.appends[0][0][1] === L(2), JSON.stringify(state.appends[0]));
  }

  console.log('\n=== 2. BUG THAT: MAY KHAC day CUNG link ngay truoc khi may nay ghi -> PHAI BO ===');
  {
    const { sheets, state, ctl } = installMock({ initialRows: ['Link', L(1)] });
    await sheets.refreshKnownLinks({ full: true });        // doc #1: chua co L(2)
    sheets.enqueue(row(2));                                // may nay cung quet trung L(2)
    ctl.injectOnRead = 2; ctl.injectLinks = [L(2)];        // may KHAC day L(2) truoc doc #2
    await sheets.flush();
    check('KHONG ghi gi (thay may khac day truoc)', state.appends.length === 0, JSON.stringify(state.appends));
    check('Sheet chi co DUNG 1 dong L(2)', state.rows.filter(v => v === L(2)).length === 1, JSON.stringify(state.rows));
  }

  console.log('\n=== 3. Lo hon hop: 1 link bi may khac day truoc, 1 link that su moi -> chi ghi cai moi ===');
  {
    const { sheets, state, ctl } = installMock({ initialRows: ['Link'] });
    await sheets.refreshKnownLinks({ full: true });        // doc #1
    sheets.enqueue(row(5));
    sheets.enqueue(row(6));
    ctl.injectOnRead = 2; ctl.injectLinks = [L(5)];        // may khac day L(5) truoc doc #2
    await sheets.flush();
    check('chi ghi 1 dong', state.appends.length === 1 && state.appends[0].length === 1, JSON.stringify(state.appends));
    check('dong ghi la L(6)', state.appends[0][0][1] === L(6), JSON.stringify(state.appends[0]));
    check('L(5) khong bi ghi trung', state.rows.filter(v => v === L(5)).length === 1, JSON.stringify(state.rows));
  }

  console.log('\n=== 4. Doc truoc khi ghi bi LOI mang -> VAN ghi (khong duoc nghen/mat du lieu) ===');
  {
    const { sheets, state, ctl } = installMock({ initialRows: ['Link'] });
    await sheets.refreshKnownLinks({ full: true });        // doc #1 THANH CONG (de _seeded=true)
    sheets.enqueue(row(9));
    ctl.failRead = true;                                   // tu day moi lan doc deu loi
    await sheets.flush();
    check('van ghi duoc du doc that bai', state.appends.length === 1, JSON.stringify(state.appends));
    check('dung link', state.appends[0][0][1] === L(9), JSON.stringify(state.appends[0]));
  }

  console.log('\n=== 5. 2 loi goi refreshKnownLinks CHONG NHAU -> chi doc 1 lan, moc khong nhay qua dong ===');
  {
    const { sheets, state } = installMock({ initialRows: ['Link', L(1), L(2)] });
    const [a, b] = await Promise.all([
      sheets.refreshKnownLinks({ full: true }),
      sheets.refreshKnownLinks({ full: true }),
    ]);
    check('chi doc DUNG 1 lan (gop loi goi trung)', state.reads.length === 1, `so lan doc=${state.reads.length}`);
    check('ca 2 nhan cung ket qua', a.rawRows === b.rawRows && a.from === b.from, JSON.stringify([a, b]));

    state.rows.push(L(3));
    const inc = await sheets.refreshKnownLinks();
    check('doc tang dan tu dong 4 (3 dong + 1)', inc.from === 4, `from=${inc.from}`);
    check('thay dung 1 dong moi', inc.rawRows === 1 && inc.links[0] === L(3), JSON.stringify(inc.links));
  }

  console.log('\n=== 6. configure() doi sang Sheet KHAC -> quen moc, lan sau doc lai toan bo ===');
  {
    const { sheets } = installMock({ initialRows: ['Link', L(1)] });
    await sheets.refreshKnownLinks({ full: true });
    const incSame = await sheets.refreshKnownLinks();
    check('cung Sheet -> doc tang dan (from > 1)', incSame.from > 1, `from=${incSame.from}`);

    sheets.configure({ enabled: true, spreadsheetId: 'ID_KHAC', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } });
    const after = await sheets.refreshKnownLinks();
    check('doi Sheet -> doc lai TOAN BO (from = 1)', after.from === 1, `from=${after.from}`);
  }

  console.log('\n=== 7. configure() goi lai CUNG cau hinh -> KHONG duoc quen moc (bay QD-19) ===');
  {
    const { sheets } = installMock({ initialRows: ['Link', L(1)] });
    await sheets.refreshKnownLinks({ full: true });
    const cfg = { enabled: true, spreadsheetId: 'ID', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } };
    sheets.configure(cfg);
    sheets.configure(cfg);
    const inc = await sheets.refreshKnownLinks();
    check('van doc tang dan (moc con nguyen)', inc.from > 1, `from=${inc.from}`);
  }

  console.log('\n=== 8. Doc truoc khi ghi chi doc PHAN DUOI (khong doc lai toan bo 156k dong) ===');
  {
    const { sheets, state } = installMock({ initialRows: ['Link', L(1), L(2), L(3)] });
    await sheets.refreshKnownLinks({ full: true });        // doc #1: from = 1
    sheets.enqueue(row(7));
    await sheets.flush();                                  // doc #2: phai la from = 5
    check('lan doc truoc khi ghi bat dau tu dong 5 (khong phai 1)',
      state.reads[1] === 5, `reads=${JSON.stringify(state.reads)}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
