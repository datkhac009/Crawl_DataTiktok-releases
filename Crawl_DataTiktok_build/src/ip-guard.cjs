// src/ip-guard.cjs — CANH IP CÔNG KHAI khớp với nhãn quốc gia của profile.
//
// VÌ SAO CẦN (2026-07-28, sau khi triển khai 6 VPS):
// `fingerprint.cjs` đặt múi giờ + ngôn ngữ theo NHÃN QUỐC GIA trong tên profile — profile
// "...(US)" luôn khai `America/New_York` + `en-US`. Cách này chỉ an toàn khi IP thật cũng ở
// Mỹ. Trên VPS, IP đúng vùng là nhờ VPN (HMA) — mà VPN thì CÓ LÚC TỤT.
//
// Khi VPN tụt lúc 3h sáng: 5 profile vẫn khai giờ New York nhưng request đi từ IP Đức
// (Hetzner). Đây ĐÚNG là mâu thuẫn mà DECISIONS.md QĐ-05 ghi là "rất dễ bị nhận diện là
// dùng proxy" — trước đây app KHÔNG HỀ BIẾT và cứ cào tiếp hàng giờ ở trạng thái đó.
//
// TRIẾT LÝ XỬ LÝ (giống checkLoginState): KHÔNG kết luận khi không chắc.
//   - Lệch quốc gia rõ ràng  → báo để nơi gọi TẠM DỪNG (không phải dừng hẳn: VPN thường tự
//                              kết nối lại sau vài phút, dừng hẳn là mất cả đêm sản lượng).
//   - Không tra được IP      → coi như KHÔNG BIẾT, KHÔNG chặn. Mất mạng vài giây không được
//                              phép làm treo cả 6 máy.
//   - Profile không có nhãn  → bỏ qua hoàn toàn, không áp dụng gì.
'use strict';

const https = require('https');

// Một số máy có AV/proxy can thiệp HTTPS (SSL interception) khiến Node không xác minh được
// chứng chỉ — cùng lý do đã xử lý trong sheets.cjs và updater.cjs.
const _insecureAgent = new https.Agent({ rejectUnauthorized: false });

// 2 nhà cung cấp: dùng cái đầu, lỗi/quá hạn thì thử cái sau. Cả hai đều miễn phí, không cần
// khóa API, trả mã quốc gia 2 ký tự. Đã đo thực tế: ifconfig.co ~850ms, country.is ~1.5s.
const PROVIDERS = [
  { url: 'https://ifconfig.co/json', pick: (j) => ({ ip: j.ip, country: j.country_iso }) },
  { url: 'https://api.country.is/', pick: (j) => ({ ip: j.ip, country: j.country }) },
];

const LOOKUP_TIMEOUT_MS = 8000;
const CACHE_MS = 60 * 1000;   // 1 phút — VPN tụt thì phát hiện trong vòng 1 phút là đủ nhanh

let _cache = { at: 0, ip: null, country: null };

function _getJson(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = https.get(url, {
      agent: _insecureAgent,
      headers: { 'User-Agent': 'TikTokCrawler-IpGuard', 'Accept': 'application/json' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return finish(null); }
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { try { finish(JSON.parse(body)); } catch (_) { finish(null); } });
    });
    req.on('error', () => finish(null));
    req.setTimeout(LOOKUP_TIMEOUT_MS, () => { try { req.destroy(); } catch (_) {} finish(null); });
  });
}

// Trả { ip, country } (country = mã 2 ký tự HOA) hoặc { ip: null, country: null } nếu không
// tra được. Có cache 1 phút để nhiều profile kiểm cùng lúc không bắn nhiều request.
async function getPublicIp({ force = false } = {}) {
  if (!force && _cache.country && Date.now() - _cache.at < CACHE_MS) return _cache;
  for (const p of PROVIDERS) {
    const j = await _getJson(p.url);
    if (!j) continue;
    try {
      const { ip, country } = p.pick(j);
      if (country && String(country).length === 2) {
        _cache = { at: Date.now(), ip: ip || null, country: String(country).toUpperCase() };
        return _cache;
      }
    } catch (_) { /* nhà cung cấp đổi định dạng → thử cái sau */ }
  }
  return { at: 0, ip: null, country: null };
}

// Nhãn quốc gia trong tên profile dùng cả UK và GB cho Anh, còn API luôn trả GB
// (ISO 3166-1). Không quy đổi thì profile "(UK)" chạy trên IP Anh sẽ bị báo lệch OAN.
const _ALIASES = { UK: 'GB' };
function _norm(c) {
  const u = String(c || '').toUpperCase();
  return _ALIASES[u] || u;
}

// So nhãn quốc gia mong muốn với IP thật.
// Trả { state, ip, country, want }
//   state = 'ok'       khớp, cứ chạy
//         | 'mismatch' LỆCH rõ ràng → nơi gọi nên TẠM DỪNG
//         | 'unknown'  không tra được → KHÔNG chặn (mạng lỗi tạm thời)
//         | 'skip'     profile không có nhãn quốc gia → không áp dụng
async function check(wantCountry, opts) {
  const want = _norm(wantCountry);
  if (!want) return { state: 'skip', ip: null, country: null, want: null };
  const { ip, country } = await getPublicIp(opts);
  if (!country) return { state: 'unknown', ip, country: null, want };
  return { state: _norm(country) === want ? 'ok' : 'mismatch', ip, country, want };
}

module.exports = { check, getPublicIp };
