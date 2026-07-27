# Kiến trúc — TikTok Crawler

> Mã nguồn thật: `G:\1.Program\2.Tool\3.Crawl_DataTiktok\Crawl_DataTiktok_build`
> (thư mục `_kit` này chỉ chứa tài liệu & kế hoạch)
> Cập nhật: 2026-07-27

## Tổng quan

Ứng dụng desktop Electron (CommonJS) dùng Playwright điều khiển Chromium để thu thập link
sound TikTok. Mỗi profile = một tài khoản TikTok, chạy độc lập, cấu hình riêng.

```
┌──────────────┐   IPC    ┌──────────────┐        ┌─────────────────┐
│  renderer/   │◄────────►│   main.js    │───────►│  src/crawler    │
│  (giao diện) │          │ (điều phối)  │        │  (engine crawl) │
└──────────────┘          └──────┬───────┘        └────────┬────────┘
                                 │                         │
                    ┌────────────┼────────────┐            ▼
                    ▼            ▼            ▼      ┌───────────┐
              src/sheets   src/updater   src/profiles│src/browser│
              (Google      (tự cập nhật) (quản lý    │(Chromium, │
               Sheet)                     profile)   │ phiên)    │
                                                     └───────────┘
```

## Bản đồ module (`src/`)

| File | Vai trò |
|---|---|
| `crawler.cjs` | Engine chính: 5 chế độ crawl, đếm số video, lọc, chống kẹt feed |
| `browser.cjs` | Vòng đời Chromium, phiên đăng nhập, context theo profile |
| `fingerprint.cjs` | Dấu vân tay cố định theo profile (chuyển máy vẫn giữ đăng nhập) |
| `linkkey.cjs` | Chuẩn hóa link sound — **dùng chung** cho lọc trùng khi quét và khi đẩy Sheet |
| `sheets.cjs` | Đẩy dữ liệu lên Google Sheets, chống trùng liên máy |
| `profiles.cjs` | Thêm/sửa/xóa/import profile, ánh xạ id → thư mục |
| `paths.cjs` | Đường dẫn dữ liệu (cạnh file .exe khi đóng gói) |
| `updater.cjs` | Tự cập nhật qua GitHub Releases + tự tải Firefox khi thiếu |

## 5 chế độ crawl

| Chế độ | Hành vi |
|---|---|
| `foryou` | Mở For You, cuộn liên tục, đọc sound của video đang xem |
| `search` | Gõ từ khóa → tab Videos → mở video đầu → cuộn như For You |
| `current` | Cào trên tab người dùng tự mở (🦊). Dừng thì **giữ trình duyệt mở** |
| `view` | Xem danh sách link sound đã dán: xem % thời lượng ngẫu nhiên, like theo tỉ lệ |
| `cycle` | **Quét ⇄ Xem tự động**: quét X giờ → nghỉ → xem Y phút → nghỉ → lặp vô hạn |

## Luồng dữ liệu

```
Cuộn feed ──► đọc link sound ──► lọc trùng (linkkey) ──► hàng đợi (tối đa 500)
                                                              │
                                                              ▼
                                              tab đếm (trình duyệt ẩn riêng)
                                                              │
                                    ┌─────────────────────────┴──────────┐
                                    ▼                                    ▼
                       API api/music/detail/                  đọc giao diện (dự phòng)
                                    │                                    │
                                    └──────────────┬─────────────────────┘
                                                   ▼
                                        lọc theo ngưỡng số video
                                                   ▼
                                     bảng kết quả + Google Sheet
```

Cả 2 bước đều thất bại → **bỏ link**, không ghi dòng `?` vào dữ liệu.

## Kiến trúc trình duyệt

- **1 Chromium dùng chung + N context** cho foryou/search/cycle (tiết kiệm ~50% tiến trình
  so với mỗi profile một trình duyệt). Tách riêng theo chế độ ẩn/hiện.
- **1 Chromium ẩn riêng** chỉ để đếm số video — tránh tab đếm nhấp nháy trong cửa sổ hiện.
- Chế độ `current` và nút 🦊 dùng trình duyệt riêng (không dùng chung).

## Mô hình phiên đăng nhập

Mỗi thư mục profile chứa:

| File | Nội dung |
|---|---|
| `session.state.json` | Cookie đăng nhập TikTok (+ bản `.bak`) |
| `fingerprint.json` | Dấu vân tay cố định: múi giờ, ngôn ngữ, CPU, RAM, GPU, màn hình |
| `Data/profile/` | Profile Firefox gốc (nếu import từ Firefox Portable) — nguồn trích cookie |

**Nguyên tắc quan trọng:**

1. Cookie được lưu định kỳ (20 giây khi crawl, 10 giây khi mở 🦊) và **ghi atomic**
   (file tạm → đổi tên), luôn giữ bản `.bak`.
2. **Không bao giờ ghi đè phiên tốt bằng phiên khuyết** — nếu bộ cookie mới thiếu cookie
   xác thực hoặc định tuyến (`tt-target-idc`, `store-idc`, `store-country-code`…) thì bỏ
   qua lần lưu đó. Ngoại lệ: `sessionid` đổi = đăng nhập tài khoản khác → cho lưu.
3. Phiên khuyết/khách sẽ **tự trích lại từ Firefox** (nếu profile còn Firefox gốc).
4. Vân tay nằm trong thư mục profile → **chép thư mục sang máy khác là mang theo**, mọi máy
   trình bày cùng một thiết bị. Mất file cũng sinh lại đúng bộ cũ (suy từ tên thư mục).
5. Múi giờ/ngôn ngữ theo **nhãn quốc gia trong tên profile** — `(US)` → giờ New York,
   `(UK)` → London, `(KR1)` → Seoul. Tránh mâu thuẫn "IP Mỹ nhưng giờ Việt Nam".

## Chống trùng dữ liệu

Hai tầng, dùng **chung một hàm khóa** (`linkkey.cjs`) nên không bao giờ lệch nhau:

- **Khi quét**: bộ nhớ link đã thu thập trong phiên + link nạp từ Sheet.
- **Khi đẩy**: chặn ngay ở cửa enqueue, lọc lại trước khi ghi, ghi nhớ link đã ghi thành công.
- **Liên máy**: mỗi máy đọc lại cột Link trên Sheet định kỳ (mặc định 5 phút, chỉnh trong
  modal ☁) để biết máy khác vừa đẩy gì.

Link sound original được **rút gọn về dạng chuẩn** `/music/original-sound-<id>` — cùng một
sound với 2 kiểu slug khác nhau không còn bị tính là 2 sound.

## Chống sập khi chạy dài

| Cơ chế | Chi tiết |
|---|---|
| Tải lại feed định kỳ | Mỗi N lần cuộn (chỉnh được, mặc định 80) — xả bộ nhớ tích tụ |
| Recycle tab đếm | Mỗi 200 sound — Playwright chỉ giải phóng bộ nhớ khi đóng tab |
| Trần hàng đợi | Tối đa 500 sound chờ; đầy thì tạm ngừng cuộn |
| Điều tiết đếm toàn cục | Giới hạn số request `/music/` đồng thời (mặc định 2) + giãn nhịp |
| Nghỉ khi bị chặn | 3 lần lỗi liên tiếp → nghỉ 30s → 2 phút → 5 phút (có nhiễu ngẫu nhiên) |
| Giữ sound khi bị chặn | Từ lần lỗi thứ 3, sound được trả về đầu hàng đợi thay vì bỏ (tối đa 3 vòng) |
| Hộp đen | Ghi lý do khi tiến trình con chết + nhịp bộ nhớ mỗi 5 phút vào `logs/` |

## Phát hiện sự cố tự động

- **Feed kẹt**: đọc trúng cùng 1 sound 20 lần liên tiếp → chẩn đoán trang rồi thoát kẹt theo
  3 cấp (bấm nút "video kế tiếp" của TikTok → click lấy con trỏ + phím xuống → tải lại).
- **Chế độ khách**: sau khi feed hiện, kiểm tra trang có nút "Log in" không. Có → dừng ngay
  với thông báo *"cần đăng nhập lại bằng 🦊"* thay vì cào vô ích hàng giờ.
- **Thống kê cuộn**: mỗi 100 lần cuộn ghi `Cuộn 100 lần, gặp N sound khác nhau, M sound mới`
  — phân biệt "feed chạy tốt nhưng trùng hết" với "feed đứng im".

## Đóng gói & cập nhật

- `build.bat`: tăng version → build electron-builder → copy Chromium **và Firefox** vào
  `lib/ms-playwright` → tạo GitHub Release chỉ kèm `.exe`.
- Tự cập nhật: so version với release mới nhất, tải `.exe`, thay file rồi khởi động lại.
- Thiếu Firefox trong `lib/` → app tự tải `firefox-<rev>.zip` từ release tag `browsers`.

## Xem thêm

- [DECISIONS.md](DECISIONS.md) — các quyết định kiến trúc và lý do
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — quy trình chẩn đoán sự cố
- [../user/USER_GUIDE.md](../user/USER_GUIDE.md) — hướng dẫn sử dụng
