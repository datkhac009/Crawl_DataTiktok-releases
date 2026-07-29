// test/sheet-lock.test.js — Kiem chung KHOA LIEN MAY (chan 1 profile chay tren 2+ may).
//
// Mock tang HTTP cua google-api.cjs nen chay duoc KHONG can Service Account that. Kiem ca
// 2 mat: (a) ket luan dung (free/busy/unknown/off), (b) request GUI DI dung dinh dang.
// Chay: node test/sheet-lock.test.js
'use strict';

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
const apiPath = require.resolve(path.join(SRC, 'google-api.cjs'));
const lockPath = require.resolve(path.join(SRC, 'sheet-lock.cjs'));

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ME = require('os').hostname();
const MIN = 60 * 1000;

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// rows = mang [profile, host, pid, beat_ms, readable]
// metaDelayMs: tre truoc khi tra ket qua "meta" (dung de dung 2 lenh check() gan nhu cung
// luc va kiem tra co bi goi addSheet 2 lan khong).
// tabHidden: trang thai "hidden" cua tab _locks NEU tabExists=true (mo phong tab da co san
// tu ban truoc khi biet an tab, hoac ai do lo bam hien lai).
function installMock({ tabExists = true, tabHidden = true, rows = [], failOn = null, metaDelayMs = 0 }) {
  const calls = [];
  const fake = {
    SHEETS_BASE: BASE, TOKEN_URL: '', SCOPE: '',
    base64url: () => '', normalizeServiceAccount: () => ({ email: 'a@b.c', privateKey: 'k' }),
    extractSpreadsheetId: (x) => String(x || '').trim(),
    getToken: async () => 'FAKE_TOKEN',
    async httpRequest(method, url, opts = {}) {
      calls.push({ method, url, body: opts.body });
      const isBatchUpdate = url.includes(':batchUpdate') && !url.includes('/values:batchUpdate');
      const req0 = isBatchUpdate && opts.body && opts.body.requests && opts.body.requests[0];
      const kind =
        url.includes('sheets.properties') ? 'meta'
        : url.includes('/values:batchUpdate') ? 'valuesUpdate'
        : (isBatchUpdate && req0 && req0.addSheet) ? 'addSheet'
        : (isBatchUpdate && req0 && req0.updateSheetProperties) ? 'hideSheet'
        : url.includes(':append') ? 'append'
        : url.includes('/values/') ? 'read'
        : 'other';
      if (kind === 'meta' && metaDelayMs) await new Promise(r => setTimeout(r, metaDelayMs));
      if (failOn === kind) return { status: 500, body: '{"error":"gia lap loi"}' };
      if (kind === 'meta') {
        const sheets = [{ properties: { sheetId: 1, title: 'Data' } }];
        if (tabExists) sheets.push({ properties: { sheetId: 999, title: '_locks', hidden: tabHidden } });
        return { status: 200, body: JSON.stringify({ sheets }) };
      }
      if (kind === 'read') {
        const values = [['profile', 'host', 'pid', 'beat_ms', 'beat_readable'], ...rows];
        return { status: 200, body: JSON.stringify({ values }) };
      }
      return { status: 200, body: '{}' };
    },
  };
  require.cache[apiPath] = new Module(apiPath, null);
  require.cache[apiPath].filename = apiPath;
  require.cache[apiPath].loaded = true;
  require.cache[apiPath].exports = fake;
  delete require.cache[lockPath];
  const lock = require(lockPath);
  return { lock, calls };
}

const CFG = { spreadsheetId: 'SHEET_ID_TEST', sa: { client_email: 'a@b.c', private_key: 'k' } };

(async () => {
  console.log('\n=== 1. Chua cau hinh Sheet -> "off", KHONG duoc chan ===');
  {
    const { lock } = installMock({});
    // khong goi configure()
    const r = await lock.check('profileA');
    check('state = off', r.state === 'off', JSON.stringify(r));
  }

  console.log('\n=== 2. Bang khoa rong -> "free" ===');
  {
    const { lock } = installMock({ rows: [] });
    lock.configure(CFG);
    const r = await lock.check('profileA');
    check('state = free', r.state === 'free', JSON.stringify(r));
  }

  console.log('\n=== 3. MAY KHAC dang chay, nhip tim tuoi -> "busy" (PHAI CHAN) ===');
  {
    const beat = Date.now() - 30 * 1000;   // 30 giay truoc
    const { lock } = installMock({ rows: [['profileA', 'VPS-02', '123', beat, 'x']] });
    lock.configure(CFG);
    const r = await lock.check('profileA');
    check('state = busy', r.state === 'busy', JSON.stringify(r));
    check('bao dung ten may khac', r.host === 'VPS-02', JSON.stringify(r));
    check('ago ~30s', r.ago >= 28 && r.ago <= 35, 'ago=' + r.ago);
  }

  console.log('\n=== 4. May khac nhung nhip tim CU >3 phut -> "free" (may do da tat) ===');
  {
    const beat = Date.now() - 4 * MIN;
    const { lock } = installMock({ rows: [['profileA', 'VPS-02', '123', beat, 'x']] });
    lock.configure(CFG);
    const r = await lock.check('profileA');
    check('state = free', r.state === 'free', JSON.stringify(r));
  }

  console.log('\n=== 5. Dong khoa la cua CHINH MAY NAY -> "free" (khong tu chan minh) ===');
  {
    const { lock } = installMock({ rows: [['profileA', ME, '999', Date.now(), 'x']] });
    lock.configure(CFG);
    const r = await lock.check('profileA');
    check('state = free', r.state === 'free', JSON.stringify(r));
  }

  console.log('\n=== 6. Profile KHAC dang bi may khac giu -> profile minh van "free" ===');
  {
    const { lock } = installMock({ rows: [['profileB', 'VPS-02', '1', Date.now(), 'x']] });
    lock.configure(CFG);
    const r = await lock.check('profileA');
    check('state = free', r.state === 'free', JSON.stringify(r));
  }

  console.log('\n=== 7. API LOI -> "unknown", TUYET DOI KHONG chan ===');
  {
    const { lock } = installMock({ rows: [], failOn: 'read' });
    lock.configure(CFG);
    const r = await lock.check('profileA');
    check('state = unknown (khong phai busy)', r.state === 'unknown', JSON.stringify(r));
    check('co kem ly do de truy log', !!r.msg, JSON.stringify(r));
  }

  console.log('\n=== 8. Tab _locks chua ton tai -> phai TU TAO (AN NGAY TU DAU) + ghi dong tieu de ===');
  {
    // User yeu cau (2026-07-28): KHONG duoc hien tab la tren Sheet chinh. Tao moi phai
    // dat hidden:true NGAY, khong phai tao xong roi an sau.
    const { lock, calls } = installMock({ tabExists: false, rows: [] });
    lock.configure(CFG);
    await lock.check('profileA');
    const addSheet = calls.find(c => {
      const r0 = c.body && c.body.requests && c.body.requests[0];
      return r0 && r0.addSheet;
    });
    check('co goi addSheet', !!addSheet);
    check('dat ten tab = _locks',
      !!addSheet && JSON.stringify(addSheet.body).includes('_locks'),
      addSheet && JSON.stringify(addSheet.body));
    check('tao tab o dang AN (hidden:true) ngay tu dau',
      !!addSheet && addSheet.body.requests[0].addSheet.properties.hidden === true,
      addSheet && JSON.stringify(addSheet.body));
    const header = calls.find(c => c.url.includes(':append'));
    check('ghi dong tieu de', !!header && JSON.stringify(header.body).includes('beat_ms'),
      header && JSON.stringify(header.body));
  }

  console.log('\n=== 9. heartbeat: chua co dong -> APPEND dong moi ===');
  {
    const { lock, calls } = installMock({ rows: [] });
    lock.configure(CFG);
    await lock.heartbeat(['profileA']);
    const ap = calls.filter(c => c.url.includes(':append'));
    check('co append', ap.length >= 1);
    const body = JSON.stringify(ap[ap.length - 1].body);
    check('ghi dung ten profile', body.includes('profileA'), body);
    check('ghi dung hostname may nay', body.includes(ME), body);
  }

  console.log('\n=== 10. heartbeat: da co dong cua may nay -> UPDATE dung so dong (khong append) ===');
  {
    // Dong tieu de o dong 1, nen dong du lieu dau tien la dong 2
    const { lock, calls } = installMock({ rows: [['profileA', ME, '1', 1, 'x']] });
    lock.configure(CFG);
    await lock.heartbeat(['profileA']);
    const up = calls.find(c => c.url.includes('/values:batchUpdate'));
    check('co values:batchUpdate', !!up);
    const body = JSON.stringify(up && up.body);
    check('nham dung dong 2 (A2:E2)', body.includes('A2:E2'), body);
    check('KHONG append thua', !calls.some(c => c.url.includes(':append')));
  }

  console.log('\n=== 11. release: ghi beat = 0 de may khac chay duoc NGAY ===');
  {
    const { lock, calls } = installMock({ rows: [['profileA', ME, '1', Date.now(), 'x']] });
    lock.configure(CFG);
    await lock.release(['profileA']);
    const up = calls.find(c => c.url.includes('/values:batchUpdate'));
    check('co ghi cap nhat', !!up);
    const vals = up && up.body && up.body.data && up.body.data[0].values[0];
    check('beat = 0', !!vals && vals[3] === 0, JSON.stringify(vals));
  }

  console.log('\n=== 12. heartbeat LOI API -> khong nem exception ra ngoai (khong lam sap app) ===');
  {
    const { lock } = installMock({ rows: [], failOn: 'append' });
    lock.configure(CFG);
    let threw = false;
    try { await lock.heartbeat(['profileA']); } catch (_) { threw = true; }
    check('khong nem loi', !threw);
  }

  console.log('\n=== 13. 2 check() GAN NHU CUNG LUC khi tab chua co -> CHI 1 lenh tao tab (khong xung dot) ===');
  {
    // Su co that 2026-07-28: configure() reset _tabReady vo dieu kien + _ensureTab khong co
    // khoa dong thoi -> 2 profile khoi dong gan nhau cung thay "chua co tab" -> ca hai cung
    // goi addSheet -> Google tu choi lenh thu 2 vi trung ten -> hien ra nhu "xung dot".
    const { lock, calls } = installMock({ tabExists: false, rows: [], metaDelayMs: 50 });
    lock.configure(CFG);
    await Promise.all([lock.check('profileA'), lock.check('profileB')]);
    const addSheetCalls = calls.filter(c => {
      const r0 = c.body && c.body.requests && c.body.requests[0];
      return r0 && r0.addSheet;
    });
    check('chi dung 1 lenh tao tab (khong phai 2)', addSheetCalls.length === 1,
      'so lenh addSheet = ' + addSheetCalls.length);
  }

  console.log('\n=== 14. configure() cung 1 cau hinh -> KHONG reset trang thai (khong doc lai meta) ===');
  {
    const { lock, calls } = installMock({ tabExists: true, tabHidden: true, rows: [] });
    lock.configure(CFG);
    await lock.check('profileA');   // lan dau: phai doc meta 1 lan de xac nhan tab da co
    const metaCallsBefore = calls.filter(c => c.url.includes('sheets.properties')).length;
    lock.configure(CFG);            // GOI LAI voi cung cau hinh (dung nhu moi lan bam Chay)
    await lock.check('profileA');
    const metaCallsAfter = calls.filter(c => c.url.includes('sheets.properties')).length;
    check('khong doc lai metadata sau configure() trung lap',
      metaCallsAfter === metaCallsBefore, `truoc=${metaCallsBefore} sau=${metaCallsAfter}`);
  }

  console.log('\n=== 15. configure() cau hinh THAT SU doi (spreadsheetId khac) -> PHAI reset ===');
  {
    const { lock, calls } = installMock({ tabExists: true, tabHidden: true, rows: [] });
    lock.configure(CFG);
    await lock.check('profileA');
    const metaCallsBefore = calls.filter(c => c.url.includes('sheets.properties')).length;
    lock.configure({ ...CFG, spreadsheetId: 'SHEET_ID_KHAC' });
    await lock.check('profileA');
    const metaCallsAfter = calls.filter(c => c.url.includes('sheets.properties')).length;
    check('doc lai metadata vi doi Sheet',
      metaCallsAfter > metaCallsBefore, `truoc=${metaCallsBefore} sau=${metaCallsAfter}`);
  }

  console.log('\n=== 16. Tab _locks DA CO san nhung CHUA AN (tinh huong that cua user 2026-07-28) -> TU AN LAI ===');
  {
    // Dung tinh huong nguoi dung gap: tab da duoc tao tu truoc khi co hidden:true, dang
    // hien tren thanh tab. App phai TU CHUA ma khong can nguoi dung tu vao Sheet sua.
    const { lock, calls } = installMock({ tabExists: true, tabHidden: false, rows: [] });
    lock.configure(CFG);
    await lock.check('profileA');
    const hideCall = calls.find(c => {
      const r0 = c.body && c.body.requests && c.body.requests[0];
      return r0 && r0.updateSheetProperties;
    });
    check('co goi an lai tab', !!hideCall, JSON.stringify(calls.map(c => c.url)));
    check('dat hidden:true dung sheetId',
      !!hideCall && hideCall.body.requests[0].updateSheetProperties.properties.hidden === true
        && hideCall.body.requests[0].updateSheetProperties.properties.sheetId === 999,
      hideCall && JSON.stringify(hideCall.body));
    check('KHONG tao tab moi (vi da co san)',
      !calls.some(c => c.body && c.body.requests && c.body.requests[0] && c.body.requests[0].addSheet));
  }

  console.log('\n=== 17. Tab _locks DA AN san -> KHONG goi lai lenh an (tranh goi API thua) ===');
  {
    const { lock, calls } = installMock({ tabExists: true, tabHidden: true, rows: [] });
    lock.configure(CFG);
    await lock.check('profileA');
    const hideCall = calls.find(c => {
      const r0 = c.body && c.body.requests && c.body.requests[0];
      return r0 && r0.updateSheetProperties;
    });
    check('khong goi an lai (da an tu truoc)', !hideCall, JSON.stringify(calls.map(c => c.url)));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
