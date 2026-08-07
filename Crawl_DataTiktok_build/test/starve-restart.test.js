// test/starve-restart.test.js — TIKTOK CẮT FEED → dừng profile đó rồi TỰ BẬT LẠI (QĐ-32 đảo lại).
//
// VI SAO CAN TEST NAY: nguoi dung TREO MAY qua dem — *"nhieu khi toi treo may nen khong the an Chay
// thu cong duoc"*. Neu duong tu-bat-lai hong thi profile dung ca dem, mat tron san luong, MA KHONG
// CO AI THAY. Day dung loai loi im lang can test tu dong nhat.
//
// Cac bay da nghi tu truoc, moi cai deu duoc kiem o duoi:
//   1. Dat hen TRUOC khi await stopProfileById -> chinh no xoa mat hen (stopProfileById huy hen).
//   2. `streak` bi xoa moi lan dung -> lan nao cung nghi 5 phut, khong bao gio gian ra.
//   3. Bam "Dung" luc dang dem nguoc khong huy duoc hen (luc do profile KHONG nam trong runningSet,
//      nen neu kiem `runningSet` truoc khi huy thi hen song sot roi tu bat lai).
//   4. Toi gio bat lai ma VPN dang TAT -> bat len la chay bang IP THAT.
//   5. Vong cho im lang 30 phut -> bi bao la "app treo" (bai hoc QĐ-21).
//
// CACH LAM: trich DUNG MA NGUON cac ham tu renderer.js roi chay trong Chromium. Khong chep logic
// sang test — ban chep se lech am tham va test pass trong khi app hong (bai hoc QĐ-10).
//
// Chay: node test/starve-restart.test.js
'use strict';

const path = require('path');
const fs = require('fs');

const RENDERER = path.join(__dirname, '..', 'renderer', 'renderer.js');
const SRC = fs.readFileSync(RENDERER, 'utf8');

function extractFn(src, name) {
  let at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`Khong tim thay function ${name}() trong renderer.js`);
  if (/async\s+$/.test(src.slice(Math.max(0, at - 8), at))) at = src.lastIndexOf('async', at);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`Ngoac khong dong cho function ${name}()`);
}

const FNS = ['cancelStarveRestart', 'handleFeedStarved', 'scheduleStarveRestart',
             'fireStarveRestart', 'formatCountdown'].map(n => extractFn(SRC, n)).join('\n\n');

const PAGE = `<!doctype html><meta charset="utf-8"><span id="crawlStatusMsg"></span>`;

// Rut ngan thang nghi that (5/15/30 phut) xuong ms de test chay duoc trong vai giay. Thay hang so
// bang regex NGAY TREN MA NGUON DA TRICH — khong chep lai than ham.
const WAITS_LINE = SRC.match(/const STARVE_RESTART_WAITS = \[[^\]]*\];/);
if (!WAITS_LINE) throw new Error('Khong tim thay STARVE_RESTART_WAITS trong renderer.js');

const HARNESS = `
  const $ = (id) => document.getElementById(id);
  const runningSet = new Set();
  const STARVE_RESTART_WAITS = [1200, 2400, 3600];  // that: 5/15/30 phut.
  // ⚠ PHAI > 1000ms: bo dem nguoc trong renderer.js chay moi 1 GIAY, nen thang ngan hon nhip
  // dem thi khong bao gio toi han (lan dau viet 300/600/900 -> 12 khang dinh truot).
  const _starve = {};
  const logs = [];
  const toasts = [];
  const rowStatus = {};
  let _vpnLocked = false;
  const startCalls = [];
  const stopCalls = [];
  // Cong tac "Tu doi IP" (⚙, chung toan app). TAT = duong nhe dang test o day (dung rieng profile
  // do + nghi 5/15/30). BAT = duong doi IP, do test/vpn-run-lock.test.js phu.
  let _vpnAutoCycle = false;
  const cycleCalls = [];
  const cycleIpAndRestart = async (id) => { cycleCalls.push(id); };
  const nameOf = (id) => 'profile-' + id;
  const appendLog = (id, m) => logs.push(id + ': ' + m);
  const toast = (m, k) => toasts.push({ m, k });
  const updateRowStatus = (id, kind, msg) => { rowStatus[id] = { kind, msg }; };
  const vpnRunLocked = () => _vpnLocked;
  // stopProfileById GIA — nhung phai giu DUNG hai hanh vi that: huy hen, va chi go khoi runningSet
  // neu dang chay. Sai o day la test do sai ma tuong dung.
  async function stopProfileById(id) {
    stopCalls.push(id);
    cancelStarveRestart(id, 'nguoi dung bam Dung');
    if (!runningSet.has(id)) return;
    runningSet.delete(id);
  }
  async function startProfileById(id) {
    startCalls.push(id);
    if (_vpnLocked) return;            // that: toggleProfile chan truoc khi goi
    runningSet.add(id);
  }
  ${FNS}
  window.T = {
    setRunning: (ids) => { runningSet.clear(); for (const i of ids) runningSet.add(i); },
    setVpnLocked: (v) => { _vpnLocked = v; },
    setAutoCycle: (v) => { _vpnAutoCycle = v; },
    cycleCalls: () => cycleCalls.slice(),
    starve: async (id) => { await handleFeedStarved(id); },
    stop: async (id) => { await stopProfileById(id); },
    start: async (id) => { await startProfileById(id); },
    // Gia lap "thu duoc sound hop le" -> xoa chuoi bi cat lien tiep (dung logic o onCrawlData)
    gotSound: (id) => { const st = _starve[id]; if (st && !st.tick) delete _starve[id]; },
    state: (id) => {
      const st = _starve[id];
      return st ? { streak: st.streak, leftMs: st.until ? st.until - Date.now() : 0, hasTick: !!st.tick } : null;
    },
    running: () => [...runningSet],
    rowStatus: (id) => rowStatus[id] || null,
    logs: () => logs.slice(),
    toasts: () => toasts.slice(),
    reset: () => {
      for (const k of Object.keys(_starve)) { if (_starve[k].tick) clearInterval(_starve[k].tick); delete _starve[k]; }
      runningSet.clear(); logs.length = 0; toasts.length = 0;
      startCalls.length = 0; stopCalls.length = 0; _vpnLocked = false;
      cycleCalls.length = 0; _vpnAutoCycle = false;
    },
    startCalls: () => startCalls.slice(),
    stopCalls: () => stopCalls.slice(),
  };
`;

let failed = 0;
function ok(cond, label, detail) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond ? '' : `  → that te: ${detail}`));
  if (!cond) failed++;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(PAGE);
  await page.addScriptTag({ content: HARNESS });

  console.log('='.repeat(78));
  console.log('### BI CAT FEED -> DUNG profile do + DAT HEN tu bat lai');
  let r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p2']);
    await T.starve('p1');
    return { running: T.running(), st: T.state('p1'), logs: T.logs(), toasts: T.toasts() };
  });
  ok(!r.running.includes('p1'), 'p1 da bi DUNG', JSON.stringify(r.running));
  ok(r.running.includes('p2'), 'p2 KHONG bi dung — chi dung dung profile bi cat', JSON.stringify(r.running));
  ok(r.st && r.st.streak === 1, `streak = 1 (that: ${r.st && r.st.streak})`);
  ok(r.st && r.st.hasTick, 'co bo dem nguoc dang chay (khong phai vong cho im lang)');
  // Thong bao phai noi RO khoang thoi gian. Lan dau dung Math.round(ms/60000) -> moi khoang duoi
  // 30 giay thanh "0 phut" (vo nghia); test bat dung loi do nen doi sang formatCountdown.
  ok(r.logs.some(m => /sẽ TỰ BẬT LẠI sau 1s/.test(m)),
    'log noi ro se tu bat lai sau BAO LAU (dinh dang formatCountdown, khong lam tron ve 0)',
    JSON.stringify(r.logs));

  console.log('\n### DEM NGUOC HIEN RA badge trang thai (vong cho im lang bi bao la app treo)');
  r = await page.evaluate(() => T.rowStatus('p1'));
  ok(r && /tự bật lại sau/.test(r.msg), 'badge hien "tu bat lai sau ..."', JSON.stringify(r));

  console.log('\n### HET GIO -> TU BAT LAI that');
  await sleep(2500);
  r = await page.evaluate(() => ({ running: T.running(), starts: T.startCalls(), st: T.state('p1'), logs: T.logs() }));
  ok(r.running.includes('p1'), 'p1 da duoc TU BAT LAI', JSON.stringify(r.running));
  ok(r.starts.includes('p1'), 'that su goi startProfileById', JSON.stringify(r.starts));
  ok(r.logs.some(m => /Hết giờ nghỉ — tự bật lại/.test(m)), 'co log luc bat lai');
  ok(r.st && r.st.streak === 1, `GIU streak sau khi bat lai (that: ${r.st && r.st.streak})`);

  console.log('\n### BI CAT LAI -> nghi LAU HON (5 -> 15 -> 30 phut, giu muc cuoi)');
  // Bay: neu `streak` bi xoa moi lan dung thi lan nao cung nghi 5 phut, khong bao gio gian ra.
  r = await page.evaluate(async () => {
    await T.starve('p1');
    return T.state('p1');
  });
  ok(r && r.streak === 2, `lan 2 -> streak = 2 (that: ${r && r.streak})`);
  ok(r && r.leftMs > 1200 && r.leftMs <= 2400, `lan 2 nghi lau hon lan 1 (that: ${r && r.leftMs}ms, mong ~2400)`);
  await sleep(3300);
  r = await page.evaluate(async () => { await T.starve('p1'); return T.state('p1'); });
  ok(r && r.streak === 3 && r.leftMs > 2400 && r.leftMs <= 3600,
    `lan 3 -> streak 3, nghi ~3600ms (that: streak=${r && r.streak}, left=${r && r.leftMs})`);
  await sleep(4300);
  r = await page.evaluate(async () => { await T.starve('p1'); return T.state('p1'); });
  ok(r && r.streak === 4 && r.leftMs > 2400 && r.leftMs <= 3600,
    `lan 4 -> GIU muc cuoi, khong tang vo han (that: streak=${r && r.streak}, left=${r && r.leftMs})`);

  console.log('\n### QUET LAI DUOC (thu duoc sound hop le) -> XOA chuoi, lan cat sau nghi lai tu 5 phut');
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1']);
    await T.starve('p1');            // streak 1
    await new Promise(r => setTimeout(r, 2500));  // cho tu bat lai xong
    T.gotSound('p1');                // feed hoi lai
    const afterSound = T.state('p1');
    await T.starve('p1');
    return { afterSound, st: T.state('p1') };
  });
  ok(r.afterSound === null, 'thu duoc sound -> xoa chuoi bi cat lien tiep', JSON.stringify(r.afterSound));
  ok(r.st && r.st.streak === 1, `lan cat sau do lai bat dau tu streak 1 (that: ${r.st && r.st.streak})`);

  console.log('\n### NGUOI DUNG BAM DUNG luc dang dem nguoc -> HUY hen, KHONG tu bat lai');
  // Bay lon nhat: luc dem nguoc profile KHONG nam trong runningSet. Neu stopProfileById kiem
  // runningSet TRUOC khi huy hen thi hen song sot -> app tu bat lai profile nguoi dung vua tat.
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1']);
    await T.starve('p1');
    await T.stop('p1');              // bam Dung trong luc dang cho
    return { st: T.state('p1'), logs: T.logs() };
  });
  ok(r.st === null, 'hen da bi HUY', JSON.stringify(r.st));
  ok(r.logs.some(m => /Đã huỷ hẹn tự chạy lại/.test(m)), 'co log noi da huy', JSON.stringify(r.logs));
  await sleep(2500);
  r = await page.evaluate(() => ({ running: T.running(), starts: T.startCalls() }));
  ok(!r.running.includes('p1') && !r.starts.includes('p1'),
    'het gio van KHONG bat lai — nguoi dung da tiep quan', JSON.stringify(r));

  console.log('\n### NGUOI DUNG BAM CHAY luc dang dem nguoc -> chay ngay, khong bat 2 lan');
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1']);
    await T.starve('p1');
    await T.start('p1');             // bam Chay: chay ngay
    return { running: T.running(), starts: T.startCalls() };
  });
  ok(r.running.includes('p1'), 'chay ngay khi bam Chay');
  await sleep(2500);
  r = await page.evaluate(() => T.startCalls());
  ok(r.filter(x => x === 'p1').length === 1,
    `chi bat DUNG 1 lan, hen cu khong bat lai lan nua (that: ${r.length} lan)`, JSON.stringify(r));

  console.log('\n### TOI GIO ma VPN DANG TAT -> KHONG bat (se chay bang IP THAT), hen lai');
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1']);
    await T.starve('p1');
    T.setVpnLocked(true);            // VPN tat / dang cho 59s
    await new Promise(r => setTimeout(r, 2500));
    return { running: T.running(), st: T.state('p1'), rowStatus: T.rowStatus('p1'), logs: T.logs() };
  });
  ok(!r.running.includes('p1'), 'VPN tat -> KHONG bat len', JSON.stringify(r.running));
  ok(r.st !== null, 'van GIU hen (khong bo luon y dinh bat lai)', JSON.stringify(r.st));
  ok(r.rowStatus && /chờ VPN ổn định/.test(r.rowStatus.msg),
    'badge noi ro dang cho VPN', JSON.stringify(r.rowStatus));
  ok(r.logs.some(m => /VPN đang tắt/.test(m)), 'co log giai thich vi sao chua bat');
  // VPN len lai -> phai tu bat
  r = await page.evaluate(async () => {
    T.setVpnLocked(false);
    await new Promise(r => setTimeout(r, 6500));   // nhip kiem lai khi VPN tat = 5s
    return { running: T.running() };
  });
  ok(r.running.includes('p1'), 'VPN len lai -> TU BAT duoc', JSON.stringify(r.running));

  console.log('\n### NHIEU PROFILE bi cat cung luc -> hen RIENG tung profile, khong an theo nhau');
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p2', 'p3']);
    await T.starve('p1');
    await T.starve('p2');
    return { running: T.running(), s1: T.state('p1'), s2: T.state('p2'), s3: T.state('p3') };
  });
  ok(r.running.length === 1 && r.running[0] === 'p3', 'chi p3 con chay', JSON.stringify(r.running));
  ok(r.s1 && r.s2 && r.s3 === null, 'p1/p2 co hen rieng, p3 khong co hen nao', JSON.stringify(r));
  await sleep(2500);
  r = await page.evaluate(() => T.running().sort());
  ok(r.includes('p1') && r.includes('p2') && r.includes('p3'),
    'ca p1 va p2 deu tu bat lai duoc', JSON.stringify(r));


  console.log('\n### CONG TAC "Tu doi IP" BAT -> re sang duong doi IP, KHONG dung duong nhe');
  // Hai duong phai loai tru nhau. Chay ca hai = dung profile 2 lan roi bat 2 lan.
  r = await page.evaluate(async () => {
    T.reset(); T.setRunning(['p1', 'p2']); T.setAutoCycle(true);
    await T.starve('p1');
    return { cycles: T.cycleCalls(), st: T.state('p1'), running: T.running(), stops: T.stopCalls() };
  });
  ok(r.cycles.length === 1 && r.cycles[0] === 'p1',
    'cong tac BAT -> goi cycleIpAndRestart dung 1 lan', JSON.stringify(r.cycles));
  ok(r.st === null, 'KHONG dat hen nghi 5/15/30 (duong kia lo viec bat lai)', JSON.stringify(r.st));
  ok(r.stops.length === 0, 'KHONG tu dung profile o day (cycleIpAndRestart dung HET)', JSON.stringify(r.stops));
  ok(r.running.length === 2, 'chua dung gi ca — de duong doi IP lo', JSON.stringify(r.running));

  await browser.close();

  console.log('\n' + '='.repeat(78));
  console.log('### KHANG DINH TREN MA NGUON');
  const fn = (n) => extractFn(SRC, n);
  ok(/\[5 \* 60000, 15 \* 60000, 30 \* 60000\]/.test(WAITS_LINE[0]),
    'thang nghi that = 5/15/30 phut (cung thang backoff cu cua backend, khong doan so moi)');
  ok(!/process\.env/.test(WAITS_LINE[0]),
    'KHONG dung process.env o renderer — sandbox khong co `process`, viet vao la chet giao dien');
  const starved = fn('handleFeedStarved');
  ok(/await stopProfileById\(profileId\)[\s\S]*scheduleStarveRestart/.test(starved),
    'dat hen SAU khi await dung xong — dat truoc thi chinh stopProfileById xoa mat hen');
  ok(!/vpnCycle|profilesStopAll|vpnIpv6Risk/.test(starved),
    'TUYET DOI khong dung vao VPN, khong dung profile khac');
  const stop = fn('stopProfileById');
  ok(/cancelStarveRestart\(id[\s\S]*if \(!runningSet\.has\(id\)\) return;/.test(stop),
    'huy hen TRUOC dong `if (!runningSet.has(id)) return` — luc dem nguoc profile khong nam trong '
    + 'runningSet, kiem sau thi bam Dung khong huy duoc gi');
  const fire = fn('fireStarveRestart');
  ok(/vpnRunLocked\(\)/.test(fire), 'truoc khi bat lai phai kiem VPN (khong bat khi VPN dang tat)');
  ok(/if \(runningSet\.has\(id\)\)/.test(fire), 'nguoi dung da tu bat thi khong bat lan 2');
  ok(/formatCountdown/.test(fn('scheduleStarveRestart')), 'dem nguoc hien ra badge, khong cho im lang');

  console.log(`\n${failed ? '❌' : '✅'} ${failed} khang dinh TRUOT`);
  console.log('\nDONE');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
