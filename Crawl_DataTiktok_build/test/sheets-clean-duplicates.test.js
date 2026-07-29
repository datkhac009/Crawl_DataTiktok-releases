// test/sheets-clean-duplicates.test.js — Kiem chung tinh nang "Don trung tren Sheet"
// (scanDuplicates / deleteRows / cleanDuplicates trong sheets.cjs).
//
// Boi canh (2026-07-29): nguoi dung phat hien 1 link ton tai 2 lan tren Sheet that (dong
// 468 va dong 139616) du co ca chan doan lac tu truoc. Co che phong ngua (enqueue/pushDedup)
// chi ngan trung PHAT SINH TU GIO, khong don duoc trung DA CO SAN -> can them cong cu quet
// toan bo tab + xoa dong thua. Uu tien GIU dong co du lieu tu ghi o cot E tro di (tranh mat
// ghi chu tay cua nguoi dung).
// Chay: node test/sheets-clean-duplicates.test.js
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

// rows: mang gia tri A:Z (KHONG ke header, se tu them header o dong 1).
function installMock(rows) {
  const deleteRequests = []; // gom moi request deleteDimension tu moi lan batchUpdate
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'FAKE_TOKEN',
    async httpRequest(method, url, opts = {}) {
      if (url.includes('sheets.properties')) {
        return { status: 200, body: JSON.stringify({ sheets: [{ properties: { sheetId: 777, title: 'Data' } }] }) };
      }
      if (url.includes(':batchUpdate')) {
        for (const r of opts.body.requests) deleteRequests.push(r.deleteDimension);
        return { status: 200, body: '{}' };
      }
      if (url.includes('/values/')) {
        const header = ['Tên Sound', 'Link', 'Số Video', 'Profile', 'Tình trạng'];
        return { status: 200, body: JSON.stringify({ values: [header, ...rows] }) };
      }
      return { status: 200, body: '{}' };
    },
  };
  require.cache[apiPath] = new Module(apiPath, null);
  require.cache[apiPath].filename = apiPath;
  require.cache[apiPath].loaded = true;
  require.cache[apiPath].exports = fake;
  delete require.cache[sheetsPath];
  const sheets = require(sheetsPath);
  return { sheets, getDeleteRequests: () => deleteRequests };
}

const CFG = { spreadsheetId: 'SHEET_ID', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } };

(async () => {
  console.log('\n=== 1. Khong co trung -> toDeleteCount = 0 ===');
  {
    const { sheets } = installMock([
      ['s1', 'https://tiktok.com/music/a-1', 100, 'p1', ''],
      ['s2', 'https://tiktok.com/music/a-2', 200, 'p1', ''],
    ]);
    const r = await sheets.scanDuplicates(CFG.spreadsheetId, CFG.tab, CFG.sa);
    check('ok = true', r.ok === true);
    check('dupGroupCount = 0', r.dupGroupCount === 0, JSON.stringify(r));
    check('toDeleteCount = 0', r.toDeleteCount === 0);
  }

  console.log('\n=== 2. 1 link lap 2 dong, ca 2 deu KHONG co du lieu cot E -> giu dong CU HON (dong nho hon) ===');
  {
    // dong 2 (header=1) va dong 3 cung link -> giu dong 2, xoa dong 3.
    const { sheets } = installMock([
      ['s1', 'https://tiktok.com/music/dup-1', 100, 'p1', ''],
      ['s1-lai', 'https://tiktok.com/music/dup-1', 999, 'p2', ''],
    ]);
    const r = await sheets.scanDuplicates(CFG.spreadsheetId, CFG.tab, CFG.sa);
    check('dupGroupCount = 1', r.dupGroupCount === 1, JSON.stringify(r));
    check('toDeleteCount = 1', r.toDeleteCount === 1);
    check('xoa dung dong 3 (giu dong 2 cu hon)', r.toDeleteRowIndexes[0] === 3, JSON.stringify(r.toDeleteRowIndexes));
  }

  console.log('\n=== 3. 1 link lap 2 dong, dong SAU co ghi chu tay o cot E -> UU TIEN GIU dong co ghi chu (du la dong moi hon) ===');
  {
    const { sheets } = installMock([
      ['s1', 'https://tiktok.com/music/dup-2', 100, 'p1', ''],           // dong 2 - khong ghi chu
      ['s1-lai', 'https://tiktok.com/music/dup-2', 999, 'p2', 'da check'], // dong 3 - CO ghi chu tay
    ]);
    const r = await sheets.scanDuplicates(CFG.spreadsheetId, CFG.tab, CFG.sa);
    check('toDeleteCount = 1', r.toDeleteCount === 1);
    check('xoa dong 2 (khong ghi chu), GIU dong 3 (co ghi chu tay)', r.toDeleteRowIndexes[0] === 2, JSON.stringify(r.toDeleteRowIndexes));
    check('sample.keepRow = 3', r.sample[0].keepRow === 3, JSON.stringify(r.sample));
  }

  console.log('\n=== 4. 3 dong cung 1 link (mo phong dung tinh huong that: dong 468 & dong 139616 + 1 dong nua) -> giu 1, xoa 2 ===');
  {
    const { sheets } = installMock([
      ['s1', 'https://tiktok.com/music/original-sound-7651689970457004808', 12000, 'jsbfan@cosoinan.com', ''],
      ['s1', 'https://tiktok.com/music/original-sound-7651689970457004808', 39000, 'uslhqtchxt263@hotmail.com(UK)', ''],
      ['s1', 'https://tiktok.com/music/original-sound-7651689970457004808', 5000, 'khac@mail.com', ''],
    ]);
    const r = await sheets.scanDuplicates(CFG.spreadsheetId, CFG.tab, CFG.sa);
    check('dupGroupCount = 1', r.dupGroupCount === 1);
    check('toDeleteCount = 2 (giu lai 1 trong 3)', r.toDeleteCount === 2, JSON.stringify(r));
  }

  console.log('\n=== 5. deleteRows(): goi batchUpdate voi dung sheetId + startIndex/endIndex, THEO THU TU GIAM DAN ===');
  {
    const { sheets, getDeleteRequests } = installMock([]);
    await sheets.deleteRows(CFG.spreadsheetId, CFG.tab, CFG.sa, [5, 10, 3]);
    const reqs = getDeleteRequests();
    check('co 3 request', reqs.length === 3, JSON.stringify(reqs));
    check('dung sheetId lay tu metadata (777)', reqs.every(r => r.range.sheetId === 777));
    check('thu tu GIAM DAN (10, 5, 3)', reqs[0].range.startIndex === 9 && reqs[1].range.startIndex === 4 && reqs[2].range.startIndex === 2, JSON.stringify(reqs));
    check('endIndex = startIndex+1 (xoa dung 1 dong)', reqs.every(r => r.range.endIndex === r.range.startIndex + 1));
  }

  console.log('\n=== 6. cleanDuplicates(): tu quet + tu xoa, tra ve dung so dong da xoa ===');
  {
    const { sheets, getDeleteRequests } = installMock([
      ['s1', 'https://tiktok.com/music/dup-3', 100, 'p1', ''],
      ['s1-lai', 'https://tiktok.com/music/dup-3', 999, 'p2', ''],
      ['s2', 'https://tiktok.com/music/khong-trung', 500, 'p3', ''],
    ]);
    const r = await sheets.cleanDuplicates(CFG.spreadsheetId, CFG.tab, CFG.sa);
    check('ok = true', r.ok === true, JSON.stringify(r));
    check('deleted = 1', r.deleted === 1, JSON.stringify(r));
    check('da thuc su goi batchUpdate xoa 1 dong', getDeleteRequests().length === 1);
  }

  console.log('\n=== 7. cleanDuplicates(): KHONG co trung -> khong goi batchUpdate nao (deleted = 0) ===');
  {
    const { sheets, getDeleteRequests } = installMock([
      ['s1', 'https://tiktok.com/music/rieng-1', 100, 'p1', ''],
      ['s2', 'https://tiktok.com/music/rieng-2', 200, 'p1', ''],
    ]);
    const r = await sheets.cleanDuplicates(CFG.spreadsheetId, CFG.tab, CFG.sa);
    check('deleted = 0', r.deleted === 0, JSON.stringify(r));
    check('KHONG goi batchUpdate', getDeleteRequests().length === 0);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
