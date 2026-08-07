# Kiến trúc — TikTok Crawler

> Mã nguồn thật: `Crawl_DataTiktok_build/` (cùng repo, thư mục ngang cấp với `_kit`)
> — thư mục `_kit` này chỉ chứa tài liệu & kế hoạch.
> Cập nhật: 2026-08-06 (thử lại khi đếm số video thất bại; khóa nút Chạy lúc đổi IP)

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
| `vpn-hma.cjs` | Đọc trạng thái HMA VPN. ⛔ `cycle()` (tắt/bật lại lấy IP mới) còn trong file nhưng **KHÔNG còn nơi nào gọi** — QĐ-32 đã bỏ. Qua native messaging của chính HMA + `ipv6LeakRisk()` phát hiện rò rỉ IPv6 + `tunnelState()` đọc đường hầm HMA **miễn phí** (2.1ms, không spawn) để canh người dùng tự tắt/bật — [QĐ-32](DECISIONS.md) |

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
| `crawl-modes.test.js` | 25 kịch bản — mock Playwright + `browser.cjs` để chạy engine thật không cần TikTok: tiền tố log từng chế độ, thoát kẹt (trùng sound / không đọc được sound), chế độ khách, `recycle` bật/tắt đúng chế độ, canh IP (lệch → tạm dừng, về đúng vùng → tự chạy tiếp), **feed cạn** (QĐ-31), và **thử lại khi đếm số video thất bại** (QĐ-07 bổ sung: lượt 2 đọc được bằng API → vào dữ liệu với số đúng; lượt 2 đọc được bằng giao diện `"4.5K"` → 4500; cả 2 lượt trượt → tab chờ + log `statusCode` lạ; **không** thử lại khi sound đã xóa / khi lượt 1 đã đọc được; `TTC_COUNT_ATTEMPTS=1` tắt được).<br>Bằng chứng "có/không thử lại" là **số lần mở trang `/music/`**, không phải đếm log.<br>⚠ **13 kịch bản GỐC chỉ IN log, KHÔNG có khẳng định nào** — pass chỉ nghĩa "không ném lỗi". Chỉ 36 khẳng định của phần feed cạn + thử lại là kiểm thật (trượt → exit ≠ 0). |
| `vpn-run-lock.test.js` | **55 khẳng định** cho việc **khóa nút "▶ Chạy" khi đổi IP** (QĐ-32 bổ sung 1+2). Ba nhãn phân biệt: `⏳ đổi IP` (app đang tắt/bật VPN) · `⛔ VPN tắt` (VPN đang tắt) · `⏳ 59s…` (chờ IP nguội) → hết chờ trả về `▶ Chạy` ngay. Nút **"■ Dừng" luôn bấm được**; mốc đã qua tự hết hạn (không kẹt vĩnh viễn); `updateRunSelectedBtnState()` **tôn trọng** khóa chứ không ghi đè.<br>Phần **canh người dùng tự tắt/bật HMA**: lần poll đầu chỉ lấy mốc (máy không cài HMA / đang tắt HMA **không bao giờ** bị khóa), tắt→bật, bật→tắt, chu trình đầy đủ, **nối lại mà adapter còn nguyên** (so IP trong hầm), poll lại khi không đổi gì **không đặt lại đồng hồ**, cảnh báo đúng **số** profile đang chạy, và phân biệt **có/không có IPv6 công khai** (có → đang LỘ IP thật; không → chỉ lỗi mạng).<br>Cộng khẳng định trên **mã nguồn**: `toggleProfile`/`runSelected` tự chặn, mở khóa nằm trong `finally`, cắt feed **chỉ dừng đúng profile đó** và tuyệt đối không đụng vào VPN, bộ canh dùng kênh **rẻ** (`vpnTunnel`) không dùng `vpnStatus`, và bộ máy tự-chạy-lại đã **dọn sạch** khỏi mã nguồn.<br>⚠ Test **trích đúng mã nguồn** 6 hàm từ `renderer.js` rồi chạy trong Chromium với DOM thật — **không chép logic sang test**, vì bản chép sẽ lệch âm thầm và test pass trong khi app hỏng. Hàm trích **phải kéo theo chữ `async`**, thiếu là SyntaxError báo lỗi lệch hướng hoàn toàn |
| `chromium-profile.test.js` | 58 khẳng định cho chế độ **profile Chromium riêng** (QĐ-27, QĐ-28): mặc định TẮT, mở đúng `<profile>/ChromiumProfile` + giới hạn cache, dọn `SingletonLock` kẹt, vân tay khớp chế độ thường, lần đầu bơm cookie sang (lần sau không bơm lại), nút 🦊 mở TAB MỚI chứ không chiếm tab feed đang quét, **trộn 2 chế độ trên cùng máy** (profile bật / profile tắt không ăn theo nhau), và **tab đếm theo chế độ hiển thị** — chạy ẩn thì dùng chung context (không bị đóng oan), chạy hiện thì tách sang trình duyệt ẩn riêng |
| `sheet-rows-status.test.js` | 15 khẳng định cho ô **"Sheet: N dòng data"** (QĐ-29): luôn hiện dù dòng thông báo đang bị lỗi/câu dài chiếm, mà cũng không xoá mất câu đó; dựng lại đúng 2 câu đã gây lỗi thật; đối chiếu thẳng `renderer.js`/`index.html`/`styles.css` để bản sao logic không lệch âm thầm |
| `sheets-pending.test.js` | **52 khẳng định** cho **tab chờ kiểm tay** (QĐ-33), mock `google-api.cjs`: ghi đúng 4 cột A:D và **không bao giờ ghi cột E "Tình trạng"**; ghi đúng tab chờ, **tuyệt đối không** ghi vào tab chính; không ghi trùng (link đã có trên Sheet / vừa ghi / **cùng ID khác slug ngôn ngữ**); **để trống tên tab = dùng tên mặc định** (không còn là tắt); **tab không tồn tại** → tự ngưng cả phiên ở *cả hai* đường phát hiện (đầu phiên và lúc ghi), **không gọi API nào nữa**, báo có tên tab + nói thẳng "link sẽ bị BỎ", sửa tên tab thì cho thử lại; lỗi ghi thường thì **giữ lô rồi ghi lại được**; và **chống trùng LIÊN MÁY** — đọc **tăng dần** từ mốc (kiểm thấy đúng `!B4:B`) + **đọc lại ngay trước khi ghi** rồi tự bỏ dòng máy khác vừa ghi, mà đọc lại **lỗi mạng thì vẫn ghi** (không nghẽn dữ liệu).<br>⚠ Dùng ID sound **19 chữ số thật** — ID ngắn làm `normalizeKey` lùi về so nguyên văn URL và khẳng định lọc trùng thành vô nghĩa. Mock trả **nguyên văn** `HTTP 400 "Unable to parse range"` như Google thật để còn kiểm được đường dịch lỗi của QĐ-26 |
| `vpn-hma.test.js` | 74 khẳng định điều khiển HMA VPN (QĐ-32), mock toàn bộ `child_process`: **mặc định nối lại đúng server cũ, không xoay city** (`rotate:true` là đường dự phòng, vẫn kiểm); **tuyệt đối không dùng `ConnectToOptimal`** (đo thật trả về Việt Nam bất kể profile khai nước nào); từ chối đổi IP khi quốc gia HMA đang nối không khớp profile hoặc khi HMA đang tắt sẵn; cảnh báo rõ "VPN có thể đang TẮT" khi bật lại thất bại; `status()` chỉ đọc, không đụng VPN; và **`ipv6LeakRisk()`** — nhận đúng `2000::/3` là rò rỉ, **không** tính Tailscale `fd7a:`/link-local `fe80`, không tính IPv6 trên adapter VPN, nhận cả `family` dạng số `6`.<br>Và **`tunnelState()`** (canh người dùng tự tắt/bật HMA): nhận đúng adapter HMA + IP trong hầm; **Tailscale TUYỆT ĐỐI không được tính** (đó là đường vào VPS — tính nhầm là khóa oan nút Chạy trên cả 4 máy ảo); dự phòng nhận adapter `TAP`/`OpenVPN` cho máy ảo bản HMA cũ; adapter HMA **thắng tất định** không phụ thuộc thứ tự Windows liệt kê; adapter còn nhưng mất IPv4 → coi là tắt; `os` ném lỗi → trả `unknown` chứ không ném ra ngoài (hàm bị gọi 2 giây/lần) |
| `starve-restart.test.js` | **37 khẳng định** cho **cắt feed → dừng profile đó rồi TỰ BẬT LẠI** (QĐ-32 đảo lại). Người dùng **treo máy qua đêm** nên đường này hỏng là mất trọn sản lượng mà **không ai thấy** — đúng loại lỗi im lặng cần test nhất.<br>Phủ: dừng **đúng** profile bị cắt (profile khác không bị đụng), đặt hẹn + đếm ngược **hiện ra badge**, hết giờ **bật lại thật**, nghỉ **lâu dần 5→15→30** và **giữ mức cuối**, thu được sound hợp lệ thì **xoá chuỗi**, bấm ■ Dừng lúc chờ thì **huỷ hẹn** (bẫy: lúc đó profile **không** nằm trong `runningSet`), bấm ▶ Chạy thì chạy ngay mà **không bật 2 lần**, VPN đang tắt thì **không bật** rồi kiểm lại mỗi 5 giây, nhiều profile có hẹn **riêng**.<br>⚠ Thang thời gian trong test phải **lớn hơn nhịp bộ đếm (1 giây)** — lần đầu dùng 300/600/900ms thì 12 khẳng định trượt vì **test sai**, không phải code sai |
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

Cả 2 bước thất bại mà sound **còn sống** → **thử lại trọn vòng 1 lần** (mở lại trang `/music/`,
làm lại cả 2 bước — [QĐ-07](DECISIONS.md) bổ sung 2026-08-06). Lý do: trang lỗi của TikTok ghi
thẳng *"Please try again later"* kèm nút Refresh, tức **chính nó khai là lỗi tạm thời**. **Không**
thử lại khi sound đã xóa (`statusCode 10201`) hoặc khi lượt 1 đã đọc được số — thử thêm là tự dội
IP mình. Tắt bằng `TTC_COUNT_ATTEMPTS=1`, không cần build lại.

Hết lượt vẫn thất bại → **không vào dữ liệu chính** (không ghi dòng `?` — QĐ-07). Từ
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
| **Nhịp cuộn tự giãn** | Hàng đợi càng đầy thì nghỉ giữa 2 lần cuộn càng lâu (dưới 50% → bình thường · 75% → ×2.5 · 100% → ×4). Vòng quét **tự khớp tốc độ** với bước đếm nên hiếm khi tới ngưỡng đầy — thay cho hành vi cũ "chạy hết tốc rồi ĐỨNG HẲN" vốn là nguyên nhân của hiện tượng *"cứ dừng mãi ở 1 video"* ([QĐ-34](DECISIONS.md)) |
| Trần hàng đợi | Tối đa 20 sound chờ; đầy hẳn thì mới tạm ngừng cuộn (chốt chống hàng đợi phình vô hạn) |
| Điều tiết đếm toàn cục | Giới hạn số request `/music/` đồng thời (mặc định 2) + giãn nhịp |
| Nghỉ khi bị chặn | 3 lần lỗi liên tiếp → nghỉ 30s → 2 phút → 5 phút (có nhiễu ngẫu nhiên) |
| **Trần thời gian đọc giao diện** | 2.5s (lượt 1) / 5s (lượt 2) tính bằng **đồng hồ**, không đếm vòng — giữ slot đếm quá lâu làm hàng đợi đầy → vòng quét đứng → **feed ngừng cuộn** ([QĐ-34](DECISIONS.md)) |
| Giữ sound khi bị chặn | Từ lần lỗi thứ 3, sound được trả về đầu hàng đợi thay vì bỏ (tối đa 3 vòng) |
| Hộp đen | Ghi lý do khi tiến trình con chết + nhịp bộ nhớ mỗi 5 phút vào `logs/` |

## Phát hiện sự cố tự động

- **Feed kẹt** — nhận biết theo **hai đường, đủ một là đủ**:
  · đọc trúng cùng 1 sound **20 lần** liên tiếp, hoặc
  · ở trên cùng 1 sound quá **90 giây** (và đã đọc ít nhất 5 lần).
  Đường thời gian là **bắt buộc** kể từ khi nhịp cuộn tự giãn (tới ×4): 20 lần đọc có thể mất tới
  5 phút mới tới ngưỡng, quá chậm để can thiệp. Đòi tối thiểu 5 lần đọc để không báo oan khi người
  dùng đặt delay rất lớn. ⚠ Cố ý đo *"cùng 1 sound bao lâu"*, **không** đo *"bao lâu không có sound
  mới"* — feed khoẻ vẫn có thể hàng phút không ra sound mới do lọc trùng 173.000 link.
  Rồi chẩn đoán trang và thoát kẹt theo **3 cấp**: bấm nút "video kế tiếp" của TikTok → cuộn mạnh
  3 nhịp con lăn → tải lại trang. Xoay vòng 1→2→3→1. `clearStuck()` reset **cả đồng hồ**, nếu không
  thì lần đọc kế tiếp báo kẹt ngay và cách vừa thử không có cơ hội tỏ hiệu quả.
- **Feed cạn** (TikTok không cấp thêm video, [QĐ-31](DECISIONS.md)): kẹt + trang chỉ còn ≤2
  video + không có nút "xuống" dùng được + đã thử trọn vòng 3 cấp + **không** phải chế độ khách
  → chu kỳ **cắt pha Quét sang pha Xem**; chế độ khác **tạm dừng 5/15/30 phút** rồi thử lại.
  Phải đủ cả 5 điều kiện — báo oan làm profile khoẻ tự tạm dừng. Kết luận mất 2–3 phút, thay
  cho việc quay vòng thoát kẹt vô hạn (đo thật: ~2 giờ ra 0 sound).
- **TikTok cắt feed → DỪNG profile đó rồi TỰ BẬT LẠI** ([QĐ-32](DECISIONS.md)): feed cạn phát status
  riêng `feed-starved` → renderer **dừng đúng profile bị cắt**, hẹn **tự bật lại sau 5 → 15 → 30
  phút** (tăng dần theo số lần cắt liên tiếp, giữ mức 30; thu được 1 sound hợp lệ thì chuỗi về 0).
  Đếm ngược **hiện ra badge** từng giây — người dùng **treo máy** nên không thể bấm tay.
  Bấm ■ Dừng lúc đang chờ = **huỷ hẹn**; bấm ▶ Chạy = chạy ngay (vẫn giữ chuỗi); VPN đang tắt lúc
  tới giờ thì **không bật**, kiểm lại mỗi 5 giây. **Không có công tắc nào**, áp cho **mọi chế độ** —
  việc dừng này **đè lên** backoff cũ của backend và cả đường "cắt sang pha Xem" của chế độ chu kỳ.
  ⛔ Tính năng **tự tắt/bật lại HMA VPN rồi tự chạy lại** đã **BỎ** (2026-08-06): IP là của **cả
  máy**, nên đổi IP giữa lúc các profile khác đang quét làm chúng chuyển từ IP A sang IP B **giữa
  phiên** — đúng khuôn "tài khoản bị chiếm" mà QĐ-15 gọi là nguyên nhân số 1 khiến TikTok hủy phiên.
  Còn dừng HẾT profile trước khi đổi thì mỗi lần **một** profile bị cắt là **cả dàn phải nghỉ**.
  `src/vpn-hma.cjs` vẫn còn `cycle()` + test (kiến thức đo thật) nhưng **không còn nơi nào gọi**.
- **Canh HMA do NGƯỜI DÙNG tự tắt/bật** ([QĐ-32](DECISIONS.md)) — tính năng KHÁC, vẫn giữ: đọc
  `tunnelState()` **2 giây/lần** (miễn phí — chỉ `os.networkInterfaces()`, đo thật 2.1ms/lần; cố ý
  không dùng `status()` vì kênh đó spawn `VpnNM.exe` + chờ 600ms). VPN tắt → nút Chạy thành
  `⛔ VPN tắt` và cảnh báo rõ số profile đang chạy (kèm **có/không có IPv6 công khai** — có thì
  chúng đang LỘ IP thật, không thì chỉ lỗi mạng). VPN lên → khóa nút kèm đếm ngược `⏳ 59s`.
  Khóa **cả** nút từng hàng và nút "Chạy ô đã chọn"; nút "■ Dừng" luôn bấm được.
  App **không bao giờ tự đụng vào VPN** — chỉ phản ánh trạng thái lên nút.
  ⚠️ Chỉ hiện đếm ngược ở dòng trạng thái là KHÔNG đủ — đã gặp thật, xem QĐ-32.
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
| Chống trùng dữ liệu | Liên máy — gần đúng | Đọc **phần mới ở cuối** mỗi phút + đọc lại toàn bộ mỗi 10 phút + đọc lại **ngay trước mỗi lần ghi**. Áp cho **cả tab chính và tab chờ** (tab chờ được bổ sung 2026-08-06 — trước đó chỉ nạp 1 lần đầu phiên nên sinh dòng trùng) (QĐ-09) |
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
