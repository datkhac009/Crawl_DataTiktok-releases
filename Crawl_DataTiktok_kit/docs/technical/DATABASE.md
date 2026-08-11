# Lưu trữ dữ liệu

Ứng dụng **không dùng cơ sở dữ liệu**. Toàn bộ dữ liệu nằm trong file, đặt **cạnh file .exe**
(bản portable) để dễ sao lưu và chuyển máy.

```
<thư mục chứa .exe>/
├── Crawl_DataTiktok.exe
├── known_links.txt            # KHO LỌC TRÙNG cục bộ (QĐ-36) — sao lưu như profiles/
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
        ├── ChromiumProfile/        # CHỈ khi bật "profile Chromium riêng" (QĐ-27) — 100–200MB
        └── Data/profile/           # profile Firefox gốc (nếu import từ Firefox Portable)
```

## `known_links.txt` — kho lọc trùng cục bộ ([QĐ-36](DECISIONS.md))

Nằm **ngay cạnh file .exe**. Mỗi dòng một khoá sound (`music:<id>`); dòng trống và dòng bắt đầu
bằng `#` bị bỏ qua.

```
# KHO LINK CUC BO — dung de loc trung khi quet va khi day len Google Sheet.
music:7386469951525243690
music:7432072491125836590
```

**Vì sao có:** Sheet đã 206.572 dòng; mỗi phiên đọc trọn cột Link mất hàng phút và ngốn quota,
mà nội dung gần như không đổi giữa hai phiên. Kho này nạp **tức thì** (mili-giây) lúc khởi động
nên crawl có bộ lọc trùng ngay, và Sheet chỉ còn là **kênh trao đổi giữa các máy** — dọn nhỏ được.

| Đặc tính | Chi tiết |
|---|---|
| Ai ghi | App: link đọc từ Sheet, link vừa đẩy lên Sheet thành công (`setOnPushed`), và nút "⬇ Nạp từ Google Sheet vào kho" |
| Ai đọc | Đầu mỗi phiên (đồng bộ, trước khi crawler chạy) → nạp vào **cả** bộ lọc quét và bộ lọc đẩy |
| Ghi kiểu gì | **Chỉ APPEND, không bao giờ xoá và không bao giờ ghi đè.** Ghi lỗi thì lùi lại bộ nhớ cho khớp đĩa |
| Người dùng sửa tay | Được — dán link thô kiểu gì cũng nhận (link dài, `?lang=vi`, dán cả dòng từ cột Sheet, có BOM). Sửa xong bấm "🔄 Đọc lại file" |
| Phạm vi | **Riêng từng máy**, không chia sẻ. Mỗi máy tự đầy kho theo những gì nó đọc được |

⚠️ **MẤT FILE NÀY = MẤT BỘ LỌC TRÙNG** khi Sheet đã dọn nhỏ. Sao lưu cùng `profiles/`.

## Cấu hình ứng dụng (electron-store)

Lưu trong thư mục dữ liệu người dùng của Electron, không nằm cạnh .exe.

| Khóa | Nội dung |
|---|---|
| `profile_settings` | Cài đặt **riêng từng profile**: chế độ, từ khóa, ẩn/hiện, bộ lọc, delay, thời lượng chu kỳ, danh sách link xem, `chromiumProfile` (profile Chromium riêng — [QĐ-28](DECISIONS.md))… |
| `sheets_config` | Spreadsheet ID, tên tab, **`pendingTab`** (tab chờ kiểm tay — [QĐ-33](DECISIONS.md); **để trống = dùng mặc định `Total_Link_Voice_Pending`**, không phải tắt), JSON Service Account, chu kỳ đồng bộ lọc trùng |
| `count_concurrency` | Số luồng đếm video đồng thời (**chung toàn app**, không theo profile) |
| `count_mode` | Chế độ đếm số video, **riêng từng máy**: `fast` (mặc định — API 8s, ngân sách đọc giao diện 2.5s/5s có trần cứng, thử lại 1 lượt) hoặc `patient` (API 20s, ngân sách 30s, không thử lại — đúng khuôn bản 0.1.63). ⚠️ Máy ảo yếu **phải** để `fast`: `patient` làm 1 sound lỗi chiếm slot đếm toàn app ~28s → hàng đợi đầy → **vòng quét đứng** — [QĐ-34](DECISIONS.md) |
| `update_repo` | Repo GitHub phát hành (để trống = dùng mặc định) |
| `vpn_auto_cycle` | Khi TikTok cắt feed: **dừng HẾT profile** → tắt/bật lại HMA VPN → chờ 59s → tự chạy lại cả nhóm (**chung toàn app**). Mặc định `false`; tắt thì cắt feed chỉ dừng đúng profile đó rồi tự bật lại sau 5/15/30 phút — [QĐ-32](DECISIONS.md) |
| `show_count_tab` | **Chỉ để chẩn đoán**: cho tab đếm `/music/` hiện thành **một tab trong CÙNG cửa sổ profile** (dùng chung context nên **không mở browser thứ hai**, không tốn thêm RAM). Mặc định `false`. Đừng bật khi chạy dài — tab đó nhấp nháy liên tục. Chỉ thấy khi profile chạy ở chế độ **hiện** — [QĐ-33](DECISIONS.md) |

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

### `ChromiumProfile/` — chỉ khi profile ĐÓ bật chế độ profile Chromium riêng

Thư mục `user-data-dir` thật của Chromium (`Default/`, `Cookies`, `Local Storage/`,
`IndexedDB/`, cache…). Giữ được **nhiều hơn** `session.state.json`: cả localStorage và
IndexedDB, nên TikTok coi là trình duyệt thật hơn và ít hủy phiên hơn.

- Kích thước ~**100–200MB mỗi profile** (đã giới hạn cache: `--disk-cache-size=60MB`,
  `--media-cache-size=10MB`).
- **Chỉ MỘT Chromium được mở một thư mục** tại một thời điểm. App bị giết giữa chừng có thể
  để lại `SingletonLock`/`SingletonSocket` — app **tự xóa** trước mỗi lần mở.
- Xóa cả thư mục này là **an toàn**: lần chạy sau app dựng lại từ `session.state.json`.
- Chép profile sang máy khác thì **không cần** mang thư mục này — chỉ cần
  `session.state.json` + `fingerprint.json`, app tự dựng lại.

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
| Google Sheet — tab chính | 4 cột A–D: Tên sound, Link, Số video, Profile |
| Google Sheet — **tab chờ** ([QĐ-33](DECISIONS.md)) | Cùng 4 cột A–D, nhưng **Số video để TRỐNG** (không đọc được). Cột E "Tình trạng" app **không bao giờ ghi** — người dùng tự điền. Chỉ chứa link TikTok trả *"Something went wrong"* (sound còn sống mà không lấy được số video) |
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
