// test/session-watch.test.js — Kiem chung checkLoginStateStable(): ket luan "KHACH" phai ON
// DINH moi duoc tin.
//
// BOI CANH THAT (2026-07-31): nguoi dung bao nut "🔑 Kiem tra dang nhap" noi DA DANG NHAP,
// nhung bam ▶ Chay thi bao che do KHACH; dung roi chay lai ~2 lan la binh thuong.
// Nguyen nhan: BAT DOI XUNG giua 2 luong —
//   • verifyProfileLogin() (nut 🔑) doc trang toi da 12 lan x 2s = 24s.
//   • Luong crawl chi doc MOT LAN roi chot luon -> trung nhip TikTok hydrate (nut "Log in"
//     hien thoang qua truoc khi cookie duoc ap) la ket luan KHACH va DUNG HAN ca profile.
// "2 lan thi duoc" khop voi hien tuong phu thuoc thoi diem: lan sau trang co cache, hydrate
// nhanh hon nen khong kip lo nut Log in.
//
// Cach xu ly (theo dung triet ly ip-guard "2 nha cung cap phai dong thuan" va sheet-lock
// "chi chan khi CHAC CHAN"): tin ngay tin TOT, bat tin XAU phai on dinh 3 lan lien tiep.
// Chay: node test/session-watch.test.js
'use strict';

const path = require('path');
const Module = require('module');

const SW = path.join(__dirname, '..', 'src', 'crawler', 'session-watch.cjs');
const swPath = require.resolve(SW);
const browserPath = require.resolve(path.join(__dirname, '..', 'src', 'browser.cjs'));

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// Mock browser.cjs de session-watch require duoc ma khong keo ca Playwright vao.
require.cache[browserPath] = new Module(browserPath, null);
require.cache[browserPath].filename = browserPath;
require.cache[browserPath].loaded = true;
require.cache[browserPath].exports = { markSessionVerified() {} };

const { checkLoginStateStable } = require(swPath);

// page gia: tra ve lan luot cac trang thai trong `script` (lan cuoi lap mai).
// `script` la mang cac gia tri 'guest' | 'logged-in' | 'unknown'.
function makePage(script) {
  let i = 0;
  const reads = [];
  return {
    reads,
    async evaluate() {
      const s = script[Math.min(i, script.length - 1)];
      i++;
      reads.push(s);
      // Mo phong dung cach checkLoginState doc DOM: tra ve chinh chuoi trang thai.
      return s;
    },
  };
}

// Dung cua so/nhip NHO trong test cho nhanh (logic khong doi).
const FAST = { windowMs: 1200, gapMs: 40 };

(async () => {
  console.log('\n=== 1. Luon la KHACH -> chot "guest" (can 3 lan doc lien tiep) ===');
  {
    const page = makePage(['guest']);
    const s = await checkLoginStateStable(page, FAST);
    check('ket luan guest', s === 'guest', s);
    check('doc it nhat 3 lan (khong chot ngay lan 1)', page.reads.length >= 3, `so lan doc=${page.reads.length}`);
  }

  console.log('\n=== 2. BUG THAT: nut Log in NHAY 1 nhip roi mat (hydrate) -> PHAI ra logged-in ===');
  {
    const page = makePage(['guest', 'logged-in']);
    const s = await checkLoginStateStable(page, FAST);
    check('KHONG bao khach oan -> logged-in', s === 'logged-in', s);
  }

  console.log('\n=== 3. Nhay 2 nhip roi moi dang nhap (van chua du 3 lien tiep) -> logged-in ===');
  {
    const page = makePage(['guest', 'guest', 'logged-in']);
    const s = await checkLoginStateStable(page, FAST);
    check('logged-in (2 lan chua du nguong 3)', s === 'logged-in', s);
  }

  console.log('\n=== 4. guest, unknown xen vao, roi guest lien tiep -> dem lai tu dau, cuoi cung guest ===');
  {
    const page = makePage(['guest', 'unknown', 'guest', 'guest', 'guest']);
    const s = await checkLoginStateStable(page, FAST);
    check('ket luan guest', s === 'guest', s);
  }

  console.log('\n=== 5. Luon "unknown" (giao dien khong dung xong) -> "unknown", KHONG chan crawl ===');
  {
    const page = makePage(['unknown']);
    const s = await checkLoginStateStable(page, FAST);
    check('unknown (khong chan)', s === 'unknown', s);
  }

  console.log('\n=== 6. Da dang nhap ngay tu dau -> tra ve NGAY sau 1 lan doc ===');
  {
    const page = makePage(['logged-in']);
    const s = await checkLoginStateStable(page, FAST);
    check('logged-in', s === 'logged-in', s);
    check('chi doc 1 lan (tin tot tin ngay)', page.reads.length === 1, `so lan doc=${page.reads.length}`);
  }

  console.log('\n=== 7. Bam Dung giua luc dang doc lai -> tra "unknown" NGAY, khong cho het cua so ===');
  {
    const page = makePage(['guest']);
    const stop = { requested: true };
    const t0 = Date.now();
    const s = await checkLoginStateStable(page, { ...FAST, stop });
    const ms = Date.now() - t0;
    check('tra unknown khi dang dung', s === 'unknown', s);
    check('khong doc DOM lan nao (thoat ngay)', page.reads.length === 0, `so lan doc=${page.reads.length}`);
    check('thoat tuc thi (<100ms)', ms < 100, `${ms}ms`);
  }

  console.log('\n=== 8. Dung giua chung (dang guest) -> khong ket luan guest ===');
  {
    const page = makePage(['guest']);
    const stop = { requested: false };
    setTimeout(() => { stop.requested = true; }, 50);
    const s = await checkLoginStateStable(page, { ...FAST, stop });
    check('unknown (khong chot guest khi da yeu cau dung)', s === 'unknown', s);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
