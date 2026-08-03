# Kiến trúc — TikTok Crawler

> Mã nguồn thật: `Crawl_DataTiktok_build/` (cùng repo, thư mục ngang cấp với `_kit`)
> — thư mục `_kit` này chỉ chứa tài liệu & kế hoạch.
> Cập nhật: 2026-07-28

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
| `crawler.cjs` | **Điều phối**: trạng thái phiên, vòng đời profile, luồng 5 chế độ, `runScanLoop` dùng chung |
| `crawler/util.cjs` | `sleep`/`rand`/`interruptibleSleep`, `parseCount`, `isOriginalSound` |
| `crawler/count-throttle.cjs` | Semaphore đếm video **toàn app** — chống dội `/music/` từ cùng 1 IP |
| `crawler/page-read.cjs` | `readActiveSound`/`readVideoCount`/`scrollFeed`/`recyclePage` |
| `crawler/stuck.cjs` | `makeFeedTracker` + chẩn đoán & thoát kẹt feed 3 cấp |
| `crawler/session-watch.cjs` | `checkLoginState` + theo dõi phiên đăng nhập giữa lúc chạy |
| `resource-blocker.cjs` | Chặn ảnh/media/font — **dùng chung** cho tab đếm và cửa sổ 🦊 |
| `ip-guard.cjs` | Canh IP công khai khớp nhãn quốc gia profile (VPN tụt trên VPS) |
| `browser.cjs` | Vòng đời Chromium, phiên đăng nhập, context theo profile |
| `fingerprint.cjs` | Dấu vân tay cố định theo profile (chuyển máy vẫn giữ đăng nhập) |
| `linkkey.cjs` | Chuẩn hóa link sound — **dùng chung** cho lọc trùng khi quét và khi đẩy Sheet |
| `google-api.cjs` | Xác thực Service Account + `httpRequest` (có timeout) — **dùng chung** cho `sheets.cjs` và `sheet-lock.cjs` |
| `sheets.cjs` | Đẩy dữ liệu lên Google Sheets, chống trùng liên máy |
| `sheet-lock.cjs` | **Khóa liên máy**: chặn 1 profile chạy trên 2+ máy, qua tab `_locks` **ẩn** trên Sheet |
| `profiles.cjs` | Thêm/sửa/xóa/import profile, ánh xạ id → thư mục |
| `history.cjs` | **Lịch sử theo ngày**: đếm sound thu được, ghi `config/history.json` (ghi trễ + atomic) |
| `paths.cjs` | Đường dẫn dữ liệu (cạnh file .exe khi đóng gói) |
| `updater.cjs` | Tải Firefox khi thiếu. **Tự cập nhật đang TẮT** — xem [QĐ-18](DECISIONS.md) |

### Một vòng quét dùng chung cho mọi chế độ

`crawler.cjs` chỉ có **một** `runScanLoop()`; 4 chế độ quét (For You / Tìm kiếm / Tab đang mở /
pha QUÉT của chu kỳ) gọi nó với tham số khác nhau:

| Chế độ | `prefix` | `allowReload` | `recycle` | `watchLogin` | `deadlineAt` |
|---|---|---|---|---|---|
| For You | *(không)* | ✅ | ✅ | ✅ | ∞ |
| Tìm kiếm | `Tìm "kw": ` | ✅ | ✅ | ❌ | ∞ |
| Tab đang mở | *(không)* | ❌ | ❌ | ❌ | ∞ |
| Chu kỳ — pha Quét | `Chu kỳ [Quét]: ` | ✅ | ✅ | ✅ | hết pha |

Trước 2026-07-28 mỗi chế độ giữ một bản sao riêng và **đã lệch nhau thật** — xem QĐ-16.

## Test tự động (`test/`)

Không nằm trong bản đóng gói. Chạy: `pnpm test`.

| File | Kiểm gì |
|---|---|
| `crawl-modes.test.js` | 13 kịch bản — mock Playwright + `browser.cjs` để chạy engine thật không cần TikTok: tiền tố log từng chế độ, thoát kẹt (trùng sound / không đọc được sound), chế độ khách, `recycle` bật/tắt đúng chế độ, canh IP (lệch → tạm dừng, về đúng vùng → tự chạy tiếp) |
| `ui-responsive.test.js` | Đo layout ở 5 khổ cửa sổ bằng Chromium, phát hiện nội dung bị cắt, chụp ảnh vào `.ui-shots/` |

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
- **Liên máy**: mỗi máy đọc **phần mới thêm ở cuối** cột Link **mỗi phút** (đọc tăng dần từ
  mốc dòng — rẻ vì chỉ vài trăm dòng), cộng đọc lại **toàn bộ** mỗi 10 phút để đồng bộ mốc
  (chỉnh trong modal ☁). Cửa sổ sinh trùng co từ 5–15 phút xuống ~1 phút — xem QĐ-09.

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

- `build.bat`: kiểm quyền phát hành (fail nhanh) → dừng app đang chạy → tăng version → build
  electron-builder → copy Chromium **và Firefox** vào `lib/ms-playwright` → tạo GitHub Release
  chỉ kèm `.exe`.
- **Tự cập nhật đang TẮT** vì repo phát hành để private (app gọi GitHub API ẩn danh → 404).
  Đang **cập nhật thủ công**: copy `.exe` mới sang từng máy. Lý do và các cách bật lại:
  [QĐ-18](DECISIONS.md).
  ⚠️ Phải cập nhật **hết** các máy — máy chạy bản cũ lẫn vào vẫn gây trùng dữ liệu trên Sheet
  (xem [TROUBLESHOOTING.md](TROUBLESHOOTING.md) mục 5).
- Thiếu Firefox trong `lib/` → app tự tải `firefox-<rev>.zip` từ release tag `browsers`
  (cũng cần repo đọc được, nên hiện phải copy tay `firefox-<rev>` vào `lib\ms-playwright`).

## Chạy nhiều máy (VPS)

| Cơ chế | Phạm vi | Ghi chú |
|---|---|---|
| Ghi Google Sheet | Liên máy — an toàn | `values:append` được Google xử lý tuần tự (QĐ-08) |
| Chống trùng dữ liệu | Liên máy — gần đúng | Đọc **phần mới ở cuối** mỗi phút + đọc lại toàn bộ mỗi 10 phút; vẫn trùng nếu 2 máy trúng cùng sound trong cùng 1 phút (QĐ-09) |
| Vân tay thiết bị | Theo profile | Tất định từ tên thư mục → chép sang máy khác vẫn cùng "thiết bị" (QĐ-05) |
| Canh IP đúng quốc gia | Theo máy | Tạm dừng khi VPN tụt, tự chạy tiếp khi về vùng (QĐ-17) |
| Số luồng đếm video | **Theo từng máy** | N máy = N × số luồng tới cùng IP nếu các máy chia sẻ exit IP |
| `profile.lock` | **CHỈ trong 1 máy** | Đọc file trong thư mục profile cục bộ → 2 máy có 2 bản copy thì không thấy nhau |
| `sheet-lock.cjs` (tab `_locks`, **ẩn**) | **Liên máy — chặn thật** | Nhịp tim lên Sheet dùng chung; máy khác giữ profile với nhịp tim <3 phút → chặn "▶ Chạy" (QĐ-19) |

`profile.lock` cục bộ và `sheet-lock.cjs` liên máy là **2 lớp khác nhau, bổ sung cho nhau**:
lớp đầu bắt được trường hợp mở 2 lần trên **cùng 1 máy**, lớp sau bắt được trường hợp chạy
trên **2 máy khác nhau** — chỉ có lớp sau mới cần Google Sheet đã cấu hình.

⚠️ Hệ quả của dòng cuối: chạy trùng cùng một profile trên 2 máy — **nguyên nhân số 1 khiến
TikTok hủy phiên** — hiện **app không phát hiện được**. Phải quản lý bằng kỷ luật vận hành
(sổ phân bổ profile → máy). Chưa có cơ chế khóa liên máy.

## Xem thêm

- [DECISIONS.md](DECISIONS.md) — các quyết định kiến trúc và lý do
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — quy trình chẩn đoán sự cố
- [../user/USER_GUIDE.md](../user/USER_GUIDE.md) — hướng dẫn sử dụng
