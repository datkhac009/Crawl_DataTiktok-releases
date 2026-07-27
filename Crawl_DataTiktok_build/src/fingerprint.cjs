// src/fingerprint.cjs — DẤU VÂN TAY CỐ ĐỊNH THEO PROFILE (2026-07-27).
//
// Vấn đề giải quyết: chép profile sang máy khác thì mất đăng nhập. Cookie đi theo file,
// NHƯNG dấu vân tay trình duyệt được tính lại trên từng máy — số nhân CPU, dung lượng RAM,
// card đồ họa, độ phân giải màn hình đều khác nhau → TikTok thấy "cùng tài khoản, khác
// thiết bị" → hạ xuống chế độ khách.
//
// Cách giải: mỗi profile có 1 file `fingerprint.json` NẰM TRONG THƯ MỤC PROFILE. Chép thư
// mục đi đâu thì vân tay đi theo đó → mọi máy trình bày y hệt nhau.
// File mất cũng không sao: mọi giá trị được suy ra TẤT ĐỊNH từ tên thư mục profile nên
// sinh lại sẽ ra đúng bộ cũ.
//
// Kèm theo: đặt MÚI GIỜ + NGÔN NGỮ khớp nhãn quốc gia trong tên profile ("...(US)", "(UK)",
// "(KR1)"). Trước đây profile chạy VPN Mỹ nhưng trình duyệt báo giờ Việt Nam + tiếng Việt —
// mâu thuẫn rất dễ bị nhận diện là dùng proxy.
'use strict';

const fs = require('fs');
const path = require('path');

// Nhãn quốc gia → múi giờ + ngôn ngữ. Khớp theo chuỗi con nên "(MayUS3)" vẫn ra US.
const _COUNTRY = {
  US: ['America/New_York', 'en-US'],
  UK: ['Europe/London', 'en-GB'],
  GB: ['Europe/London', 'en-GB'],
  KR: ['Asia/Seoul', 'ko-KR'],
  JP: ['Asia/Tokyo', 'ja-JP'],
  TW: ['Asia/Taipei', 'zh-TW'],
  SG: ['Asia/Singapore', 'en-SG'],
  PH: ['Asia/Manila', 'en-PH'],
  ID: ['Asia/Jakarta', 'id-ID'],
  TH: ['Asia/Bangkok', 'th-TH'],
  MY: ['Asia/Kuala_Lumpur', 'ms-MY'],
  IN: ['Asia/Kolkata', 'en-IN'],
  AU: ['Australia/Sydney', 'en-AU'],
  CA: ['America/Toronto', 'en-CA'],
  DE: ['Europe/Berlin', 'de-DE'],
  FR: ['Europe/Paris', 'fr-FR'],
  BR: ['America/Sao_Paulo', 'pt-BR'],
  VN: ['Asia/Ho_Chi_Minh', 'vi-VN'],
};
// Xét mã 2 ký tự dễ trùng (UK/US) sau các mã dài hơn — ở đây đều 2 ký tự nên duyệt theo
// thứ tự khai báo là đủ; riêng GB xếp sau UK để "UK" thắng.
const _COUNTRY_ORDER = Object.keys(_COUNTRY);

// Băm tất định (djb2) — cùng tên profile luôn ra cùng số, trên mọi máy, mọi lần chạy.
function _hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
// ⚠ Phải dùng >>> (dịch KHÔNG dấu) ở nơi gọi: với h >= 2^31 thì `h >> n` ra số ÂM →
// arr[âm % len] = undefined → vỡ. Bọc thêm Math.abs cho chắc.
const _pick = (arr, h) => arr[Math.abs(h) % arr.length];

// Bộ giá trị thật hay gặp trên máy Windows — chọn tất định theo băm tên profile.
const _SCREENS = [
  { width: 1920, height: 1080 }, { width: 1536, height: 864 },
  { width: 1600, height: 900 }, { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];
const _CORES = [4, 6, 8, 12, 16];
const _MEMORY = [4, 8, 8, 16];
const _GPUS = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
];

// Suy ra quốc gia từ tên thư mục profile: lấy phần trong ngoặc đơn cuối cùng.
function countryOf(name) {
  const m = String(name || '').match(/\(([^)]*)\)\s*$/);
  const tag = (m ? m[1] : String(name || '')).toUpperCase();
  for (const code of _COUNTRY_ORDER) if (tag.includes(code)) return code;
  return null;
}

// Sinh bộ vân tay tất định từ tên profile (không đọc/ghi file).
function derive(profileName) {
  const h = _hash(profileName);
  const cc = countryOf(profileName);
  const [timezoneId, locale] = _COUNTRY[cc] || _COUNTRY.US;
  const screen = _pick(_SCREENS, h);
  const [glVendor, glRenderer] = _pick(_GPUS, h >>> 3);
  return {
    country: cc || 'US',
    timezoneId,
    locale,
    screen,
    hardwareConcurrency: _pick(_CORES, h >>> 6),
    deviceMemory: _pick(_MEMORY, h >>> 9),
    glVendor,
    glRenderer,
    platform: 'Win32',
  };
}

// Đọc fingerprint.json trong thư mục profile; chưa có thì sinh + ghi (để chép đi máy khác
// là mang theo). File hỏng cũng không sao — sinh lại từ tên profile ra đúng bộ cũ.
function getFingerprint(profilePath) {
  const name = path.basename(profilePath || 'profile');
  const file = path.join(profilePath, 'fingerprint.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.timezoneId && j.screen && j.hardwareConcurrency) return j;
  } catch (_) { /* chưa có hoặc hỏng → sinh mới */ }
  const fp = derive(name);
  try { fs.writeFileSync(file, JSON.stringify(fp, null, 2)); } catch (_) {}
  return fp;
}

// Tùy chọn truyền cho browser.newContext() — phần Playwright hỗ trợ sẵn.
function contextOptions(fp) {
  return { locale: fp.locale, timezoneId: fp.timezoneId };
}

// Mã chạy trong trang để ép các tín hiệu còn lại giống nhau trên mọi máy.
// Truyền fp làm tham số (addInitScript(fn, arg)) — KHÔNG tham chiếu biến ngoài.
function initScript(fp) {
  const def = (obj, prop, val) => {
    try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch (_) {}
  };
  def(navigator, 'hardwareConcurrency', fp.hardwareConcurrency);
  def(navigator, 'deviceMemory', fp.deviceMemory);
  def(navigator, 'platform', fp.platform);
  def(screen, 'width', fp.screen.width);
  def(screen, 'height', fp.screen.height);
  def(screen, 'availWidth', fp.screen.width);
  def(screen, 'availHeight', fp.screen.height - 40);
  def(screen, 'colorDepth', 24);
  def(screen, 'pixelDepth', 24);
  // WebGL: 37445 = UNMASKED_VENDOR_WEBGL, 37446 = UNMASKED_RENDERER_WEBGL
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C || !C.prototype) continue;
    const orig = C.prototype.getParameter;
    C.prototype.getParameter = function (p) {
      if (p === 37445) return fp.glVendor;
      if (p === 37446) return fp.glRenderer;
      return orig.apply(this, arguments);
    };
  }
}

module.exports = { getFingerprint, contextOptions, initScript, derive, countryOf };
