// test/module-refs.test.js — Moi ten dung dang `X.abc` PHAI duoc khai bao trong chinh file do.
//
// VI SAO CO FILE NAY (loi that, 2026-08-11, da phat hanh v0.1.69 roi moi phat hien):
// `main.js` dung `linkstore.` o 15 cho nhung KHONG he `require('./src/linkstore.cjs')`.
// Dong require nam trong ban nhap da bi `git checkout` xoa; luc lam lai thi khong them lai.
//
// Vi sao khong bi bat som:
//   • `node --check` chi bat CU PHAP, khong bat ReferenceError luc chay.
//   • Test hien co nap `linkstore.cjs` va `sheets.cjs` TRUC TIEP, khong bao gio nap `main.js`
//     (no `require('electron')`), nen khong cho nao cham vao loi.
//   • Kiem tham chieu cu chi soi renderer -> preload -> ten kenh IPC, khong soi dinh danh
//     cua chinh `main.js`.
//   • 12/15 cho dung deu nam trong `try/catch` hoac `.catch()` -> LOI BI NUOT IM LANG. Nang
//     nhat la vong dong bo dinh ky: lo~i moi vong, chi hien ra thanh "Doc lai Sheet loi".
//
// DECISIONS.md da ghi dung bai hoc nay ("Tin `node --check` la du cho renderer") nhung chi ap
// cho renderer. File nay ap cho TAT CA file cua app.
//
// Chay: node test/module-refs.test.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'main.js',
  'preload.cjs',
  'renderer/renderer.js',
  ...fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.cjs')).map(f => 'src/' + f),
  ...fs.readdirSync(path.join(ROOT, 'src/crawler')).filter(f => f.endsWith('.cjs')).map(f => 'src/crawler/' + f),
];

// Ten toan cuc hop le — KHONG phai module thieu require.
const GLOBALS = new Set([
  // Node
  'process', 'console', 'module', 'exports', 'require', 'global', 'Buffer', '__dirname', '__filename',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask',
  // Built-in
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy',
  'Reflect', 'Intl', 'BigInt', 'Function', 'ArrayBuffer', 'Uint8Array', 'TextEncoder', 'TextDecoder',
  'URL', 'URLSearchParams', 'AbortController',
  // Browser (renderer)
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'history',
  'performance', 'screen', 'alert', 'confirm', 'prompt', 'fetch', 'Element', 'HTMLElement',
  'Node', 'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'CSS', 'Image', 'Blob',
  'FileReader', 'DOMParser', 'XMLHttpRequest', 'WebSocket', 'crypto',
]);

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// Bo comment + noi dung chuoi/template, de dinh danh nam trong do khong bi tinh.
// Thay bang khoang trang cung do dai de so dong/cot khong lech (huu ich khi bao loi).
function scrub(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { const j = src.indexOf('\n', i); const e = j === -1 ? n : j; out += blank(src.slice(i, e)); i = e; continue; }
    if (c === '/' && c2 === '*') { const j = src.indexOf('*/', i + 2); const e = j === -1 ? n : j + 2; out += blank(src.slice(i, e)); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      out += q + blank(src.slice(i + 1, Math.max(i + 1, j - 1))) + (src[j - 1] === q ? q : '');
      i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

// Ten duoc KHAI BAO trong file (rong tay, tha lot hon la bao oan).
function declaredNames(s) {
  const d = new Set();
  const add = (t) => { for (const m of String(t).matchAll(/[A-Za-z_$][\w$]*/g)) d.add(m[0]); };
  // ── const/let/var — PHAI xu ly khai bao NHIEU BIEN mot dong ──
  // `let sidePage = null, helper = null;` : bat cach cu chi lay bien DAU TIEN nen `helper`
  // bi bao THIEU KHAI BAO oan (chinh bo kiem nay bao oan o crawler.cjs:744 luc moi viet).
  // Cach lam: lay tron danh sach khai bao toi dau `;` o DO SAU 0, tach theo dau phay o do sau
  // 0, roi voi moi manh chi lay phan TRUOC dau `=` (phan rang buoc). Cot yeu la khong lay
  // phan khoi tao: `const x = linkstore.all()` ma lay ca ve phai thi `linkstore` thanh "da
  // khai bao" -> bo kiem tu lam mu chinh minh, dung loi dang muon bat.
  for (const m of s.matchAll(/\b(?:const|let|var)\s+/g)) {
    let i = m.index + m[0].length, depth = 0, buf = '';
    while (i < s.length) {
      const ch = s[i];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
      else if (ch === ';' && depth === 0) break;
      buf += ch; i++;
    }
    let d2 = 0, piece = '';
    const pieces = [];
    for (const ch of buf) {
      if ('([{'.includes(ch)) d2++;
      else if (')]}'.includes(ch)) d2--;
      if (ch === ',' && d2 === 0) { pieces.push(piece); piece = ''; continue; }
      piece += ch;
    }
    pieces.push(piece);
    for (const p of pieces) {
      let d3 = 0, bind = '';
      for (let k = 0; k < p.length; k++) {
        const ch = p[k];
        if ('([{'.includes(ch)) d3++;
        else if (')]}'.includes(ch)) d3--;
        // `=` o do sau 0 = bat dau phan khoi tao -> dung lai. Bo qua ==, =>, >=, <=, !=
        if (ch === '=' && d3 === 0 && p[k + 1] !== '=' && p[k + 1] !== '>'
            && !'=!<>'.includes(p[k - 1] || '')) break;
        bind += ch;
      }
      add(bind);
    }
  }
  // function / class / generator
  for (const m of s.matchAll(/\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
  for (const m of s.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
  // tham so ham: (a, b = 1, { c }) =>   va   function f(a, b)
  for (const m of s.matchAll(/(?:function\s*\*?\s*[A-Za-z_$][\w$]*\s*)?\(([^()]*)\)\s*(?:=>|\{)/g)) add(m[1]);
  // arrow 1 tham so khong ngoac:  x => ...
  for (const m of s.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) d.add(m[1]);
  // catch (e)   /   for (const x of ...)   da phu boi luat tren
  for (const m of s.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
  // label doi tuong: `{ ten: ... }` khong phai khai bao, nhung phuong thuc shorthand thi co
  for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) d.add(m[1]);
  return d;
}

// Ten duoc DUNG nhu namespace:  `ten.abc`  (bo qua `a.ten.abc` — chi lay goc chuoi truy cap)
function usedNamespaces(s) {
  const used = new Map();   // ten -> so lan
  const lines = s.split('\n');
  for (let li = 0; li < lines.length; li++) {
    for (const m of lines[li].matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$]/g)) {
      const name = m[2];
      if (!used.has(name)) used.set(name, { count: 0, line: li + 1 });
      used.get(name).count++;
    }
  }
  return used;
}

// Ten do preload PHOI ra window cho renderer (`contextBridge.exposeInMainWorld('api', …)`).
// Doc THANG tu preload.cjs chu khong viet cung 'api': doi tren nay ma quen sua test thi
// renderer se bao thieu khai bao ngay, thay vi test im lang cho qua.
const EXPOSED = new Set(
  [...fs.readFileSync(path.join(ROOT, 'preload.cjs'), 'utf8')
      .matchAll(/exposeInMainWorld\(\s*['"]([A-Za-z_$][\w$]*)['"]/g)].map(m => m[1]),
);

console.log('\n=== Moi `X.abc` phai co X duoc khai bao trong cung file ===');
console.log(`   (preload phoi ra window: ${[...EXPOSED].join(', ') || '(khong co)'})`);
let totalMissing = 0;
for (const rel of FILES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const s = scrub(src);
  const declared = declaredNames(s);
  const used = usedNamespaces(s);
  const isRenderer = rel.startsWith('renderer/');
  const missing = [];
  for (const [name, info] of used) {
    if (declared.has(name) || GLOBALS.has(name)) continue;
    if (isRenderer && EXPOSED.has(name)) continue;   // window.api do preload phoi ra
    missing.push(`${name} (dong ${info.line}, ${info.count} cho)`);
  }
  totalMissing += missing.length;
  check(`${rel}`, missing.length === 0, missing.length ? '-> THIEU KHAI BAO: ' + missing.join(' · ') : '');
}

// ── Moi require('./...') phai tro tOI FILE CO THAT ──
// Kiem tinh o tren khong bat duoc truong hop require SAI DUONG DAN (ten dinh danh van duoc
// khai bao, chi la module khong ton tai) — loi do nem MODULE_NOT_FOUND ngay khi mo app.
console.log('\n=== Moi require tuong doi phai tro toi file co that ===');
{
  let bad = 0;
  for (const rel of FILES) {
    const dir = path.dirname(path.join(ROOT, rel));
    const s = scrub(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const m of s.matchAll(/require\(\s*['"](\.[^'"]*)['"]\s*\)/g)) {
      const target = path.resolve(dir, m[1]);
      const ok = fs.existsSync(target)
        || fs.existsSync(target + '.js') || fs.existsSync(target + '.cjs')
        || fs.existsSync(path.join(target, 'index.js'));
      if (!ok) { console.log(`   FAIL ${rel} -> require('${m[1]}') KHONG TON TAI`); bad++; fail++; }
    }
  }
  check('tat ca require tuong doi giai duoc', bad === 0, bad ? `${bad} duong dan sai` : '');
}

// ── Khang dinh RIENG cho dung loi da xay ra: main.js phai require linkstore ──
// Luat chung o tren da phu, nhung them khang dinh tuong minh de ai doc test la biet
// chuyen gi da xay ra, va de thong bao khi truot chi dung cho.
{
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const usesIt = /\blinkstore\s*\./.test(scrub(main));
  const requiresIt = /require\(\s*['"]\.\/src\/linkstore\.cjs['"]\s*\)/.test(main);
  check('main.js: dung linkstore. thi PHAI require linkstore.cjs (loi that v0.1.69)',
    !usesIt || requiresIt,
    usesIt && !requiresIt ? '-> main.js goi linkstore. ma khong require -> ReferenceError luc chay' : '');
}

console.log(`\n──────── ${pass} OK, ${fail} FAIL (${totalMissing} dinh danh thieu khai bao) ────────`);
process.exit(fail ? 1 : 0);
