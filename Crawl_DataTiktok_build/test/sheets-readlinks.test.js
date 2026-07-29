// test/sheets-readlinks.test.js — Kiem chung readLinks() cua sheets.cjs: retry 1 lan khi
// loi/thoi gian cho, va khong retry mai khi loi lien tuc (tranh treo lau vo ich).
//
// Boi canh (2026-07-29): nguoi dung bao doc Sheet "Total_Link_Voice!B:B" bi timeout that
// (khong phai bug treo cu) vi tab da tich luy nhieu nghin dong. Da nang timeout mac dinh
// 10s -> 25s (google-api.cjs) + them retry 1 lan o day, vi day la GET thuan doc, goi lai
// khong gay trung du lieu.
// Chay: node test/sheets-readlinks.test.js
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

// failFirstN: so lan goi httpRequest dau tien se that bai (loi/tra HTTP 500), tu lan sau tra OK.
function installMock({ failFirstN = 0 } = {}) {
  let calls = 0;
  const appendCalls = [];
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'FAKE_TOKEN',
    async httpRequest(method, url, opts = {}) {
      calls++;
      if (url.includes(':append')) { appendCalls.push(opts.body); return { status: 200, body: '{}' }; }
      if (calls <= failFirstN) return { status: 500, body: '{"error":"gia lap timeout/loi"}' };
      return { status: 200, body: JSON.stringify({ values: [['link-A'], ['link-B']] }) };
    },
  };
  require.cache[apiPath] = new Module(apiPath, null);
  require.cache[apiPath].filename = apiPath;
  require.cache[apiPath].loaded = true;
  require.cache[apiPath].exports = fake;
  delete require.cache[sheetsPath];
  const sheets = require(sheetsPath);
  return { sheets, getCalls: () => calls, getAppendCalls: () => appendCalls };
}

(async () => {
  console.log('\n=== 1. Lan dau OK ngay -> tra du lieu, CHI 1 lan goi (khong retry thua) ===');
  {
    const { sheets, getCalls } = installMock({ failFirstN: 0 });
    const links = await sheets.readLinks('SHEET_ID', 'Total_Link_Voice', { client_email: 'a@b.c', private_key: 'k' });
    check('tra dung 2 link', links.length === 2 && links[0] === 'link-A', JSON.stringify(links));
    check('chi goi httpRequest 1 lan', getCalls() === 1, `so lan=${getCalls()}`);
  }

  console.log('\n=== 2. Lan dau LOI (timeout gia lap), lan 2 OK -> RETRY thanh cong, khong nem loi ra ngoai ===');
  {
    const { sheets, getCalls } = installMock({ failFirstN: 1 });
    const links = await sheets.readLinks('SHEET_ID', 'Total_Link_Voice', { client_email: 'a@b.c', private_key: 'k' });
    check('tra dung 2 link sau khi retry', links.length === 2, JSON.stringify(links));
    check('da goi httpRequest 2 lan (1 loi + 1 retry)', getCalls() === 2, `so lan=${getCalls()}`);
  }

  console.log('\n=== 3. LOI CA 2 LAN -> nem loi ra ngoai (khong retry vo han) ===');
  {
    const { sheets, getCalls } = installMock({ failFirstN: 99 });
    let threw = false;
    try {
      await sheets.readLinks('SHEET_ID', 'Total_Link_Voice', { client_email: 'a@b.c', private_key: 'k' });
    } catch (e) {
      threw = true;
    }
    check('nem loi ra ngoai', threw);
    check('CHI thu dung 2 lan (khong lap vo han)', getCalls() === 2, `so lan=${getCalls()}`);
  }

  console.log('\n=== 4. CHUA nap duoc lan nao (isSeeded=false) -> enqueue() KHONG duoc tu day (tranh day mu gay trung) ===');
  {
    const { sheets, getAppendCalls } = installMock({});
    sheets.configure({ enabled: true, spreadsheetId: 'SHEET_ID', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } });
    check('isSeeded() = false luc dau', sheets.isSeeded() === false);
    sheets.enqueue(['ten sound', 'https://tiktok.com/music/x-1', 100, 'profileA']);
    await sheets.flush();
    check('KHONG co append nao (con dang cho seed)', getAppendCalls().length === 0, `so lan append=${getAppendCalls().length}`);
  }

  console.log('\n=== 5. Sau khi updateKnownLinks() thanh cong (isSeeded=true) -> enqueue() day BINH THUONG ===');
  {
    const { sheets, getAppendCalls } = installMock({});
    sheets.configure({ enabled: true, spreadsheetId: 'SHEET_ID', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } });
    sheets.updateKnownLinks([]); // mo phong lan nap dau phien (hoac reseed dinh ky) thanh cong
    check('isSeeded() = true sau updateKnownLinks', sheets.isSeeded() === true);
    sheets.enqueue(['ten sound', 'https://tiktok.com/music/x-2', 200, 'profileA']);
    await sheets.flush();
    check('CO append (da san sang day binh thuong)', getAppendCalls().length === 1, `so lan append=${getAppendCalls().length}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
