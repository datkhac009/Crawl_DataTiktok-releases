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
  // Bo QUA danh sach THAM SO truoc khi dem ngoac. Bat dau dem tu dau `{` DAU TIEN la sai voi
  // tham so mac dinh dang object: `function f(id, opts = {})` -> gap `{` roi `}` ngay trong
  // ngoac tron -> depth ve 0 -> "than ham" chi la mau `...opts = {}`, moi khang dinh tren than
  // ham do deu TRUOT trong khi ma nguon hoan toan dung (da bi lua that: 5 khang dinh truot oan).
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
  // Profile dang DUNG MEM (check not hang doi). setRowRunning doc bien nay de chon nhan nut
  // "■ Dừng" hay "⏹ Dừng ngay" -> thieu no la ReferenceError, test bao loi ngay (dung y do
  // cua cach trich ma nguon that: doi ten/them phu thuoc la test bat duoc, khong lech am tham).
  const _draining = new Set();
  const getCheckedIds = () => [...document.querySelectorAll('#profileTableBody .row-check:checked')]
    .map(c => c.dataset.id);
  let _vpnCooldownUntil = 0;
  let _vpnRunLock = false;
  let _vpnLockReason = 'cycling';
  let _runningSelectedBatch = false;
  // Phu thuoc rieng cua watchVpnTunnel
  const VPN_COOLDOWN_MS = 60 * 1000;
  let _tunnelPrev = undefined;
  let _tunnelFake = { up: false, address: null };
  let _vpnCycling = false;
  let _vpnDownGroup = [];
  const stopAllCalls = [];
  const groupRetries = [];
  // scheduleGroupRetry GIA — chi ghi lai lan goi. Ban that keo theo fireGroupRetry +
  // startProfilesStaggered, khong thuoc pham vi test nay (co test rieng o starve-restart).
  const scheduleGroupRetry = (ids, waitMs) => { groupRetries.push({ ids: [...ids], waitMs }); };
  const profileLogs = { p1: [], p2: [], p3: [] };
  const logs = [];
  const toasts = [];
  let _ipv6Fake = { risky: false };
  const api = {
    vpnTunnel: async () => _tunnelFake,
    vpnIpv6Risk: async () => _ipv6Fake,
    profilesStopAll: async () => { stopAllCalls.push([...runningSet]); runningSet.clear(); },
  };
  const appendLog = (id, m) => logs.push(m);
  const toast = (m, k) => toasts.push({ m, k });
  ${FNS}
  // Cua so dieu khien cho test
  window.T = {
    setCooldown: (ms) => { _vpnCooldownUntil = ms ? Date.now() + ms : 0; },
    setRunLock: (v, reason) => { _vpnRunLock = v; if (reason) _vpnLockReason = reason; },
    setBatch: (v) => { _runningSelectedBatch = v; },
    setRunning: (ids) => { runningSet.clear(); for (const i of ids) runningSet.add(i); },
    setIpv6: (v) => { _ipv6Fake = v; },
    setCycling: (v) => { _vpnCycling = v; },
    running: () => [...runningSet],
    stopAllCalls: () => stopAllCalls.slice(),
    groupRetries: () => groupRetries.slice(),
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
      _vpnLockReason = 'cycling'; _vpnCycling = false; _vpnDownGroup = [];
      logs.length = 0; toasts.length = 0;
      stopAllCalls.length = 0; groupRetries.length = 0;
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

  console.log('\n### CANH BAO khi TAT HMA ma profile CON DANG CHAY');
  r = await page.evaluate(async () => {
    T.reset();
    T.setRunning(['p1', 'p3']);
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);
    return { toasts: T.toasts(), logs: T.logs() };
  });
  // Toast chi noi NGAN; chi tiet (co IPv6 hay khong, dia chi nao) nam trong log 📄 vi toast bien
  // mat sau vai giay, khong doc kip cau dai.
  ok(r.toasts.some(t => /DỪNG HẾT 2 profile/.test(t.m) && t.k === 'err'),
    'VPN tat con profile chay -> toast DO, noi dang dung HET bao nhieu', JSON.stringify(r.toasts));
  ok(r.logs.some(m => /ĐANG DỪNG HẾT 2 profile/.test(m)),
    'log noi dung SO profile bi dung het', JSON.stringify(r.logs));

  // Hai ca can MUC KHAN CAP khac nhau — gop lai la bat nguoi dung tu doan:
  //   khong co IPv6 cong khai -> profile chi bi loi mang tam thoi
  //   CO IPv6 cong khai       -> duong ham HMA chi dinh tuyen IPv4, nen IPv6 di THANG ra internet
  //                              bang IP THAT (do that: lot trong 241ms) => dang LO NUOC THAT
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p3']);
    T.setIpv6({ risky: true, addresses: [{ iface: 'Ethernet', address: '2001:db8::1' }] });
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);
    return { logs: T.logs() };
  });
  ok(r.logs.some(m => /LỘ IP THẬT/.test(m) && m.includes('2001:db8::1')),
    'may CO IPv6 cong khai -> canh bao dang LO IP THAT, kem dia chi cu the', JSON.stringify(r.logs));
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p3']);
    T.setIpv6({ risky: false, addresses: [] });
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);
    return { logs: T.logs() };
  });
  ok(r.logs.some(m => /chỉ bị lỗi mạng/.test(m)) && !r.logs.some(m => /LỘ IP THẬT/.test(m)),
    'may DA TAT IPv6 -> noi ro chi la loi mang, KHONG bao dong oan', JSON.stringify(r.logs));

  // ════════════════════════════════════════════════════════════════════════
  // TAT HMA -> DUNG HET, khong chi canh bao (nguoi dung chot 2026-08-06)
  // ════════════════════════════════════════════════════════════════════════
  // *"khi toi tat HMA thi van thay cac profile chay... Tat HMA la dung het luon khong cho chay"*.
  // Canh bao la vo nghia khi ho TREO MAY: moi giay profile con chay la mot giay gui request bang
  // IP THAT.
  console.log('\n### TAT HMA -> DUNG HET profile (khong chi canh bao)');
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p2', 'p3']);
    await T.tunnel(true, '10.252.32.18');   // moc: dang bat
    await T.tunnel(false, null);            // nguoi dung tat HMA
    return { stopAll: T.stopAllCalls(), running: T.running ? T.running() : null, logs: T.logs(), toasts: T.toasts() };
  });
  ok(r.stopAll.length === 1, `da goi profilesStopAll DUNG 1 lan (that: ${r.stopAll.length})`);
  ok(r.stopAll[0] && r.stopAll[0].length === 3,
    'dung ca 3 profile dang chay', JSON.stringify(r.stopAll));
  ok(r.logs.some(m => /ĐANG DỪNG HẾT 3 profile/.test(m)),
    'log noi ro dang dung HET bao nhieu profile', JSON.stringify(r.logs));
  ok(r.toasts.some(t => /DỪNG HẾT/.test(t.m) && t.k === 'err'), 'toast do bao dang dung het');

  console.log('\n### TAT HMA ma KHONG co profile nao chay -> KHONG goi dung het vo ich');
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning([]);
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);
    return { stopAll: T.stopAllCalls() };
  });
  ok(r.stopAll.length === 0, 'khong co gi chay -> khong goi profilesStopAll', JSON.stringify(r.stopAll));

  console.log('\n### VPN LEN LAI -> hen chay lai DUNG nhom vua bi dung vi VPN tat');
  // Nguoi dung treo may, VPN tut luc 3h sang: neu khong tu bat lai thi mat ca dem.
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p2']);
    await T.tunnel(true, '10.252.32.18');
    await T.tunnel(false, null);              // dung het + nho nhom
    await T.tunnel(true, '10.252.40.7');      // VPN len lai
    return { retries: T.groupRetries() };
  });
  ok(r.retries.length === 1, `hen chay lai DUNG 1 lan (that: ${r.retries.length})`);
  ok(r.retries[0] && r.retries[0].ids.length === 2 && r.retries[0].ids.includes('p1') && r.retries[0].ids.includes('p2'),
    'hen dung nhom 2 profile vua bi dung', JSON.stringify(r.retries));
  ok(r.retries[0] && r.retries[0].waitMs === 60000,
    `cho dung 59s (VPN_COOLDOWN_MS) roi moi bat (that: ${r.retries[0] && r.retries[0].waitMs})`);

  console.log('\n### APP dang tu doi IP -> bo canh KHONG hen (cycleIpAndRestart tu lo)');
  // Hai duong cung bat mot nhom = bat 2 lan. Bo canh phai nhuong khi app dang lai.
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1']);
    await T.tunnel(true, '10.252.32.18');
    T.setCycling(true);                       // cycleIpAndRestart dang chay
    await T.tunnel(false, null);
    await T.tunnel(true, '10.252.40.7');
    return { retries: T.groupRetries() };
  });
  ok(r.retries.length === 0,
    'app dang tu doi IP -> bo canh KHONG hen chay lai (tranh bat 2 lan)', JSON.stringify(r.retries));
  // Tra runningSet ve nhu ban dau cho cac buoc sau (neu co).
  await page.evaluate(() => T.setRunning(['p3']));

  // ══════════════════════════════════════════════════════════════════════
  // LOI THAT (2026-08-13): nut "■ Dung" bi TAT, va KHONG TU KHOI
  // ══════════════════════════════════════════════════════════════════════
  // Nguoi dung gui anh: 4 profile dang quet ("Chu ky [Quet]: da quet 39 sound"), ca 4 nut
  // "■ Dung" tren tung hang deu bi tat -> mat han duong dung rieng tung profile.
  //
  // Chuoi su viec:
  //   1. HMA bien dong -> applyVpnCooldown() khoa cac hang CHUA chay, ghi chu "⏳ 59s"
  //   2. Profile khoi dong -> setRowRunning(id,true) doi chu thanh "■ Dung"
  //      …ma KHONG mo khoa -> nut TAT nhung mang chu "■ Dung"
  //   3. Het 59 giay: applyVpnCooldown() *bo qua* dung hang nay (`runningSet.has(id)` -> return)
  //      nen KHONG BAO GIO mo lai. Ket vinh vien toi khi ve lai bang.
  //
  // Bat bien cua app la "nut Dung LUON bam duoc" — truoc day chi thi hanh o MOT dau
  // (applyVpnCooldown bo qua hang dang chay), khong phu duong NGUOC LAI (bi khoa TRUOC roi moi
  // chay). Dung bai hoc QD-32: rang buoc cai o mot trong nhieu duong = ke nhu chua co.
  console.log('\n=== 9. Nut "■ Dung" phai bam duoc KE CA khi hang bi khoa TRUOC roi moi chay ===');
  {
    // ⚠ Dung `addScriptTag`, KHONG `page.evaluate(chuoi)`: evaluate danh gia chuoi nhu BIEU THUC
    // nen chuoi bat dau bang `function` -> SyntaxError "Unexpected token 'function'". Bo test nay
    // von da dung addScriptTag cho HARNESS — di theo dung khuon do.
    // Dung LAI page san co (da co FNS + HARNESS); `const` o top-level cua script nam trong pham vi
    // tu vung toan cuc nen script thu hai thay duoc `runningSet`, `$`, `applyVpnCooldown`…
    await page.evaluate(() => T.reset());
    // ⚠ `T.setRunning()` chi sua `Set`, KHONG dong bo DOM — cac muc test truoc da ghi lai chu nut
    // p3 thanh "▶ Chạy". Phai dung chinh `setRowRunning` de dua CA HAI ve dung trang thai, neu
    // khong thi khang dinh 9.6 truot vi du lieu ban dau sai chu khong phai code sai.
    await page.evaluate(() => { T.setRunning([]); });
    await page.addScriptTag({ content: extractFn(SRC, 'setRowRunning') + `
      window.__t = {
        lock() { T.setRunLock(true, 'vpn-off'); T.apply(); },
        unlock() { T.setRunLock(false); T.setCooldown(0); T.apply(); },
        start(id) { setRowRunning(id, true); },
        btn(id) { const b = document.querySelector('button[data-act="run"][data-id="' + id + '"]');
                  return { text: b.textContent, disabled: b.disabled }; },
      };
    ` });
    // Dua p3 ve dung trang thai DANG CHAY bang chinh setRowRunning (dong bo ca Set lan DOM).
    await page.evaluate(() => window.__t.start('p3'));

    // p1 CHUA chay -> bi khoa dung nhu thiet ke
    await page.evaluate(() => window.__t.lock());
    let b = await page.evaluate(() => window.__t.btn('p1'));
    ok(b.disabled === true, '9.1 hang CHUA chay bi khoa khi VPN tat (dung thiet ke)');
    ok(b.text === '⛔ VPN tắt', '9.2 va doi nhan bao dung ly do', b.text);

    // …roi profile do BAT DAU CHAY trong luc van dang khoa
    await page.evaluate(() => window.__t.start('p1'));
    b = await page.evaluate(() => window.__t.btn('p1'));
    ok(b.text === '■ Dừng', '9.3 doi chu thanh "■ Dừng"');
    ok(b.disabled === false,
      '9.4 *** LOI THAT ***: nut "■ Dừng" PHAI bam duoc ngay ca khi hang bi khoa TRUOC do — '
      + 'khong thi nguoi dung mat han duong dung rieng tung profile');

    // …va het gio khoa cung khong duoc lam no tat lai
    await page.evaluate(() => window.__t.unlock());
    b = await page.evaluate(() => window.__t.btn('p1'));
    ok(b.disabled === false && b.text === '■ Dừng',
      '9.5 het khoa van bam duoc va van la "■ Dừng" (applyVpnCooldown bo qua hang dang chay)');

    // Hang dang chay san (p3) van phai nguyen ven qua ca chu trinh khoa/mo
    await page.evaluate(() => { window.__t.lock(); });
    b = await page.evaluate(() => window.__t.btn('p3'));
    ok(b.disabled === false && b.text === '■ Dừng',
      '9.6 hang DANG chay san khong bao gio bi khoa (duong cu, chong hoi quy)', JSON.stringify(b));
    await page.close();
  }

  await browser.close();

  console.log('\n' + '='.repeat(78));
  console.log('### KHANG DINH TREN MA NGUON (bat cac loi khong the thay bang DOM)');
  const fn = (n) => extractFn(SRC, n);
  ok(/vpnRunLocked\(\)/.test(fn('toggleProfile')),
    'toggleProfile() tu chan khi dang doi IP — khong chi dua vao `disabled` cua nut');
  ok(/vpnRunLocked\(\)/.test(fn('runSelected')), 'runSelected() cung tu chan');
  // ── CAT FEED -> DUNG DUNG PROFILE DO, KHONG DUNG VAO VPN (nguoi dung chot bo 2026-08-06) ──
  // Ly do bo tinh nang tu doi IP: IP la cua CA MAY, nen doi IP giua luc 4 profile khac dang quet
  // lam chung chuyen tu IP A sang IP B GIUA PHIEN — dung khuon "tai khoan bi chiem" (QD-15).
  // Con dung HET profile truoc khi doi thi moi lan MOT profile bi cat la ca dan phai nghi.
  // Duong NHE (`stopAndScheduleRestart`) tach ra 2026-08-07 de dung chung cho ca 'feed can' lan
  // 'bi chan trang dem keo dai' — mot ban logic duy nhat (QĐ-10).
  const light = fn('stopAndScheduleRestart');
  ok(/stopProfileById\(profileId\b/.test(light),
    'duong nhe -> DUNG dung profile do');
  // Tu 2026-08-13 `stopProfileById` MAC DINH la dung MEM (check not hang doi). Duong TU DONG
  // nay BAT BUOC phai ep `force`, vi ca "bi chan trang dem" thi CHINH buoc dem dang hong ->
  // hang doi khong bao gio tieu het (QD-35 do that: 20 sound can 6-7 tieng). Dung mem o day
  // = profile treo vinh vien qua dem, ma nguoi dung treo may nen khong ai thay.
  ok(/stopProfileById\(profileId,\s*\{\s*force:\s*true\s*\}\)/.test(light),
    'duong nhe phai ep force:true — dung mem se KHONG BAO GIO xong khi trang dem bi chan');
  ok(!/vpnCycle|profilesStopAll|startProfilesStaggered|vpnIpv6Risk/.test(light),
    'TUYET DOI khong dung vao VPN, khong dung profile khac');
  ok(!/_vpnRunLock|_vpnCooldownUntil/.test(light),
    'khong khoa nut Chay — nguoi dung phai bam chay lai duoc ngay');
  ok(/nameOf\(profileId\)/.test(light) && /appendLog/.test(light),
    'noi RO profile nao bi dung, va ghi vao log 📄 cua chinh profile do');
  const starved = fn('handleFeedStarved');
  // ── DUONG DOI IP (cong tac BAT): LUON dung HET, khong co nhanh "chi dung 1" ──
  // Nguoi dung chot 2026-08-06 sau khi chi ra lo hong ma phep do IPv6 KHONG che duoc: 4 profile kia
  // dang quet tren IP A bi chuyen sang IP B GIUA PHIEN, dung khuon "tai khoan bi chiem" (QD-15).
  const cyc = fn('cycleIpAndRestart');
  ok(/api\.profilesStopAll\(\)/.test(cyc), 'duong doi IP goi profilesStopAll (dung HET)');
  ok(!/api\.profileStop\(/.test(cyc) && !/stopOnlyOne/.test(cyc),
    'TUYET DOI khong con nhanh "chi dung 1 profile" — do la lo hong da bi bo');
  ok(!/vpnIpv6Risk/.test(cyc),
    'khong con hoi ipv6LeakRisk de quyet dinh dung 1 hay dung het — luon dung het nen khong can');
  ok(/await api\.crawlRunningIds\(\)/.test(cyc),
    'cho BACKEND xac nhan da dung sach truoc khi tat VPN (khong tin runningSet cua renderer)');
  ok(/waitBeforeRestart\(was\)[\s\S]*startProfilesStaggered\(was\)/.test(cyc),
    'cho IP nguoi TRUOC roi moi bat lai ca nhom, bat lan luot');
  ok(/scheduleGroupRetry/.test(cyc),
    'doi IP that bai -> HEN THU LAI ca nhom (nguoi dung treo may, bo mac la mat ca dem)');
  ok(/_vpnAutoCycle/.test(fn('handleFeedStarved')),
    'handleFeedStarved re nhanh theo cong tac: BAT -> doi IP, TAT -> dung rieng + nghi 5/15/30');

  const watch = fn('watchVpnTunnel');
  ok(/api\.vpnTunnel\(\)/.test(watch) && !/api\.vpnStatus\(/.test(watch),
    'bo canh doc kenh RE (vpnTunnel: chi doc networkInterfaces), KHONG dung vpnStatus '
    + '(spawn VpnNM.exe + cho 600ms -> poll 2s/lan la 1800 tien trinh/gio)');
  ok(/_tunnelPrev === undefined/.test(watch),
    'lan poll dau chi LAY MOC — khong thi may dang tat HMA se bi khoa nut ngay khi mo app');
  ok(/api\.profilesStopAll\(\)/.test(watch),
    'TAT HMA -> bo canh DUNG HET profile, khong chi canh bao (nguoi dung chot: "Tat HMA la dung '
    + 'het luon khong cho chay")');
  ok(/if \(_vpnCycling\)/.test(watch),
    'app dang tu doi IP thi bo canh KHONG hen chay lai — cycleIpAndRestart tu lo, tranh bat 2 lan');
  ok(/_vpnDownGroup/.test(watch),
    'nho nhom bi dung vi VPN tat de tu bat lai khi VPN len (VPN tut luc 3h sang van phuc hoi)');
  ok(/startVpnWatcher\(\)/.test(fn('init')),
    'startVpnWatcher() duoc goi trong init() — khong thi ca tinh nang khong bao gio chay');
  ok(/if\s*\(_vpnWatcherOn\)\s*return/.test(fn('startVpnWatcher')),
    'startVpnWatcher() chan chay 2 bo dem — init() co the chay lai (ban dev bam 🔄 Reload), 2 '
    + 'interval cung ghi nut se lam dem nguoc nhay 2 giay');
  ok(!/_vpnAutoCycle/.test(fn('startVpnWatcher')) && !/_vpnAutoCycle/.test(watch),
    'bo canh chay BAT KE cong tac "Tu doi IP" — nguoi dung chot: "ke ca app tu dong hay la toi '
    + 'thi deu phai khoa 59 giay"');

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. NUT "■ Dung" = DUNG MEM (check not hang doi roi moi dung han)
  // Nguoi dung chot 2026-08-13: "quet duoc 300 check dang o 260, an dung la no dung luon —
  // dung ra phai doi check xong 40 link nua". So sound MAT khi dung cung = Quet - Da check.
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 10. Nut "■ Dung" phai CHECK NOT hang doi roi moi dung han ===');
  const stopFn = fn('stopProfileById');

  ok(/api\.profileSoftStop\(id\)/.test(stopFn),
    '10.1 duong MAC DINH goi profileSoftStop (check not), khong phai profileStop');

  ok(/async function stopProfileById\(id,\s*opts\s*=\s*\{\}\)/.test(stopFn),
    '10.2 nhan opts.force de duong TU DONG con ep dung cung duoc');

  // Duong thoat BAT BUOC: khong co no thi 2 ca ket that — VPN tut (moi giay la mot giay dung
  // IP THAT) va trang dem bi chan (hang doi khong bao gio tieu, QD-35: 20 sound = 6-7 tieng).
  ok(/!opts\.force\s*&&\s*!_draining\.has\(id\)/.test(stopFn),
    '10.3 bam lan HAI (dang check not) = CAT NGAY — duong thoat cho VPN tut / trang dem bi chan');

  ok(/api\.profileStop\(id\)/.test(stopFn),
    '10.4 van con duong dung CUNG that su (khong phai chi doi ten)');

  // Huy hen tu-bat-lai phai nam TRUOC moi `return`, ke ca return cua nhanh dung mem moi —
  // nguoi dung bam Dung = ho tiep quan, app khong duoc tu bat lai (QD-32).
  const softIdx = stopFn.indexOf('profileSoftStop');
  ok(stopFn.indexOf('cancelStarveRestart') < softIdx && stopFn.indexOf('cancelGroupRetry') < softIdx,
    '10.5 huy hen tu-bat-lai TRUOC nhanh dung mem — khong thi app tu bat lai profile vua tat');

  // Nhan nut phai doi, neu khong nguoi dung tuong nut hong (bam Dung ma profile van chay).
  const rowFn = fn('setRowRunning');
  ok(/_draining\.has\(id\)/.test(rowFn) && /Dừng ngay/.test(rowFn),
    '10.6 nhan nut doi thanh "⏹ Dừng ngay" khi dang check not');
  ok(/if\s*\(!running\)\s*_draining\.delete\(id\)/.test(rowFn),
    '10.7 dung han thi quen trang thai draining — khong thi lan chay sau nut hien sai nhan');

  // Nut toolbar "cat ngay" phai HOI TRUOC vi day la hanh dong MAT DU LIEU khong hoan tac
  // duoc (cung nguyen tac voi 🧹 Don trung, QD-20).
  const forceFn = fn('forceStopSelected');
  ok(/force:\s*true/.test(forceFn), '10.8 nut "⏹ Dung ngay o da chon" ep force');
  ok(/confirm\(/.test(forceFn) && /profileScanned/.test(forceFn) && /profileChecked/.test(forceFn),
    '10.9 hoi xac nhan va noi RO so sound se mat (Quet - Da check), khong noi chung chung');

  console.log(`\n${failed ? '❌' : '✅'} ${failed} khang dinh TRUOT`);
  console.log('\nDONE');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
