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
// Rut ngan cho giua 2 luot doc so video (that la 2.5s). KHONG rut ngan duoc vong poll giao dien
// (6 x 500ms co dinh trong crawler) nen cac kich ban DEM ben duoi van can runMs vai giay.
process.env.TTC_COUNT_RETRY_MS = '100';

const SRC = path.join(__dirname, '..', 'src');
const browserPath = require.resolve(path.join(SRC, 'browser.cjs'));
const profilesPath = require.resolve(path.join(SRC, 'profiles.cjs'));
const ipGuardPath = require.resolve(path.join(SRC, 'ip-guard.cjs'));

// ── Fake page: tra ve chuoi sound do kich ban quy dinh ──
function makeFakePage(script) {
  let readIdx = 0;
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
      // checkLoginState
      if (src.includes('top-login-button')) return script.loginState || 'logged-in';
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
                     links, navButton, countApi, countDom, extra = {} }) {
  // Xoa cache crawler de moi kich ban co trang thai phien sach
  for (const k of Object.keys(require.cache)) {
    if (k.includes('crawler') || k.includes('browser.cjs') || k.includes('profiles.cjs')
        || k.includes('ip-guard.cjs')) delete require.cache[k];
  }
  const page = makeFakePage({ sounds, loginState, links, navButton, countApi, countDom });
  installMocks(page, profileName);
  installIpGuardMock(ipScript);
  const crawler = require(path.join(SRC, 'crawler.cjs'));

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
  crawler.stopProfile('p_test');
  await new Promise(r => setTimeout(r, 400));
  return { name, msgs, data, pending, calls: page._calls };
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

  console.log(`\n${failed ? '❌' : '✅'} ${failed} khang dinh TRUOT`);
  console.log('\nDONE');
  process.exit(failed ? 1 : 0);
})();
