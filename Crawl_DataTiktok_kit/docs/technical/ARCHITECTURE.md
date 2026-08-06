# Kiến trúc — TikTok Crawler

> Mã nguồn thật: `Crawl_DataTiktok_build/` (cùng repo, thư mục ngang cấp với `_kit`)
> — thư mục `_kit` này chỉ chứa tài liệu & kế hoạch.
> Cập nhật: 2026-08-05

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
| `crawler/stuck.cjs` | `makeFeedTracker` + chẩn đoán & thoát kẹt feed 3 cấp + `looksStarved` (nhận biết **feed cạn** — QĐ-31) |
| `crawler/session-watch.cjs` | `checkLoginState` + theo dõi phiên đăng nhập giữa lúc chạy |
| `resource-blocker.cjs` | Chặn ảnh/media/font — **dùng chung** cho tab đếm và cửa sổ 🦊 |
| `ip-guard.cjs` | Canh IP công khai khớp nhãn quốc gia profile (VPN tụt trên VPS) |
| `browser.cjs` | Vòng đời Chromium, phiên đăng nhập, context theo profile |
| `fingerprint.cjs` | Dấu vân tay cố định theo profile (chuyển máy vẫn giữ đăng nhập) |
| `linkkey.cjs` | Chuẩn hóa link sound — **dùng chung** cho lọc trùng khi quét và khi đẩy Sheet |
| `quota-guard.cjs` | **Cầu dao quota**: gặp 429 → tạm ngưng gọi API 60s, không mất dữ liệu (QĐ-24) |
| `google-api.cjs` | Xác thực Service Account + `httpRequest` (có timeout) — **dùng chung** cho `sheets.cjs` và `sheet-lock.cjs` |
| `sheets.cjs` | Đẩy dữ liệu lên Google Sheets, chống trùng liên máy |
| `sheet-lock.cjs` | **Khóa liên máy**: chặn 1 profile chạy trên 2+ máy, qua tab `_locks` **ẩn** trên Sheet |
| `profiles.cjs` | Thêm/sửa/xóa/import profile, ánh xạ id → thư mục |
| `history.cjs` | **Lịch sử theo ngày**: đếm sound thu được, ghi `config/history.json` (ghi trễ + atomic) |
| `paths.cjs` | Đường dẫn dữ liệu (cạnh file .exe khi đóng gói) |
| `updater.cjs` | Tải Firefox khi thiếu. **Tự cập nhật đang TẮT** — xem [QĐ-18](DECISIONS.md) |
| `vpn-hma.cjs` | Điều khiển HMA VPN (tắt/bật lại lấy IP mới khi feed cạn) qua native messaging của chính HMA + `ipv6LeakRisk()` phát hiện rò rỉ IPv6 — [QĐ-32](DECISIONS.md) |

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
| `crawl-modes.test.js` | 19 kịch bản — mock Playwright + `browser.cjs` để chạy engine thật không cần TikTok: tiền tố log từng chế độ, thoát kẹt (trùng sound / không đọc được sound), chế độ khách, `recycle` bật/tắt đúng chế độ, canh IP (lệch → tạm dừng, về đúng vùng → tự chạy tiếp), và **feed cạn** (QĐ-31: báo đúng khi cạn, **không báo oan** khi nút còn bấm được / feed còn nhiều video / đang là khách; chu kỳ cắt pha Quét sang pha Xem).<br>⚠ **13 kịch bản GỐC chỉ IN log, KHÔNG có khẳng định nào** — pass chỉ nghĩa "không ném lỗi". Chỉ 17 khẳng định của phần feed cạn là kiểm thật (trượt → exit ≠ 0). |
| `chromium-profile.test.js` | 58 khẳng định cho chế độ **profile Chromium riêng** (QĐ-27, QĐ-28): mặc định TẮT, mở đúng `<profile>/ChromiumProfile` + giới hạn cache, dọn `SingletonLock` kẹt, vân tay khớp chế độ thường, lần đầu bơm cookie sang (lần sau không bơm lại), nút 🦊 mở TAB MỚI chứ không chiếm tab feed đang quét, **trộn 2 chế độ trên cùng máy** (profile bật / profile tắt không ăn theo nhau), và **tab đếm theo chế độ hiển thị** — chạy ẩn thì dùng chung context (không bị đóng oan), chạy hiện thì tách sang trình duyệt ẩn riêng |
| `sheet-rows-status.test.js` | 15 khẳng định cho ô **"Sheet: N dòng data"** (QĐ-29): luôn hiện dù dòng thông báo đang bị lỗi/câu dài chiếm, mà cũng không xoá mất câu đó; dựng lại đúng 2 câu đã gây lỗi thật; đối chiếu thẳng `renderer.js`/`index.html`/`styles.css` để bản sao logic không lệch âm thầm |
| `sheets-pending.test.js` | 26 khẳng định cho **tab chờ kiểm tay** (QĐ-33), mock `google-api.cjs`: ghi đúng 4 cột A:D và **không bao giờ ghi cột E "Tình trạng"**; ghi đúng tab chờ, **tuyệt đối không** ghi vào tab chính; không ghi trùng (link đã có trên Sheet / vừa ghi / **cùng ID khác slug ngôn ngữ**); để trống tên tab = tắt hoàn toàn (không gọi API nào); đổi tên tab thì quên danh sách tab cũ; lỗi ghi thì **giữ lô rồi ghi lại được**. ⚠ Dùng ID sound **19 chữ số thật** — ID ngắn làm `normalizeKey` lùi về so nguyên văn URL và khẳng định lọc trùng thành vô nghĩa |
| `vpn-hma.test.js` | 60 khẳng định điều khiển HMA VPN (QĐ-32), mock toàn bộ `child_process`: **mặc định nối lại đúng server cũ, không xoay city** (`rotate:true` là đường dự phòng, vẫn kiểm); **tuyệt đối không dùng `ConnectToOptimal`** (đo thật trả về Việt Nam bất kể profile khai nước nào); từ chối đổi IP khi quốc gia HMA đang nối không khớp profile hoặc khi HMA đang tắt sẵn; cảnh báo rõ "VPN có thể đang TẮT" khi bật lại thất bại; `status()` chỉ đọc, không đụng VPN; và **`ipv6LeakRisk()`** — nhận đúng `2000::/3` là rò rỉ, **không** tính Tailscale `fd7a:`/link-local `fe80`, không tính IPv6 trên adapter VPN, nhận cả `family` dạng số `6` |
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

Cả 2 bước đều thất bại → **không vào dữ liệu chính** (không ghi dòng `?` — QĐ-07). Nhưng từ
2026-08-06 ([QĐ-33](DECISIONS.md)) phân biệt tiếp:

| Ca | Xử lý |
|---|---|
| Sound **đã bị xóa** (`statusCode 10201`) | **Bỏ hẳn** — không có gì cho người kiểm |
| Sound **còn sống**, TikTok trả *"Something went wrong"* | → **TAB CHỜ** trên Sheet để người kiểm tay (cột "Tình trạng" để trống) |

## Kiến trúc trình duyệt

Có **2 chế độ**, chọn bằng công tắc *"Dùng profile Chromium riêng cho tài khoản này"* trong
⚙ Cài đặt crawl — **riêng từng profile**, không phải toàn app ([QĐ-28](DECISIONS.md)). Mặc định
là chế độ A. Lý do tồn tại chế độ B: [QĐ-27](DECISIONS.md).

**Trộn 2 chế độ trên cùng một máy là an toàn và là cách dùng chính** — bật 1–2 profile để A/B
test, các profile còn lại vẫn dùng chung một Chromium như cũ.

**A. Chromium dùng chung (mặc định, tiết kiệm RAM nhất)**

- **1 Chromium dùng chung + N context** cho foryou/search/cycle (tiết kiệm ~50% tiến trình
  so với mỗi profile một trình duyệt). Tách riêng theo chế độ ẩn/hiện.
- **1 Chromium ẩn riêng** chỉ để đếm số video — tránh tab đếm nhấp nháy trong cửa sổ hiện.
- Chế độ `current` và nút 🦊 dùng trình duyệt riêng (không dùng chung).
- Phiên đăng nhập nằm trong file `session.state.json` (chỉ cookie).

**B. Profile Chromium riêng (`launchPersistentContext`, tùy chọn)**

- Mỗi profile **1 Chromium + 1 thư mục riêng** `<profile>/ChromiumProfile` — giữ cả
  `localStorage`/`IndexedDB` nên **TikTok ít hủy phiên hơn**. Đổi lại **+150–250MB RAM mỗi
  profile** (5 profile ≈ +1GB) và ~100–200MB đĩa mỗi profile.
- **Tab đếm**: chạy **ẩn** → dùng chung context của profile (một thư mục chỉ cho một *persistent
  context* mở, và không ai thấy tab nên tiết kiệm được 1 instance). Chạy **hiện** → tách sang
  **trình duyệt ẩn riêng**, để tab `/music/` không lòi vào cửa sổ người dùng đang xem
  (sửa 2026-08-05 — xem bổ sung của [QĐ-27](DECISIONS.md)).
- Nút 🦊 **dùng lại** context đang crawl nếu profile đang chạy.
- Lần đầu bật: cookie trong `session.state.json` được bơm sang nên **không mất đăng nhập**.
- Đổi công tắc chỉ áp cho **lần bật profile tiếp theo**.
- Cờ được truyền **theo từng lời gọi** (`acquireProfileContext(path, {persistent})`), không có
  cờ module toàn cục. Tab đếm tra `_profileCtx` của profile đang chạy nên không thể lệch chế độ.

Cả 2 chế độ dùng **chung một hàm dựng option vân tay** nên không bao giờ lệch vân tay.

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
- **Feed cạn** (TikTok không cấp thêm video, [QĐ-31](DECISIONS.md)): kẹt + trang chỉ còn ≤2
  video + không có nút "xuống" dùng được + đã thử trọn vòng 3 cấp + **không** phải chế độ khách
  → chu kỳ **cắt pha Quét sang pha Xem**; chế độ khác **tạm dừng 5/15/30 phút** rồi thử lại.
  Phải đủ cả 5 điều kiện — báo oan làm profile khoẻ tự tạm dừng. Kết luận mất 2–3 phút, thay
  cho việc quay vòng thoát kẹt vô hạn (đo thật: ~2 giờ ra 0 sound).
- **Tự đổi IP khi feed cạn** ([QĐ-32](DECISIONS.md), tùy chọn — mặc định TẮT): phát hiện feed
  cạn phát status riêng `feed-starved` → nếu công tắc "Tự đổi IP" bật, renderer dừng profile →
  **tắt/bật lại HMA VPN đúng server đang dùng** (qua native messaging của chính HMA,
  `src/vpn-hma.cjs`) → chạy lại đúng nhóm vừa dừng. **Không cần đổi city** — HMA cấp IP từ pool
  mỗi lần kết nối (đo thật: cùng gateway London cho `18.171.54.19` → `18.132.40.68`).
  Giới hạn 10 phút/lần, 6 lần/ngày.
  **Dừng 1 hay dừng hết do `ipv6LeakRisk()` quyết định**: máy có IPv6 công khai thì lúc VPN tắt
  IPv6 đi thẳng ra IP thật (đo: lọt trong 241ms, `systemKillSwitchActive` của HMA KHÔNG chặn) →
  phải dừng hết; máy đã tắt IPv6 → chỉ dừng đúng profile bị cạn. Kiểm ở **cả** renderer (để
  quyết định) và `main.js` (chốt lại, không tin renderer).
- **Chế độ khách**: sau khi feed hiện, kiểm tra trang có nút "Log in" không. Có → dừng ngay
  với thông báo *"cần đăng nhập lại bằng 🦊"* thay vì cào vô ích hàng giờ.
- **Thống kê cuộn**: mỗi 100 lần cuộn ghi `Cuộn 100 lần, gặp N sound khác nhau, M sound mới`
  — phân biệt "feed chạy tốt nhưng trùng hết" với "feed đứng im".

## Đóng gói & cập nhật

- `build.bat`: kiểm quyền phát hành (fail nhanh) → dừng app đang chạy → tăng version → build
  electron-builder → copy Chromium **và Firefox** vào `lib/ms-playwright` → tạo GitHub Release
  chỉ kèm `.exe`.
  Bước kiểm quyền đọc **`X-Oauth-Scopes`** của token (cần `repo`), **không** dùng
  `.permissions.push` — repo đã public nên trường đó luôn `true` dù token không có scope nào,
  gate sẽ báo pass sai rồi hỏng ở bước cuối sau 8 phút build (gặp thật 2026-08-04).
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
