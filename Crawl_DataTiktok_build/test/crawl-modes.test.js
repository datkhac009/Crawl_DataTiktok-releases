// test/crawl-modes.test.js — Smoke test cho vòng quét feed dùng chung (runScanLoop).
// Mock toàn bộ Playwright + browser.cjs để chạy được crawler THẬT mà không cần TikTok.
// Muc dich: kiem chung 4 che do (foryou/search/current/cycle) van phat ra dung cac dong
// log/hanh vi nhu TRUOC khi gop 4 vong lap thanh 1.
'use strict';

const path = require('path');
const Module = require('module');

// Rut ngan nhip cho khi tam dung vi IP lech vung (that la 60s) de test duong tu phuc hoi.
process.env.TTC_IP_RETRY_MS = '250';

const SRC = path.join(__dirname, '..', 'src');
const browserPath = require.resolve(path.join(SRC, 'browser.cjs'));
const profilesPath = require.resolve(path.join(SRC, 'profiles.cjs'));
const ipGuardPath = require.resolve(path.join(SRC, 'ip-guard.cjs'));

// ── Fake page: tra ve chuoi sound do kich ban quy dinh ──
function makeFakePage(script) {
  let readIdx = 0;
  const calls = { goto: [], reload: 0, wheel: 0, click: [], waitForSelector: [], keyboard: [] };
  const page = {
    _calls: calls,
    async goto(u) { calls.goto.push(u); },
    async reload() { calls.reload++; },
    async waitForSelector(s) { calls.waitForSelector.push(s); },
    async bringToFront() {},
    async close() {},
    async route() {},
    async unroute() {},
    viewportSize: () => ({ width: 1536, height: 864 }),
    mouse: {
      async move() {},
      async wheel() { calls.wheel++; },
      async click(x, y) { calls.click.push([x, y]); },
    },
    keyboard: { async press(k) { calls.keyboard.push(k); } },
    locator: () => {
      // Moi cap locator phai co DAY DU click/fill/waitFor/count/nth — che do search goi
      // input.fill() tren ket qua cua .first(), thieu la nga o buoc "Go tu khoa".
      const leaf = {
        async waitFor() {}, async click() {}, async fill() {},
        async count() { return 3; }, nth: () => leaf, first: () => leaf,
      };
      return { ...leaf, filter: () => ({ first: () => leaf }) };
    },
    async waitForResponse() { return null; },
    // page.evaluate: phan biet theo cach crawler goi
    async evaluate(fn) {
      const src = String(fn);
      // checkLoginState
      if (src.includes('top-login-button')) return script.loginState || 'logged-in';
      // diagnoseFeed — PHAI xet TRUOC readActiveSound: ca hai deu chua 'video-music' +
      // 'getBoundingClientRect' + 'aria-label', neu xet sau se bi readActiveSound an mat.
      if (src.includes('activeElement')) {
        return { links: 2, videoReady: 4, active: 'BODY', overlay: '' };
      }
      // readActiveSound
      if (src.includes('video-music') && src.includes('getBoundingClientRect') && src.includes('aria-label')) {
        const v = script.sounds[Math.min(readIdx, script.sounds.length - 1)];
        readIdx++;
        return v;
      }
      // _findNextButtonInPage
      if (src.includes('action-item')) return { x: 1480, y: 440, label: 'action-item' };
      // readVideoCount / duration / like
      if (src.includes('videos?')) return null;
      if (src.includes('duration')) return 10;
      return null;
    },
  };
  return page;
}

// Mock ip-guard: `ipScript` la mang cac state tra ve theo tung lan goi (lan cuoi lap mai).
// Vd ['mismatch','mismatch','ok'] = lech 2 lan roi VPN ve dung vung -> phai TU CHAY TIEP.
function installIpGuardMock(ipScript) {
  let i = 0;
  const fake = {
    async check(want) {
      const state = ipScript[Math.min(i, ipScript.length - 1)];
      i++;
      if (state === 'skip') return { state: 'skip', ip: null, country: null, want: null };
      if (state === 'unknown') return { state: 'unknown', ip: '1.2.3.4', country: null, want };
      if (state === 'mismatch') return { state: 'mismatch', ip: '1.2.3.4', country: 'DE', want };
      return { state: 'ok', ip: '1.2.3.4', country: want, want };
    },
    async getPublicIp() { return { ip: '1.2.3.4', country: 'US' }; },
    _calls: () => i,
  };
  require.cache[ipGuardPath] = new Module(ipGuardPath, null);
  require.cache[ipGuardPath].filename = ipGuardPath;
  require.cache[ipGuardPath].loaded = true;
  require.cache[ipGuardPath].exports = fake;
  return fake;
}

function installMocks(page, profileName) {
  const ctx = {
    pages: () => [page],
    async newPage() { return page; },
    async close() {},
    async cookies() { return []; },
    async addCookies() {},
    browser: () => ({ isConnected: () => true }),
  };
  // Mock browser.cjs
  const fakeBrowser = {
    TIKTOK_HOME: 'https://www.tiktok.com',
    checkProfileBusy: () => null,
    async acquireProfileContext() { return ctx; },
    async releaseProfileContext() {},
    getExistingContext: () => ctx,
    async getActivePage() { return page; },
    async acquireCountContext() { return { ctx }; },
    async releaseCountContext() {},
    markSessionVerified() {},
  };
  require.cache[browserPath] = new Module(browserPath, null);
  require.cache[browserPath].filename = browserPath;
  require.cache[browserPath].loaded = true;
  require.cache[browserPath].exports = fakeBrowser;

  // Mock profiles.cjs
  // Ten profile QUAN TRONG: fingerprint.countryOf() suy nhan quoc gia tu ten THU MUC, nen
  // 'TEST(UK)' -> co canh IP, 'TEST_KHONG_NHAN' -> bo qua canh IP hoan toan.
  const pname = profileName || 'TEST(UK)';
  const fakeProfiles = {
    loadProfiles: () => [{ id: 'p_test', name: pname, folderName: pname }],
    getProfilePath: () => path.join(__dirname, '..', 'profiles', pname),
  };
  require.cache[profilesPath] = new Module(profilesPath, null);
  require.cache[profilesPath].filename = profilesPath;
  require.cache[profilesPath].loaded = true;
  require.cache[profilesPath].exports = fakeProfiles;
}

// ── Chay 1 kich ban ──
async function run({ name, mode, sounds, loginState, runMs, ipScript = ['ok'], profileName, extra = {} }) {
  // Xoa cache crawler de moi kich ban co trang thai phien sach
  for (const k of Object.keys(require.cache)) {
    if (k.includes('crawler') || k.includes('browser.cjs') || k.includes('profiles.cjs')
        || k.includes('ip-guard.cjs')) delete require.cache[k];
  }
  const page = makeFakePage({ sounds, loginState });
  installMocks(page, profileName);
  installIpGuardMock(ipScript);
  const crawler = require(path.join(SRC, 'crawler.cjs'));

  const msgs = [];
  const data = [];
  const res = crawler.startProfile(
    {
      profileId: 'p_test', mode,
      minDelay: 1, maxDelay: 2, recycleEvery: extra.recycleEvery ?? 0,
      minVideos: 0, maxVideos: 0, headless: true, keyword: 'test kw',
      viewLinks: ['https://www.tiktok.com/music/original-sound-1234567890'],
      cycleScanHours: extra.cycleScanHours ?? 0.0005,   // ~1.8s
      cycleViewMinutes: 0.01, cycleBreakMin: 0, cycleBreakMax: 0,
      ...extra.params,
    },
    (d) => data.push(d),
    (pid, status, msg) => { if (msg) msgs.push(`[${status}] ${msg}`); },
  );
  if (!res.ok) return { name, error: res.msg, msgs };

  await new Promise(r => setTimeout(r, runMs));
  crawler.stopProfile('p_test');
  await new Promise(r => setTimeout(r, 400));
  return { name, msgs, data, calls: page._calls };
}

// ── Cac kich ban ──
const SOUND_A = { href: '/music/original-sound-1111111111', name: 'original sound - a' };
const SOUND_B = { href: '/music/original-sound-2222222222', name: 'original sound - b' };
const SOUND_C = { href: '/music/original-sound-3333333333', name: 'original sound - c' };

(async () => {
  const results = [];

  results.push(await run({
    name: 'foryou — quet duoc sound moi',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 900,
  }));

  results.push(await run({
    name: 'search — log phai co tien to Tim "kw":',
    // search co cac buoc dieu huong (sleep 1200 + 1500) truoc khi vao vong quet -> can lau hon
    mode: 'search', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 4200,
  }));

  results.push(await run({
    name: 'current — cao tren tab dang mo',
    mode: 'current', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 900,
  }));

  results.push(await run({
    name: 'cycle — pha QUET co tien to Chu ky [Quet]:',
    mode: 'cycle', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 1200,
  }));

  results.push(await run({
    name: 'KET: doc trung 1 sound 20 lan -> phai canh bao + thoat ket',
    mode: 'foryou', sounds: [SOUND_A], runMs: 1500,
  }));

  results.push(await run({
    name: 'KET: KHONG doc duoc sound nao (null) -> phai canh bao (bug da fix 2026-07-28)',
    mode: 'foryou', sounds: [null], runMs: 1500,
  }));

  // runMs phai DU DAI: tu 2026-07-31 ket luan 'guest' can 3 lan doc LIEN TIEP cach nhau 2s
  // (~4-6s) de khong bao khach oan luc trang dang hydrate — xem session-watch.cjs.
  results.push(await run({
    name: 'GUEST: feed hien nhung dang che do khach -> phai dung ngay',
    mode: 'foryou', sounds: [SOUND_A], loginState: 'guest', runMs: 9000,
  }));

  // ── 2 case KIEM CHUNG KHAC BIET HANH VI giua cac che do (de hoi quy nhat khi gop) ──
  results.push(await run({
    name: 'RECYCLE foryou (recycleEvery=5) -> PHAI co reload + log "Tải lại feed để xả RAM"',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 900,
    extra: { recycleEvery: 5 },
  }));

  results.push(await run({
    name: 'RECYCLE current (recycleEvery=5) -> PHAI reload = 0 (tab cua NGUOI DUNG, khong duoc tai lai)',
    mode: 'current', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 900,
    extra: { recycleEvery: 5 },
  }));

  // ── CANH IP KHOP NHAN QUOC GIA (VPN tut tren VPS) ──
  results.push(await run({
    name: 'IP-GUARD: IP lech vung -> PHAI TAM DUNG, KHONG quet duoc sound nao',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B], runMs: 900, ipScript: ['mismatch'],
  }));

  results.push(await run({
    name: 'IP-GUARD: lech 2 lan roi VPN ve dung vung -> PHAI TU CHAY TIEP va quet duoc',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 1600,
    ipScript: ['mismatch', 'mismatch', 'ok'],
  }));

  results.push(await run({
    name: 'IP-GUARD: khong tra duoc IP (mat mang) -> KHONG duoc chan, van phai quet',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 900, ipScript: ['unknown'],
  }));

  results.push(await run({
    name: 'IP-GUARD: profile KHONG co nhan quoc gia -> bo qua canh IP, van quet',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 900,
    profileName: 'TEST_KHONG_NHAN', ipScript: ['mismatch'],   // du mismatch cung phai chay
  }));

  for (const r of results) {
    console.log('\n' + '='.repeat(78));
    console.log('### ' + r.name);
    if (r.error) { console.log('  startProfile tu choi:', r.error); continue; }
    console.log('  --- log phat ra ---');
    for (const m of r.msgs) console.log('   ' + m);
    if (r.data && r.data.length) console.log('  --- onData:', r.data.length, 'dong');
    if (r.calls) console.log('  --- wheel:', r.calls.wheel, '| reload:', r.calls.reload, '| click:', JSON.stringify(r.calls.click));
  }
  console.log('\nDONE');
  process.exit(0);
})();
