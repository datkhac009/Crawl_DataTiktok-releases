// src/google-api.cjs — Xác thực Service Account + tiện ích HTTP cho Google Sheets API v4.
//
// Vì sao tách riêng (2026-07-28): trước đây toàn bộ phần này nằm trong sheets.cjs. Khi thêm
// sheet-lock.cjs (khóa liên máy) cũng cần đúng cơ chế xác thực đó — nếu copy sang thì có
// NGAY 2 bản sao, đúng cái bẫy DECISIONS.md QĐ-10 đã ghi: "khi có ≥2 bản sao của cùng một
// logic, chúng SẼ lệch nhau". Đặc biệt nguy hiểm với cache token: 2 cache riêng nghĩa là
// gấp đôi số lần xin token, dễ chạm giới hạn của Google.
//
// Cơ chế: ký JWT RS256 từ service account (client_email + private_key) → đổi lấy
// access_token OAuth2 (scope spreadsheets), cache 55 phút theo email.
// Không cần thư viện ngoài — dùng crypto + https của Node.
'use strict';

const crypto = require('crypto');
const https = require('https');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const CACHE_TTL_MS = 55 * 60 * 1000;

// Một số máy có phần mềm diệt virus/proxy can thiệp HTTPS (SSL interception) khiến
// Node không xác minh được chứng chỉ Google ("unable to verify the first certificate").
// Agent này bỏ qua xác minh chứng chỉ để vẫn gọi được API trong môi trường đó.
const _insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Trần thời gian mặc định cho MỌI request Google API. (2026-07-28) TRƯỚC ĐÂY không có
// timeout nào — nếu kết nối bị treo (mạng chập chờn, không lỗi hẳn cũng không xong) thì
// Promise không bao giờ resolve/reject. Hậu quả thật: `sheet-lock.cjs` gọi hàm này trên
// đường CHẶN của IPC 'profile-start', renderer chạy tuần tự (`for...await`) nên request
// treo ở profile thứ N làm profile N+1..cuối KHÔNG BAO GIỜ được thử — người dùng thấy
// "chỉ profile đầu tiên chạy được".
//
// Bổ sung (2026-07-29): ban đầu đặt 10000ms, nhưng thực tế đọc `values/{tab}!B:B` trên
// tab đã tích lũy nhiều nghìn dòng (nhiều máy cùng đẩy vào 1 Sheet lâu ngày) đôi khi CHÍNH
// ĐÁNG mất hơn 10s (không phải treo, chỉ là chậm) — timeout cũ vô tình biến một request
// đang chạy chậm nhưng vẫn sẽ xong thành một lỗi giả. Nới lên 25s: vẫn có trần (không còn
// treo vô hạn như bug gốc), nhưng đủ chỗ cho request hợp lệ trên Sheet lớn.
const DEFAULT_TIMEOUT_MS = 25000;

// ── Tiện ích HTTP (Promise) ──
function httpRequest(method, url, { headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    const u = new URL(url);
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { ...headers },
      agent: _insecureAgent,
    };
    if (data) {
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => done(resolve, { status: res.statusCode, body: buf }));
      res.on('error', (e) => done(reject, e));
    });
    req.on('error', (e) => done(reject, e));
    // ⚠ (2026-07-28) `req.setTimeout()` của Node ĐÃ THỬ và KHÔNG đủ tin cậy: đo thực tế,
    // khi kết nối treo ở đúng giai đoạn DNS/TCP handshake (không SYN-ACK, không lỗi), timer
    // đó KHÔNG kích hoạt — request cứ treo tới khi hệ điều hành tự bỏ cuộc (~21 giây trong
    // môi trường test, có thể lâu hơn trên máy thật). Dùng `setTimeout()` JS thuần (đếm từ
    // lúc gọi hàm, không phụ thuộc trạng thái socket) để đảm bảo đúng hạn ở MỌI giai đoạn.
    const timer = setTimeout(() => {
      req.destroy(new Error(`Google API timeout sau ${timeoutMs}ms: ${method} ${u.pathname}`));
    }, timeoutMs);
    if (timer.unref) timer.unref();   // không giữ tiến trình Node sống chỉ vì timer này
    if (data) req.write(data);
    req.end();
  });
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Chấp nhận cả JSON tải từ Google (client_email/private_key) lẫn {email,private_key}.
function normalizeServiceAccount(sa) {
  if (!sa) return null;
  const email = sa.client_email || sa.email;
  const privateKey = sa.private_key;
  if (!email || !privateKey) return null;
  return { email, privateKey: privateKey.replace(/\\n/g, '\n') };
}

// ── Token cache theo email (DÙNG CHUNG cho mọi module gọi Sheets) ──
const _tokenCache = new Map(); // email -> { token, expiresAt }

async function getToken(sa) {
  const norm = normalizeServiceAccount(sa);
  if (!norm) throw new Error('Service Account không hợp lệ (thiếu client_email/private_key).');

  const cached = _tokenCache.get(norm.email);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: norm.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = crypto.createSign('RSA-SHA256')
    .update(signingInput)
    .sign(norm.privateKey);
  const jwt = `${signingInput}.${base64url(signature)}`;

  const resp = await httpRequest('POST', TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });

  let data;
  try { data = JSON.parse(resp.body); } catch (_) { data = {}; }
  if (!data.access_token) {
    throw new Error(`Lấy token thất bại: ${resp.body.slice(0, 200)}`);
  }

  _tokenCache.set(norm.email, { token: data.access_token, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.access_token;
}

// Tách spreadsheet ID từ URL hoặc trả lại nguyên nếu đã là ID.
function extractSpreadsheetId(idOrUrl) {
  if (!idOrUrl) return '';
  const m = String(idOrUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(idOrUrl).trim();
}

// Đua `promise` với đồng hồ `ms`; hết giờ thì trả `fallback` NGAY LẬP TỨC — không hủy
// promise gốc (nó vẫn chạy/timeout tự nhiên ở tầng dưới), chỉ là nơi gọi không phải chờ nó.
// Dùng làm LỚP PHÒNG THỦ THỨ HAI ở điểm gọi quan trọng nhất (chặn IPC 'profile-start'):
// dù timeout tầng HTTP có bị chỉnh sai hay thêm 1 bước gọi tuần tự nữa trong tương lai, nơi
// gọi vẫn có trần thời gian riêng, không phụ thuộc hoàn toàn vào tầng dưới.
function withDeadline(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

module.exports = {
  httpRequest,
  withDeadline,
  base64url,
  normalizeServiceAccount,
  getToken,
  extractSpreadsheetId,
  SHEETS_BASE,
  TOKEN_URL,
  SCOPE,
};
