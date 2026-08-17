'use strict';
// ════════════════════════════════════════════════════════════════════════════════════════
// CHOT LUONG LUU SESSION (sua 2026-08-17)
//
// LOI THAT, do tren may nguoi dung: MOT phien chay ghi 10.111 dong "BO QUA luu session",
// trong do 10.098 dong cung MOT ly do duy nhat — thieu `s_v_web_id`. Hau qua nhin thay
// ngay o ngay sua file: 3/6 profile co `session.state.json` dung im 5–7 NGAY.
//
//   profile-A   10/08 09:06   -> 7 ngay
//   profile-B     10/08 18:20   -> 7 ngay
//   profile-C   12/08 19:10   -> 5 ngay
//
// Nghia la cookie MOI cua TikTok khong he duoc ghi xuong dia ca tuan; moi lan khoi dong lai
// app deu nap phien cu — dung con duong dan toi che do KHACH ma QD-04 sinh ra de chan.
//
// Goc re: chi can MOT cookie trong danh sach 19 cai bi thieu la chan TOAN BO luot luu. Ma
// `s_v_web_id` khong phai cookie xac thuc, cung khong phai cookie dinh tuyen.
//
// ⚠ Test TRICH DUNG MA NGUON tu browser.cjs roi chay — KHONG chep logic sang test (QD-10).
// Khong `require('./src/browser.cjs')` truc tiep vi file do keo theo playwright + electron.
// ════════════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'src', 'browser.cjs');
const src = fs.readFileSync(SRC_PATH, 'utf8');

let failed = 0, passed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${extra ? '  →  ' + extra : ''}`); }
}

// ── Trich ham theo dem ngoac (cung cach vpn-run-lock.test.js dang dung) ────────────────
function extractFn(name) {
  let at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`Khong tim thay function ${name}() trong browser.cjs`);
  if (/async\s+$/.test(src.slice(Math.max(0, at - 8), at))) at = src.lastIndexOf('async', at);
  const lp = src.indexOf('(', src.indexOf(`function ${name}(`));
  let pd = 0, i0 = lp;
  for (; i0 < src.length; i0++) {
    if (src[i0] === '(') pd++;
    else if (src[i0] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', i0);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`Khong dong ngoac cho ${name}()`);
}

function extractConst(name) {
  const at = src.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`Khong tim thay const ${name} trong browser.cjs`);
  const end = src.indexOf('\n];', at);
  if (end > 0 && end - at < 900) return src.slice(at, end + 3);
  const line = src.indexOf('\n', at);
  return src.slice(at, line);
}

// Dung day du 3 hang so + 3 ham THAT tu ma nguon.
const harness = [
  extractConst('_CRITICAL_COOKIES'),
  extractConst('_CARRY_COOKIES'),
  extractConst('_AUTH_COOKIES'),
  extractFn('_tiktokCookieMap'),
  extractFn('_sessionRegression'),
  extractFn('_mergeCarryCookies'),
  'module.exports = { _CRITICAL_COOKIES, _CARRY_COOKIES, _AUTH_COOKIES,',
  '  _tiktokCookieMap, _sessionRegression, _mergeCarryCookies };',
].join('\n\n');

const T = (() => {
  const m = { exports: {} };
  try { new Function('module', 'exports', harness)(m, m.exports); }
  catch (e) { console.error('!! Khong nap duoc ma trich tu browser.cjs:', e.message); process.exit(1); }
  return m.exports;
})();

const C = (name, value, extra) => Object.assign(
  { name, value: value || 'v', domain: '.tiktok.com', path: '/' }, extra || {});

console.log('\n═══ 1. Danh sach cookie da duoc TACH dung ═══');
ok(!T._CRITICAL_COOKIES.includes('s_v_web_id'),
  's_v_web_id KHONG con trong nhom chan luu');
ok(!T._CRITICAL_COOKIES.includes('passport_fe_beating_status'),
  'passport_fe_beating_status KHONG con trong nhom chan luu');
ok(T._CARRY_COOKIES.includes('s_v_web_id') && T._CARRY_COOKIES.includes('passport_fe_beating_status'),
  'ca hai nam trong nhom MANG THEO');
for (const n of ['sessionid', 'sid_guard', 'tt-target-idc', 'store-idc', 'store-country-code']) {
  ok(T._CRITICAL_COOKIES.includes(n), `cookie cot loi "${n}" van duoc bao ve`);
}
ok(T._AUTH_COOKIES.length === T._CRITICAL_COOKIES.length + T._CARRY_COOKIES.length,
  '_AUTH_COOKIES = hop cua 2 nhom (cho cho khac dung khong bi hut cookie)');

console.log('\n═══ 2. DUNG CANH DA GAY LOI: chi thieu s_v_web_id ═══');
{
  // Dung y nguyen canh tren may nguoi dung: file cu co s_v_web_id, Chromium khong sinh lai.
  const prev = { cookies: [C('sessionid', 'abc'), C('sid_guard'), C('tt-target-idc', 'alisg'),
    C('store-idc'), C('store-country-code', 'gb'), C('s_v_web_id', 'verify_xyz')] };
  const fresh = [C('sessionid', 'abc'), C('sid_guard'), C('tt-target-idc', 'alisg'),
    C('store-idc'), C('store-country-code', 'gb')];
  const why = T._sessionRegression(prev, fresh);
  ok(why === null, 'CHO PHEP luu (truoc day bi chan 10.098 lan/phien)',
    why ? `van tra ve: "${why}"` : '');

  const merged = T._mergeCarryCookies(prev.cookies, fresh);
  const m = T._tiktokCookieMap(merged);
  ok(m.has('s_v_web_id') && m.get('s_v_web_id') === 'verify_xyz',
    's_v_web_id van duoc MANG THEO xuong file — khong mat gi');
  ok(m.get('sessionid') === 'abc' && merged.length === 6,
    'du 6 cookie, khong nhan ban, khong nuot cookie moi');
}

console.log('\n═══ 3. QD-04 VAN CON RANG: cookie cot loi mat thi phai CHAN ═══');
{
  const prev = { cookies: [C('sessionid', 'abc'), C('tt-target-idc', 'alisg'), C('store-idc')] };
  const why = T._sessionRegression(prev, [C('sessionid', 'abc')]);
  ok(typeof why === 'string' && /tt-target-idc|store-idc/.test(why),
    'mat cookie DINH TUYEN -> van chan luu (dung su co goc cua QD-04)', String(why));
}
{
  const prev = { cookies: [C('sessionid', 'abc'), C('sid_guard')] };
  const why = T._sessionRegression(prev, [C('sessionid', 'abc')]);
  ok(typeof why === 'string' && /sid_guard/.test(why), 'mat cookie XAC THUC -> van chan luu', String(why));
}
{
  const prev = { cookies: [C('sessionid', 'abc')] };
  ok(/sessionid/.test(String(T._sessionRegression(prev, [C('sid_guard')]))),
    'mat han sessionid -> van chan luu');
}
{
  // Dang nhap tai khoan KHAC luon duoc phep ghi — neu chan thi phien moi khong bao gio xuong dia.
  const prev = { cookies: [C('sessionid', 'CU'), C('tt-target-idc'), C('store-idc')] };
  ok(T._sessionRegression(prev, [C('sessionid', 'MOI')]) === null,
    'doi tai khoan (sessionid khac) -> van CHO luu, khong doi du cookie');
}

console.log('\n═══ 4. Mang theo phai co GIOI HAN — khong bua bai ═══');
{
  const prev = [C('sessionid', 'CU'), C('sid_guard', 'CU'), C('s_v_web_id', 'x')];
  const merged = T._mergeCarryCookies(prev, [C('sessionid', 'MOI')]);
  const m = T._tiktokCookieMap(merged);
  ok(m.get('sessionid') === 'MOI', 'KHONG bao gio de cookie cu de len cookie moi');
  ok(!m.has('sid_guard'), 'KHONG mang theo cookie ngoai danh sach (phien cu khong song day)');
  ok(m.has('s_v_web_id'), 'chi mang theo dung cookie trong _CARRY_COOKIES');
}
{
  const past = Math.floor(Date.now() / 1000) - 86400;
  const merged = T._mergeCarryCookies([C('s_v_web_id', 'cu', { expires: past })], [C('sessionid')]);
  ok(!T._tiktokCookieMap(merged).has('s_v_web_id'), 'KHONG mang theo cookie da HET HAN');
}
{
  const future = Math.floor(Date.now() / 1000) + 86400;
  const merged = T._mergeCarryCookies([C('s_v_web_id', 'moi', { expires: future })], [C('sessionid')]);
  ok(T._tiktokCookieMap(merged).has('s_v_web_id'), 'cookie con han thi VAN mang theo');
  const sess = T._mergeCarryCookies([C('s_v_web_id', 'x', { expires: -1 })], [C('sessionid')]);
  ok(T._tiktokCookieMap(sess).has('s_v_web_id'), 'cookie phien (expires = -1) khong bi coi la het han');
}
{
  const merged = T._mergeCarryCookies(
    [Object.assign(C('s_v_web_id', 'x'), { domain: '.example.com' })], [C('sessionid')]);
  ok(!merged.some(c => c.name === 's_v_web_id'), 'KHONG mang theo cookie cua domain khac');
}
{
  ok(T._mergeCarryCookies(null, [C('sessionid')]).length === 1, 'khong co file cu -> tra nguyen bo moi');
  ok(T._mergeCarryCookies([], []).length === 0, 'ca hai rong -> khong ném loi');
  const dup = T._mergeCarryCookies([C('s_v_web_id', 'cu')], [C('s_v_web_id', 'moi')]);
  ok(dup.length === 1 && dup[0].value === 'moi', 'bo moi DA CO thi khong mang theo ban cu (khong nhan doi)');
}

console.log('\n═══ 5. Ma nguon that phai dung ham nay khi ghi file ═══');
{
  const noComment = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/_writeStateAtomic\(\s*file\s*,\s*JSON\.stringify\(\{\s*cookies:\s*merged/.test(noComment),
    '_saveSession ghi bo cookie DA TRON, khong ghi bo tho');
  ok(/const\s+merged\s*=\s*_mergeCarryCookies\(/.test(noComment),
    '_saveSession that su goi _mergeCarryCookies()');
  ok(!/const lost = _AUTH_COOKIES/.test(noComment),
    'chot chan luu KHONG con dung _AUTH_COOKIES (danh sach gop) nua');
}

console.log(`\n${failed ? '❌' : '✅'} session-save-guard: ${passed} dat, ${failed} truot\n`);
process.exit(failed ? 1 : 0);
