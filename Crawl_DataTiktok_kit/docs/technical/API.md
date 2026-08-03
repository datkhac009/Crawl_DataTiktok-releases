# API

Ứng dụng **không có API server**. Phần này ghi lại 2 loại giao tiếp thực tế có trong app.

## 1. IPC nội bộ (renderer ↔ main)

Renderer chạy trong sandbox, gọi main qua `window.api` (khai báo ở `preload.cjs`).

| Kênh | Chiều | Mục đích |
|---|---|---|
| `profile-start` / `profile-stop` / `profile-soft-stop` | gọi | Chạy / dừng cứng / dừng mềm một profile |
| `profiles-stop-all`, `crawl-running-ids` | gọi | Dừng tất cả, hỏi profile nào đang chạy |
| `open-browser` / `close-browser` | gọi | Mở/đóng trình duyệt 🦊; trả kèm chẩn đoán phiên đăng nhập |
| `crawl-data` | nhận | Một sound đã qua bộ lọc → thêm dòng vào bảng |
| `crawl-status` | nhận | Trạng thái profile. Có 3 loại đặc biệt: `counts` (số Quét/Đã check), `phase` (mốc chuyển pha để đếm ngược), `sheet-error` |
| `sheets-*` | gọi | Đọc/ghi cấu hình, test kết nối, đẩy bù thủ công |
| `history-get`, `history-clear` | gọi | Đọc/xóa lịch sử thu thập theo ngày (`config/history.json`) |
| `check-updates`, `download-and-update` | gọi | Kiểm tra & cài bản mới |
| `download-progress`, `update-available` | nhận | Tiến trình tải bản cập nhật |

## 2. Endpoint TikTok mà app phụ thuộc

| Endpoint | Dùng để | Ghi chú |
|---|---|---|
| `https://www.tiktok.com/` | Feed For You | Cần User-Agent Chrome thật, nếu không bị chặn |
| `api/music/detail/` | Lấy số video của sound | Nghe response khi mở trang `/music/`. `statusCode: 0` = OK; HTTP 400 + `10201` = sound đã xóa |
| `https://www.tiktok.com/music/<slug>-<id>` | Trang sound | Chỉ `<id>` có ý nghĩa, phần chữ bị bỏ qua |

## 3. Google Sheets API v4

- Xác thực: Service Account, ký JWT RS256 → đổi lấy access token (cache 55 phút).
- Ghi: `values:append` phạm vi `{tab}!A:Z`, `valueInputOption=RAW`.
- Đọc để lọc trùng: `values.get` phạm vi `{tab}!B:B` (cột Link).

Chi tiết lý do chọn cách này: [DECISIONS.md](DECISIONS.md) mục QĐ-08.
