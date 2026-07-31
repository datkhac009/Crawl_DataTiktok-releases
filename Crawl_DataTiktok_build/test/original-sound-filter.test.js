// test/original-sound-filter.test.js — Kiem chung bo loc "Chi lay Original Sound"
// (isOriginalSound trong crawler/util.cjs) sau khi doi cach rut gon link (2026-07-30).
//
// 2 boi canh that trong ngay:
//  (a) Sound goc cua tac gia nuoc khac bi LOAI OAN: nguoi dung gui bang chung link
//      `/music/оригинальный-звук-7648030600474299169` — TikTok gan nhan "original sound" theo
//      NGON NGU CUA NGUOI DANG video, ma danh sach nhan cu chi co tieng Anh + tieng Viet.
//      Feed moi may phuc vu noi dung theo IP/vung VPN khac nhau nen may ao gap nhieu sound
//      tac gia nuoc ngoai hon -> san luong thap hon may khac du cung profile, cung phien ban.
//  (b) BAY NGHIEM TRONG khi rut gon link theo ID: canonicalSoundUrl() gio ghep MOI link ve
//      `/music/original-sound-<id>` KE CA nhac ban quyen. Neu goi isOriginalSound() voi link
//      DA RUT GON thi no LUON thay "original-sound-" -> bo loc MAT TAC DUNG HOAN TOAN, moi
//      nhac ban quyen deu lot. Bat buoc phai xet link GOC.
// Chay: node test/original-sound-filter.test.js
'use strict';

const { isOriginalSound } = require('../src/crawler/util.cjs');
const { canonicalSoundUrl } = require('../src/linkkey.cjs');

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

(async () => {
  console.log('\n=== 1. Tieng Anh / tieng Viet (van phai chay dung nhu truoc) ===');
  {
    check('slug original-sound', isOriginalSound('https://www.tiktok.com/music/original-sound-76273901234567', ''));
    check('slug nhac-nen', isOriginalSound('https://www.tiktok.com/music/nhạc-nền-76273901234567', ''));
    check('ten "original sound - user"', isOriginalSound('https://x/y', 'original sound - someuser'));
    check('ten "nhạc nền - user"', isOriginalSound('https://x/y', 'nhạc nền - someuser'));
  }

  console.log('\n=== 2. BUG THAT: nhan tieng Nga (bang chung nguoi dung) -> PHAI nhan ra la original sound ===');
  {
    const u = 'https://www.tiktok.com/music/оригинальный-звук-7648030600474299169';
    check('nhan ra qua slug tieng Nga', isOriginalSound(u, ''), u);
    check('nhan ra qua TEN tieng Nga', isOriginalSound('https://x/y', 'оригинальный звук - user'));
    // Dang %-encode ma trinh duyet thuong tra ve.
    const enc = 'https://www.tiktok.com/music/%D0%BE%D1%80%D0%B8%D0%B3%D0%B8%D0%BD%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9-%D0%B7%D0%B2%D1%83%D0%BA-7648030600474299169';
    check('nhan ra ca khi link bi %-encode', isOriginalSound(enc, ''), enc);
  }

  console.log('\n=== 3. Cac ngon ngu khac trong danh sach (best-effort) ===');
  {
    check('tieng Thai', isOriginalSound('https://www.tiktok.com/music/เสียงต้นฉบับ-76273901234567', ''));
    check('tieng Indonesia', isOriginalSound('https://www.tiktok.com/music/suara-asli-76273901234567', ''));
    check('tieng Tay Ban Nha', isOriginalSound('https://www.tiktok.com/music/sonido-original-76273901234567', ''));
    check('tieng Bo Dao Nha', isOriginalSound('https://www.tiktok.com/music/som-original-76273901234567', ''));
    check('tieng Duc', isOriginalSound('https://www.tiktok.com/music/originalton-76273901234567', ''));
    check('tieng A Rap', isOriginalSound('https://www.tiktok.com/music/الصوت-الأصلي-76273901234567', ''));
  }

  console.log('\n=== 4. Nhac CO BAN QUYEN -> PHAI bi loai (bo loc con tac dung that) ===');
  {
    const u = 'https://www.tiktok.com/music/Foreign-Kodiene-Mixx-7411103147315349520';
    check('slug ten bai hat -> khong phai original', !isOriginalSound(u, 'Foreign Kodiene Mixx'), u);
    check('ten bai hat thuong -> khong phai original',
      !isOriginalSound('https://www.tiktok.com/music/If-You-Dont-Mean-It-7656283172601465618', 'If You Don\'t Mean It - TEN'));
  }

  console.log('\n=== 5. BAY: goi voi link DA RUT GON thi bo loc mat tac dung -> phai luon dung link GOC ===');
  {
    const raw = 'https://www.tiktok.com/music/Foreign-Kodiene-Mixx-7411103147315349520';
    const shortened = canonicalSoundUrl(raw);
    check('link da rut gon co chua "original-sound-" (nguon goc cua bay)',
      shortened.includes('/music/original-sound-'), shortened);
    // Chung minh bay la THAT: neu lo truyen link da rut gon (KHONG kem ten) thi nhac ban
    // quyen bi nham thanh original sound. Day chinh la dieu addSound() phai tranh.
    check('=> truyen link RUT GON: bi nham thanh original (bay)', isOriginalSound(shortened, ''));
    check('=> truyen link GOC: loai dung (cach lam dung)', !isOriginalSound(raw, 'Foreign Kodiene Mixx'));
  }

  console.log('\n=== 6. Dau vao rong/la -> khong phai original (khong nem loi) ===');
  {
    check('rong', !isOriginalSound('', ''));
    check('null/undefined', !isOriginalSound(null, undefined));
    check('url la', !isOriginalSound('https://www.tiktok.com/@user/video/123', 'abc'));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
