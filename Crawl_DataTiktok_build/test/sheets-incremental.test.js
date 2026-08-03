// test/sheets-incremental.test.js — Kiem chung readLinkColumn(): doc TANG DAN phan duoi Sheet.
//
// BOI CANH THAT (2026-08-03): nguoi dung co 2 may chay profile cung vung (UK/KR/US), ca hai
// deu thay sound X la "moi" nen ca hai day X len Sheet -> TRUNG (anh chup Sheet cho thay
// nhieu dong bi to xanh la trung).
// Goc re la DO TRE BIET TIN: doc lai TOAN BO cot B cua tab 156.000 dong mat hang chuc giay
// nen chi dam chay 5-15 phut/lan; trong khoang ho do may nay MU ve nhung gi may kia vua day.
//
// Cach sua: dong moi LUON append vao CUOI tab -> chi can doc PHAN DUOI ke tu moc lan truoc.
// Vai tram dong thi re + nhanh -> chay duoc MOI PHUT, cua so trung co tu 5-15 phut xuong ~1
// phut. `rawRows` (so dong THO, ke ca dong rong) la thu tinh moc — KHONG dung links.length
// vi no da loc bo dong rong nen moc se lech dan.
// Chay: node test/sheets-incremental.test.js
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

// `sheetRows`: toan bo cot B tren "Sheet" gia lap (mang chuoi, phan tu '' = dong rong).
// Mock tu cat theo range B<n>:B giong Google.
function installMock(sheetRows) {
  const urls = [];
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'FAKE_TOKEN',
    async httpRequest(method, url) {
      urls.push(decodeURIComponent(url));
      const m = decodeURIComponent(url).match(/!B(\d+)?:B/);
      const from = m && m[1] ? parseInt(m[1], 10) : 1;
      const slice = sheetRows.slice(from - 1);
      // Google KHONG tra ve cac dong rong o CUOI dai — cat duoi giong that.
      let end = slice.length;
      while (end > 0 && slice[end - 1] === '') end--;
      const values = slice.slice(0, end).map(v => (v === '' ? [] : [v]));
      return { status: 200, body: JSON.stringify({ values }) };
    },
  };
  require.cache[apiPath] = new Module(apiPath, null);
  require.cache[apiPath].filename = apiPath;
  require.cache[apiPath].loaded = true;
  require.cache[apiPath].exports = fake;
  delete require.cache[sheetsPath];
  return { sheets: require(sheetsPath), urls };
}

const SA = { client_email: 'a@b.c', private_key: 'k' };
// ⚠ Ghep CHUOI, khong cong so: 76000000000000000 vuot Number.MAX_SAFE_INTEGER (~9.007e15)
// nen `76000000000000000 + n` cho ra CUNG MOT so voi moi n -> moi L(n) thanh cung 1 link,
// test se pass mot cach VO NGHIA. Da bi chinh loi nay lua mot lan (2026-08-03).
const L = (n) => `https://www.tiktok.com/music/original-sound-76000000000${String(100000 + n)}`;

(async () => {
  console.log('\n=== 1. Doc TOAN BO (startRow=1) -> dung range B:B, tra du link + rawRows ===');
  {
    const rows = ['Link', L(1), L(2), L(3)];
    const { sheets, urls } = installMock(rows);
    const r = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: 1 });
    check('rawRows = 4 (ke ca dong tieu de)', r.rawRows === 4, String(r.rawRows));
    check('links = 4', r.links.length === 4, String(r.links.length));
    check('dung range B:B (khong co so dong)', urls[0].includes('Data!B:B'), urls[0]);
  }

  console.log('\n=== 2. Doc TANG DAN tu moc -> chi tra phan MOI, dung range B<n>:B ===');
  {
    const rows = ['Link', L(1), L(2), L(3), L(4), L(5)];
    const { sheets, urls } = installMock(rows);
    // Lan dau doc toan bo -> moc = rawRows + 1 = 7
    const full = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: 1 });
    const next = full.rawRows + 1;
    check('moc sau lan doc dau = 7', next === 7, String(next));

    // Chua co dong moi -> khong tra gi
    const none = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: next });
    check('chua co dong moi -> rawRows = 0', none.rawRows === 0, String(none.rawRows));
    check('dung range B7:B', urls[urls.length - 1].includes('Data!B7:B'), urls[urls.length - 1]);
  }

  console.log('\n=== 3. May KHAC vua day 2 sound -> lan doc tang dan thay DUNG 2 dong moi ===');
  {
    const rows = ['Link', L(1), L(2), L(3), L(4), L(5)];
    const { sheets } = installMock(rows);
    const full = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: 1 });
    let next = full.rawRows + 1;

    rows.push(L(90), L(91));            // may khac append 2 dong
    const inc = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: next });
    check('thay dung 2 dong moi', inc.rawRows === 2, String(inc.rawRows));
    check('dung 2 link vua them', JSON.stringify(inc.links) === JSON.stringify([L(90), L(91)]), JSON.stringify(inc.links));
    next += inc.rawRows;

    rows.push(L(92));                   // them 1 dong nua
    const inc2 = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: next });
    check('lan sau thay dung 1 dong moi (khong lap lai 2 dong cu)',
      inc2.rawRows === 1 && inc2.links[0] === L(92), JSON.stringify(inc2.links));
  }

  console.log('\n=== 4. Co dong RONG xen giua -> moc tinh theo rawRows, KHONG bi lech dan ===');
  {
    // Day la ly do phai tra rawRows: links.length nho hon so dong that.
    const rows = ['Link', L(1), '', L(2), ''];
    const { sheets } = installMock(rows);
    const full = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: 1 });
    check('links (3) < rawRows (4) vi co dong rong', full.links.length === 3 && full.rawRows === 4,
      `links=${full.links.length} rawRows=${full.rawRows}`);
    const next = full.rawRows + 1;      // = 5
    rows.push(L(50));                   // dong 6 (dong 5 dang rong)
    const inc = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: next });
    // Google tra ve CA dong rong o giua (dong 5) vi phia sau con du lieu -> rawRows = 2.
    // Do la ly do moc phai cong rawRows (KHONG cong links.length): 5 + 2 = 7 moi la dong
    // ke tiep chua doc; neu cong links.length (=1) thi moc thanh 6 -> doc lai dong 6 -> khi
    // Sheet co nhieu dong rong, moc lech dan va doc lap vo ich.
    check('thay dong moi', inc.links.length === 1 && inc.links[0] === L(50), JSON.stringify(inc.links));
    check('rawRows dem CA dong rong o giua (=2)', inc.rawRows === 2, String(inc.rawRows));
    check('moc tien dung: 5 + 2 = 7', next + inc.rawRows === 7, String(next + inc.rawRows));

    // Doc tu moc moi -> khong lap lai dong da doc.
    const inc2 = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: next + inc.rawRows });
    check('khong doc lap dong cu', inc2.rawRows === 0 && inc2.links.length === 0, JSON.stringify(inc2));
  }

  console.log('\n=== 5. readLinks() cu van chay nguyen nhu truoc (tuong thich nguoc) ===');
  {
    const rows = ['Link', L(1), L(2)];
    const { sheets } = installMock(rows);
    const links = await sheets.readLinks('ID', 'Data', SA);
    check('tra ve MANG link (khong phai object)', Array.isArray(links), typeof links);
    check('du 3 phan tu', links.length === 3, String(links.length));
  }

  console.log('\n=== 6. Thieu Spreadsheet ID -> tra rong, khong nem loi ===');
  {
    const { sheets } = installMock(['Link']);
    const r = await sheets.readLinkColumn('', 'Data', SA, { startRow: 1 });
    check('links rong + rawRows = 0', r.links.length === 0 && r.rawRows === 0, JSON.stringify(r));
  }

  console.log('\n=== 7. startRow la 0 / am / rac -> ep ve 1 (doc toan bo), khong tao range sai ===');
  {
    const rows = ['Link', L(1)];
    for (const bad of [0, -5, NaN, undefined, 'abc']) {
      const { sheets, urls } = installMock(rows);
      const r = await sheets.readLinkColumn('ID', 'Data', SA, { startRow: bad });
      check(`startRow=${String(bad)} -> doc toan bo B:B`,
        r.rawRows === 2 && urls[0].includes('Data!B:B'), urls[0]);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
