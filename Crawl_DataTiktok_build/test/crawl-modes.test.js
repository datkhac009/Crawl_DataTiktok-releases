// test/crawl-modes.test.js — Smoke test cho vòng quét feed dùng chung (runScanLoop).
// Mock toàn bộ Playwright + browser.cjs để chạy được crawler THẬT mà không cần TikTok.
// Muc dich: kiem chung 4 che do (foryou/search/current/cycle) van phat ra dung cac dong
// log/hanh vi nhu TRUOC khi gop 4 vong lap thanh 1.
'use strict';

const path = require('path');
const Module = require('module');

// Rut ngan nhip cho khi tam dung vi IP lech vung (that la 60s) de test duong tu phuc hoi.
process.env.TTC_IP_RETRY_MS = '250';
// Rut ngan backoff khi FEED CAN (that la 5/15/30 phut) de test duong tam dung + thu lai.
process.env.TTC_STARVE_RETRY_MS = '300';
// Rut ngan cho giua 2 luot doc so video (that la 2.5s). Ngan sach doc GIAO DIEN (2.5s/5s) khong
// rut ngan duoc nen cac kich ban DEM ben duoi van can runMs vai giay.
process.env.TTC_COUNT_RETRY_MS = '100';
// Rut ngan nhip kiem lai phien dang nhap (that la 15 PHUT) — de test duoc duong "TikTok huy phien
// GIUA CHUNG", duong tung lam profile ket vinh vien o trang thai "dang chay".
process.env.TTC_LOGIN_RECHECK_MS = '500';
// Rut ngan backoff khi bi chan trang dem (that la 30s/2p/5p) — de test duong "bi chan KEO DAI ->"
// bo cuoc", khong co no thi phai cho hon 20 phut.
process.env.TTC_BLOCK_BACKOFF_MS = '50';

const SRC = path.join(__dirname, '..', 'src');
const browserPath = require.resolve(path.join(SRC, 'browser.cjs'));
const profilesPath = require.resolve(path.join(SRC, 'profiles.cjs'));
const ipGuardPath = require.resolve(path.join(SRC, 'ip-guard.cjs'));
const throttlePath = require.resolve(path.join(SRC, 'crawler', 'count-throttle.cjs'));

// ── Theo doi SLOT DEM (semaphore TOAN APP, chi 2 slot cho moi profile) ──
// Vi sao phai theo doi: slot bi GIU trong luc ngu giua 2 luot thu lai => tren may ao yeu, 1
// sound loi chiem slot toi 30-49 GIAY => thong luong dem tut duoi nhip cuon => hang doi day =>
// vong quet dung o nhanh cho => FEED NGUNG CUON (loi that nguoi dung bao 2026-08-06).
// Nha THUA cung nguy hiem khong kem: semaphore tuong con cho => hon 2 request /music/ song song,
// dung thu QD-21 sinh ra de chan. Nen phai kiem CA HAI chieu.
let slotLog = null;
function installThrottleSpy() {
  const real = require(throttlePath);
  slotLog = { acquires: 0, releases: 0, held: 0, maxHeld: 0, heldDuringSleep: false };
  const fake = {
    ...real,
    async acquireCountSlot(stop) {
      const ok = await real.acquireCountSlot(stop);
      if (ok) {
        slotLog.acquires++;
        slotLog.held++;
        if (slotLog.held > slotLog.maxHeld) slotLog.maxHeld = slotLog.held;
      }
      return ok;
    },
    releaseCountSlot() {
      slotLog.releases++;
      slotLog.held--;
      if (slotLog.held < 0) slotLog.heldDuringSleep = true;   // nha thua => am
      return real.releaseCountSlot();
    },
  };
  require.cache[throttlePath] = new Module(throttlePath, null);
  require.cache[throttlePath].filename = throttlePath;
  require.cache[throttlePath].loaded = true;
  require.cache[throttlePath].exports = fake;
}

// ── Fake page: tra ve chuoi sound do kich ban quy dinh ──
function makeFakePage(script) {
  let readIdx = 0;
  const bornAt = Date.now();   // moc de gia lap "TikTok huy phien sau N ms" (xem guestAfterMs)
  const calls = { goto: [], musicGoto: 0, reload: 0, wheel: 0, click: [], waitForSelector: [], keyboard: [] };
  const page = {
    _calls: calls,
    // musicGoto = so LUOT mo trang /music/ = so luot doc so video. La thu duy nhat chung minh
    // duoc "co thu lai" hay "khong thu lai" — dem log thi khong chac.
    async goto(u) { calls.goto.push(u); if (String(u).includes('/music/')) calls.musicGoto++; },
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
    // ── Kich ban DEM SO VIDEO, theo TUNG LUOT doc (attempt) ──
    //   countApi[i] = response gia o luot i  ({status, body}; null = khong co response nao)
    //   countDom[i] = ket qua doc giao dien o luot i (null = khong doc duoc)
    // ⚠ BAT DOI XUNG ve chi so — nham la test do sai ma tuong dung:
    //   waitForResponse duoc crawler goi TRUOC goto -> luot hien tai = musicGoto
    //   readVideoCount  duoc goi SAU  goto          -> luot hien tai = musicGoto - 1
    async waitForResponse() {
      if (!script.countApi) return null;
      const spec = script.countApi[Math.min(calls.musicGoto, script.countApi.length - 1)];
      if (!spec) return null;
      return { status: () => (spec.status ?? 200), async text() { return spec.body ?? ''; } };
    },
    // page.evaluate: phan biet theo cach crawler goi
    async evaluate(fn) {
      const src = String(fn);
      // checkLoginState.
      // `guestAfterMs`: dang nhap TOT luc dau roi TikTok HUY PHIEN giua chung — dung tinh huong
      // that trong log nguoi dung 2026-08-07, va la duong tung lam profile ket vinh vien.
      if (src.includes('top-login-button')) {
        if (script.guestAfterMs && Date.now() - bornAt >= script.guestAfterMs) return 'guest';
        return script.loginState || 'logged-in';
      }
      // diagnoseFeed — PHAI xet TRUOC readActiveSound: ca hai deu chua 'video-music' +
      // 'getBoundingClientRect' + 'aria-label', neu xet sau se bi readActiveSound an mat.
      if (src.includes('activeElement')) {
        return { links: script.links ?? 2, videoReady: 4, active: 'BODY', overlay: '' };
      }
      // readActiveSound
      if (src.includes('video-music') && src.includes('getBoundingClientRect') && src.includes('aria-label')) {
        const v = script.sounds[Math.min(readIdx, script.sounds.length - 1)];
        readIdx++;
        return v;
      }
      // _findNextButtonInPage — 3 ca, dung dung 3 hinh dang tra ve that cua ham do:
      //   'enabled'  -> { x, y, label }        nut bam duoc
      //   'disabled' -> { disabled, label }    CO nut nhung TikTok da TAT (bao het video)
      //   'none'     -> null                  khong co nut nao
      if (src.includes('action-item')) {
        const nb = script.navButton || 'enabled';
        if (nb === 'none') return null;
        if (nb === 'disabled') return { disabled: true, label: 'action-item' };
        return { x: 1480, y: 440, label: 'action-item' };
      }
      // readVideoCount / duration / like
      if (src.includes('videos?')) {
        if (!script.countDom) return null;
        const i = Math.min(Math.max(calls.musicGoto - 1, 0), script.countDom.length - 1);
        return script.countDom[i] ?? null;
      }
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
async function run({ name, mode, sounds, loginState, runMs, ipScript = ['ok'], profileName,
                     links, navButton, countApi, countDom, countMode, noStop, guestAfterMs, extra = {} }) {
  // Xoa cache crawler de moi kich ban co trang thai phien sach
  for (const k of Object.keys(require.cache)) {
    if (k.includes('crawler') || k.includes('browser.cjs') || k.includes('profiles.cjs')
        || k.includes('ip-guard.cjs') || k.includes('count-throttle.cjs')) delete require.cache[k];
  }
  const page = makeFakePage({ sounds, loginState, links, navButton, countApi, countDom, guestAfterMs });
  installMocks(page, profileName);
  installIpGuardMock(ipScript);
  installThrottleSpy();
  const crawler = require(path.join(SRC, 'crawler.cjs'));
  // Che do dem la trang thai MODULE (nhu setCountConcurrency) -> dat sau khi require, truoc khi chay.
  if (countMode) crawler.setCountMode(countMode);

  const msgs = [];
  const data = [];
  const pending = [];   // cac dong bi day sang TAB CHO (QĐ-33)
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
    (row) => { pending.push(row); return true; },
  );
  if (!res.ok) return { name, error: res.msg, msgs };

  await new Promise(r => setTimeout(r, runMs));
  // ⚠ ĐO TRƯỚC khi gọi stopProfile: `noStop` dùng để kiểm profile có TỰ thoát khỏi `_active` khi
  // vòng quét kết thúc (vd TikTok huỷ phiên giữa chừng) hay không. Gọi stopProfile rồi mới đo thì
  // che mất bug — profile nào cũng thoát.
  const stillRunningBeforeStop = crawler.isProfileRunning('p_test');
  if (!noStop) crawler.stopProfile('p_test');
  await new Promise(r => setTimeout(r, 400));
  return {
    name, msgs, data, pending, calls: page._calls, slots: slotLog,
    stillRunningBeforeStop, stillRunningAfter: crawler.isProfileRunning('p_test'),
  };
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

  // ── FEED CAN: TikTok KHONG CAP THEM VIDEO cho profile/IP nay (2026-08-05) ──
  // Su co that: 1 may ao, profile CON dang nhap (nut 🔑 xac nhan), nhung trang chi co 2 video
  // va nut "video ke tiep" bi TikTok TAT. App quay vong thoat ket cach 1→2→3 gan 2 gio, ra
  // 0 sound hop le. 4 kich ban duoi kiem CA hai chieu: bao dung khi can, va KHONG bao oan.
  // ⚠ runMs phai DU cho TRON MOT VONG 3 CAP thoat ket: cap 2 ("cuon manh 3 nhip con lan")
  // mat ~2.1s vi 3 x sleep(700) trong unstickFeed. Dat 2600ms thi moi den ket lan 2 -> chua
  // du dieu kien (4) nen KHONG bao gi, va khang dinh truot oan (da gap khi viet test nay).
  const starveForyou = await run({
    name: 'FEED CAN foryou: 2 video + nut ke tiep DANG TAT -> phai bao + TAM DUNG co backoff',
    mode: 'foryou', sounds: [SOUND_A], runMs: 4200, links: 2, navButton: 'disabled',
  });
  results.push(starveForyou);

  const starveNoBtn = await run({
    name: 'FEED CAN foryou: 2 video + KHONG co nut nao -> cung phai bao feed can',
    mode: 'foryou', sounds: [SOUND_A], runMs: 4200, links: 2, navButton: 'none',
  });
  results.push(starveNoBtn);

  const notStarvedEnabled = await run({
    name: 'KHONG BAO OAN: 2 video nhung nut VAN BAM DUOC -> chi thoat ket, khong bao feed can',
    mode: 'foryou', sounds: [SOUND_A], runMs: 4200, links: 2, navButton: 'enabled',
  });
  results.push(notStarvedEnabled);

  const notStarvedManyLinks = await run({
    name: 'KHONG BAO OAN: nut TAT nhung feed con 8 video -> khong bao feed can',
    mode: 'foryou', sounds: [SOUND_A], runMs: 4200, links: 8, navButton: 'disabled',
  });
  results.push(notStarvedManyLinks);

  const starveGuest = await run({
    name: 'FEED CAN + dang la KHACH -> phai bao KHACH (khong bao feed can, huong chua khac han)',
    mode: 'foryou', sounds: [SOUND_A], loginState: 'guest', runMs: 12000,
    links: 2, navButton: 'disabled',
  });
  results.push(starveGuest);

  const starveCycle = await run({
    name: 'FEED CAN cycle: phai KET THUC PHA QUET SOM roi sang pha XEM',
    mode: 'cycle', sounds: [SOUND_A], runMs: 3200, links: 2, navButton: 'disabled',
  });
  results.push(starveCycle);

  // ── DEM SO VIDEO: THU LAI khi TikTok tra trang loi (2026-08-06) ──
  // Lay tu ca THAT tren VPS: trang /music/ hien "Something went wrong — Please try again later",
  // API tra statusCode 10203 voi body ~200 byte khong co musicInfo.
  const API_OK = { status: 200, body: JSON.stringify({ statusCode: 0, musicInfo: { stats: { videoCount: 4321 } } }) };
  const API_ODD = { status: 200, body: JSON.stringify({ statusCode: 10203 }) };
  const API_GONE = { status: 400, body: JSON.stringify({ statusCode: 10201 }) };

  const retryWin = await run({
    name: 'DEM: luot 1 statusCode LA, luot 2 API doc duoc -> phai THU LAI va LAY DUOC sound',
    mode: 'foryou', sounds: [SOUND_A], runMs: 7000,
    countApi: [API_ODD, API_OK], countDom: [null, null],
  });
  results.push(retryWin);

  const retryDom = await run({
    name: 'DEM: luot 2 API van la nhung GIAO DIEN doc duoc "4.5K" -> lay duoc 4500',
    mode: 'foryou', sounds: [SOUND_C], runMs: 8000,
    countApi: [API_ODD, API_ODD], countDom: [null, '4.5K'],
  });
  results.push(retryDom);

  // runMs phai du cho: luot 1 doc DOM 6x500ms=3s + cho 100ms + luot 2 doc DOM 12x500ms=6s.
  // Luot 2 kien nhan GAP DOI vi VPS yeu co the dung trang cham hon 3s (nguyen nhan that).
  const retryFail = await run({
    name: 'DEM: ca 2 luot deu truot -> BO khoi du lieu chinh, log statusCode LA, day sang TAB CHO',
    mode: 'foryou', sounds: [SOUND_B], runMs: 13000,
    countApi: [API_ODD, API_ODD], countDom: [null, null],
  });
  results.push(retryFail);

  const goneNoRetry = await run({
    name: 'DEM: sound DA XOA (10201) -> KHONG thu lai, KHONG vao tab cho',
    mode: 'foryou', sounds: [SOUND_C], runMs: 4000, countApi: [API_GONE],
  });
  results.push(goneNoRetry);

  const okNoRetry = await run({
    name: 'DEM: doc duoc ngay luot 1 -> KHONG thu lai',
    mode: 'foryou', sounds: [SOUND_A], runMs: 4000, countApi: [API_OK],
  });
  results.push(okNoRetry);

  // ── CHE DO DEM: 'patient' (= quy trinh ban 0.1.63) vs 'fast' ──
  // Nguoi dung chay 5 may voi CUNG mot .exe, ma may manh va may ao can danh doi NGUOC NHAU. Cong
  // tac nay la cach duy nhat lam duoc ca hai — nen phai kiem no THAT SU doi hanh vi.
  const patientBothFail = await run({
    name: 'CHE DO patient: KHONG thu lai (dung nhu ban 0.1.63)',
    mode: 'foryou', sounds: [SOUND_A], runMs: 9000, countMode: 'patient',
    countApi: [API_ODD, API_OK], countDom: [null, null],
  });
  results.push(patientBothFail);

  const fastRetries = await run({
    name: 'CHE DO fast: CO thu lai -> cuu duoc sound ma patient bo mat',
    mode: 'foryou', sounds: [SOUND_A], runMs: 9000, countMode: 'fast',
    countApi: [API_ODD, API_OK], countDom: [null, null],
  });
  results.push(fastRetries);

  // Cong tac tat: doi bien moi truong roi chay lai — run() xoa cache crawler nen hang so duoc
  // doc lai. Phai TRA LAI ngay sau do, khong thi cac kich ban sau bi anh huong.
  process.env.TTC_COUNT_ATTEMPTS = '1';
  const retryOff = await run({
    name: 'DEM: TTC_COUNT_ATTEMPTS=1 -> TAT hoan toan viec thu lai (khong can build lai)',
    mode: 'foryou', sounds: [SOUND_B], runMs: 6000,
    countApi: [API_ODD, API_OK], countDom: [null, null],
  });
  delete process.env.TTC_COUNT_ATTEMPTS;
  results.push(retryOff);

  for (const r of results) {
    console.log('\n' + '='.repeat(78));
    console.log('### ' + r.name);
    if (r.error) { console.log('  startProfile tu choi:', r.error); continue; }
    console.log('  --- log phat ra ---');
    for (const m of r.msgs) console.log('   ' + m);
    if (r.data && r.data.length) console.log('  --- onData:', r.data.length, 'dong');
    if (r.calls) console.log('  --- wheel:', r.calls.wheel, '| reload:', r.calls.reload, '| click:', JSON.stringify(r.calls.click));
  }

  // ── KHANG DINH THAT ──
  // ⚠ Cac kich ban PHIA TREN (13 cai goc) chi IN log ra cho nguoi doc, KHONG co khang dinh
  // nao — nen chung KHONG tu bat duoc hoi quy. Phan duoi day la khang dinh thuc su (fail thi
  // exit code khac 0) cho duong FEED CAN moi them.
  let failed = 0;
  const has = (r, needle) => (r.msgs || []).some(m => m.includes(needle));
  // Trich than mot ham tu renderer.js (dem ngoac) — dung de kiem hop dong tren MA NGUON.
  // Cung ky thuat voi test/vpn-run-lock.test.js; PHAI keo theo chu `async` phia truoc.
  function extractRendererFn(src, name) {
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
  function ok(cond, label) {
    console.log((cond ? '  ✓ ' : '  ✗ ') + label);
    if (!cond) failed++;
  }

  console.log('\n' + '='.repeat(78));
  console.log('### KHANG DINH: phat hien FEED CAN');

  ok(has(starveForyou, 'KHÔNG cấp thêm video'), 'nut TAT -> bao dung "KHONG cap them video"');
  ok(has(starveForyou, 'ĐANG BỊ TẮT'),
    'noi ro nut ke tiep DANG BI TAT — bang chung truc tiep TikTok het video');
  ok(has(starveForyou, 'Phiên đăng nhập vẫn TỐT'),
    'noi ro phien VAN TOT, de khong ai di bam 🦊 vo ich');
  ok(has(starveForyou, '⏸'), 'sau do TAM DUNG (khong quay vong thoat ket vo han nua)');
  ok(has(starveForyou, 'đổi IP/VPN'), 'chi dung viec can lam o NGOAI app: doi IP/VPN hoac Tim kiem');
  ok(has(starveForyou, 'Hết giờ tạm dừng'), 'het backoff thi TU THU LAI (khong dung han)');
  ok(!has(starveForyou, 'chế độ KHÁCH'), 'KHONG bao nham thanh che do khach');

  ok(has(starveNoBtn, 'KHÔNG cấp thêm video'), 'khong co nut nao -> cung ket luan feed can');
  ok(has(starveNoBtn, 'không có nút'), 'phan biet duoc "khong co nut" voi "nut bi TAT"');

  console.log('### KHANG DINH: KHONG bao oan (quan trong hon — bao oan lam profile khoe tu dung)');
  ok(!has(notStarvedEnabled, 'KHÔNG cấp thêm video'), 'nut con bam duoc -> KHONG bao feed can');
  ok(has(notStarvedEnabled, 'thử cách'), 'van chay thoat ket 3 cap nhu cu');
  ok(!has(notStarvedManyLinks, 'KHÔNG cấp thêm video'), 'feed con 8 video -> KHONG bao feed can');
  ok(has(starveGuest, 'chế độ KHÁCH'), 'dang la KHACH -> phai bao KHACH');
  ok(!has(starveGuest, 'KHÔNG cấp thêm video'), 'dang la KHACH -> KHONG bao feed can');

  console.log('### KHANG DINH: che do chu ky nhay sang pha XEM thay vi tam dung');
  ok(has(starveCycle, 'kết thúc pha QUÉT SỚM'), 'cycle: ket thuc pha QUET som');
  ok(has(starveCycle, 'pha XEM'), 'cycle: chuyen sang pha XEM');
  ok(!has(starveCycle, '⏸'), 'cycle: KHONG dung backoff (da co pha Xem de nhay sang)');

  console.log('### KHANG DINH: THU LAI khi TikTok tra trang loi (2026-08-06)');
  const cnt = (r) => (r.data || []).map(d => d.count);
  ok(retryWin.calls.musicGoto === 2,
    `luot 1 truot -> mo lai trang /music/ dung 2 lan (that: ${retryWin.calls.musicGoto})`);
  ok(has(retryWin, 'thử lại lượt 2/2'), 'co log noi ro dang thu lai luot may tren luot may');
  ok(retryWin.data.length === 1 && retryWin.data[0].count === 4321,
    `luot 2 doc duoc -> sound VAO du lieu voi so DUNG 4321 (that: ${JSON.stringify(cnt(retryWin))})`);
  ok(retryWin.pending.length === 0, 'da doc duoc thi KHONG day sang tab cho nua');
  ok(retryDom.data.length === 1 && retryDom.data[0].count === 4500,
    `luot 2 doc bang GIAO DIEN "4.5K" -> 4500 (that: ${JSON.stringify(cnt(retryDom))})`);

  ok(retryFail.calls.musicGoto === 2,
    `ca 2 luot truot -> dung dung o 2 luot roi bo (that: ${retryFail.calls.musicGoto})`);
  ok(has(retryFail, 'statusCode lạ 10203'),
    'log ro statusCode LA — truoc day ca nay bi bo qua trong IM LANG nen 10203 ton tai ma khong ai biet');
  ok(has(retryFail, 'byte'), 'log kem do dai body, de ve sau phan loai duoc ma la');
  ok(retryFail.data.length === 0, 'ca 2 luot truot -> KHONG ghi dong nao vao du lieu chinh (QĐ-07)');
  ok(retryFail.pending.length === 1,
    `ca 2 luot truot ma sound CON SONG -> day sang TAB CHO (that: ${retryFail.pending.length})`);
  ok(retryFail.pending[0] && retryFail.pending[0].count === '',
    'dong tab cho de TRONG o so video (khong bao gio doan so)');

  console.log('### KHANG DINH: KHONG thu lai khi khong can (tu tang tai la tu lam minh bi chan)');
  ok(goneNoRetry.calls.musicGoto === 1,
    `sound DA XOA -> chi 1 luot, khong thu lai vo ich (that: ${goneNoRetry.calls.musicGoto})`);
  ok(!has(goneNoRetry, 'thử lại lượt'), 'sound da xoa -> khong co log thu lai');
  ok(goneNoRetry.pending.length === 0, 'sound da xoa -> KHONG vao tab cho (khong co gi cho nguoi kiem)');
  ok(okNoRetry.calls.musicGoto === 1,
    `doc duoc ngay luot 1 -> chi 1 luot (that: ${okNoRetry.calls.musicGoto})`);
  ok(okNoRetry.data.length === 1 && okNoRetry.data[0].count === 4321, 'doc duoc luot 1 -> vao du lieu binh thuong');
  ok(retryOff.calls.musicGoto === 1,
    `TTC_COUNT_ATTEMPTS=1 -> TAT duoc viec thu lai (that: ${retryOff.calls.musicGoto})`);
  ok(retryOff.pending.length === 1, 'tat thu lai -> van vao tab cho nhu cu, khong mat link');

  console.log('### KHANG DINH: TIKTOK CHAN TRANG DEM KEO DAI -> BO CUOC, khong cay 6 tieng');
  // ⚠ LOI THAT (log nguoi dung 2026-08-07): buoc dem bi chan, app backoff 30s -> 2p -> 5p roi KET
  // O MUC 5 PHUT MAI MAI vi `failStreak` khong bao gio reset (moi lan thu deu loi). Moi sound con
  // duoc giu 3 vong => ~18-22 phut/sound; hang doi 20 sound => 6-7 TIENG, ma suot thoi gian do
  // vong quet dung han vi hang doi day. Do that: 40 phut -> Quet 24 · Da check 3 · HOP LE 0.
  // ── KIEM HANH VI THAT: nguong co that su kich hoat khong? ──
  // Nguong khong bao gio cham la loi IM LANG kinh dien — khang dinh tren ma nguon khong bat duoc.
  // `countApi: [null]` = KHONG co response nao (dung nhu bi chan), `countDom: [null]` = giao dien
  // cung khong doc duoc => moi sound deu that bai => failStreak leo den nguong.
  process.env.TTC_COUNT_ATTEMPTS = '1';   // 1 luot/sound cho nhanh; tra lai ngay sau
  const countBlocked = await run({
    name: 'Bi chan trang dem KEO DAI -> phat count-blocked (bo cuoc)',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 30000,
    countApi: [null], countDom: [null], noStop: true,
  });
  delete process.env.TTC_COUNT_ATTEMPTS;
  results.push(countBlocked);
  ok(countBlocked.msgs.some(m => /\[count-blocked\]/.test(m)),
    'THUC SU phat status count-blocked khi bi chan keo dai',
    JSON.stringify(countBlocked.msgs.filter(m => /chặn/.test(m)).slice(-3)));
  ok(countBlocked.msgs.filter(m => /\[count-blocked\]/.test(m)).length === 1,
    `chi phat DUNG MOT LAN (that: ${countBlocked.msgs.filter(m => /\[count-blocked\]/.test(m)).length})`);

  const blockSrc = require('fs').readFileSync(path.join(SRC, 'crawler.cjs'), 'utf8');
  ok(/const COUNT_BLOCK_GIVEUP = 6;/.test(blockSrc),
    'co nguong bo cuoc = 6 (di het thang backoff roi con nghi o muc tran 2 lan nua)');
  ok(/failStreak >= COUNT_BLOCK_GIVEUP && !countBlockedEmitted/.test(blockSrc),
    'phat tin hieu khi vuot nguong, va CHI MOT LAN (co countBlockedEmitted)');
  ok(/'count-blocked'/.test(blockSrc),
    'dung status RIENG `count-blocked`, khong muon `error` (error lam hang doi ve nut Chay)');
  const rSrc = require('fs').readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  ok(/s\.status === 'count-blocked'/.test(rSrc), 'renderer co xu ly count-blocked');
  const hcb = extractRendererFn(rSrc, 'handleCountBlocked');
  ok(/stopAndScheduleRestart\(profileId/.test(hcb),
    'count-blocked -> dung profile do + hen tu bat lai (dung chung duong nhe voi feed can)');
  ok(!/cycleIpAndRestart|_vpnAutoCycle/.test(hcb),
    'TUYET DOI khong di duong doi IP: chan nay theo TAI KHOAN, khong theo IP — 5 profile khac tren '
    + 'CUNG may van dem binh thuong (bang chung trong anh nguoi dung)');
  ok(/updateRowStatus\(s\.profileId, 'running', s\.msg\);\s*\n\s*appendLog\(s\.profileId, s\.msg\);\s*\n\s*handleCountBlocked/.test(rSrc),
    'giu hang o trang thai `running` — dung `error` la lap lai dung bay gay be tac 2026-08-07');

  console.log('### KHANG DINH: TIKTOK HUY PHIEN GIUA CHUNG -> profile PHAI thoat "dang chay"');
  // ⚠ BUG THAT (log nguoi dung 2026-08-07): vong quet ket thuc vi TikTok huy phien, nhung countLoop
  // la vong VO HAN nen Promise.all KHONG BAO GIO resolve -> crawlOneProfile khong ket thuc ->
  // `finally` khong chay -> `_active` giu profile MAI -> moi lan bam Chay deu bi "Profile dang
  // chay.". Te hon: renderer nhan 'error' nen doi hang ve nut "▶ Chạy" -> khong bam Dung duoc ->
  // BE TAC, chi khoi dong lai app moi thoat. Nguoi dung da thu dung/chay lai, xoa ChromiumProfile,
  // dang nhap lai — deu vo ich.
  // `noStop: true` = CO Y khong goi stopProfile, de xem profile co TU thoat khong.
  // runMs phai du cho: nhip kiem lai phien (500ms) + chot 'guest' can 3 lan doc LIEN TIEP cach
  // nhau 2s (~6s) + countLoop can not hang doi roi thoat. Ngan hon la kich ban khong chay toi noi
  // va 3 khang dinh truot vi TEST SAI, khong phai code sai.
  // `countApi: [API_OK]` = moi sound dem duoc NGAY. Co y: bo va nay dung `stop.draining` (dung
  // MEM) nen countLoop check NOT hang doi roi moi thoat — khong mat du lieu. Neu de sound khong
  // dem duoc thi moi cai ton ~7.6s va hang doi chua can kip trong runMs, khang dinh se truot vi
  // TEST SAI chu khong phai code sai (da mac dung loi nay khi viet).
  const guestMid = await run({
    name: 'TikTok huy phien GIUA CHUNG -> profile tu thoat, khong ket "dang chay"',
    mode: 'foryou', sounds: [SOUND_A, SOUND_B, SOUND_C], runMs: 14000,
    countApi: [API_OK], guestAfterMs: 1500, noStop: true,
  });
  results.push(guestMid);
  ok(guestMid.msgs.some(m => /BỊ HỦY giữa chừng/.test(m)),
    'co phat hien phien bi huy giua chung', JSON.stringify(guestMid.msgs.slice(-3)));
  ok(guestMid.stillRunningBeforeStop === false,
    'profile TU THOAT khoi trang thai "dang chay" — KHONG can ai bam Dung');
  ok(guestMid.stillRunningAfter === false, 'va van thoat sau do');

  console.log('### KHANG DINH: NHIP CUON TU GIAN theo ap luc hang doi (chong "dung feed")');
  // Truoc day vong quet chay HET TOC roi DUNG HAN khi hang doi day 20/20 — hanh vi bat/tat do la
  // thu gay ra hien tuong "cu dung mai o 1 video" (nguoi dung gui anh: 4 profile ket 8 phut).
  // Gio giu duoc mot bat bien: TU khop toc do voi buoc dem, KHONG bao gio dung han khi chua day.
  // ⚠ KHONG dung bien `src` o day: no duoc khai bao (const) o muc TRAN CHO API PHIA DUOI, nen
  // truy cap som la ReferenceError vung chet (TDZ). Doc rieng.
  const crawlerSrc = require('fs').readFileSync(path.join(SRC, 'crawler.cjs'), 'utf8');
  const pf = crawlerSrc.match(/function queuePressureFactor\(\)[\s\S]*?\n  \}/);
  ok(!!pf, 'co ham queuePressureFactor()');
  const factor = pf ? new Function('soundQueue', 'QUEUE_MAX',
    pf[0].replace('function queuePressureFactor()', 'return (function()') + ')()') : null;
  const F = (n) => factor({ length: n }, 20);
  ok(F(0) === 1 && F(9) === 1, `duoi 50% hang doi -> nhip BINH THUONG (that: ${F(0)}, ${F(9)})`);
  ok(F(15) > F(10) && F(20) > F(15), `cang day cang cham, TANG DAN (10:${F(10)} 15:${F(15)} 20:${F(20)})`);
  ok(F(20) === 4, `day 20/20 -> x4, KHONG phai dung han (that: ${F(20)})`);
  ok(F(30) === 4, `vuot tran cung chi x4, khong tang vo han (that: ${F(30)})`);
  ok(/rand\(minDelay, maxDelay\) \* queuePressureFactor\(\)/.test(crawlerSrc),
    'he so duoc AP vao dung nhip cuon cua vong quet');
  ok(/while \(soundQueue\.length >= QUEUE_MAX/.test(crawlerSrc),
    'VAN giu nguong day lam chot chong hang doi phinh vo han — chi la gio rat it khi toi');

  console.log('### KHANG DINH: PHAT HIEN KET co ca TRAN THOI GIAN (nhip gian lam dem-lan cham)');
  const stuckSrc = require('fs').readFileSync(path.join(SRC, 'crawler', 'stuck.cjs'), 'utf8');
  const { makeFeedTracker, STUCK_SAME_MS, STUCK_SAME_MIN } = require(path.join(SRC, 'crawler', 'stuck.cjs'));
  ok(STUCK_SAME_MS === 90000 && STUCK_SAME_MIN === 5, 'tran 90s, toi thieu 5 lan doc');
  // Duong dem-lan cu phai con nguyen
  let tr = makeFeedTracker(); let firedAt = 0;
  for (let i = 0; i < 20; i++) if (tr.track('/music/a', false)) { firedAt = i + 1; break; }
  ok(firedAt === 20, `duong dem-lan VAN hoat dong: bao ket o lan doc thu 20 (that: ${firedAt})`);
  // Duong THOI GIAN: it lan doc nhung qua lau -> phai bao ket
  const realNow = Date.now;
  let fake = realNow();
  try {
    tr = makeFeedTracker();
    Date.now = () => fake;
    for (let i = 0; i < 4; i++) tr.track('/music/b', false);
    fake += STUCK_SAME_MS + 5000;
    ok(tr.track('/music/b', false) === true,
      `${STUCK_SAME_MIN} lan doc + qua ${STUCK_SAME_MS / 1000}s tren cung 1 sound -> bao ket`);
    // KHONG bao oan khi delay rat lon (moi 2 lan doc)
    tr = makeFeedTracker();
    fake = realNow();
    tr.track('/music/c', false);
    fake += STUCK_SAME_MS + 5000;
    ok(tr.track('/music/c', false) === false,
      'chi 2 lan doc du da qua 90s -> KHONG bao ket (nguoi dung co the dat delay rat lon)');
    // clearStuck phai reset dong ho, khong thi lan doc ke tiep bao ket NGAY
    tr = makeFeedTracker();
    fake = realNow();
    for (let i = 0; i < 6; i++) tr.track('/music/d', false);
    fake += STUCK_SAME_MS + 5000;
    tr.track('/music/d', false);       // bao ket
    tr.clearStuck();                    // da can thiep
    for (let i = 0; i < 5; i++) tr.track('/music/d', false);   // du STUCK_SAME_MIN lan, nhung dong ho moi
    ok(tr.track('/music/d', false) === false,
      'clearStuck() reset dong ho -> cho cach vua thu co co hoi to hieu qua, khong bao ket ngay');
  } finally {
    Date.now = realNow;   // PHAI tra lai, khong thi cac test sau chay tren dong ho gia
  }
  ok(/clearStuck\(\) \{ sameCount = 0; progressRun = 0; sameSince = Date\.now\(\); \}/.test(stuckSrc),
    'clearStuck() reset ca sameSince (kiem tren ma nguon, khong chi hanh vi)');
  ok(/sameCount >= STUCK_SAME_MIN && Date\.now\(\) - sameSince >= STUCK_SAME_MS/.test(stuckSrc),
    'dieu kien thoi gian DOI ca hai: du so lan toi thieu VA qua tran thoi gian');

  console.log('### KHANG DINH: CHE DO DEM that su doi hanh vi (khong chi la cai dat trang tri)');
  // Day la BANG CHUNG cong tac hoat dong: CUNG mot kich ban (luot 1 statusCode la, luot 2 API tot),
  // 'patient' bo mat sound con 'fast' cuu duoc.
  ok(patientBothFail.calls.musicGoto === 1,
    `patient -> chi 1 luot doc, KHONG thu lai (that: ${patientBothFail.calls.musicGoto})`);
  ok(patientBothFail.data.length === 0 && patientBothFail.pending.length === 1,
    'patient -> sound vao TAB CHO (dung nhu ban 0.1.63: khong co co hoi thu lai)',
    JSON.stringify({ data: patientBothFail.data.length, pending: patientBothFail.pending.length }));
  ok(fastRetries.calls.musicGoto === 2,
    `fast -> thu lai, 2 luot doc (that: ${fastRetries.calls.musicGoto})`);
  ok(fastRetries.data.length === 1 && fastRetries.data[0].count === 4321,
    'fast -> CUU DUOC dung sound ma patient bo mat, voi so dung 4321',
    JSON.stringify(fastRetries.data.map(d => d.count)));
  ok(fastRetries.pending.length === 0, 'fast -> khong phai vao tab cho nua');

  console.log('### KHANG DINH: TRAN CHO API va DOM phai co gioi han THAT');
  // Tren may ao, TikTok tra trang loi => API `api/music/detail/` KHONG BAO GIO chay => moi luot
  // dot tron tran cho. Tran 20s x 2 luot = 40s/sound, la phan TON NHAT trong con so 132s/sound
  // do duoc. Kiem tren MA NGUON vi mock tra response ngay lap tuc, khong do duoc tran that.
  const src = require('fs').readFileSync(path.join(SRC, 'crawler.cjs'), 'utf8');
  ok(/timeout: cfg\.apiWaitMs/.test(src) && !/timeout:\s*20000\s*\}\)/.test(src),
    'tran cho api/music/detail/ lay theo CHE DO, khong hardcode o cho goi');
  ok(/const COUNT_MODE_DEFAULT = 'fast'/.test(src),
    'MAC DINH la \"fast\" — chon sai o may manh chi mat chut co hoi, chon sai o may yeu la DUNG FEED');
  ok(/fast:\s*\{\s*apiWaitMs: 8000,\s*domBudgetMs: \[2500, 5000\],\s*attempts: 2/.test(src),
    'che do fast: API 8s, ngan sach 2.5s/5s, 2 luot');
  ok(/patient:\s*\{\s*apiWaitMs: 20000,\s*domBudgetMs: \[30000, 30000\],\s*attempts: 1/.test(src),
    'che do patient: API 20s, ngan sach 30s, 1 luot (dung khuon v0.1.63)');
  ok(/const cfg = _countCfg\(\)/.test(src) && /for \(let attempt = 1; attempt <= cfg\.attempts/.test(src),
    'chot thong so MOT LAN cho moi sound — doi cai dat giua dong khong lam sound dang chay doi luat');
  const prSrc = require('fs').readFileSync(path.join(SRC, 'crawler', 'page-read.cjs'), 'utf8');
  ok(/function readVideoCount\(page,\s*timeoutMs\s*=\s*5000\)/.test(prSrc),
    'readVideoCount nhan tran cho TUNG lan goi');
  ok(/readVideoCount\(sidePage,\s*Math\.max\(500,\s*until - Date\.now\(\)\)\)/.test(src),
    'noi goi TRUYEN phan ngan sach con lai — khong truyen thi 1 lan goi (5s) da vuot ngan sach '
    + '2.5s, tuc ngan sach chi la hinh thuc');

  console.log('### KHANG DINH: TAC HANG DOI thi BO luot thu lai (uu tien cho feed chay tiep)');
  ok(/soundQueue\.length >= QUEUE_MAX \/ 2/.test(src),
    'co dieu kien bo thu lai khi hang doi qua nua');
  ok(/bỏ lượt thử lại vì đang tắc hàng đợi/.test(src),
    'noi RO ly do trong log — nguoi dung phai biet vi sao link vao tab cho ma khong duoc thu lai');

  console.log('### KHANG DINH: SLOT DEM khong bi giu trong luc cho (goc re cua "feed ngung cuon")');
  // Slot dem la semaphore TOAN APP (2 slot cho MOI profile). Giu no trong luc ngu giua 2 luot
  // => tren VPS yeu 1 sound loi chiem slot 30-49s => thong luong dem tut duoi nhip cuon =>
  // hang doi day => vong quet dung => feed ngung cuon.
  const sl = (r) => r.slots || {};
  ok(sl(retryFail).acquires === 2,
    `thu lai 2 luot -> XIN slot 2 lan rieng biet (nha ra roi xin lai), that: ${sl(retryFail).acquires}`);
  ok(sl(retryFail).releases === sl(retryFail).acquires,
    `xin va nha CAN BANG (${sl(retryFail).acquires} xin / ${sl(retryFail).releases} nha) — `
    + 'nha thua se lam semaphore tuong con cho => hon 2 request /music/ song song');
  ok(sl(retryFail).held === 0, `chay xong khong con giu slot nao (that: ${sl(retryFail).held})`);
  ok(sl(retryFail).heldDuringSleep === false,
    'khong lan nao nha THUA (bo dem chua bao gio xuong am)');
  ok(sl(retryFail).maxHeld <= 1,
    `1 profile -> khong bao gio giu qua 1 slot cung luc (that: ${sl(retryFail).maxHeld})`);
  ok(sl(okNoRetry).acquires === 1 && sl(okNoRetry).releases === 1,
    `doc duoc ngay -> dung 1 lan xin + 1 lan nha (that: ${sl(okNoRetry).acquires}/${sl(okNoRetry).releases})`);
  ok(sl(goneNoRetry).acquires === 1 && sl(goneNoRetry).held === 0,
    'sound da xoa -> 1 lan xin, nha sach');
  ok(sl(retryWin).acquires === 2 && sl(retryWin).releases === 2,
    `thu lai roi doc duoc -> van can bang (that: ${sl(retryWin).acquires}/${sl(retryWin).releases})`);

  console.log(`\n${failed ? '❌' : '✅'} ${failed} khang dinh TRUOT`);
  console.log('\nDONE');
  process.exit(failed ? 1 : 0);
})();
