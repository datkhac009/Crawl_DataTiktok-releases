// src/linkstore.cjs — KHO LINK CỤC BỘ để lọc trùng (2026-08-11).
//
// VÌ SAO CÓ FILE NÀY:
// Trước đây toàn bộ danh sách link đã biết chỉ nằm trên Google Sheet. Sheet phình tới
// ~206.000 dòng → mỗi lần mở app phải tải trọn cột Link (13 MB, hàng phút), và vì handler
// `profile-start` AWAIT lần đọc đó nên giao diện đứng ở "Đang khởi động..." suốt thời gian ấy.
// Tệ hơn: mốc "đã đọc tới dòng N" chỉ nằm trong bộ nhớ nên tắt app là mất, lần sau đọc lại
// từ đầu. Đo thật trên máy người dùng (2026-08-10): 18 lần đọc trọn 201.000 dòng trong 8
// tiếng, mỗi lần chỉ thu về 5–8 link mới, kèm 273 lần Google API timeout.
//
// Cách giải: chuyển gánh nặng lưu trữ xuống MÁY.
//   • File text này giữ toàn bộ link đã biết — nạp tức thì lúc khởi động (mili-giây).
//   • Google Sheet chỉ còn là KÊNH TRAO ĐỔI giữa các máy, giữ nhỏ nên đọc rất nhanh.
//   • Link mới đọc từ Sheet, hoặc chính máy này vừa đẩy lên Sheet, đều được ghi thêm vào đây.
//
// ⚠ MẤT FILE NÀY = MẤT BỘ LỌC TRÙNG. Khi Sheet đã được dọn nhỏ, nó không còn là bản lưu đầy
// đủ nữa. Phải để file này trong danh sách sao lưu, quan trọng ngang thư mục profiles/.
//
// ⚠ TUYỆT ĐỐI KHÔNG để hàm nào ở đây ném lỗi ra ngoài. Kho hỏng thì tệ nhất là đẩy trùng vài
// dòng; ném lỗi lúc khởi động thì mất cả phiên chạy. Cùng tinh thần history.cjs.
//
// Định dạng: MỖI DÒNG MỘT LINK, chuẩn hoá qua normalizeKey (linkkey.cjs) — cùng đúng hàm mà
// crawler và sheets dùng, nên không bao giờ lệch chuẩn so trùng (bài học QĐ-10).
// Người dùng dán link thô kiểu gì cũng được: link dài, có ?lang=vi, hoa/thường lẫn lộn, dán
// cả dòng từ cột Sheet (Tên sound <TAB> Link <TAB> Số video). Dòng trống và dòng bắt đầu
// bằng # bị bỏ qua.
'use strict';

const fs = require('fs');
const path = require('path');
const { getBaseDir } = require('./paths.cjs');
const { normalizeKey } = require('./linkkey.cjs');

const FILE_NAME = 'known_links.txt';

// Tập khoá đã nạp (null = chưa nạp lần nào). Giữ ở bộ nhớ để `addUrls` biết cái nào đã có
// mà không phải đọc lại file 12MB mỗi lần ghi.
let _keys = null;

// Đặt NGAY CẠNH file phần mềm, không nhét vào thư mục con — để mở ra dán link cho nhanh.
// `getBaseDir()` tự thích ứng: bản đóng gói → thư mục chứa .exe (cùng chỗ với profiles/,
// config/, logs/); bản dev → gốc dự án. Không có đường dẫn cứng nào ở đây.
function getFilePath() { return path.join(getBaseDir(), FILE_NAME); }

// ── ĐỌC MỘT DÒNG THÀNH KHOÁ ──
// Rộng rãi có chủ đích vì người dùng DÁN TAY vào file này. Trả null nếu dòng không có link.
function keyOfLine(line) {
  let s = String(line == null ? '' : line).trim();
  if (!s || s.startsWith('#')) return null;
  s = s.replace(/^["']+|["']+$/g, '').trim();   // bóc dấu nháy khi dán từ CSV
  if (!s) return null;
  // Khoá dựng sẵn — CHÍNH LÀ định dạng app tự ghi ra ở addUrls(). Phải nhận ở đây, TRƯỚC chốt
  // "phải có tiktok.com" bên dưới; thiếu nhánh này thì ghi ra rồi nạp lại là MẤT SẠCH KHO
  // (test 17 và 19 bắt đúng lỗi này).
  if (/^music:\d+$/i.test(s)) return s.toLowerCase();
  // Dán cả dòng từ Sheet (Tên sound <TAB> Link <TAB> Số video…) → nhặt đúng ô chứa link.
  // Phải xét TRƯỚC khi gọi normalizeKey nguyên dòng, vì tên sound cũng có thể chứa chữ số.
  if (/[\s,;]/.test(s)) {
    for (const tok of s.split(/[\s,;]+/)) {
      const t = tok.replace(/^["']+|["']+$/g, '');
      if (/tiktok\.com\/music\//i.test(t)) {
        const k = normalizeKey(t);
        if (k) return k;
      }
    }
  }
  // ⛔ CHẶN DÒNG RÁC (2026-08-11). Đo trên kho thật 208.060 dòng của người dùng: dòng đầu là
  // TIÊU ĐỀ CỘT `link` của Sheet, và normalizeKey() không hề từ chối nó — nó rơi vào nhánh dự
  // phòng `canonicalSoundUrl(u).toLowerCase()` và sinh ra khoá `"link"`. Vô hại (không bao giờ
  // khớp sound nào) nhưng làm số khoá sai và gây hoang mang khi soi file.
  //
  // Điều kiện nhận CỐ Ý RỘNG, chỉ cần có `tiktok.com` ở đâu đó: không được siết theo
  // `tiktok.com/music/` vì còn link rút gọn (`vt.tiktok.com`) và bản mobile (`m.tiktok.com`).
  // Đo lại trên kho thật: luật này bỏ đúng 1 dòng (`link`), giữ nguyên cả 208.053 dòng còn lại —
  // kể cả 180 link có id ngắn/không số mà normalizeKey phải dùng nhánh dự phòng.
  if (!/tiktok\.com/i.test(s)) return null;
  return normalizeKey(s) || null;
}

// Nạp file vào bộ nhớ. Gọi nhiều lần vẫn rẻ (lần sau trả về tập đã có).
// force=true → đọc lại từ đĩa (dùng sau khi người dùng tự sửa file bằng tay).
function load(force = false) {
  if (_keys && !force) return _keys;
  const set = new Set();
  try {
    let raw = fs.readFileSync(getFilePath(), 'utf8');
    // Notepad mặc định lưu UTF-8 CÓ BOM — không bỏ thì dòng đầu tiên bị hỏng khoá.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    for (const line of raw.split(/\r?\n/)) {
      const k = keyOfLine(line);
      if (k) set.add(k);
    }
  } catch (_) { /* chưa có file → tập rỗng, sẽ tạo khi ghi lần đầu */ }
  _keys = set;
  return _keys;
}

function count() { return load().size; }

// Trả về mảng khoá — dùng làm seed cho crawler.startProfile / sheets.addKnownKeys.
function all() { return [...load()]; }

// Ghi thêm những link CHƯA CÓ. Trả về số dòng thực sự ghi thêm.
// Ghi NỐI ĐUÔI (append), không ghi đè cả file: nhanh, và app tắt đột ngột giữa chừng cũng
// chỉ mất dòng đang ghi dở chứ không mất sạch file.
function addUrls(urls) {
  const set = load();
  const fresh = [];
  for (const u of (urls || [])) {
    const k = keyOfLine(u);
    if (!k || set.has(k)) continue;
    set.add(k);
    fresh.push(k);
  }
  if (!fresh.length) return 0;
  try {
    // Bảo đảm có xuống dòng ngăn cách nếu file cũ không kết thúc bằng '\n' (vd người dùng
    // dán tay rồi lưu mà thiếu dòng trống cuối) — nếu không, dòng mới sẽ dính vào dòng cuối.
    let needNewline = false;
    try {
      const st = fs.statSync(getFilePath());
      if (st.size > 0) {
        const fd = fs.openSync(getFilePath(), 'r');
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, st.size - 1);
        fs.closeSync(fd);
        needNewline = buf.toString('utf8') !== '\n';
      }
    } catch (_) {}
    fs.appendFileSync(getFilePath(), (needNewline ? '\n' : '') + fresh.join('\n') + '\n', 'utf8');
  } catch (e) {
    // Ghi lỗi → gỡ khỏi tập trong bộ nhớ để lần sau còn thử ghi lại, tránh tình trạng
    // "bộ nhớ bảo đã có, đĩa thì chưa" khiến link biến mất vĩnh viễn khỏi kho.
    for (const k of fresh) set.delete(k);
    console.error('[linkstore] Không ghi được kho link:', e.message);
    return 0;
  }
  return fresh.length;
}

// Tạo file rỗng kèm phần ghi chú nếu chưa có, để người dùng mở ra là biết dán vào đâu.
function ensureFile() {
  const f = getFilePath();
  if (fs.existsSync(f)) return f;
  const header = [
    '# KHO LINK CUC BO — dung de loc trung khi quet va khi day len Google Sheet.',
    '# Moi dong MOT link. Dan link tho kieu gi cung duoc (link dai, co ?lang=vi, hoa/thuong',
    '# lan lon, hoac dan ca dong tu cot Sheet) — app tu chuan hoa khi nap.',
    '# Dong trong va dong bat dau bang # bi bo qua.',
    '#',
    '# ⚠ DUNG XOA FILE NAY. Khi Google Sheet da duoc don nho, day la noi giu lich su link.',
    '# Hay sao luu no cung voi thu muc profiles/.',
    '',
  ].join('\n');
  try { fs.writeFileSync(f, header, 'utf8'); } catch (e) {
    console.error('[linkstore] Không tạo được kho link:', e.message);
  }
  return f;
}

// Chỉ dùng trong test — dựng lại trạng thái sạch giữa các kịch bản.
function _reset() { _keys = null; }

module.exports = { getFilePath, keyOfLine, load, count, all, addUrls, ensureFile, FILE_NAME, _reset };
