// test/lang-filter.test.js — LOC THEO NGON NGU + bam "Not interested" (2026-08-21)
//
// Nguoi dung chay profile UK/US nhung feed toan sound A Rap / Nam My. Yeu cau: chi lay sound
// cua nguoi dang noi tieng Anh, Han/Nhat van duoc; sound bi loai thi bam "Not interested".
//
// ⚠⚠ KHANG DINH QUAN TRONG NHAT trong file nay la muc 3: KHONG BAO GIO bam "Report".
// Trong menu cua TikTok, "Report" nam NGAY DUOI "Not interested" (anh nguoi dung gui). Bam
// lech mot dong la BAO CAO VIDEO -> tai khoan co the bi danh dau. Test dung lai dung menu do.
'use strict';

const path = require('path');
const F = require(path.join(__dirname, '..', 'src', 'script-filter.cjs'));
const NI = require(path.join(__dirname, '..', 'src', 'crawler', 'not-interested.cjs'));

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('   OK   ' + label); }
  else { fail++; console.log('   FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}
// Ca 2 ham nhan QUOC GIA: luat la "tieng Anh + ngon ngu cua chinh quoc gia profile".
// Mac dinh US de cac muc khac (chi cho tieng Anh) van dung nghia.
const rejected = (name, cc) => !!(F.uploaderLangLabel(name, cc || 'US')
  || F.foreignScripts(name, cc || 'US').length);

(async () => {

console.log('\n=== 1. NGON NGU NGUOI DANG (tien to ten sound) ===');
// TikTok dat nhan "original sound" theo locale NGUOI DANG (QD-10) -> tien to = ngon ngu ho.
for (const [n, want] of [
  ['original sound - Daily Muslims News', false],
  ['sonido original - Ozono Television',  true ],   // Tay Ban Nha (Latino)
  ['som original - Gabriel Gomx',         true ],   // Bo Dao Nha (Brazil)
  ['son original - ministere',            true ],   // Phap
  ['suara asli - Rr. Rahayu',             true ],   // Indonesia
  ['nhac nen - Otrthanh',                 false],   // khong dau -> khong khop nhan vi
  ['nhạc nền - Otrthanh',                 true ],   // co dau -> khop
  ['оригинальный звук - kot',             true ],   // Nga
  ['الصوت الأصلي - x',                     true ],   // A Rap
]) ok('"' + n.slice(0, 30) + '" -> ' + (want ? 'LOAI' : 'LAY'), rejected(n) === want,
      'uploader=' + F.uploaderLangLabel(n) + ' scripts=' + JSON.stringify(F.foreignScripts(n)));

console.log('=== 2. DUOC PHEP = tieng Anh + ngon ngu CUA CHINH quoc gia profile ===');
// Nguoi dung chot: "neu IP la KR thi lay title tieng Anh HOAC tieng Han. Neu IP la AU thi
// lay AU hoac UK US vi no deu la tieng Anh." -> khong the dung MOT danh sach co dinh.
for (const cc of ['US', 'UK', 'AU']) {
  ok('(' + cc + ') LAY tieng Anh', rejected('original sound - Kamal', cc) === false);
  ok('(' + cc + ') LOAI tieng Han', rejected('오리지널 사운드 - abc', cc) === true);
  ok('(' + cc + ') LOAI tieng Nhat', rejected('オリジナル楽曲 - xyz', cc) === true);
}
ok('(KR) LAY tieng Han', rejected('오리지널 사운드 - abc', 'KR') === false);
ok('(KR) LAY tieng Anh', rejected('original sound - Kamal', 'KR') === false);
ok('(KR) LOAI tieng Nhat (khong phai ban ngu cua KR)',
   rejected('オリジナル楽曲 - xyz', 'KR') === true);
ok('(KR) he chu Hangul DUOC PHEP', F.foreignScripts('오리지널', 'KR').length === 0);
ok('(US) he chu Hangul BI LOAI', F.foreignScripts('오리지널', 'US').length > 0);
ok('(JP) LAY tieng Nhat', rejected('オリジナル楽曲 - xyz', 'JP') === false);
ok('(JP) LOAI tieng Han', rejected('오리지널 사운드 - abc', 'JP') === true);
ok('(JP) Kanji duoc phep (tieng Nhat dung Kanji)', F.foreignScripts('楽曲', 'JP').length === 0);
ok('khong co nhan quoc gia -> CHI cho tieng Anh',
   rejected('오리지널 사운드 - abc', '') === true && rejected('original sound - x', '') === false);

console.log('\n=== 3. TEN KHONG CO TIEN TO -> xet HE CHU ===');
for (const [n, want] of [
  ['أدعية إسلامية', true ],   // dung ten sound trong anh nguoi dung gui
  ['نمسته',         true ],
  ['नमस्ते',          true ],
  ['นักร้อง',         true ],
  ['ኢትዮጵያ',         true ],   // Ethiopia — chau Phi phi-Latin
  ['Espresso',      false],   // ten bai hat that -> khong ket luan duoc -> LAY
  ['original sound - S🦋', false],
  ['🌟✨ 1234 🌟',   false],   // chi emoji/so -> khong co tin hieu -> LAY
]) ok('"' + n.slice(0, 22) + '" -> ' + (want ? 'LOAI' : 'LAY'), rejected(n) === want,
      JSON.stringify(F.foreignScripts(n)));

console.log('\n=== 4. Emoji KHONG duoc tinh la chu la ===');
ok('emoji don thuan khong sinh nhan nao', F.foreignScripts('🦋🐍🌟').length === 0);
ok('Latin + emoji -> LAY', rejected('original sound - Kamal__k__fresh 🔥') === false);
ok('dau cau/so khong sinh nhan', F.foreignScripts('--- 123 !!! ___') .length === 0);

console.log('\n=== 5. Danh sach chu TRANH phai co "report" ===');
ok('co "report" trong FORBIDDEN_TEXTS', NI.FORBIDDEN_TEXTS.includes('report'));
ok('co "bao cao"/"bao cao co dau"',
   NI.FORBIDDEN_TEXTS.some(t => t.indexOf('bao') === 0 || t.indexOf('báo') === 0));
ok('co "not interested" trong NOT_INTERESTED_TEXTS',
   NI.NOT_INTERESTED_TEXTS.includes('not interested'));

// ── Phan chay THAT trong Chromium: dung lai menu cua TikTok ──
let chromium = null;
try { chromium = require('playwright').chromium; } catch (_) {}
if (!chromium) {
  console.log('\n(bo qua muc 6-8: khong nap duoc playwright)');
} else {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // ⚠ `setContent` thay DOM nhung KHONG xoa bien tren `window` — `window.__clicked` con
  // song qua muc sau. Da bi dung loi nay: muc 7 doc lai gia tri cua muc 6 va bao FAIL oan.
  const reset = async (html) => {
    await page.setContent(html);
    await page.evaluate(() => { window.__clicked = []; });
  };

  const MENU = (items) => `
    <div style="height:2000px"></div>
    <button aria-label="More options" style="position:fixed;top:50%;left:50%;width:40px;height:40px"
            onclick="document.getElementById('m').style.display='block'">...</button>
    <div id="m" role="menu" style="display:none;position:fixed;top:55%;left:50%">
      ${items.map(t => `<div role="menuitem" style="width:120px;height:24px"
          onclick="window.__clicked=window.__clicked||[];window.__clicked.push('${t}')">${t}</div>`).join('')}
    </div>`;

  console.log('\n=== 6. Menu binh thuong -> bam dung "Not interested" ===');
  await reset(MENU(['Speed', 'Auto scroll', 'Captions', 'Not interested', 'Report']));
  let r = await NI.markNotInterested(page);
  let clicked = await page.evaluate(() => window.__clicked || []);
  ok('bao thanh cong', r.ok === true, JSON.stringify(r));
  ok('da bam dung 1 muc', clicked.length === 1, JSON.stringify(clicked));
  ok('muc do la "Not interested"', clicked[0] === 'Not interested', JSON.stringify(clicked));
  ok('TUYET DOI khong bam "Report"', !clicked.includes('Report'), JSON.stringify(clicked));

  console.log('\n=== 7. Menu CHI co Report -> khong bam gi ca ===');
  await reset(MENU(['Speed', 'Report']));
  r = await NI.markNotInterested(page);
  clicked = await page.evaluate(() => window.__clicked || []);
  ok('bao that bai', r.ok === false, JSON.stringify(r));
  ok('KHONG bam bat ky muc nao', clicked.length === 0, JSON.stringify(clicked));

  console.log('\n=== 7b. KHOI BOC chua CA \"Not interested\" VA \"Report\" ===');
  // ⚠ Day la canh DUY NHAT lam chot "chu TRANH" co tac dung — va la rui ro THAT.
  // `textContent` cua khoi boc = "Not interestedReport" nen no KHOP chu "not interested".
  // Bam vao KHOI BOC thi khong biet cu click roi vao muc nao — co the la Report.
  // Dot bien "bo danh sach chu TRANH" phai lam muc nay TRUOT.
  await reset(`
    <div style="height:2000px"></div>
    <button aria-label="More options" style="position:fixed;top:50%;left:50%;width:40px;height:40px"
            onclick="document.getElementById('m').style.display='block'">...</button>
    <div id="m" role="menu" style="display:none;position:fixed;top:55%;left:50%">
      <div id="wrap" style="width:120px;height:48px"
           onclick="window.__clicked=window.__clicked||[];window.__clicked.push('WRAPPER')">
        <div role="menuitem" style="width:120px;height:24px"
             onclick="event.stopPropagation();window.__clicked=window.__clicked||[];window.__clicked.push('Not interested')">Not interested</div>
        <div role="menuitem" style="width:120px;height:24px"
             onclick="event.stopPropagation();window.__clicked=window.__clicked||[];window.__clicked.push('Report')">Report</div>
      </div>
    </div>`);
  r = await NI.markNotInterested(page);
  clicked = await page.evaluate(() => window.__clicked || []);
  ok('KHONG bam vao KHOI BOC (khong biet cu click roi vao dau)',
     !clicked.includes('WRAPPER'), JSON.stringify(clicked));
  ok('TUYET DOI khong bam Report (khoi boc)', !clicked.includes('Report'), JSON.stringify(clicked));
  ok('bam dung la Not interested',
     clicked.length === 1 && clicked[0] === 'Not interested', JSON.stringify(clicked));

  console.log('\n=== 8. Khong co nut "..." -> tra that bai, KHONG nem ===');
  await reset('<div>khong co gi</div>');
  r = await NI.markNotInterested(page);
  ok('tra { ok:false } chu khong nem', r && r.ok === false, JSON.stringify(r));
  ok('co ly do de doc log', typeof r.why === 'string' && r.why.length > 0, JSON.stringify(r));

  await browser.close();
}

console.log('\n' + '='.repeat(60) + '\nKET QUA: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('LOI:', e); process.exit(1); });
