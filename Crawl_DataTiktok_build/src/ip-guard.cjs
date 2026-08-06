// src/ip-guard.cjs — CANH IP CÔNG KHAI khớp với nhãn quốc gia của profile.
//
// VÌ SAO CẦN (2026-07-28, sau khi triển khai nhiều VPS):
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
//                              phép làm treo cả dàn máy.
//   - Profile không có nhãn  → bỏ qua hoàn toàn, không áp dụng gì.
//
// Bổ sung (2026-07-30) — 2 NHÀ CUNG CẤP PHẢI ĐỒNG THUẬN mới kết luận "lệch": gặp thực tế 1
// máy ảo VPN đúng (IP Hàn Quốc thật, xác nhận độc lận bằng 2 dịch vụ khác) nhưng app vẫn báo
// TẠM DỪNG toàn bộ 5 profile — vì trước đây `getPublicIp()` dùng nhà cung cấp ĐẦU TIÊN trả
// lời được là TIN NGAY, không đối chiếu nhà cung cấp còn lại. `ifconfig.co` (đứng đầu danh
// sách) trả trang chặn Cloudflare thay vì JSON cho dải IP dạng VPN/datacenter — nếu nó lỡ trả
// JSON nhưng SAI quốc gia (geolocation DB xếp nhầm dải IP proxy) thì app tin luôn, không còn
// cơ hội đối chiếu. Giờ hỏi CẢ 2 nhà cung cấp (song song), CHỈ kết luận "lệch"/"khớp" khi
// đồng thuận — 2 bên trả khác quốc gia nhau thì coi như KHÔNG CHẮC, không chặn (đúng triết lý
// ở trên: 1 nhà cung cấp lỗi/xếp nhầm không được phép tự ý chặn cả 5 profile).
'use strict';

const https = require('https');

// Một số máy có AV/proxy can thiệp HTTPS (SSL interception) khiến Node không xác minh được
// chứng chỉ — cùng lý do đã xử lý trong sheets.cjs và updater.cjs.
const _insecureAgent = new https.Agent({ rejectUnauthorized: false });

// 2 nhà cung cấp — giờ hỏi CẢ HAI (song song) để đối chiếu, không chỉ dùng cái đầu trả lời
// được. Cả hai đều miễn phí, không cần khóa API, trả mã quốc gia 2 ký tự. Đã đo thực tế:
// ifconfig.co ~850ms, country.is ~1.5s — chạy song song nên tổng thời gian chờ vẫn ~1.5s
// (không cộng dồn), chỉ chậm hơn ~650ms so với trước để đổi lấy việc đối chiếu.
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

// Trả { ip, country } (country = mã 2 ký tự HOA) hoặc { ip, country: null } nếu:
//   - không nhà cung cấp nào trả lời được, HOẶC
//   - các nhà cung cấp trả lời NHƯNG KHÔNG ĐỒNG THUẬN quốc gia (1 bên có thể xếp nhầm dải IP
//     VPN/datacenter — gặp thực tế 2026-07-30: ifconfig.co báo lệch trong khi country.is +
//     một dịch vụ đối chiếu ngoài đều xác nhận IP đúng vùng. Không đồng thuận = không đủ tin
//     cậy để chặn cả 5 profile, coi như KHÔNG BIẾT).
// Có cache 1 phút để nhiều profile kiểm cùng lúc không bắn nhiều request — KHÔNG cache kết
// quả "không biết" (at=0), để lần kiểm tiếp theo được thử lại ngay thay vì kẹt ở trạng thái
// mơ hồ cả phút.
async function getPublicIp({ force = false } = {}) {
  if (!force && _cache.at && Date.now() - _cache.at < CACHE_MS) return _cache;

  const settled = await Promise.all(PROVIDERS.map(async (p) => {
    const j = await _getJson(p.url);
    if (!j) return null;
    try {
      const { ip, country } = p.pick(j);
      if (country && String(country).length === 2) {
        return { ip: ip || null, country: String(country).toUpperCase() };
      }
    } catch (_) { /* nhà cung cấp đổi định dạng → bỏ qua kết quả này */ }
    return null;
  }));

  const results = settled.filter(Boolean);
  if (!results.length) { _cache = { at: 0, ip: null, country: null }; return _cache; }

  const ip = results.find(r => r.ip)?.ip || null;
  const countries = new Set(results.map(r => r.country));
  if (countries.size > 1) {
    _cache = { at: 0, ip, country: null };
    return _cache;
  }
  _cache = { at: Date.now(), ip, country: results[0].country };
  return _cache;
}

// Nhãn quốc gia trong tên profile dùng cả UK và GB cho Anh, còn API luôn trả GB
// (ISO 3166-1). Không quy đổi thì profile "(UK)" chạy trên IP Anh sẽ bị báo lệch OAN.
const _ALIASES = { UK: 'GB' };
function _norm(c) {
  const u = String(c || '').toUpperCase();
  return _ALIASES[u] || u;
}
// XUẤT RA để mọi nơi so quốc gia dùng CHUNG một phép quy đổi (2026-08-05).
// Lý do: `vpn-hma.cjs` cũng phải so nhãn quốc gia của profile với vùng HMA đang nối, và lần
// đầu nó tự so chuỗi thẳng → profile `(UK)` gặp HMA báo `GB` là bị coi là LỆCH → tính năng đổi
// IP tự chối chạy với TOÀN BỘ profile UK. Đúng bẫy QĐ-10: 2 bản sao của cùng một logic thì
// chúng SẼ lệch nhau. Test `vpn-hma.test.js` mục 3 bắt được ngay lúc triển khai.
const normalizeCountry = _norm;

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

module.exports = { check, getPublicIp, normalizeCountry };
