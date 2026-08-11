// test/update-repo-switch.test.js — Doi o "GitHub repo phat hanh" la CHUYEN duoc sang ban
// phat hanh cua repo do, KE CA khi version ben do CU HON (2026-08-11).
//
// BOI CANH THAT: du an co 2 nguoi, 2 repo phat hanh rieng (QD-18). Nguoi dung muon chuyen ca
// dan 5 may sang repo cua nguoi kia bang cach CHI doi o repo. Nhung release moi nhat ben do la
// 0.1.55 trong khi may dang o 0.1.70 -> luat cu `isNewer(latest, current)` tra false -> app bao
// "Da la ban moi nhat" va KHONG tai gi. Dung cai bay QD-18 da ghi. He qua: phai di thay .exe
// tay tren tung may.
//
// ⚠ HAI KHANG DINH QUAN TRONG NHAT o day la hai chot AN TOAN, khong phai tinh nang:
//   1. Ha version CHI duoc de nghi khi nguoi dung TU BAM Kiem tra (`manual`). Lan tu kiem luc
//      khoi dong tuyet doi khong ha ngam — cau hinh sai mot o se am tham cho ca dan may tut ve
//      ban cu, mat tinh nang ma khong ai hay.
//   2. Version BANG NHAU thi KHONG de nghi gi -> khong sinh vong lap cap nhat vo han sau khi
//      da chuyen xong.
//
// Chay: node test/update-repo-switch.test.js
'use strict';

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
const updaterPath = require.resolve(path.join(SRC, 'updater.cjs'));

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

// ── Gia lap GitHub API + electron, roi nap updater.cjs THAT ──
// Khong chep logic sang test: ban chep se lech am tham va test pass trong khi app hong
// (bai hoc QD-10, da ap cho vpn-run-lock.test.js).
function load({ latestTag, currentVersion, assets = [{ name: 'Crawl_DataTiktok.exe', browser_download_url: 'https://x/y.exe' }] }) {
  const calls = { paths: [] };
  const httpsPath = require.resolve('https');
  // ⚠ checkForUpdates dung `https.request(opts, cb)` roi `req.end()` — KHONG dung `https.get`.
  // Mock ban dau cua toi chi co `get` nen `req.end is not a function`. Phai tra ve object co
  // `on()` VA `end()`, va chi ban du lieu KHI `end()` duoc goi (dung nhu request that: chua
  // end thi chua gui). Bat sai nhip nay se lam khang dinh "khong de nghi gi" pass GIA.
  const makeRes = () => ({
    statusCode: 200,
    headers: {},
    setEncoding() {},
    _h: {},
    on(ev, fn) { this._h[ev] = fn; return this; },
    pipe() {},
  });
  const fakeHttps = {
    Agent: class { constructor() {} },
    request(opts, cb) {
      calls.paths.push(typeof opts === 'string' ? opts : opts.path);
      const res = makeRes();
      return {
        on() { return this; },
        end() {
          cb(res);
          if (res._h.data) res._h.data(JSON.stringify({ tag_name: latestTag, body: 'ghi chu', assets }));
          if (res._h.end) res._h.end();
        },
      };
    },
    get(opts, cb) { const r = this.request(opts, cb); r.end(); return r; },
  };
  require.cache[httpsPath] = new Module(httpsPath, null);
  require.cache[httpsPath].filename = httpsPath;
  require.cache[httpsPath].loaded = true;
  require.cache[httpsPath].exports = fakeHttps;

  // ⚠ `_currentVersion()` doc `require('../package.json').version` — KHONG doc
  // `app.getVersion()`. Mock ban dau cua toi chi dat app.getVersion nen tham so
  // `currentVersion` VO TAC DUNG: moi kich ban deu chay voi version that trong package.json
  // (0.1.70), lam khang dinh "bang nhau -> khong de nghi" truot oan. Phai gia lap dung file
  // package.json ma updater doc.
  const pkgPath = require.resolve(path.join(SRC, '..', 'package.json'));
  require.cache[pkgPath] = new Module(pkgPath, null);
  require.cache[pkgPath].filename = pkgPath;
  require.cache[pkgPath].loaded = true;
  require.cache[pkgPath].exports = { version: currentVersion };

  const elPath = require.resolve('electron');
  require.cache[elPath] = new Module(elPath, null);
  require.cache[elPath].filename = elPath;
  require.cache[elPath].loaded = true;
  require.cache[elPath].exports = {
    app: { isPackaged: true, getVersion: () => currentVersion, getPath: () => require('os').tmpdir(), quit() {} },
    BrowserWindow: { getAllWindows: () => [] },
  };

  delete require.cache[updaterPath];
  const updater = require(updaterPath);

  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, p }) } };
  return { updater, win, sent, calls };
}

// Doi mot nhip vi checkForUpdates dung callback cua https.get (dong bo trong mock, nhung
// JSON.parse + send nam trong handler 'end' nen cho 1 tick cho chac).
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  console.log('\n=== 1. normalizeRepo: cat sach moi kieu nhap tay ===');
  {
    const { updater } = load({ latestTag: 'v0.1.55', currentVersion: '0.1.70' });
    const n = updater.normalizeRepo;
    // Chinh cai lam nguoi dung mat thoi gian 2 lan: dau `/` o cuoi -> GitHub 404.
    check('1. bo dau / o cuoi', n('Hung13010/Crawl_DataTiktok-releases/') === 'Hung13010/Crawl_DataTiktok-releases', n('Hung13010/Crawl_DataTiktok-releases/'));
    check('2. bo khoang trang', n('  a/b  ') === 'a/b', n('  a/b  '));
    check('3. dan ca URL GitHub', n('https://github.com/Hung13010/Crawl_DataTiktok-releases') === 'Hung13010/Crawl_DataTiktok-releases');
    check('4. dan URL co duoi /releases/tag/v1', n('https://github.com/a/b/releases/tag/v1') === 'a/b');
    check('5. bo .git cua link clone', n('https://github.com/a/b.git') === 'a/b');
    check('6. dau / o dau', n('/a/b') === 'a/b');
    check('7. // o giua', n('a//b') === 'a/b');
    check('8. thieu phan repo -> rong (khong dung bua)', n('chi-mot-tu') === '');
    check('9. rong/null -> rong', n('') === '' && n(null) === '' && n(undefined) === '');
  }

  console.log('\n=== 2. Ban MOI HON: van de nghi nhu cu, ca manual lan tu dong ===');
  for (const manual of [true, false]) {
    const { updater, win, sent } = load({ latestTag: 'v0.1.80', currentVersion: '0.1.70' });
    updater.checkForUpdates(win, { repo: 'a/b', manual });
    await tick();
    const av = sent.find(s => s.ch === 'update-available');
    check(`10${manual ? 'a' : 'b'}. manual=${manual} -> co de nghi`, !!av, JSON.stringify(sent.map(s => s.ch)));
    check(`11${manual ? 'a' : 'b'}. khong bi danh dau la ha version`, av && av.p.isDowngrade === false, av && String(av.p.isDowngrade));
  }

  console.log('\n=== 3. CHOT AN TOAN: ban CU HON chi de nghi khi MANUAL ===');
  {
    // Dung dung cap so that: may o 0.1.70, repo cua Hung moi nhat 0.1.55.
    const A = load({ latestTag: 'v0.1.55', currentVersion: '0.1.70' });
    A.updater.checkForUpdates(A.win, { repo: 'Hung13010/Crawl_DataTiktok-releases', manual: true });
    await tick();
    const av = A.sent.find(s => s.ch === 'update-available');
    check('12. MANUAL + ban cu hon -> CO de nghi', !!av, JSON.stringify(A.sent.map(s => s.ch)));
    check('13. co co isDowngrade = true', av && av.p.isDowngrade === true, av && String(av.p.isDowngrade));
    check('14. bao dung version cu/moi', av && av.p.current === '0.1.70' && av.p.version === '0.1.55',
      av && `${av.p.current} -> ${av.p.version}`);
    check('15. bao kem TEN REPO (de UI noi ro chuyen sang dau)', av && av.p.repo === 'Hung13010/Crawl_DataTiktok-releases', av && av.p.repo);

    // ⚠ Khang dinh quan trong nhat ca file: tu kiem luc khoi dong KHONG duoc ha ngam.
    const B = load({ latestTag: 'v0.1.55', currentVersion: '0.1.70' });
    B.updater.checkForUpdates(B.win, { repo: 'Hung13010/Crawl_DataTiktok-releases', manual: false });
    await tick();
    check('16. TU DONG + ban cu hon -> TUYET DOI khong de nghi',
      !B.sent.some(s => s.ch === 'update-available'), JSON.stringify(B.sent.map(s => s.ch)));
    check('17. va cung khong bao gi ra UI (im lang dung khuon manual=false)',
      B.sent.length === 0, JSON.stringify(B.sent.map(s => s.ch)));
  }

  console.log('\n=== 4. KHONG SINH VONG LAP: version bang nhau -> khong de nghi ===');
  {
    // Sau khi da chuyen xong: app 0.1.55, repo Hung moi nhat 0.1.55.
    const { updater, win, sent } = load({ latestTag: 'v0.1.55', currentVersion: '0.1.55' });
    updater.checkForUpdates(win, { repo: 'Hung13010/Crawl_DataTiktok-releases', manual: true });
    await tick();
    check('18. bang nhau -> KHONG de nghi cai lai', !sent.some(s => s.ch === 'update-available'),
      JSON.stringify(sent.map(s => s.ch)));
    check('19. bao "da la ban moi nhat"', sent.some(s => s.ch === 'update-not-available'),
      JSON.stringify(sent.map(s => s.ch)));
  }

  console.log('\n=== 5. Repo hong (dau / o cuoi) van goi dung URL sau khi chuan hoa ===');
  {
    const { updater, win, calls } = load({ latestTag: 'v0.1.55', currentVersion: '0.1.70' });
    updater.checkForUpdates(win, { repo: 'Hung13010/Crawl_DataTiktok-releases/', manual: true });
    await tick();
    const p = calls.paths[0] || '';
    check('20. URL KHONG co dau // (nguyen nhan 404 that)', !p.includes('//'), p);
    check('21. URL dung dang /repos/Owner/Repo/releases/latest',
      p === '/repos/Hung13010/Crawl_DataTiktok-releases/releases/latest', p);
  }

  console.log('\n=== 6. isNewer van dung (khong pha logic cu) ===');
  {
    const { updater } = load({ latestTag: 'v1', currentVersion: '1' });
    const f = updater.isNewer;
    check('22. 0.1.70 > 0.1.55', f('0.1.70', '0.1.55') === true);
    check('23. 0.1.55 KHONG > 0.1.70', f('0.1.55', '0.1.70') === false);
    check('24. bang nhau -> false', f('0.1.55', '0.1.55') === false);
    check('25. so sanh theo SO, khong theo chuoi (0.1.9 < 0.1.10)', f('0.1.10', '0.1.9') === true);
  }

  console.log(`\n──────── ${pass} OK, ${fail} FAIL ────────`);
  process.exit(fail ? 1 : 0);
})();
