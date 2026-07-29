// test/google-api-timeout.test.js — Xac nhan app KHONG BAO GIO treo vo han khi goi Google API.
//
// Sự cố thật (2026-07-28): httpRequest() trong google-api.cjs khong co timeout nao. Ket hop
// voi sheet-lock.cjs nam tren duong CHAN cua IPC 'profile-start', va renderer chay tuan tu
// (for...await) khi bam "Chay da chon" — 1 request bi treo (khong loi han, cung khong xong)
// lam CA VONG LAP dung yen: profile dau chay duoc, cac profile sau KHONG BAO GIO duoc thu.
//
// File nay kiem tra CA 2 LOP phong thu da them:
//   1. httpRequest() TU NO co timeout (khong qua mock — goi that toi 1 dia chi khong bao
//      gio phan hoi, xac nhan no THUC SU reject trong thoi gian gioi han).
//   2. withDeadline() — lop phong thu THU HAI dat o main.js, hoat dong DOC LAP voi (1): du
//      (1) co loi gi thi (2) van dam bao noi goi khong bao gio cho qua han.
// Chay: node test/google-api-timeout.test.js
'use strict';

const { httpRequest, withDeadline } = require('../src/google-api.cjs');

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

(async () => {
  console.log('=== 1. withDeadline: promise treo VINH VIEN -> van tra fallback dung han ===');
  {
    const hung = new Promise(() => {});   // KHONG BAO GIO resolve/reject — mo phong dung sự cố thật
    const t0 = Date.now();
    const r = await withDeadline(hung, 200, 'FALLBACK');
    const elapsed = Date.now() - t0;
    check('tra dung fallback', r === 'FALLBACK', 'nhan duoc: ' + r);
    check('tra ve DUNG HAN (khong cho promise treo)', elapsed < 1000, 'mat ' + elapsed + 'ms');
  }

  console.log('\n=== 2. withDeadline: promise xong SOM hon deadline -> tra ve gia tri THAT ===');
  {
    const nhanh = new Promise((resolve) => setTimeout(() => resolve('GIA_TRI_THAT'), 20));
    const r = await withDeadline(nhanh, 500, 'FALLBACK');
    check('tra ve gia tri that (khong bi fallback che mat)', r === 'GIA_TRI_THAT', 'nhan duoc: ' + r);
  }

  console.log('\n=== 3. withDeadline: nhieu loi goi CHONG NHAU (mo phong 5 profile bam Chay lien tiep) ===');
  {
    // Mo phong dung tinh huong that: profile 2 "treo", nhung nho withDeadline moi profile
    // van tra ket qua trong ~1s thay vi ca vong lap dung im vo han.
    const t0 = Date.now();
    const ketQua = [];
    for (let i = 0; i < 5; i++) {
      const gia = i === 1 ? new Promise(() => {}) : Promise.resolve('ok-' + i);   // profile #2 treo
      ketQua.push(await withDeadline(gia, 300, 'TIMEOUT'));
    }
    const elapsed = Date.now() - t0;
    check('ca 5 "profile" deu co ket qua (khong bi bo cuoc)', ketQua.length === 5);
    check('profile bi treo tra ve TIMEOUT, khong lam ket qua khac sai',
      JSON.stringify(ketQua) === JSON.stringify(['ok-0', 'TIMEOUT', 'ok-2', 'ok-3', 'ok-4']),
      JSON.stringify(ketQua));
    check('TONG thoi gian ~300ms (khong phai treo vo han)', elapsed < 1000, 'mat ' + elapsed + 'ms');
  }

  console.log('\n=== 4. httpRequest that (khong mock): goi toi dia chi KHONG BAO GIO phan hoi ===');
  {
    // 192.0.2.1 la dia chi danh rieng cho tai lieu/kiem thu (RFC 5737, TEST-NET-1) — dam
    // bao KHONG BAO GIO co may that o do tren bat ky mang nao, nen ket noi se treo (khong
    // co RST/loi tra ve ngay) cho toi khi timeout cua chinh code nay can thiep.
    const t0 = Date.now();
    let err = null;
    try {
      await httpRequest('GET', 'https://192.0.2.1/khong-ton-tai', { timeoutMs: 500 });
    } catch (e) { err = e; }
    const elapsed = Date.now() - t0;
    check('httpRequest TU REJECT (khong treo vo han)', !!err, err ? err.message : '(khong co loi)');
    check('bao dung la timeout', !!err && /timeout/i.test(err.message), err && err.message);
    // Cho du 5s vi may test co the cham hon (DNS/route), nhung PHAI < 1 lenh treo vo han.
    check('reject trong thoi gian hop ly (< 5s, khong phai treo vo han)', elapsed < 5000, 'mat ' + elapsed + 'ms');
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
