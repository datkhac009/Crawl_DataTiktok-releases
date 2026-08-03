// test/quota-guard.test.js — Kiem chung CAU DAO chong doi quota Google API.
//
// BOI CANH (2026-08-03, nguoi dung hoi): "neu luot call API nhieu qua no se bi nghen thi sao".
// Truoc do app KHONG co mot dong nao xu ly 429/quota — gap la nem loi nhu loi mang thuong roi
// timer 5s lai thu tiep -> cang doi, cang bi chan sau hon.
// Gioi han Google Sheets API v4: 300 req/phut moi PROJECT va 60 req/phut moi NGUOI DUNG
// (= moi Service Account). CA 5 MAY dung CHUNG 1 Service Account nen 60/phut ap cho TONG.
// Chay: node test/quota-guard.test.js
'use strict';

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
const apiPath = require.resolve(path.join(SRC, 'google-api.cjs'));
const sheetsPath = require.resolve(path.join(SRC, 'sheets.cjs'));
const quotaPath = require.resolve(path.join(SRC, 'quota-guard.cjs'));
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

const L = (n) => `https://www.tiktok.com/music/original-sound-76000000000${String(100000 + n)}`;
const row = (n) => [`sound ${n}`, L(n), 1000, 'p'];

// ctl.readStatus / ctl.appendStatus: ma HTTP tra ve (200 = binh thuong)
function installMock({ initialRows = ['Link'] } = {}) {
  const state = { rows: initialRows.slice(), appends: [], reads: 0 };
  const ctl = { readStatus: 200, readBody: '', appendStatus: 200, appendBody: '' };
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'T',
    async httpRequest(method, url, opts = {}) {
      const u = decodeURIComponent(url);
      if (u.includes(':append')) {
        if (ctl.appendStatus !== 200) return { status: ctl.appendStatus, body: ctl.appendBody };
        const vals = (opts.body && opts.body.values) || [];
        state.appends.push(vals);
        for (const r of vals) state.rows.push(r[1]);
        return { status: 200, body: '{}' };
      }
      state.reads++;
      if (ctl.readStatus !== 200) return { status: ctl.readStatus, body: ctl.readBody };
      const m = u.match(/!B(\d+)?:B/);
      const from = m && m[1] ? parseInt(m[1], 10) : 1;
      const slice = state.rows.slice(from - 1);
      let end = slice.length;
      while (end > 0 && !slice[end - 1]) end--;
      return { status: 200, body: JSON.stringify({ values: slice.slice(0, end).map(v => [v]) }) };
    },
  };
  require.cache[apiPath] = new Module(apiPath, null);
  require.cache[apiPath].filename = apiPath;
  require.cache[apiPath].loaded = true;
  require.cache[apiPath].exports = fake;
  delete require.cache[sheetsPath];
  delete require.cache[quotaPath];
  const quota = require(quotaPath);
  const sheets = require(sheetsPath);
  sheets.configure({ enabled: true, spreadsheetId: 'ID', tab: 'Data', sa: { client_email: 'a@b.c', private_key: 'k' } });
  return { sheets, quota, state, ctl };
}

(async () => {
  console.log('\n=== 1. isQuotaError: 429 = quota; 403 CO chu quota = quota ===');
  {
    const { quota } = installMock({});
    check('429 -> quota', quota.isQuotaError(429, ''));
    check('403 + "Quota exceeded" -> quota', quota.isQuotaError(403, '{"error":{"message":"Quota exceeded"}}'));
    check('403 + rateLimitExceeded -> quota', quota.isQuotaError(403, '{"reason":"userRateLimitExceeded"}'));
  }

  console.log('\n=== 2. 403 THIEU QUYEN (khong phai quota) -> KHONG duoc coi la quota ===');
  {
    // Rat quan trong: coi moi 403 la quota se CHE MAT loi "chua chia se Sheet cho service
    // account" — loi nay rat hay gap va cuc kho doan neu bi bao nham thanh quota.
    const { quota } = installMock({});
    const body = '{"error":{"code":403,"message":"The caller does not have permission"}}';
    check('403 thieu quyen -> KHONG phai quota', quota.isQuotaError(403, body) === false);
    check('500 -> KHONG phai quota', quota.isQuotaError(500, 'internal') === false);
  }

  console.log('\n=== 3. Doc bi 429 -> mo cau dao + loi noi ro la quota ===');
  {
    const { sheets, quota, ctl } = installMock({ initialRows: ['Link', L(1)] });
    ctl.readStatus = 429; ctl.readBody = '{"error":"Too Many Requests"}';
    let msg = '';
    try { await sheets.refreshKnownLinks({ full: true }); } catch (e) { msg = e.message; }
    check('nem loi noi ro "vuot gioi han"', msg.includes('vượt giới hạn'), msg);
    check('goi y dung Service Account rieng', msg.includes('Service Account'), msg);
    check('cau dao DA MO', quota.isCoolingDown());
    check('cooldown ~60s', quota.cooldownRemaining() > 50000, String(quota.cooldownRemaining()));
  }

  console.log('\n=== 4. Dang cooldown -> refreshKnownLinks KHONG goi API nua (khong doi) ===');
  {
    const { sheets, quota, state, ctl } = installMock({ initialRows: ['Link', L(1)] });
    await sheets.refreshKnownLinks({ full: true });        // doc that #1
    const readsBefore = state.reads;
    ctl.readStatus = 429;
    try { await sheets.refreshKnownLinks(); } catch (_) {}  // doc #2 -> 429, mo cau dao
    const readsAfterHit = state.reads;
    const r = await sheets.refreshKnownLinks();             // dang cooldown -> phai BO QUA
    check('cau dao mo', quota.isCoolingDown());
    check('KHONG goi API them khi dang cooldown', state.reads === readsAfterHit,
      `truoc=${readsBefore} sau429=${readsAfterHit} cuoi=${state.reads}`);
    check('tra ve co skipped="quota"', r.skipped === 'quota', JSON.stringify(r));
    check('van tra dung moc de lan sau doc tiep (khong mat dong)', r.from > 1, `from=${r.from}`);
  }

  console.log('\n=== 5. Ghi bi 429 -> lo VAN NAM TRONG BO DEM, khong mat du lieu ===');
  {
    const { sheets, quota, state, ctl } = installMock({ initialRows: ['Link'] });
    await sheets.refreshKnownLinks({ full: true });
    sheets.enqueue(row(2));
    ctl.appendStatus = 429; ctl.appendBody = '{"error":"Too Many Requests"}';
    await sheets.flush();
    check('khong ghi duoc dong nao', state.appends.length === 0, JSON.stringify(state.appends));
    check('cau dao mo sau khi ghi bi 429', quota.isCoolingDown());

    // Het cooldown + Google het chan -> lo cu phai duoc day len, KHONG mat.
    quota._reset();
    ctl.appendStatus = 200;
    await sheets.flush();
    check('sau khi het chan: lo cu duoc day len', state.appends.length === 1, JSON.stringify(state.appends));
    check('dung link cu (khong mat du lieu)', state.appends[0][0][1] === L(2), JSON.stringify(state.appends[0]));
  }

  console.log('\n=== 6. Dang cooldown -> flush KHONG ghi, giu nguyen lo cho ===');
  {
    const { sheets, quota, state } = installMock({ initialRows: ['Link'] });
    await sheets.refreshKnownLinks({ full: true });
    sheets.enqueue(row(3));
    quota.noteQuotaHit('test');            // mo cau dao thu cong
    await sheets.flush();
    check('khong ghi gi khi dang cooldown', state.appends.length === 0, JSON.stringify(state.appends));

    quota._reset();
    await sheets.flush();
    check('het cooldown thi day duoc', state.appends.length === 1, JSON.stringify(state.appends));
    check('dung link', state.appends[0][0][1] === L(3), JSON.stringify(state.appends[0]));
  }

  console.log('\n=== 7. Loi 500 thuong (khong phai quota) -> KHONG mo cau dao ===');
  {
    const { sheets, quota, ctl } = installMock({ initialRows: ['Link'] });
    ctl.readStatus = 500; ctl.readBody = 'internal error';
    try { await sheets.refreshKnownLinks({ full: true }); } catch (_) {}
    check('cau dao KHONG mo voi loi thuong', !quota.isCoolingDown());
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
