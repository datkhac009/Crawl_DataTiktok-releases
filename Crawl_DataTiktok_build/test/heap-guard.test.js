'use strict';
// ════════════════════════════════════════════════════════════════════════════════════════
// CHOT AN TOAN BO NHO — tu khoi dong lai TRUOC khi dung tran 4GB (2026-08-17)
//
// SU CO THAT: app tu tat khi treo may qua dem, 4 lan trong 9 ngay. Event Log: `c0000602`
// (STATUS_FAIL_FAST_EXCEPTION — tien trinh TU ket lieu, khong phai bi Windows giet).
// Duong cong trong log cua chinh app:
//     00:53  heap  235/ 256 MB      04:23  heap 2245/3235 MB
//     07:03  heap 3216/4072 MB  ← sat tran      07:04:43  ← CHET
//
// ⚠ DA DO: KHONG nang duoc tran 4GB cua tien trinh main Electron (4 cach, deu ra 4096).
// Nen cach duy nhat la chan TRUOC. Test nay khoa lai hanh vi do.
//
// ⚠ Trich MA NGUON THAT tu main.js roi chay voi do gia — khong chep logic sang test (QD-10).
// Khong require('../main.js') duoc vi no keo theo electron + dung app ngay khi nap.
// ════════════════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

let failed = 0, passed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${extra ? '  →  ' + extra : ''}`); }
}

function extractFn(name) {
  let at = SRC.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`Khong tim thay function ${name}() trong main.js`);
  if (/async\s+$/.test(SRC.slice(Math.max(0, at - 8), at))) at = SRC.lastIndexOf('async', at);
  const lp = SRC.indexOf('(', SRC.indexOf(`function ${name}(`));
  let pd = 0, i0 = lp;
  for (; i0 < SRC.length; i0++) {
    if (SRC[i0] === '(') pd++;
    else if (SRC[i0] === ')') { pd--; if (pd === 0) break; }
  }
  const open = SRC.indexOf('{', i0);
  let d = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') d++;
    else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error(`Khong dong ngoac cho ${name}()`);
}
function extractLine(re, what) {
  const m = SRC.match(re);
  if (!m) throw new Error(`Khong tim thay ${what} trong main.js`);
  return m[0];
}
// Than cua ipcMain.handle('resume-take', () => { ... }) → doi thanh mot ham co ten.
function extractResumeHandler() {
  const at = SRC.indexOf("ipcMain.handle('resume-take'");
  if (at < 0) throw new Error("Khong tim thay handler 'resume-take'");
  const open = SRC.indexOf('{', SRC.indexOf('=>', at));
  let d = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') d++;
    else if (SRC[i] === '}') { d--; if (d === 0) return 'function resumeTake() ' + SRC.slice(open, i + 1); }
  }
  throw new Error("Khong dong ngoac cho handler 'resume-take'");
}

const CONSTS = [
  extractLine(/const HEAP_RESTART_RATIO = [^\n]+/, 'HEAP_RESTART_RATIO'),
  extractLine(/const RESUME_KEY = [^\n]+/, 'RESUME_KEY'),
  extractLine(/const RESUME_MAX_AGE_MS = [^\n]+/, 'RESUME_MAX_AGE_MS'),
  extractLine(/const DRAIN_MAX_MS = [^\n]+/, 'DRAIN_MAX_MS'),
  'let _restartingForHeap = false;',
].join('\n');

// Dung ban do voi DONG HO AO: setTimeout gia goi lai ngay va day dong ho len, nen vong cho
// xa chay tuc thi ma tran THOI GIAN that (DRAIN_MAX_MS) van duoc kiem dung nhu ma nguon.
function build(fakes, { heapLimit = 4096 } = {}) {
  let clock = 1_000_000;
  const src = [CONSTS, extractFn('_heapLimitMB'), extractFn('_checkHeapCeiling'),
    extractFn('_gracefulRestart'), extractResumeHandler(),
    'module.exports = { _checkHeapCeiling, _gracefulRestart, resumeTake, HEAP_RESTART_RATIO, DRAIN_MAX_MS, RESUME_MAX_AGE_MS };',
  ].join('\n\n');
  const m = { exports: {} };
  const fakeDate = { now: () => clock };
  const fakeSetTimeout = (fn, ms) => { clock += (ms || 0); return setImmediate(fn); };
  const fakeRequire = (n) => (n === 'v8'
    ? { getHeapStatistics: () => ({ heap_size_limit: heapLimit * 1048576 }) }
    : require(n));
  new Function('module', 'exports', 'require', 'crawler', 'store', 'sheets', 'history',
    'app', 'send', 'console', 'setTimeout', 'Date', src)(
    m, m.exports, fakeRequire, fakes.crawler, fakes.store, fakes.sheets, fakes.history,
    fakes.app, fakes.send, fakes.console || { log() {}, warn() {}, error() {} },
    fakeSetTimeout, fakeDate);
  return Object.assign(m.exports, { _clock: () => clock });
}

function makeFakes({ running = ['p1', 'p2'], neverDrains = false } = {}) {
  const ev = [];
  let alive = running.slice();
  const storeMap = new Map();
  return {
    ev, storeMap,
    crawler: {
      runningIds: () => { ev.push('runningIds'); return alive.slice(); },
      softStopProfile: (id) => { ev.push('soft:' + id); if (!neverDrains) alive = alive.filter((x) => x !== id); },
      stopProfile: (id) => { ev.push('HARD:' + id); alive = alive.filter((x) => x !== id); },
      stopAll: async () => { ev.push('stopAll'); alive = []; },
      isAnyRunning: () => alive.length > 0,
    },
    store: {
      get: (k) => storeMap.get(k),
      set: (k, v) => { ev.push('store.set:' + k); storeMap.set(k, v); },
      delete: (k) => { ev.push('store.delete:' + k); storeMap.delete(k); },
    },
    sheets: { flushAll: async () => { ev.push('flushSheet'); } },
    history: { flush: () => { ev.push('flushHistory'); } },
    app: { relaunch: () => ev.push('relaunch'), exit: (c) => ev.push('exit:' + c) },
    send: (ch, p) => ev.push('send:' + (p && p.status)),
  };
}

(async () => {

console.log('\n═══ 1. Nguong: duoi tran thi TUYET DOI khong duoc dong vao ═══');
{
  const f = makeFakes(); const T = build(f);
  T._checkHeapCeiling(2000);            // 49% cua 4096
  ok(f.ev.length === 0, 'heap 2000/4096 (49%) → khong lam gi ca', f.ev.join(','));
  T._checkHeapCeiling(2900);            // 70.8% — ngay DUOI nguong 72%
  ok(f.ev.length === 0, 'heap 2900/4096 (71%) → van khong lam gi (sat nguong nhung chua toi)', f.ev.join(','));
}

console.log('\n═══ 2. Vuot nguong → khoi dong lai, DUNG THU TU ═══');
{
  const f = makeFakes({ running: ['p1', 'p2', 'p3'] }); const T = build(f);
  T._checkHeapCeiling(3000);            // 73.2% > 72%
  await new Promise((r) => setTimeout(r, 60));
  const i = (s) => f.ev.indexOf(s);
  ok(i('relaunch') >= 0 && i('exit:0') >= 0, 'co khoi dong lai that', f.ev.join(','));
  ok(i('store.set:resume_profiles') < i('soft:p1'),
    'GHI danh sach profile TRUOC khi dung — dung sau thi runningIds() da rong, mat sach', f.ev.join(','));
  ok(f.storeMap.get('resume_profiles').ids.join(',') === 'p1,p2,p3',
    'ghi dung ca 3 profile dang chay');
  ok(i('flushSheet') >= 0 && i('flushHistory') >= 0, 'co xa Sheet va lich su');
  ok(i('flushSheet') < i('relaunch') && i('flushHistory') < i('relaunch'),
    'xa XONG roi moi khoi dong lai — nguoc lai la mat du lieu dang cho');
  ok(i('relaunch') < i('exit:0'), 'relaunch() truoc exit(0) — nguoc lai thi app tat han, khong mo lai');
}

console.log('\n═══ 3. Phai dung MEM — khong duoc vut hang doi da quet ═══');
{
  const f = makeFakes({ running: ['p1', 'p2'] }); const T = build(f);
  T._checkHeapCeiling(4000);
  await new Promise((r) => setTimeout(r, 60));
  ok(f.ev.includes('soft:p1') && f.ev.includes('soft:p2'), 'goi softStopProfile cho tung profile');
  ok(!f.ev.some((e) => e.startsWith('HARD:')), 'KHONG dung cung — se mat sound da quet chua dem (QD-11)');
  ok(!f.ev.includes('stopAll'), 'xa kip thi khong can den stopAll()');
}

console.log('\n═══ 4. Mot profile KET khong duoc giu app toi luc OOM that ═══');
{
  const f = makeFakes({ running: ['p1'], neverDrains: true }); const T = build(f);
  T._checkHeapCeiling(4000);
  await new Promise((r) => setTimeout(r, 120));
  ok(f.ev.includes('stopAll'), 'het tran cho → dung CUNG phan con lai', f.ev.join(','));
  ok(f.ev.includes('relaunch'), 'van khoi dong lai duoc, khong treo vinh vien');
  ok(T.DRAIN_MAX_MS === 5 * 60 * 1000, `tran cho xa = 5 phut (thuc te: ${T.DRAIN_MAX_MS}ms)`);
}

console.log('\n═══ 5. Khong duoc khoi dong lai HAI lan ═══');
{
  const f = makeFakes(); const T = build(f);
  T._checkHeapCeiling(4000);
  T._checkHeapCeiling(4050);
  T._checkHeapCeiling(4090);
  await new Promise((r) => setTimeout(r, 80));
  ok(f.ev.filter((e) => e === 'relaunch').length === 1,
    'goi 3 lan lien tiep van chi khoi dong lai DUNG 1 lan', f.ev.join(','));
}

console.log('\n═══ 6. Tran heap doc DONG — khong cam cung 4096 ═══');
{
  const f = makeFakes(); const T = build(f, { heapLimit: 8192 });
  T._checkHeapCeiling(3000);            // 36% cua 8192 → khong duoc chay
  ok(f.ev.length === 0, 'may co tran 8192 thi heap 3000 (36%) khong bi coi la nguy hiem', f.ev.join(','));
  const f2 = makeFakes(); const T2 = build(f2, { heapLimit: 8192 });
  T2._checkHeapCeiling(6000);           // 73%
  await new Promise((r) => setTimeout(r, 60));
  ok(f2.ev.includes('relaunch'), 'cung ti le 73% tren tran 8192 thi VAN chay');
}

console.log('\n═══ 7. Dau "cao tiep": lay MOT lan roi xoa ═══');
{
  const f = makeFakes(); const T = build(f);
  f.storeMap.set('resume_profiles', { ids: ['a', 'b'], at: T._clock() - 1000 });
  const first = T.resumeTake();
  ok(first.join(',') === 'a,b', 'lan dau tra ve dung danh sach');
  ok(!f.storeMap.has('resume_profiles'), 'XOA ngay trong cung loi goi');
  ok(T.resumeTake().length === 0, 'lan hai tra rong → nap lai giao dien (F5) khong bat profile 2 lan');
}
{
  const f = makeFakes(); const T = build(f);
  f.storeMap.set('resume_profiles', { ids: ['a'], at: T._clock() - 20 * 60 * 1000 });
  ok(T.resumeTake().length === 0, 'dau qua 15 phut → BO (mat dien qua dem, mo lai khong tu cao)');
  ok(!f.storeMap.has('resume_profiles'), 'dau cu van bi xoa, khong nam lai mai');
}
{
  const f = makeFakes(); const T = build(f);
  ok(T.resumeTake().length === 0, 'khong co dau → rong, khong ném loi');
  f.storeMap.set('resume_profiles', { ids: [], at: T._clock() });
  ok(T.resumeTake().length === 0, 'dau rong (khong profile nao dang chay) → rong');
}

console.log('\n═══ 8. Ma nguon: da noi day du vao app ═══');
{
  const noCmt = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(/_checkHeapCeiling\(mb\(m\.heapTotal\)\)/.test(noCmt),
    'nhip blackbox that su GOI _checkHeapCeiling — khong thi chot nay chet lam sao cung khong ai biet');
  ok(/ipcMain\.handle\('resume-take'/.test(noCmt), "co dang ky IPC 'resume-take'");
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  ok(/resumeTake:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('resume-take'\)/.test(pre),
    'preload.cjs co phoi resumeTake ra renderer');
  const rnd = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  ok(/api\.resumeTake\(\)/.test(rnd), 'renderer that su goi api.resumeTake()');
  ok(/startProfilesStaggered\(alive\)/.test(rnd),
    'renderer bat lai LAN LUOT (QD-21), khong bat o at');
}

console.log(`\n${failed ? '❌' : '✅'} heap-guard: ${passed} dat, ${failed} truot\n`);
process.exit(failed ? 1 : 0);

})();
