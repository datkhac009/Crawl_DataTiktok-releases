// test/ip-guard.test.js — Kiem chung ip-guard.cjs: 2 nha cung cap PHAI DONG THUAN moi duoc
// ket luan "lech"/"khop"; bat dong thi coi la "khong biet" (KHONG chan).
//
// Boi canh (2026-07-30): may ao that co IP Han Quoc that (xac nhan doc lap bang 2 dich vu
// khac), nhung app van bao TAM DUNG ca 5 profile - vi truoc day getPublicIp() tin ngay nha
// cung cap DAU TIEN tra loi duoc, khong doi chieu nha cung cap con lai. ifconfig.co (dung
// dau danh sach) co the tra ve trang chan Cloudflare hoac xep nham quoc gia cho dai IP
// VPN/datacenter. Fix: hoi CA HAI song song, chi ket luan khi dong thuan.
//
// Mock module `https` qua require.cache (ip-guard.cjs dung thang https.get, khong qua
// google-api.cjs) - khong can mang that.
// Chay: node test/ip-guard.test.js
'use strict';

const path = require('path');
const Module = require('module');
const realHttps = require('https');

const httpsPath = require.resolve('https');
const guardPath = require.resolve(path.join(__dirname, '..', 'src', 'ip-guard.cjs'));

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// specs: { [url]: {status, body} | 'error' | 'timeout' }
function installMock(specs) {
  const fakeHttps = {
    Agent: realHttps.Agent,
    get(url, _opts, cb) {
      const spec = specs[url];
      const req = {
        _onError: null,
        on(event, handler) {
          if (event === 'error') this._onError = handler;
          return req;
        },
        setTimeout(_ms, handler) {
          if (spec === 'timeout') setImmediate(handler);
        },
        destroy() {},
      };
      if (spec === 'error') {
        setImmediate(() => { if (req._onError) req._onError(new Error('mock network error')); });
      } else if (spec === 'timeout') {
        // khong goi callback nao - _getJson tu ket thuc qua setTimeout() gia lap o tren
      } else if (spec) {
        const res = {
          statusCode: spec.status,
          on(event, handler) {
            if (event === 'data') setImmediate(() => handler(spec.body));
            if (event === 'end') setImmediate(() => handler());
            return res;
          },
          resume() {},
        };
        setImmediate(() => cb(res));
      }
      return req;
    },
  };
  require.cache[httpsPath] = new Module(httpsPath, null);
  require.cache[httpsPath].filename = httpsPath;
  require.cache[httpsPath].loaded = true;
  require.cache[httpsPath].exports = fakeHttps;
  delete require.cache[guardPath];
  return require(guardPath);
}

const IFCONFIG = 'https://ifconfig.co/json';
const COUNTRYIS = 'https://api.country.is/';

(async () => {
  console.log('\n=== 1. Ca 2 nha cung cap DONG THUAN (KR) -> state = ok voi profile (KR) ===');
  {
    const guard = installMock({
      [IFCONFIG]: { status: 200, body: JSON.stringify({ ip: '213.177.237.73', country_iso: 'KR' }) },
      [COUNTRYIS]: { status: 200, body: JSON.stringify({ ip: '213.177.237.73', country: 'KR' }) },
    });
    const r = await guard.check('KR', { force: true });
    check('state = ok', r.state === 'ok', JSON.stringify(r));
    check('country = KR', r.country === 'KR');
  }

  console.log('\n=== 2. 2 nha cung cap BAT DONG (1 bao DE, 1 bao KR that) -> "unknown", KHONG chan ===');
  {
    const guard = installMock({
      [IFCONFIG]: { status: 200, body: JSON.stringify({ ip: '213.177.237.73', country_iso: 'DE' }) },
      [COUNTRYIS]: { status: 200, body: JSON.stringify({ ip: '213.177.237.73', country: 'KR' }) },
    });
    const r = await guard.check('KR', { force: true });
    check('state = unknown (KHONG mismatch)', r.state === 'unknown', JSON.stringify(r));
  }

  console.log('\n=== 3. Ca 2 nha cung cap DONG THUAN LECH that (ca 2 cung bao DE) -> mismatch that ===');
  {
    const guard = installMock({
      [IFCONFIG]: { status: 200, body: JSON.stringify({ ip: '1.2.3.4', country_iso: 'DE' }) },
      [COUNTRYIS]: { status: 200, body: JSON.stringify({ ip: '1.2.3.4', country: 'DE' }) },
    });
    const r = await guard.check('KR', { force: true });
    check('state = mismatch (that su lech, ca 2 dong thuan)', r.state === 'mismatch', JSON.stringify(r));
  }

  console.log('\n=== 4. ifconfig.co bi chan (tra trang Cloudflare, khong phai JSON) -> fallback dung country.is ===');
  {
    const guard = installMock({
      [IFCONFIG]: { status: 200, body: '<!DOCTYPE html><html>Just a moment...</html>' },
      [COUNTRYIS]: { status: 200, body: JSON.stringify({ ip: '213.177.237.73', country: 'KR' }) },
    });
    const r = await guard.check('KR', { force: true });
    check('state = ok (dung ket qua tu country.is)', r.state === 'ok', JSON.stringify(r));
  }

  console.log('\n=== 5. Ca 2 nha cung cap deu loi/timeout -> unknown ===');
  {
    const guard = installMock({ [IFCONFIG]: 'error', [COUNTRYIS]: 'timeout' });
    const r = await guard.check('KR', { force: true });
    check('state = unknown', r.state === 'unknown', JSON.stringify(r));
  }

  console.log('\n=== 6. Profile khong co nhan quoc gia -> skip, khong goi mang ===');
  {
    const guard = installMock({});
    const r = await guard.check('', { force: true });
    check('state = skip', r.state === 'skip', JSON.stringify(r));
  }

  console.log('\n=== 7. Alias UK -> GB: profile (UK) chay tren IP GB that -> ok (khong bao oan) ===');
  {
    const guard = installMock({
      [IFCONFIG]: { status: 200, body: JSON.stringify({ ip: '5.6.7.8', country_iso: 'GB' }) },
      [COUNTRYIS]: { status: 200, body: JSON.stringify({ ip: '5.6.7.8', country: 'GB' }) },
    });
    const r = await guard.check('UK', { force: true });
    check('state = ok (UK == GB)', r.state === 'ok', JSON.stringify(r));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
