// src/vpn-hma.cjs — ĐIỀU KHIỂN HMA VPN: tắt rồi bật lại để lấy IP mới.
//
// VÌ SAO CÓ (2026-08-05, người dùng chốt): khi TikTok cắt feed của một profile (QĐ-31 —
// "feed cạn"), nguyên nhân gần như luôn ở tầng IP của máy. Hai bản vá trước chỉ giảm thiệt hại
// (phát hiện đúng, ngừng dội, đổi hướng); đổi IP là thứ duy nhất chạm tới GỐC RỄ.
//
// ── CÁCH ĐIỀU KHIỂN: native messaging host của chính HMA ──
// HMA đăng ký `com.privax.vpn` → `VpnNM.exe` để extension trình duyệt của họ bật/tắt VPN.
// Đó là kênh điều khiển sẵn có, và nó chạy dưới QUYỀN NGƯỜI DÙNG THƯỜNG.
// Giao thức = Chrome native messaging: mỗi message là 4 byte length (little-endian) + JSON UTF-8.
// Host được gọi với argv[1] = origin của extension.
//
// Từ vựng lệnh (trích từ chính VpnNM.exe, API 1.36):
//   gửi:   Vpn_GetState_NmSvc · Vpn_GetApiVersion_NmSvc · Vpn_GetOptimalGateway_NmSvc
//          Vpn_Connect_NmSvc · Vpn_ConnectToOptimal_NmSvc · Vpn_Disconnect_NmSvc
//   nhận:  Vpn_OnStateChanged_SvcNm · Vpn_OnErrorOccurred_SvcNm
//
// ── 3 CÁCH KHÁC ĐÃ CÂN VÀ LOẠI (đo thật trên máy người dùng 2026-08-05) ──
//   • `openvpn.exe` đi kèm HMA: máy đó HMA chạy **WireGuard** (adapter "HMA VPN WireGuard" Up),
//     openvpn.exe không phải đường vận chuyển đang dùng.
//   • Stop/start dịch vụ `HmaProVpn` hoặc disable/enable adapter: dịch vụ chạy `LocalSystem`,
//     app KHÔNG chạy admin → không làm được. Bắt người dùng chạy app bằng admin là quá đắt.
//   • UI automation cửa sổ HMA: GUI là **WebView2** (có `EBWebView` trong ProgramData) → UI
//     Automation gần như không thấy phần tử nào, chỉ còn click theo toạ độ. Trên máy ảo mà RDP
//     ngắt/khoá màn hình thì click toạ độ không chạy → không dùng được cho chạy không người trông.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
// ⚠ DÙNG CHUNG phép quy đổi mã quốc gia với ip-guard, KHÔNG tự viết lại: nhãn profile dùng
// `UK` còn HMA/ISO 3166-1 trả `GB`. Lần đầu tôi so chuỗi thẳng ở đây → mọi profile `(UK)` bị
// coi là LỆCH vùng nên tính năng đổi IP tự chối chạy. Đúng bẫy QĐ-10 (2 bản sao SẼ lệch), và
// test bắt được ngay lúc triển khai.
const { normalizeCountry } = require('./ip-guard.cjs');

// Origin của extension HMA — host CÓ THỂ kiểm tra tham số này, nên truyền đúng như Chrome truyền.
const ORIGIN = 'chrome-extension://poeojclicodamonabcabmapamjkkmnnk/';

const ACT = {
  getState: 'Vpn_GetState_NmSvc',
  getApiVersion: 'Vpn_GetApiVersion_NmSvc',
  connect: 'Vpn_Connect_NmSvc',
  disconnect: 'Vpn_Disconnect_NmSvc',
  // ⛔ TUYỆT ĐỐI KHÔNG DÙNG `Vpn_ConnectToOptimal_NmSvc`.
  // Đo thật trên máy người dùng: `Vpn_GetOptimalGateway_NmSvc` trả về VN-51-HANOI (Việt Nam) —
  // vì "optimal" là server GẦN NHẤT theo địa lý, không phải server đang chọn. Nối vào đó thì
  // profile khai giờ London/Seoul/New York bỗng chạy trên IP Việt Nam = đúng mâu thuẫn
  // "IP nước này, giờ nước khác" mà QĐ-05 gọi là dễ bị nhận diện proxy nhất, và ip-guard
  // (QĐ-17) sẽ tạm dừng cả dàn máy. Luôn Connect bằng gateway id TƯỜNG MINH.
};

const RESPONSE_TIMEOUT_MS = 15000;   // trần chờ 1 lời gọi
const CONNECT_WAIT_MS = 90000;       // trần chờ VPN lên lại sau khi Connect
// Nhịp đọc lại trạng thái trong lúc chờ tắt/bật. Cho ghi đè bằng TTC_VPN_POLL_MS để test không
// phải chờ thật (cùng khuôn TTC_IP_RETRY_MS / TTC_STARVE_RETRY_MS). Bản chạy thật không set.
const POLL_MS = Number(process.env.TTC_VPN_POLL_MS) || 2000;

// ── Tìm VpnNM.exe: ĐỌC TỪ REGISTRY, không hardcode ──
// Máy ảo có thể cài khác ổ/khác thư mục (x86 vs x64), hardcode là hỏng âm thầm ở đúng nơi
// không ai vào xem log.
const REG_KEYS = [
  'HKLM\\SOFTWARE\\Privax\\Browser\\NativeMessagingHosts\\com.privax.vpn',
  'HKLM\\SOFTWARE\\WOW6432Node\\Privax\\Browser\\NativeMessagingHosts\\com.privax.vpn',
  'HKLM\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.privax.vpn',
  'HKLM\\SOFTWARE\\WOW6432Node\\Google\\Chrome\\NativeMessagingHosts\\com.privax.vpn',
];
const FALLBACK_MANIFESTS = [
  'C:\\Program Files\\Privax\\HMA VPN\\VpnNM_chrome.json',
  'C:\\Program Files (x86)\\Privax\\HMA VPN\\VpnNM_chrome.json',
];

function _regQuery(key) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/ve'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // Dòng dạng:  (Default)    REG_SZ    C:\...\VpnNM_chrome.json
      const m = String(stdout).match(/REG_SZ\s+(.+?)\s*$/m);
      resolve(m ? m[1].trim() : null);
    });
  });
}

// Trả đường dẫn tuyệt đối tới VpnNM.exe, hoặc null nếu máy này không có HMA.
let _hostPathCache = undefined;
async function hostPath() {
  if (_hostPathCache !== undefined) return _hostPathCache;
  const candidates = [];
  for (const k of REG_KEYS) {
    const v = await _regQuery(k);
    if (v) candidates.push(v);
  }
  candidates.push(...FALLBACK_MANIFESTS);

  for (const manifest of candidates) {
    try {
      if (!fs.existsSync(manifest)) continue;
      const j = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (!j || !j.path) continue;
      // `path` trong manifest là tương đối so với chính file manifest.
      const exe = path.isAbsolute(j.path) ? j.path : path.join(path.dirname(manifest), j.path);
      if (fs.existsSync(exe)) { _hostPathCache = exe; return exe; }
    } catch (_) { /* manifest hỏng → thử ứng viên kế tiếp */ }
  }
  _hostPathCache = null;
  return null;
}

async function isAvailable() { return !!(await hostPath()); }

// ── NGUY CƠ RÒ RỈ IPv6 KHI VPN TẮT (đo thật 2026-08-06) ──
//
// Đường hầm WireGuard của HMA chỉ định tuyến IPv4. Đo trên máy người dùng:
//   HMA BẬT : IPv4 → 13.40.11.3 (GB)        · IPv6 → bị chặn (EACCES)   ✅ an toàn
//   HMA TẮT : IPv6 → 2001:db8:… (VN) lọt ra chỉ trong 241ms            ❌ RÒ RỈ
//
// ⚠ `systemKillSwitchActive: true` của HMA **KHÔNG** chặn IPv6 — đã đo, đừng tin vào cờ đó.
//
// Vì sao quan trọng: trong cửa sổ VPN tắt để đổi IP, profile nào còn chạy sẽ gửi request bằng
// IPv6 THẬT trong khi vẫn khai múi giờ London/Seoul/New York — đúng mâu thuẫn "IP nước này,
// giờ nước khác" mà QĐ-05 nói là dễ bị nhận diện proxy nhất. Rò rỉ này IM LẶNG: profile vẫn
// chạy mượt (người dùng quan sát đúng), chỉ mất phiên SAU ĐÓ nên rất khó truy ra nguyên nhân.
//
// Hàm này quyết định app được phép dừng RIÊNG 1 profile hay phải dừng HẾT:
//   không có rủi ro → chỉ dừng profile bị cắt feed (các profile khác chỉ lỗi mạng tạm thời)
//   có rủi ro       → phải dừng hết, nếu không là lộ IP thật của cả nhóm
//
// Chỉ tính **global unicast 2000::/3** (bắt đầu bằng 2 hoặc 3) — đó là loại duy nhất ra được
// internet. Bỏ qua `fe80` (link-local) và `fd/fc` (ULA riêng tư, vd Tailscale dùng `fd7a:…`)
// vì chúng không định tuyến ra ngoài nên không thể rò rỉ.
// Dùng `os.networkInterfaces()` (đồng bộ, sẵn trong Node) — không spawn tiến trình, không cần
// quyền admin, gọi bao nhiêu lần cũng được.
const _VPN_IFACE = /tailscale|wireguard|hma|tap-?windows|openvpn|loopback/i;

function ipv6LeakRisk() {
  const found = [];
  let ifaces = {};
  try { ifaces = os.networkInterfaces() || {}; } catch (_) { return { risky: false, addresses: [], unknown: true }; }
  for (const [name, addrs] of Object.entries(ifaces)) {
    // Adapter của chính VPN có IPv6 công khai là chuyện bình thường (đi trong đường hầm), và
    // nó biến mất khi VPN tắt — không phải nguồn rò rỉ.
    if (_VPN_IFACE.test(name)) continue;
    for (const a of addrs || []) {
      const fam = a && (a.family === 'IPv6' || a.family === 6);
      if (!fam || a.internal) continue;
      if (/^[23]/.test(a.address)) found.push({ iface: name, address: a.address });
    }
  }
  return { risky: found.length > 0, addresses: found };
}

// ── Một phiên nói chuyện với host ──
// Mỗi phiên spawn một tiến trình host riêng rồi đóng — giống hệt cách Chrome làm với extension.
// Không giữ tiến trình sống lâu: host chết giữa chừng thì lần sau tự có tiến trình mới, không
// phải tự dựng cơ chế hồi phục.
function _openSession(exe) {
  const child = spawn(exe, [ORIGIN, '--parent-window=0'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const waiters = [];        // { action, resolve, timer }
  const events = [];         // mọi message nhận được (để chẩn đoán)
  let buf = Buffer.alloc(0);
  let dead = null;

  child.on('error', (e) => { dead = 'spawn lỗi: ' + e.message; });
  child.on('exit', (code) => { dead = `host thoát (code=${code})`; });

  child.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      // Length vô lý = mất đồng bộ khung → bỏ hết, đừng cố đoán.
      if (n > 8 * 1024 * 1024) { buf = Buffer.alloc(0); break; }
      if (buf.length < 4 + n) break;
      const raw = buf.slice(4, 4 + n).toString('utf8');
      buf = buf.slice(4 + n);
      let msg = null;
      try { msg = JSON.parse(raw); } catch (_) { continue; }
      events.push(msg);
      // Khớp trả lời với người đang chờ ĐÚNG action đó. Sự kiện OnStateChanged/OnErrorOccurred
      // đẩy về bất chợt nên không được coi là trả lời của lời gọi đang chờ.
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].action === msg.action) {
          clearTimeout(waiters[i].timer);
          const w = waiters.splice(i, 1)[0];
          w.resolve(msg);
          break;
        }
      }
    }
  });

  function call(action, data) {
    return new Promise((resolve) => {
      if (dead) return resolve({ error: { description: dead } });
      const timer = setTimeout(() => {
        const i = waiters.findIndex(w => w.timer === timer);
        if (i >= 0) waiters.splice(i, 1);
        resolve({ error: { description: `quá ${RESPONSE_TIMEOUT_MS}ms không có phản hồi cho ${action}` } });
      }, RESPONSE_TIMEOUT_MS);
      if (timer.unref) timer.unref();
      waiters.push({ action, resolve, timer });
      try {
        const body = Buffer.from(JSON.stringify(data === undefined ? { action } : { action, data }), 'utf8');
        const len = Buffer.alloc(4);
        len.writeUInt32LE(body.length, 0);
        child.stdin.write(Buffer.concat([len, body]));
      } catch (e) {
        clearTimeout(timer);
        resolve({ error: { description: 'ghi stdin lỗi: ' + e.message } });
      }
    });
  }

  function close() { try { child.kill(); } catch (_) {} }
  function lastError() {
    const e = [...events].reverse().find(m => m.action === 'Vpn_OnErrorOccurred_SvcNm');
    return e ? JSON.stringify(e.data).slice(0, 300) : null;
  }

  return { call, close, events, lastError, isDead: () => dead };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Trạng thái gọn cho nơi gọi.
function _summarize(state) {
  const g = state && state.activeGateway;
  return {
    connected: !!(g && g.id),
    gatewayId: g ? g.id : null,
    city: g && g.city ? g.city.name : null,
    countryId: g && g.country ? String(g.country.id || '').toUpperCase() : null,
    connectionId: state && state.connectionInfo ? state.connectionInfo.connectionId : null,
    gateways: (state && state.gateways) || [],
  };
}

async function _getState(sess) {
  const r = await sess.call(ACT.getState);
  if (!r || r.error || !r.data) return { ok: false, msg: (r && r.error && r.error.description) || 'không đọc được trạng thái HMA' };
  return { ok: true, state: _summarize(r.data) };
}

// Đọc trạng thái hiện tại (dùng cho chẩn đoán / hiện ra UI).
async function status() {
  const exe = await hostPath();
  if (!exe) return { ok: false, msg: 'Không tìm thấy HMA VPN trên máy này (không có native messaging host com.privax.vpn).' };
  const sess = _openSession(exe);
  try {
    await sleep(600);   // host cần một nhịp để dựng kênh tới dịch vụ
    return await _getState(sess);
  } finally { sess.close(); }
}

// ── Chọn gateway để nối lại ──
//
// ⚠ MẶC ĐỊNH LÀ **NỐI LẠI ĐÚNG GATEWAY CŨ** (`rotate: false`), KHÔNG xoay thành phố.
//
// Ban đầu module này mặc định xoay sang city khác, vì tôi GIẢ ĐỊNH nối lại đúng server cũ sẽ
// được cấp lại đúng IP cũ (nên không đổi được gì). Giả định đó SAI — người dùng chỉ ra, và đo
// thật xác nhận: disconnect rồi connect lại **đúng** `GB-H9-LONDON-ULT` cho IP
// `18.171.54.19` → `18.132.40.68`. HMA cấp IP từ một POOL mỗi lần kết nối, không gán tĩnh theo
// gateway. Vậy chỉ cần tắt/bật lại là đã đổi IP.
//
// Điều đó làm việc xoay city không chỉ dư thừa mà CÓ HẠI: nó đưa IP sang một vùng địa lý khác
// trong cùng nước, lệch với vùng mà phiên đăng nhập của profile đã quen — thêm rủi ro mà không
// đổi lấy lợi ích nào. Nên `rotate` giờ chỉ còn là đường dự phòng, mặc định TẮT.
//
// Hệ quả tốt: **KR (chỉ 1 gateway — Seoul) không còn là trường hợp yếu hơn** GB/US nữa. Trước
// đây tài liệu ghi "KR nối lại vẫn có thể ra cùng IP, không đảm bảo đổi được gì" — điều đó dựa
// trên chính giả định sai ở trên và KHÔNG đúng.
//
// ⚠ Vẫn chỉ trong cùng quốc gia khi có xoay — đổi nước là phá vỡ sự khớp giữa IP và nhãn quốc
// gia của profile (QĐ-05) và sẽ bị ip-guard tạm dừng (QĐ-17).
function pickGateway(gateways, countryId, currentId) {
  // Quy đổi UK→GB ở ĐÂY nữa: nơi gọi có thể truyền nhãn profile (`UK`) thay vì mã HMA (`gb`).
  const cc = normalizeCountry(countryId);
  const sameCountry = (gateways || []).filter(g =>
    g && g.country && normalizeCountry(g.country.id) === cc && g.id);
  if (!sameCountry.length) return { id: currentId, rotated: false, total: 0 };
  const others = sameCountry.filter(g => g.id !== currentId);
  if (!others.length) return { id: currentId, rotated: false, total: sameCountry.length };
  // Xoay vòng tất định theo thời điểm — không cần lưu trạng thái, và nhiều máy không đồng loạt
  // chọn cùng một city.
  const pick = others[Math.floor(Math.random() * others.length)];
  return { id: pick.id, rotated: true, total: sameCountry.length, city: pick.city && pick.city.name };
}

// ── CHU TRÌNH TẮT → BẬT ──
// Trả { ok, msg, before, after }.
//
// ⚠ NƠI GỌI PHẢI ĐẢM BẢO KHÔNG CÒN PROFILE NÀO ĐANG CHẠY. Trong lúc VPN tắt, máy dùng IP THẬT
// (đo trên máy người dùng: IP thật 🇻🇳 trong khi profile khai giờ London). Một request lọt ra
// lúc đó là đủ để TikTok thấy "1 phiên, 2 quốc gia" → hủy phiên. Module này KHÔNG tự dừng
// profile được (không biết gì về crawler) nên trách nhiệm đó thuộc nơi gọi.
// `rotate` MẶC ĐỊNH FALSE: chỉ tắt/bật lại đúng gateway cũ là đã đổi IP (đo thật — xem
// pickGateway). Truyền `rotate: true` chỉ khi muốn đổi hẳn thành phố, và biết rõ mình đang
// đánh đổi gì.
let _cycling = false;
async function cycle({ expectCountry = null, rotate = false } = {}) {
  if (_cycling) return { ok: false, msg: 'Đang có một lượt tắt/bật VPN khác chạy dở.' };
  const exe = await hostPath();
  if (!exe) return { ok: false, msg: 'Không tìm thấy HMA VPN trên máy này.' };

  _cycling = true;
  const sess = _openSession(exe);
  try {
    await sleep(600);

    const s0 = await _getState(sess);
    if (!s0.ok) return { ok: false, msg: 'Không đọc được trạng thái HMA: ' + s0.msg };
    const before = s0.state;
    if (!before.connected) {
      return { ok: false, msg: 'HMA đang KHÔNG kết nối — không rõ nên nối lại vào đâu. Hãy bật HMA một lần bằng tay rồi thử lại.' };
    }
    // Nhãn quốc gia của profile phải khớp vùng HMA đang nối, nếu không thì việc "nối lại cùng
    // nước" sẽ nối vào nước SAI so với profile.
    if (expectCountry && before.countryId
        && normalizeCountry(expectCountry) !== normalizeCountry(before.countryId)) {
      return {
        ok: false,
        msg: `HMA đang ở ${before.countryId} nhưng profile khai (${String(expectCountry).toUpperCase()}) `
          + '— KHÔNG tự đổi IP để tránh nối vào nước sai. Hãy sửa VPN cho khớp nhãn profile trước.',
        before,
      };
    }

    const target = rotate
      ? pickGateway(before.gateways, before.countryId, before.gatewayId)
      : { id: before.gatewayId, rotated: false, total: 0 };
    if (!target.id) return { ok: false, msg: 'Không xác định được gateway để nối lại.', before };

    // 1) TẮT
    const d = await sess.call(ACT.disconnect);
    if (d && d.error) return { ok: false, msg: 'Tắt HMA lỗi: ' + d.error.description, before };

    // Chờ tới khi thực sự ngắt (activeGateway rỗng). Không tin ngay lời "đã nhận lệnh".
    let offOk = false;
    for (let t = 0; t < 15; t++) {
      await sleep(POLL_MS);
      const s = await _getState(sess);
      if (s.ok && !s.state.connected) { offOk = true; break; }
    }
    // Không xác nhận được là đã ngắt vẫn đi tiếp — nhưng ghi log, vì nó nghĩa là ta không chắc
    // cửa sổ lộ IP thật kéo dài bao lâu.
    if (!offOk) console.warn('[vpn] Không xác nhận được HMA đã ngắt (vẫn thử nối lại).');

    // 2) BẬT lại — gateway TƯỜNG MINH, không bao giờ ConnectToOptimal.
    const c = await sess.call(ACT.connect, { gateway: { id: target.id } });
    if (c && c.error) {
      return {
        ok: false,
        msg: `Bật lại HMA lỗi: ${c.error.description}. ⚠ VPN có thể ĐANG TẮT — máy đang dùng IP thật, `
          + 'đừng chạy profile nào tới khi bật lại HMA bằng tay.',
        before,
      };
    }

    // 3) Chờ lên lại + xác nhận ĐÚNG NƯỚC
    const deadline = Date.now() + CONNECT_WAIT_MS;
    let after = null;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const s = await _getState(sess);
      if (s.ok && s.state.connected) { after = s.state; break; }
    }
    if (!after) {
      const le = sess.lastError();
      return {
        ok: false,
        msg: `Bật lại HMA quá ${Math.round(CONNECT_WAIT_MS / 1000)}s chưa lên. ⚠ ĐỪNG chạy profile `
          + 'nào tới khi HMA lên lại (máy đang dùng IP thật).' + (le ? ' Lỗi HMA: ' + le : ''),
        before,
      };
    }
    if (before.countryId && after.countryId && after.countryId !== before.countryId) {
      return {
        ok: false,
        msg: `HMA lên lại nhưng SAI NƯỚC: trước ${before.countryId}, giờ ${after.countryId}. `
          + 'Đừng chạy profile — sửa VPN cho đúng vùng trước.',
        before, after,
      };
    }

    return {
      ok: true,
      before, after,
      msg: `HMA đã tắt/bật lại ${target.rotated
        ? `(${before.city || before.gatewayId} → ${after.city || after.gatewayId})`
        : `(${after.city || after.gatewayId})`}`
        + ` — ${after.countryId}. HMA cấp IP mới từ pool mỗi lần kết nối nên không cần đổi city.`,
    };
  } finally {
    sess.close();
    _cycling = false;
  }
}

module.exports = { isAvailable, hostPath, status, cycle, pickGateway, ipv6LeakRisk, ORIGIN, ACT };
