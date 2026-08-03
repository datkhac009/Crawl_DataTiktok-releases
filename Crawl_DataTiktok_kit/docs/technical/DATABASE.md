# Lưu trữ dữ liệu

Ứng dụng **không dùng cơ sở dữ liệu**. Toàn bộ dữ liệu nằm trong file, đặt **cạnh file .exe**
(bản portable) để dễ sao lưu và chuyển máy.

```
<thư mục chứa .exe>/
├── Crawl_DataTiktok.exe
├── config/
│   ├── profiles.json          # danh sách profile: id, tên, tên thư mục
│   └── history.json           # lịch sử thu thập theo ngày (giữ 400 ngày)
├── logs/
│   ├── crawler_<thời gian>.log   # log chạy (tự xóa sau 7 ngày)
│   └── crash_<thời gian>.log     # stack trace khi lỗi nghiêm trọng
├── lib/ms-playwright/         # Chromium + Firefox đóng gói kèm
└── profiles/
    └── <tên profile>/
        ├── session.state.json      # cookie đăng nhập TikTok
        ├── session.state.json.bak  # bản dự phòng
        ├── session.good.json       # PHIÊN VÀNG — bản đã xác minh đăng nhập thật
        ├── fingerprint.json        # dấu vân tay cố định của profile
        ├── profile.lock            # máy nào đang dùng + nhịp tim (cảnh báo chạy trùng)
        └── Data/profile/           # profile Firefox gốc (nếu import từ Firefox Portable)
```

## Cấu hình ứng dụng (electron-store)

Lưu trong thư mục dữ liệu người dùng của Electron, không nằm cạnh .exe.

| Khóa | Nội dung |
|---|---|
| `profile_settings` | Cài đặt **riêng từng profile**: chế độ, từ khóa, ẩn/hiện, bộ lọc, delay, thời lượng chu kỳ, danh sách link xem… |
| `sheets_config` | Spreadsheet ID, tên tab, JSON Service Account, chu kỳ đồng bộ lọc trùng |
| `count_concurrency` | Số luồng đếm video đồng thời (**chung toàn app**, không theo profile) |
| `update_repo` | Repo GitHub phát hành (để trống = dùng mặc định) |

## Các file trong thư mục profile

### `session.state.json`

Định dạng storageState của Playwright: `{ cookies: [...], origins: [...] }`.
Thực tế `origins` (localStorage) luôn rỗng — xem lý do ở [DECISIONS.md](DECISIONS.md) QĐ-03.

Nhóm cookie **bắt buộc phải đủ**, thiếu là TikTok hạ xuống chế độ khách:

| Nhóm | Cookie |
|---|---|
| Xác thực | `sessionid`, `sessionid_ss`, `sid_guard`, `sid_tt`, `uid_tt`, `sid_ucp_v1` |
| **Định tuyến** | `tt-target-idc`, `tt-target-idc-sign`, `store-idc`, `store-country-code`, `store-country-sign` |
| Thiết bị | `ttwid`, `msToken`, `s_v_web_id` |

Ghi theo kiểu **atomic**: ghi file tạm → sao lưu bản cũ thành `.bak` → đổi tên đè. Không bao
giờ để lại file cắt cụt nếu app bị giết giữa chừng.

### `session.good.json` — phiên VÀNG

Bản sao của `session.state.json` tại thời điểm **đã xác minh đăng nhập thật trên trang
TikTok**. Chỉ được ghi khi: có `sessionid` **và** có ít nhất một cookie định tuyến **và**
trang thật xác nhận không phải chế độ khách. Tối đa 10 phút ghi một lần.

Khi phiên hiện tại hỏng, đây là **đường khôi phục đầu tiên** (trước cả trích lại từ Firefox).
Nên chép kèm khi sao lưu profile.

### `profile.lock`

`{ host, pid, beat }` — máy nào đang dùng profile, cập nhật nhịp tim mỗi 30 giây. Quá 3 phút
không có nhịp tim thì coi như đã tắt. Dùng để **cảnh báo** (không chặn) khi phát hiện profile
đang chạy ở nơi khác — chạy trùng là nguyên nhân số 1 khiến TikTok hủy phiên.

### `config/history.json` — lịch sử thu thập theo ngày

```json
{ "days": {
    "2026-08-03": { "valid": 230,
                    "byProfile": { "rsgweakde533@hotmail.com(UK)": 93, "nytshoo083@hotmail.com(UK)": 92 } }
} }
```

`valid` = số sound **thực sự thu được** trong ngày (bằng cột **Hợp lệ** — đã qua bộ lọc số
video và vào bảng dữ liệu). Ngày tính theo **giờ máy**, không phải UTC.

Ghi **có trễ 5 giây** (gom trong RAM rồi mới ghi — một đêm 5 profile thu vài trăm sound, ghi
đĩa mỗi sound là vô ích) và **ghi atomic** (file tạm → đổi tên) như `session.state.json`.
Giữ 400 ngày rồi tự dọn ngày cũ nhất. File hỏng thì đọc lại từ 0, không làm chết app.

⚠️ Số liệu **của riêng từng máy** — không gộp liên máy (gộp sẽ phải ghi thêm lên Google Sheet,
tăng tải API). Xem QĐ-23.

### `fingerprint.json`

Sinh tự động, suy tất định từ tên thư mục profile nên **mất cũng tạo lại đúng bộ cũ**.

```json
{ "country": "UK", "timezoneId": "Europe/London", "locale": "en-GB",
  "screen": { "width": 1600, "height": 900 },
  "hardwareConcurrency": 16, "deviceMemory": 4,
  "glVendor": "Google Inc. (AMD)", "glRenderer": "ANGLE (AMD, AMD Radeon RX 580 ...)",
  "platform": "Win32" }
```

**Phải chép kèm khi chuyển profile sang máy khác** — xem [DECISIONS.md](DECISIONS.md) QĐ-05.

## Dữ liệu đầu ra

| Nơi | Nội dung |
|---|---|
| Bảng trong app | Giữ tối đa 5000 dòng hiển thị; dữ liệu đầy đủ vẫn nằm trong bộ nhớ để xuất |
| Google Sheet | 4 cột A–D: Tên sound, Link, Số video, Profile |
| Xuất Excel (CSV) | UTF-8 có BOM để Excel mở không lỗi font tiếng Việt |

## Dọn dữ liệu thừa

`clean-profiles.cjs` (chạy bằng `node`, không nằm trong bản đóng gói):

```bash
node clean-profiles.cjs          # xem trước
node clean-profiles.cjs --apply  # xóa thật
```

Xóa mọi thứ trong thư mục profile **trừ** `session.state.json`, và chỉ với profile đã có
cookie TikTok trong file đó (an toàn, không mất đăng nhập).

⚠️ Sau khi dọn thì **không còn Firefox gốc** để trích lại cookie — nếu phiên hỏng thì bắt
buộc phải đăng nhập lại bằng 🦊.
