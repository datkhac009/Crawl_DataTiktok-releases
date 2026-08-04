// test/chromium-profile.test.js — Che do "profile Chromium rieng" (persistent context).
//
// Muc dich: chot lai 5 dieu de-vo nhat cua che do nay, vi tat ca deu chi bung ra khi CHAY
// THAT tren VPS (rat kho phat hien luc dev):
//   1. Mac dinh phai TAT — bat mac dinh la +1GB RAM tren may 2.2GB trong.
//   2. Lan dau bat: cookie trong session.state.json phai duoc mang sang, khong thi 5 profile
//      dang dang nhap tot bong dung thanh khach het.
//   3. Tab dem PHAI dung chung context cua profile — mot thu muc user-data-dir chi cho MOT
//      Chromium mo, mo them la "profile is already in use".
//   4. releaseCountContext KHONG duoc dong context dung chung — dong la sap luon tab quet.
//   5. Van tay (fingerprint) cua 2 che do phai y het nhau — lech van tay giua tab dem va tab
//      chinh = "1 phien dang nhap, 2 thiet bi" → TikTok huy phien (QD-05).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function eq(a, b, name) { ok(a === b, name, `nhan "${a}", mong "${b}"`); }

// ── Fake Playwright: ghi lai moi lan mo trinh duyet ──
const launches = [];      // { dir, opts }
function makeFakePage(tag) {
  const page = {
    _tag: tag,
    _goto: [],
    _routed: 0,
    closed: false,
    async goto(u) { page._goto.push(u); },
    async route() { page._routed++; },
    async unroute() {},
    async bringToFront() {},
    async close() { page.closed = true; for (const f of page._onClose) f(); },
    on(ev, f) { if (ev === 'close') page._onClose.push(f); },
    _onClose: [],
  };
  return page;
}
function makeFakeContext(dir) {
  const ctx = {
    _dir: dir,
    _cookiesAdded: [],
    _initScripts: 0,
    _routed: 0,          // route() ở mức CONTEXT — đè lên MỌI tab, kể cả tab đang quét
    _pages: [],
    closed: false,
    async addCookies(c) { ctx._cookiesAdded.push(...c); },
    async addInitScript() { ctx._initScripts++; },
    async newPage() { const p = makeFakePage(`p${ctx._pages.length}`); ctx._pages.push(p); return p; },
    async route() { ctx._routed++; },
    async unroute() {},
    pages: () => ctx._pages.filter(p => !p.closed),
    async storageState() { return { cookies: [], origins: [] }; },
    async close() { ctx.closed = true; },
    on() {},
    browser: () => ({ isConnected: () => true }),
  };
  return ctx;
}
const fakePlaywright = {
  chromium: {
    async launchPersistentContext(dir, opts) {
      launches.push({ dir, opts });
      return makeFakeContext(dir);
    },
    async launch() {
      throw new Error('Che do persistent KHONG duoc goi chromium.launch() (moi profile 1 dir rieng)');
    },
  },
};
const pwPath = require.resolve('playwright');
require.cache[pwPath] = new Module(pwPath, null);
require.cache[pwPath].filename = pwPath;
require.cache[pwPath].loaded = true;
require.cache[pwPath].exports = fakePlaywright;

const browser = require('../src/browser.cjs');
const fingerprint = require('../src/fingerprint.cjs');

// ── Thu muc profile tam ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-persist-'));
const profileDir = path.join(tmp, 'someone@hotmail.com(UK)');
fs.mkdirSync(profileDir, { recursive: true });
const SESSION_COOKIES = [
  { name: 'sessionid', value: 'abc', domain: '.tiktok.com', path: '/' },
  { name: 'tt-target-idc', value: 'useast2a', domain: '.tiktok.com', path: '/' },
];
fs.writeFileSync(
  path.join(profileDir, 'session.state.json'),
  JSON.stringify({ cookies: SESSION_COOKIES, origins: [] }),
  'utf8'
);

console.log('\n=== Che do profile Chromium rieng ===\n');

(async () => {
  // ── 1. Mac dinh TAT ──
  console.log('1. Mac dinh phai TAT (khong tu dong ngon them RAM)');
  eq(browser.isPersistentProfiles(), false, 'isPersistentProfiles() mac dinh = false');
  browser.setPersistentProfiles(true);
  eq(browser.isPersistentProfiles(), true, 'bat len thi doc lai duoc true');
  browser.setPersistentProfiles(0);
  eq(browser.isPersistentProfiles(), false, 'gia tri falsy (0) → false, khong phai 0');
  browser.setPersistentProfiles('yes');
  eq(browser.isPersistentProfiles(), true, 'gia tri truthy → true (ep ve boolean)');

  // ── 2. Thu muc & tham so mo trinh duyet ──
  console.log('\n2. Mo trinh duyet dung thu muc rieng cua profile');
  eq(browser.persistDir(profileDir), path.join(profileDir, 'ChromiumProfile'),
    'persistDir = <profile>/ChromiumProfile');

  // Rac khoa cu con lai tu lan sap truoc — phai duoc don, khong thi Chromium khong mo noi.
  const pdir = browser.persistDir(profileDir);
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'SingletonLock'), 'stale', 'utf8');

  launches.length = 0;
  const ctx1 = await browser.acquireProfileContext(profileDir, { headless: true });
  eq(launches.length, 1, 'goi launchPersistentContext dung 1 lan');
  eq(launches[0].dir, pdir, 'mo dung thu muc ChromiumProfile');
  eq(launches[0].opts.headless, true, 'truyen headless dung');
  ok(!fs.existsSync(path.join(pdir, 'SingletonLock')), 'da don SingletonLock cu ket lai');
  ok(launches[0].opts.args.some(a => a.startsWith('--disk-cache-size=')),
    'co gioi han cache dia (khong de Chromium phinh ra ca GB)');
  ok(launches[0].opts.args.some(a => a.startsWith('--media-cache-size=')),
    'co gioi han cache media');

  // ── 3. Van tay giong y che do thuong ──
  console.log('\n3. Van tay phai y het che do thuong (QD-05)');
  const fp = fingerprint.getFingerprint(profileDir);
  const expect = fingerprint.contextOptions(fp);
  let sameFp = true, badKey = '';
  for (const k of Object.keys(expect)) {
    if (JSON.stringify(launches[0].opts[k]) !== JSON.stringify(expect[k])) { sameFp = false; badKey = k; }
  }
  ok(sameFp, 'moi option van tay khop contextOptions(fp)', `lech o "${badKey}"`);
  eq(launches[0].opts.viewport.width, fp.screen.width, 'viewport rong = man hinh cua van tay');
  eq(ctx1._initScripts, 1, 'da cai initScript che vet automation');

  // ── 4. Lan dau: mang cookie tu session.state.json sang ──
  console.log('\n4. Lan dau bat: mang cookie sang, KHONG mat dang nhap');
  eq(ctx1._cookiesAdded.length, 2, 'da nap 2 cookie tu session.state.json');
  ok(ctx1._cookiesAdded.some(c => c.name === 'sessionid'), 'co cookie xac thuc sessionid');
  ok(ctx1._cookiesAdded.some(c => c.name === 'tt-target-idc'), 'co cookie dinh tuyen tt-target-idc');

  // ── 5. Tab dem dung CHUNG context ──
  console.log('\n5. Tab dem dung chung context (mot dir khong mo 2 Chromium)');
  launches.length = 0;
  const cnt = await browser.acquireCountContext(ctx1, profileDir);
  eq(launches.length, 0, 'KHONG mo them trinh duyet nao cho tab dem');
  eq(cnt.ctx, ctx1, 'tra ve dung context cua profile');
  eq(cnt.shared, true, 'danh dau shared = true');
  await browser.releaseCountContext(cnt);
  eq(ctx1.closed, false, 'releaseCountContext KHONG dong context dung chung');

  // ── 5b. Nut 🦊 khi profile ĐANG CRAWL ──
  // Day la bug that da suyt lot: getContext() tra ve CHINH context dang quet, ma openForLogin
  // cu ban goi pages()[0] → goto(tiktok.com) len TAB FEED dang cuon = pha vong quet.
  console.log('\n5b. Nut 🦊 luc dang crawl: mo TAB MOI, khong chiem tab feed');
  const feedPage = await ctx1.newPage();        // gia lap tab feed dang quet
  await feedPage.goto('https://www.tiktok.com/foryou');
  launches.length = 0;
  const loginCtx = await browser.openForLogin(profileDir, { blockImages: true });
  eq(launches.length, 0, 'KHONG mo them Chromium (dung lai context dang crawl)');
  eq(loginCtx, ctx1, 'dung lai dung context cua profile dang chay');
  eq(feedPage._goto.length, 1, 'tab feed KHONG bi goto de len (van 1 lan goto ban dau)');
  const loginPage = ctx1._pages[ctx1._pages.length - 1];
  ok(loginPage !== feedPage, 'da mo mot TAB MOI cho dang nhap');
  ok(loginPage._goto.some(u => u.includes('tiktok.com')), 'tab moi moi la tab dieu huong TikTok');
  eq(ctx1._routed, 0, 'KHONG chan anh o muc context (se de len ca tab quet)');
  eq(loginPage._routed, 1, 'chan anh dat o muc TAB dang nhap');

  console.log('\n5c. Bam ❌ chi dong tab 🦊, khong dong context dang quet');
  await browser.closeProfile(profileDir);
  eq(loginPage.closed, true, 'tab dang nhap da dong');
  eq(feedPage.closed, false, 'tab feed VAN SONG');
  eq(ctx1.closed, false, 'context dang quet VAN SONG');

  // ── 6. Dong profile ──
  console.log('\n6. Dong profile thi dong luon Chromium rieng do');
  await browser.releaseProfileContext(profileDir);
  eq(ctx1.closed, true, 'context da dong');

  // ── 7. Lan thu 2 (profile da co san) thi khong nap lai cookie ──
  console.log('\n7. Lan chay sau: Chromium tu giu phien, khong nap chong cookie');
  fs.mkdirSync(path.join(pdir, 'Default'), { recursive: true });   // gia lap profile da dung roi
  launches.length = 0;
  const ctx2 = await browser.acquireProfileContext(profileDir, { headless: true });
  eq(launches.length, 1, 'van mo lai tu thu muc cu');
  eq(ctx2._cookiesAdded.length, 0, 'KHONG nap lai cookie (tranh de cookie cu ghi de phien moi)');
  await browser.releaseProfileContext(profileDir);

  // ── 8. Tat cong tac thi quay ve duong cu ──
  console.log('\n8. Tat cong tac thi quay ve "1 Chromium dung chung"');
  browser.setPersistentProfiles(false);
  let threw = '';
  try {
    await browser.acquireProfileContext(profileDir, { headless: true });
  } catch (e) { threw = e.message; }
  ok(threw.includes('KHONG duoc goi chromium.launch'),
    'che do tat di qua chromium.launch() (duong cu), khong phai launchPersistentContext');

  const cnt2 = { ctx: makeFakeContext('x'), shared: false };
  await browser.releaseCountContext(cnt2);
  eq(cnt2.ctx.closed, true, 'context RIENG cua tab dem thi van phai duoc dong');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} dat, ${fail} truot\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
