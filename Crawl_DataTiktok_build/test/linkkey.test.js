// test/linkkey.test.js — Kiem chung normalizeKey()/canonicalSoundUrl() trong linkkey.cjs.
//
// Boi canh (2026-07-30): nguoi dung phat hien 1 sound (bai hat co ban quyen, slug tieng
// Thai) bi day TRUNG len Sheet dung 2 lan, du co ca co che loc trung o luc quet lan luc day.
// Nguyen nhan: canonicalSoundUrl() CO Y giu nguyen slug cho bai hat co ban quyen (khac voi
// original-sound duoc rut gon ve dang /music/original-sound-<id>) - normalizeKey() cu chi
// lowercase NGUYEN VAN url do, nen 2 lan gap CUNG 1 ID nhung TikTok tra slug hoi khac nhau
// (viet hoa, dau nhay, chuan hoa Unicode chu khong phai Latin...) bi coi la 2 sound khac
// nhau. Fix: normalizeKey() gio trich RIENG so ID cuoi URL lam khoa so trung (dung chung ca
// original-sound lan bai hat ban quyen), KHONG dung cho URL luu/hien thi (van giu slug de doc).
// Chay: node test/linkkey.test.js
'use strict';

const { canonicalSoundUrl, normalizeKey } = require('../src/linkkey.cjs');

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`   OK   ${label}`); }
  else { fail++; console.log(`   FAIL ${label} ${extra}`); }
}

(async () => {
  console.log('\n=== 1. original-sound: 2 slug khac nhau, cung ID -> canonicalSoundUrl rut gon giong het ===');
  {
    const a = canonicalSoundUrl('https://www.tiktok.com/music/original-sound-Nhatty-on-Air-76273901234567');
    const b = canonicalSoundUrl('https://www.tiktok.com/music/original-sound-76273901234567');
    check('rut gon ve cung 1 url', a === b, `${a} vs ${b}`);
    check('dung dang /music/original-sound-<id>', a === 'https://www.tiktok.com/music/original-sound-76273901234567');
  }

  console.log('\n=== 2. Bai hat CO BAN QUYEN: canonicalSoundUrl KHONG rut gon (giu nguyen slug de doc) ===');
  {
    const u = 'https://www.tiktok.com/music/If-You-Dont-Mean-It-7656283172601465618';
    const c = canonicalSoundUrl(u);
    check('giu nguyen slug (khong rut gon nhu original-sound)', c === u, c);
  }

  console.log('\n=== 3. BUG THAT: bai hat ban quyen CUNG ID nhung slug khac nhau -> normalizeKey PHAI ra CUNG 1 key ===');
  {
    const u1 = 'https://www.tiktok.com/music/If-You-Don%27t-Mean-It-%E0%B8%AD%E0%B8%A2%E0%B9%88%E0%B8%B2%E0%B9%80%E0%B8%9C%E0%B8%A5%E0%B8%AD%E0%B9%83%E0%B8%88%E0%B9%83%E0%B8%AB%E0%B9%89%E0%B9%83%E0%B8%84%E0%B8%A3-7656283172601465618';
    const u2 = 'https://www.tiktok.com/music/if-you-dont-mean-it-tên-khác-hoàn-toàn-7656283172601465618';
    const k1 = normalizeKey(u1);
    const k2 = normalizeKey(u2);
    check('cung ID -> cung key du slug khac hoan toan', k1 === k2, `${k1} vs ${k2}`);
    check('key la dang music:<id>', k1 === 'music:7656283172601465618', k1);
  }

  console.log('\n=== 4. Khac ID that su -> khac key (khong gop nham 2 sound khac nhau) ===');
  {
    const k1 = normalizeKey('https://www.tiktok.com/music/song-a-12345678901');
    const k2 = normalizeKey('https://www.tiktok.com/music/song-b-98765432109');
    check('khac ID -> khac key', k1 !== k2, `${k1} vs ${k2}`);
  }

  console.log('\n=== 5. Query string / trailing slash / hoa-thuong khac nhau van ra cung key (cung ID) ===');
  {
    const k1 = normalizeKey('https://www.tiktok.com/music/Song-Name-76273901234567?lang=en');
    const k2 = normalizeKey('https://www.tiktok.com/music/song-name-76273901234567/');
    check('bo qua query/slash/hoa-thuong', k1 === k2, `${k1} vs ${k2}`);
  }

  console.log('\n=== 6. URL khong dung dinh dang /music/...-<id> -> lui ve so nguyen van (fallback an toan) ===');
  {
    const k1 = normalizeKey('https://www.tiktok.com/@someuser/video/123');
    const k2 = normalizeKey('https://www.tiktok.com/@someuser/video/123');
    const k3 = normalizeKey('https://www.tiktok.com/@otheruser/video/456');
    check('cung url la -> cung key (fallback)', k1 === k2);
    check('khac url -> khac key (fallback)', k1 !== k3);
  }

  console.log('\n=== 7. ID ngan hon 8 chu so -> KHONG trich (tranh nham voi nam/so thu tu trong slug) ===');
  {
    const u = 'https://www.tiktok.com/music/album-2024-1234567'; // chi 7 chu so cuoi
    const k = normalizeKey(u);
    check('khong khop pattern ID (>=8 so) -> fallback nguyen van', k === u.toLowerCase(), k);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`KET QUA: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
