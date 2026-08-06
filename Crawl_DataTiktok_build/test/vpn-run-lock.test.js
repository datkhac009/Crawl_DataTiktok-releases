// test/vpn-run-lock.test.js — Khoa nut "Chay" trong luc app dang doi IP (QĐ-32, bo sung 2026-08-06).
//
// VI SAO CAN TEST NAY: ban dau viec cho 1 phut sau khi doi IP chi GHI DEM NGUOC vao dong trang
// thai. Nguoi dung thu o may minh va phat hien dung lo hong: *"khi bat lai HMA thi toi an Chay no
// van chay duoc luon"* — tuc viec cho chang ngan duoc gi, dung cai no sinh ra de ngan. Bug thuoc
// loai "UI khong phan anh dung rang buoc", chi bat duoc bang cach BAM THU, nen phai co test.
//
// CACH LAM: trich DUNG MA NGUON cua 4 ham quyet dinh trong renderer.js roi chay trong Chromium
// voi DOM that. KHONG chep lai logic sang day — chep la se lech am tham (bai hoc QĐ-10), va test
// se pass trong khi app that hong. Neu ai doi ten/xoa ham, buoc trich se bao loi ngay.
//
// Chay: node test/vpn-run-lock.test.js
'use strict';

const path = require('path');
const fs = require('fs');

const RENDERER = path.join(__dirname, '..', 'renderer', 'renderer.js');
const SRC = fs.readFileSync(RENDERER, 'utf8');

// Trich `function ten(...) { ... }` bang cach DEM NGOAC — regex khong lam duoc viec nay cho than
// ham co ngoac long nhau.
function extractFn(src, name) {
  let at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`Khong tim thay function ${name}() trong renderer.js`);
  // PHAI keo theo chu `async` phia truoc. Lan dau bo sot: `async function watchVpnTunnel` bi cat
  // thanh `function watchVpnTunnel` -> than ham co `await` -> SyntaxError, ca harness khong nap
  // duoc va bao "T is not defined" (thong bao cha lien quan gi den nguyen nhan).
  if (/async\s+$/.test(src.slice(Math.max(0, at - 8), at))) at = src.lastIndexOf('async', at);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`Ngoac khong dong cho function ${name}()`);
}

const FNS = ['vpnCooldownLeft', 'vpnRunLocked', 'applyVpnCooldown', 'vpnLockedMsg',
             'updateRunSelectedBtnState', 'watchVpnTunnel'].map(n => extractFn(SRC, n)).join('\n\n');

// DOM toi thieu dung nhu that: 3 hang profile (2 dang DUNG, 1 dang CHAY) + nut tong.
const PAGE = `<!doctype html><meta charset="utf-8">
<button class="btn btn-primary" id="runSelectedBtn">▶ Chạy ô đã chọn</button>
<span id="crawlStatusMsg"></span>
<table><tbody id="profileTableBody">
  <tr data-id="p1"><td><input type="checkbox" class="row-check" data-id="p1" checked></td>
    <td><button class="btn btn-sm btn-primary" data-act="run" data-id="p1">▶ Chạy</button></td></tr>
  <tr data-id="p2"><td><input type="checkbox" class="row-check" data-id="p2" checked></td>
    <td><button class="btn btn-sm btn-primary" data-act="run" data-id="p2">▶ Chạy</button></td></tr>
  <tr data-id="p3"><td><input type="checkbox" class="row-check" data-id="p3"></td>
    <td><button class="btn btn-sm" data-act="run" data-id="p3">■ Dừng</button></td></tr>
</tbody></table>`;

// Cac phu thuoc ma 4 ham tren doc tu pham vi module cua renderer.js.
const HARNESS = `
  const $ = (id) => document.getElementById(id);
  const runningSet = new Set(['p3']);        // p3 dang CHAY -> nut cua no la "■ Dừng"
  const getCheckedIds = () => [...document.querySelectorAll('#profileTableBody .row-check:checked')]
    .map(c => c.dataset.id);
  let _vpnCooldownUntil = 0;
  let _vpnRunLock = false;
  let _vpnLockReason = 'cycling';
  let _runningSelectedBatch = false;
  // Phu thuoc rieng cua watchVpnTunnel
  const VPN_COOLDOWN_MS = 60 * 1000;
  let _tunnelPrev = undefined;
  let _vpnCycling = false;
  let _tunnelFake = { up: false, address: null };
  const profileLogs = { p1: [], p2: [], p3: [] };
  const logs = [];
  const toasts = [];
  const api = { vpnTunnel: async () => _tunnelFake };
  const appendLog = (id, m) => logs.push(m);
  const toast = (m, k) => toasts.push({ m, k });
  ${FNS}
  // Cua so dieu khien cho test
  window.T = {
    setCooldown: (ms) => { _vpnCooldownUntil = ms ? Date.now() + ms : 0; },
    setRunLock: (v, reason) => { _vpnRunLock = v; if (reason) _vpnLockReason = reason; },
    setBatch: (v) => { _runningSelectedBatch = v; },
    setCycling: (v) => { _vpnCycling = v; },
    setRunning: (ids) => { runningSet.clear(); for (const i of ids) runningSet.add(i); },
    apply: () => applyVpnCooldown(),
    locked: () => vpnRunLocked(),
    left: () => vpnCooldownLeft(),
    msg: () => vpnLockedMsg(),
    updateGlobal: () => updateRunSelectedBtnState(),
    // Gia lap 1 nhip poll duong ham HMA
    tunnel: async (up, address) => {
      _tunnelFake = { up, address: address || null };
      await watchVpnTunnel();
      return { locked: vpnRunLocked(), left: vpnCooldownLeft(), reason: _vpnLockReason };
    },
    reset: () => {
      _tunnelPrev = undefined; _vpnCooldownUntil = 0; _vpnRunLock = false;
      _vpnCycling = false; _vpnLockReason = 'cycling';
      logs.length = 0; toasts.length = 0;
    },
    logs: () => logs.slice(),
    toasts: () => toasts.slice(),
    snap: () => {
      const rows = {};
      document.querySelectorAll('#profileTableBody button[data-act="run"]').forEach(b => {
        rows[b.dataset.id] = { text: b.textContent, disabled: b.disabled, title: b.title };
      });
      const g = $('runSelectedBtn');
      return { rows, global: { text: g.textContent, disabled: g.disabled } };
    },
  };
`;

let failed = 0;
function ok(cond, label, detail) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond ? '' : `  → that te: ${detail}`));
  if (!cond) failed++;
}

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(PAGE);
  await page.addScriptTag({ content: HARNESS });

  console.log('='.repeat(78));
  console.log('### KHONG co gi dang dien ra -> nut phai BINH THUONG');
  let s = await page.evaluate(() => { T.apply(); return T.snap(); });
  ok(s.rows.p1.text === '▶ Chạy' && !s.rows.p1.disabled, 'hang dang dung: nut "▶ Chạy", bam duoc', JSON.stringify(s.rows.p1));
  ok(s.rows.p3.text === '■ Dừng' && !s.rows.p3.disabled, 'hang dang chay: nut "■ Dừng", bam duoc', JSON.stringify(s.rows.p3));
  ok(await page.evaluate(() => T.locked() === false), 'vpnRunLocked() = false');

  console.log('\n### PHA 1 — DANG TAT/BAT LAI VPN (nguy hiem nhat: VPN dang TAT)');
  s = await page.evaluate(() => { T.setRunLock(true); T.apply(); return T.snap(); });
  ok(s.rows.p1.disabled && s.rows.p2.disabled, 'MOI nut "Chạy" bi KHOA', JSON.stringify(s.rows));
  ok(s.rows.p1.text === '⏳ đổi IP', 'nhan nut noi ro dang doi IP (khong co so vi khong biet truoc bao lau)', s.rows.p1.text);
  ok(!s.rows.p3.disabled && s.rows.p3.text === '■ Dừng',
    'nut "■ Dừng" VAN bam duoc — nguoi dung phai dung duoc profile khac trong luc cho', JSON.stringify(s.rows.p3));
  ok(s.global.disabled && s.global.text === '⏳ đổi IP', 'nut tong cung bi khoa', JSON.stringify(s.global));
  ok(await page.evaluate(() => T.msg().includes('IP THẬT')),
    'canh bao noi thang: chay luc nay se dung IP THAT', await page.evaluate(() => T.msg()));

  console.log('\n### PHA 2 — CHO IP MOI NGUOI, dem nguoc TREN NUT');
  s = await page.evaluate(() => { T.setRunLock(true); T.setCooldown(45000); T.apply(); return T.snap(); });
  ok(s.rows.p1.text === '⏳ 45s', 'nut hien so giay con lai', s.rows.p1.text);
  ok(s.rows.p1.disabled && s.global.disabled, 'van khoa trong luc dem nguoc', JSON.stringify(s.global));
  ok(s.global.text === '⏳ 45s', 'nut tong cung dem nguoc', s.global.text);
  ok(await page.evaluate(() => T.left() === 45), 'vpnCooldownLeft() tra dung 45');
  s = await page.evaluate(() => { T.setCooldown(9000); T.apply(); return T.snap(); });
  ok(s.rows.p1.text === '⏳ 9s', 'so giam theo thoi gian thuc', s.rows.p1.text);
  ok(await page.evaluate(() => T.msg().includes('9s') && T.msg().includes('đổi IP')),
    'thong bao khi bam nham noi ro con bao nhieu giay', await page.evaluate(() => T.msg()));

  console.log('\n### HET GIO -> nut phai TRA VE "Chạy" ngay (nguoi dung chot dung hanh vi nay)');
  s = await page.evaluate(() => { T.setCooldown(0); T.setRunLock(false); T.apply(); return T.snap(); });
  ok(s.rows.p1.text === '▶ Chạy' && !s.rows.p1.disabled, 'hang dung: mo khoa + tra lai nhan "▶ Chạy"', JSON.stringify(s.rows.p1));
  ok(s.global.text === '▶ Chạy ô đã chọn', 'nut tong tra lai nhan goc, KHONG ket o "⏳"', s.global.text);
  ok(await page.evaluate(() => T.locked() === false), 'vpnRunLocked() ve false');

  console.log('\n### HET HAN TU DONG (khong ai goi setCooldown(0)) — mocs qua khu phai tu het');
  s = await page.evaluate(() => { T.setCooldown(-5000); T.apply(); return T.snap(); });
  ok(s.rows.p1.text === '▶ Chạy' && !s.rows.p1.disabled,
    'moc da qua -> tu coi la het cho, khong khoa vinh vien', JSON.stringify(s.rows.p1));

  console.log('\n### updateRunSelectedBtnState() phai TON TRONG khoa, khong ghi de len no');
  // Day la bay that: ham nay duoc goi tu renderProfiles()/setRowRunning() rat nhieu lan. Neu no
  // khong biet ve khoa thi CHI CAN 1 lan ve lai bang giua luc cho la nut mo khoa tro lai.
  s = await page.evaluate(() => { T.setRunLock(true); T.setCooldown(30000); T.updateGlobal(); return T.snap(); });
  ok(s.global.disabled && s.global.text === '⏳ 30s',
    'goi updateRunSelectedBtnState() giua luc cho -> nut VAN khoa va van dem nguoc', JSON.stringify(s.global));
  s = await page.evaluate(() => { T.setBatch(true); T.setRunLock(false); T.setCooldown(0); T.updateGlobal(); return T.snap(); });
  ok(s.global.disabled, 'het cho nhung dang bat lan luot -> van khoa nhu cu (khong lam hong duong cu)', JSON.stringify(s.global));

  // ════════════════════════════════════════════════════════════════════════
  // NGUOI DUNG TU TAT/BAT HMA — dung loi ho bao 2 lan
  // ════════════════════════════════════════════════════════════════════════
  // Lan dau toi chi khoa nut trong handleFeedStarved(), tuc CHI khi APP tu doi IP. Nguoi dung tu
  // tay tat/bat HMA thi app khong biet gi -> nut Chay van sang. Ho gui anh: HMA "ON 00:00:02",
  // 5 profile da dung, ma ca 5 nut Chay lan nut tong deu sang. Yeu cau chot:
  // *"ke ca app tu dong hay la toi thi deu phai la khi bat lai HMA thi cac nut chay se bi disable
  // trong vong 59 giay"*.
  console.log('\n' + '='.repeat(78));
  console.log('### LAN POLL DAU chi LAY MOC — mo app luc HMA dang tat KHONG duoc khoa');
  // Bay that: coi lan doc dau tien la "VPN vua sap" thi may khong cai HMA (hoac dang tat) se bi
  // khoa nut ngay khi mo app, khong bam duoc gi.
  let r = await page.evaluate(async () => { T.reset(); return await T.tunnel(false, null); });
  ok(r.locked === false, 'HMA dang TAT luc mo app -> KHONG khoa (chi lay moc)', JSON.stringify(r));
  r = await page.evaluate(async () => await T.tunnel(false, null));
  ok(r.locked === false, 'van tat, khong doi -> van KHONG khoa', JSON.stringify(r));

  console.log('\n### MAY KHONG CAI HMA -> up:false mai mai, tuyet doi khong khoa');
  r = await page.evaluate(async () => {
    T.reset();
    for (let i = 0; i < 5; i++) await T.tunnel(false, null);
    return { locked: T.locked(), left: T.left() };
  });
  ok(r.locked === false && r.left === 0, 'poll 5 lan deu up:false -> khong sinh chuyen tiep nao', JSON.stringify(r));

  console.log('\n### NGUOI DUNG BAT HMA (tat -> bat) -> khoa + dem nguoc 60s');
  r = await page.evaluate(async () => {
    T.reset();
    await T.tunnel(false, null);              // moc: dang tat
    return await T.tunnel(true, '10.252.32.18');   // nguoi dung bam ON
  });
  ok(r.locked === true, 'bat HMA -> KHOA nut Chay', JSON.stringify(r));
  ok(r.left === 60, `dem nguoc dung 60s (that: ${r.left})`);
  let s2 = await page.evaluate(() => T.snap());
  ok(s2.rows.p1.text === '⏳ 60s' && s2.rows.p1.disabled, 'nut tung hang hien dem nguoc + bi khoa', JSON.stringify(s2.rows.p1));
  ok(s2.global.text === '⏳ 60s' && s2.global.disabled,
    'NUT "Chay o da chon" CUNG bi khoa — dung yeu cau "ca nut Chay tat ca cac o chon nua"', JSON.stringify(s2.global));
  ok(await page.evaluate(() => T.logs().some(m => /BẬT LẠI/.test(m))), 'co ghi log noi HMA vua bat lai');

  console.log('\n### NGUOI DUNG TAT HMA (bat -> tat) -> khoa ngay, nhan "VPN tat"');
  r = await page.evaluate(async () => {
    T.reset();
    await T.tunnel(true, '10.252.32.18');   // moc: dang bat
    return await T.tunnel(false, null);     // nguoi dung bam OFF
  });
  ok(r.locked === true, 'tat HMA -> KHOA ngay (bat profile luc nay la chay IP THAT)', JSON.stringify(r));
  ok(r.left === 0, 'khong dem nguoc — chua biet bao gio ho bat lai');
  ok(r.reason === 'vpn-off', 'ly do khoa = vpn-off', r.reason);
  s2 = await page.evaluate(() => T.snap());
  ok(s2.rows.p1.text === '⛔ VPN tắt', 'nhan nut phai la "VPN tat", KHONG phai "doi IP" (2 ca xu khac nhau)', s2.rows.p1.text);
  ok(await page.evaluate(() => T.msg().includes('IP THẬT')), 'canh bao noi thang se dung IP that');

  console.log('\n### TAT roi BAT (chu trinh day du) -> ket thuc bang dem nguoc 60s');
  r = await page.evaluate(async () => {
    T.reset();
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);
    // IP trong ĐUONG HAM (10.252.x.x, RFC 1918) — KHONG dung IP exit cong khai o day: sai ngu
    // nghia (adapter mang dia chi noi bo cua ham), va repo nay PUBLIC nen khong dua IP that vao.
    return await T.tunnel(true, '10.252.40.7');
  });
  ok(r.locked === true && r.left === 60, 'bat lai -> chuyen tu "VPN tat" sang dem nguoc 60s', JSON.stringify(r));
  ok(r.reason === 'cycling', 'ly do khoa doi ve cycling (co dem nguoc)', r.reason);

  console.log('\n### NOI LAI ma ADAPTER KHONG MAT — doi IP trong ham cung phai nhan ra');
  // Vi sao khong chi dung co `up`: neu HMA noi lai ma adapter khong bien mat thi `up` luon true,
  // se KHONG nhan ra lan noi lai. So ca DIA CHI moi bat duoc ca nay.
  r = await page.evaluate(async () => {
    T.reset();
    await T.tunnel(true, '10.252.32.18');          // moc
    return await T.tunnel(true, '10.252.40.7');    // noi lai, adapter con nguyen, IP ham doi
  });
  ok(r.locked === true && r.left === 60, 'IP trong duong ham doi -> van khoa + dem nguoc 60s', JSON.stringify(r));

  console.log('\n### KHONG DOI GI -> khong duoc dat lai dong ho (neu khong dem nguoc dung mai)');
  r = await page.evaluate(async () => {
    T.reset();
    await T.tunnel(false, null);
    await T.tunnel(true, '10.252.32.18');
    T.setCooldown(9000);                       // gia lap da dem nguoc gan xong
    await T.tunnel(true, '10.252.32.18');      // poll lai, khong co gi doi
    return { left: T.left() };
  });
  ok(r.left === 9, `poll lai khi khong co gi doi -> giu nguyen 9s, khong nhay ve 60s (that: ${r.left})`);

  console.log('\n### APP dang tu doi IP -> bo canh phai DUNG NGOAI (chi mot chu so huu)');
  r = await page.evaluate(async () => {
    T.reset();
    await T.tunnel(true, '10.252.32.18');
    T.setCycling(true);                        // handleFeedStarved dang chay
    T.setRunLock(true, 'cycling');
    await T.tunnel(false, null);               // VPN tat vi CHINH APP tat
    return { reason: T.locked() ? 'cycling-giu-nguyen' : 'da-mo-khoa', left: T.left() };
  });
  ok(r.reason === 'cycling-giu-nguyen' && r.left === 0,
    'app dang doi IP -> bo canh khong dat dem nguoc, de handleFeedStarved tu lo', JSON.stringify(r));

  console.log('\n### CANH BAO khi TAT HMA ma profile CON DANG CHAY');
  r = await page.evaluate(async () => {
    T.reset();
    T.setRunning(['p1', 'p3']);
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);
    return { toasts: T.toasts(), logs: T.logs() };
  });
  ok(r.toasts.some(t => /IP thật/i.test(t.m) && t.k === 'err'),
    'con profile chay ma VPN tat -> toast DO canh bao dung IP that', JSON.stringify(r.toasts));
  ok(r.logs.some(m => /2 profile ĐANG CHẠY/.test(m)),
    'log noi dung SO profile dang chay can dung ngay', JSON.stringify(r.logs));
  // Tra runningSet ve nhu ban dau cho cac buoc sau (neu co).
  await page.evaluate(() => T.setRunning(['p3']));

  await browser.close();

  console.log('\n' + '='.repeat(78));
  console.log('### KHANG DINH TREN MA NGUON (bat cac loi khong the thay bang DOM)');
  const fn = (n) => extractFn(SRC, n);
  ok(/vpnRunLocked\(\)/.test(fn('toggleProfile')),
    'toggleProfile() tu chan khi dang doi IP — khong chi dua vao `disabled` cua nut');
  ok(/vpnRunLocked\(\)/.test(fn('runSelected')), 'runSelected() cung tu chan');
  ok(/_vpnCancelRestart\s*=\s*true/.test(fn('stopProfileById')),
    'stopProfileById() HUY viec tu chay lai — de nut "■ Dừng" tren TUNG HANG cung huy duoc, '
    + 'khong chi rieng "Dừng đã chọn"');
  ok(!/_vpnCancelRestart\s*=\s*true/.test(fn('stopSelected')),
    'stopSelected() KHONG lap lai logic huy (mot cho duy nhat — QĐ-10)');
  const wait = fn('waitBeforeRestart');
  ok(/finally\s*\{[\s\S]*_vpnCooldownUntil\s*=\s*0/.test(wait),
    'waitBeforeRestart() mo khoa trong `finally` — bo sot la nut KET KHOA VINH VIEN khi bi huy giua chung');
  ok(/applyVpnCooldown\(\)/.test(wait), 'waitBeforeRestart() cap nhat nut moi giay (khong chi ghi dong trang thai)');
  const starved = fn('handleFeedStarved');
  ok(/finally\s*\{[\s\S]*_vpnRunLock\s*=\s*false/.test(starved),
    'handleFeedStarved() mo khoa trong `finally` — che moi duong `return` som (bi gioi han nhip, doi IP that bai)');
  ok(/_vpnRunLock\s*=\s*false[\s\S]*startProfilesStaggered/.test(starved),
    'mo khoa TRUOC khi tu bat lai tung profile — dung yeu cau "het 59s thi hien Chạy"');

  const watch = fn('watchVpnTunnel');
  ok(/api\.vpnTunnel\(\)/.test(watch) && !/api\.vpnStatus\(/.test(watch),
    'bo canh doc kenh RE (vpnTunnel: chi doc networkInterfaces), KHONG dung vpnStatus '
    + '(spawn VpnNM.exe + cho 600ms -> poll 2s/lan la 1800 tien trinh/gio)');
  ok(/_tunnelPrev === undefined/.test(watch),
    'lan poll dau chi LAY MOC — khong thi may dang tat HMA se bi khoa nut ngay khi mo app');
  ok(/if\s*\(_vpnCycling\)\s*return/.test(watch),
    'app dang tu doi IP thi bo canh dung ngoai (chi MOT chu so huu viec khoa)');
  ok(/startVpnWatcher\(\)/.test(fn('init')),
    'startVpnWatcher() duoc goi trong init() — khong thi ca tinh nang khong bao gio chay');
  ok(/if\s*\(_vpnWatcherOn\)\s*return/.test(fn('startVpnWatcher')),
    'startVpnWatcher() chan chay 2 bo dem — init() co the chay lai (ban dev bam 🔄 Reload), 2 '
    + 'interval cung ghi nut se lam dem nguoc nhay 2 giay');
  ok(!/_vpnAutoCycle/.test(fn('startVpnWatcher')) && !/_vpnAutoCycle/.test(watch),
    'bo canh chay BAT KE cong tac "Tu doi IP" — nguoi dung chot: "ke ca app tu dong hay la toi '
    + 'thi deu phai khoa 59 giay"');

  console.log(`\n${failed ? '❌' : '✅'} ${failed} khang dinh TRUOT`);
  console.log('\nDONE');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
