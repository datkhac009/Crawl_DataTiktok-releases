# API

> Cập nhật: 2026-08-06 (bảng statusCode của api/music/detail/)
> (`ipcMain.handle`). Sửa 2 chỗ thì cập nhật lại file này.

Ứng dụng **không có API server**. Phần này ghi lại 3 loại giao tiếp thực tế có trong app.

## 1. IPC nội bộ (renderer ↔ main)

Renderer chạy trong sandbox, gọi main qua `window.api` (khai báo ở `preload.cjs`).

| Kênh | Chiều | Mục đích |
|---|---|---|
| `app-version`, `is-dev` | gọi | Version hiện tại; có phải bản dev (quyết định hiện nút 🔄 Reload) |
| `restart-app`, `reload-window` | gửi | Khởi động lại app; nạp lại giao diện (chỉ dev) |
| `profiles-list`, `profiles-add`, `profiles-update`, `profiles-delete` | gọi | CRUD profile (`config/profiles.json`) |
| `profiles-import-path`, `profiles-list-folders`, `profiles-get-path` | gọi | Import folder từ ổ đĩa; liệt kê folder chưa gán; tra đường dẫn |
| `profile-start` / `profile-stop` / `profile-soft-stop` | gọi | Chạy / dừng cứng / dừng mềm một profile |
| `profiles-stop-all`, `crawl-running-ids` | gọi | Dừng tất cả; hỏi profile nào đang chạy (**nguồn sự thật** để renderer đồng bộ lại trạng thái sau khi nạp lại giao diện) |
| `verify-logins` | gọi | 🔑 Kiểm tra đăng nhập THẬT nhiều profile (mở TikTok hỏi thẳng, ~20–30s/profile) |
| `open-browser` / `close-browser` | gọi | Mở/đóng trình duyệt 🦊; trả kèm chẩn đoán phiên đăng nhập |
| `browser-closed` | nhận | Người dùng tự đóng cửa sổ 🦊 |
| `crawl-data` | nhận | Một sound đã qua bộ lọc → thêm dòng vào bảng |
| `crawl-status` | nhận | Trạng thái profile — **nhiều loại**, xem bảng dưới |
| `sheets-get-config`, `sheets-set-config`, `sheets-test` | gọi | Đọc/ghi cấu hình Sheet; 🔌 Test kết nối (trả cả danh sách tab có thật) |
| `sheets-push-manual` | gọi | ☁ Đẩy bù thủ công (tự lọc trùng, bấm nhiều lần không tạo trùng) |
| `sheets-scan-duplicates`, `sheets-clean-duplicates` | gọi | 🧹 Dọn trùng: bước quét (chỉ đọc, để xem trước) và bước xoá thật |
| `linkstore-info` | gọi | Trạng thái kho cục bộ: đường dẫn + số khoá. Tham số `force=true` = đọc lại từ đĩa sau khi người dùng tự sửa file |
| `linkstore-import-sheet` | gọi | ⬇ Nạp từ Google Sheet vào kho — đọc TOÀN BỘ cột Link rồi **gộp thêm** vào `known_links.txt`. **Không bao giờ ghi đè** ([QĐ-36](DECISIONS.md)) |
| `linkstore-open` | gọi | Mở `known_links.txt` bằng ứng dụng mặc định để dán link tay (tự tạo file nếu chưa có) |
| `history-get`, `history-clear` | gọi | Đọc/xóa lịch sử thu thập theo ngày (`config/history.json`) |
| `store-get`, `store-set` | gọi | Đọc/ghi electron-store (`profile_settings`, `count_concurrency`, `update_repo`…) |
| `select-folder`, `export-results` | gọi | Hộp thoại chọn thư mục; xuất bảng dữ liệu ra CSV (UTF-8 BOM) |
| `check-updates`, `download-and-update` | gọi | Kiểm tra & cài bản mới |
| `update-get-repo`, `update-set-repo` | gọi | Repo GitHub phát hành (ô "Nâng cao" trong modal ⬆) |
| `download-progress`, `update-available`, `update-not-available`, `update-error` | nhận | Tiến trình tải + kết quả kiểm tra cập nhật |
| `vpn-status` | gọi | Đọc trạng thái HMA VPN hiện tại (chỉ đọc, không đổi gì) — [QĐ-32](DECISIONS.md) |
| `vpn-ipv6-risk` | gọi | Máy có IPv6 công khai (rò rỉ khi VPN tắt) hay không. Dùng để **phân mức cảnh báo** khi người dùng tắt HMA lúc còn profile chạy: có IPv6 → chúng đang **LỘ IP thật**; không có → chỉ lỗi mạng. Rẻ, đồng bộ, không spawn gì |
| `vpn-cycle` | gọi | Tắt/bật lại HMA VPN **đúng server đang dùng** để lấy IP mới từ pool (không đổi city — xem QĐ-32). Backend **từ chối nếu còn profile nào đang chạy** + giới hạn nhịp (10 phút/lần, 6 lần/ngày) |
| `vpn-tunnel` | gọi | Đường hầm HMA đang lên/xuống + **IP trong hầm** (`{up, address, iface}`). Renderer poll **2 giây/lần** để biết NGƯỜI DÙNG tự tắt/bật HMA. ⚠ CỐ Ý không dùng `vpn-status` cho việc này: kênh đó spawn `VpnNM.exe` + chờ 600ms (≈1800 tiến trình/giờ nếu poll dày); kênh này chỉ đọc `os.networkInterfaces()` — đo thật **2.1ms/lần** — [QĐ-32](DECISIONS.md) |

### Các loại `crawl-status`

`profileId = null` nghĩa là thông báo **cấp phiên** (không thuộc profile nào).

| `status` | Kèm dữ liệu | Renderer làm gì |
|---|---|---|
| `running` | `msg` | Cập nhật badge trạng thái + ghi log 📄, đánh dấu hàng đang chạy |
| `stopped` / `error` | `msg` | Bỏ đánh dấu đang chạy, xoá chip pha; `error` còn hiện toast |
| `counts` | `scanned`, `checked`, `skippedDup` | **Kênh riêng, không kèm text** — chỉ cập nhật số, không đụng badge/log |
| `phase` | `phaseLabel`, `nextLabel`, `deadlineAt` | Chip đếm ngược của chế độ chu kỳ (renderer tự tick mỗi giây) |
| `verify` | `state`, `msg` | Kết quả 🔑. ⚠ **KHÔNG** dùng `running` cho việc này — xem cảnh báo trong `main.js` |
| `feed-starved` | `msg` | TikTok không cấp thêm video cho profile ([QĐ-31](DECISIONS.md)) — vừa là log, vừa là tín hiệu để renderer xử. Công tắc "Tự đổi IP" **bật** → **dừng HẾT profile** + tắt/bật lại HMA + chờ 59s + chạy lại cả nhóm; **tắt** → dừng đúng profile đó rồi tự bật lại sau 5/15/30 phút ([QĐ-32](DECISIONS.md)). ⚠ **KHÔNG** dùng `error`/`running` — profile vẫn sống |
| `count-blocked` | `msg` | TikTok chặn **trang đếm** `/music/` của profile này quá lâu (≥6 sound liên tiếp lỗi, đã đi hết thang backoff 30s → 2p → 5p). Renderer **dừng profile đó rồi tự bật lại** 5/15/30 phút. ⚠ **KHÔNG** đi đường đổi IP — chặn này theo **tài khoản**, không theo IP. ⚠ **KHÔNG** dùng `error` (sẽ làm hàng đổi về nút "▶ Chạy" khi profile chưa dừng) |
| `sheet-rows` | `sheetRows`, `knownLinks` | Ghi vào **ô riêng** `#sheetRowsInfo` ([QĐ-29](DECISIONS.md)) |
| `sheet-error` | `msg` | Hiện toast lỗi + ghi vào dòng thông báo |
| `info` | `msg` | Thông báo cấp phiên (nạp link lọc trùng, tiến độ 🔑…) |
| `all-done` | `msg` | Không còn profile nào chạy → tổng kết phiên; main.js xả nốt buffer Sheet |

## 2. Endpoint TikTok mà app phụ thuộc

| Endpoint | Dùng để | Ghi chú |
|---|---|---|
| `https://www.tiktok.com/` | Feed For You | Cần User-Agent Chrome thật, nếu không bị chặn |
| `api/music/detail/` | Lấy số video của sound | Nghe response khi mở trang `/music/` — **không gọi thẳng** (cần tham số ký `X-Bogus`/`msToken`, xem [QĐ-06](DECISIONS.md)). Trần chờ **8 giây** (`TTC_COUNT_API_MS`) — trang lỗi thì API không bao giờ chạy, xem [QĐ-34](DECISIONS.md) |
| `https://www.tiktok.com/music/<slug>-<id>` | Trang sound | Chỉ `<id>` có ý nghĩa, phần chữ bị bỏ qua |

**Các `statusCode` đã gặp thật trong body của `api/music/detail/`** — app xử khác nhau hoàn toàn:

| `statusCode` | Nghĩa | App làm gì |
|---|---|---|
| `0` | OK, có `musicInfo.stats.videoCount` | Dùng **số chính xác** (vd `88100`, không phải text `"88.1K"` làm tròn) |
| `10201`, `10202` (thường kèm HTTP 400), hoặc **body rỗng** | Sound đã xóa / không tồn tại | **Bỏ hẳn**, không thử lại, không vào tab chờ. Không tính là "bị chặn" → không phạt tốc độ |
| **`10203`** (đo 2026-08-06: HTTP 200, body ~205 byte, **không có** `musicInfo`) | Chưa rõ nghĩa — **phụ thuộc IP/vùng**: cùng link, từ IP UK trả `10203` còn từ IP US lại hiện `21 videos` | **Không** coi là sound chết. Rơi xuống đọc giao diện → thử lại trọn vòng → vẫn trượt thì **tab chờ**. Ghi log kèm mã + độ dài body |
| Mã lạ khác | Chưa gặp | Xử như `10203` (không bỏ oan cái chưa hiểu) |
| **Không có response nào** | Đang bị chặn / rate-limit | Tăng `failStreak` → phạt tốc độ toàn cục → backoff 30s/2ph/5ph |

⚠️ **Nợ kỹ thuật đã biết:** hai dòng cuối đang bị **gộp** — lỗi của riêng một link (`statusCode`
lạ) cũng làm tăng `failStreak` nên cũng phạt tốc độ **mọi profile**, dù TikTok chẳng chặn gì. Chờ
log có số liệu về `10203` rồi mới tách — xem [QĐ-07](DECISIONS.md).

## 3. Google Sheets API v4

Xác thực: Service Account, ký JWT RS256 → đổi lấy access token (cache 55 phút, dùng chung
toàn app qua `google-api.cjs`).

| Việc | Lời gọi | Ghi chú |
|---|---|---|
| Ghi dữ liệu | `values:append` `{tab}!A:Z` · `RAW` | `A:Z` **không** phải `A:D` — xem [QĐ-08](DECISIONS.md) |
| Ghi **tab chờ** | `values:append` `{pendingTab}!A:Z` · `RAW` | Link TikTok trả *"Something went wrong"*. Chỉ 4 cột A:D, **cột E "Tình trạng" không bao giờ ghi** — [QĐ-33](DECISIONS.md) |
| Đọc **tab chờ** — toàn bộ | `values.get` `{pendingTab}!B:B` | Đầu phiên + đồng bộ lại mốc (cùng `reseedMinutes` với tab chính). **Không** nạp vào bộ lọc quét → link chờ vẫn được thử lại phiên sau |
| Đọc **tab chờ** — tăng dần | `values.get` `{pendingTab}!B{n}:B` | Phần mới ở cuối, **mỗi phút** + **ngay trước mỗi lần ghi**. Cùng bộ cơ chế của tab chính ([QĐ-09](DECISIONS.md)) — thiếu nó thì nhiều máy cùng ghi sẽ sinh dòng trùng, đã gặp thật 2026-08-06 |
| Đọc lọc trùng — **toàn bộ** | `values.get` `{tab}!B:B` | Đầu phiên + đồng bộ lại mốc (mặc định 10 phút/lần). Trần riêng 120s × 2 lần thử ([QĐ-20](DECISIONS.md)) |
| Đọc lọc trùng — **tăng dần** | `values.get` `{tab}!B{n}:B` | Phần mới ở cuối, mỗi phút + **ngay trước mỗi lần ghi** ([QĐ-09](DECISIONS.md)) |
| Dọn trùng — quét | `values.get` `{tab}!A:Z` | Đọc rộng để biết dòng nào có ghi chú tay ở cột E trở đi ([QĐ-20](DECISIONS.md)) |
| Dọn trùng — xoá | `:batchUpdate` + `deleteDimension` | **Phải xoá theo thứ tự GIẢM DẦN** số dòng |
| Test kết nối | `GET` spreadsheet `?fields=properties.title,sheets.properties.title` | Trả cả danh sách tab có thật |
| Khoá liên máy — đọc/ghi | `values.get` + `values:batchUpdate` `'_locks'!A:E` | Nhịp tim mỗi 60s ([QĐ-19](DECISIONS.md)) |
| Khoá liên máy — tạo tab | `:batchUpdate` + `addSheet` (`hidden: true`) / `updateSheetProperties` | Tab `_locks` tạo ở dạng **ẩn**; tab cũ chưa ẩn thì app tự ẩn lại |

**Xử lý lỗi cần biết:**

| HTTP | Nghĩa | App làm gì |
|---|---|---|
| `429`, hoặc `403` **có** chữ quota/rateLimit | Vượt giới hạn (60 req/phút **mỗi Service Account**) | Mở cầu dao, tạm ngưng 60s, **không mất dữ liệu** ([QĐ-24](DECISIONS.md)) |
| `403` **không** có chữ quota | Chưa chia sẻ Sheet cho service account | Báo đúng lỗi thiếu quyền — **không** được nhầm thành quota |
| `400` + `unable to parse range` | **Tên tab không tồn tại** | Dịch thành câu chỉ đúng chỗ sửa ([QĐ-26](DECISIONS.md)) |

Chi tiết lý do chọn cách này: [DECISIONS.md](DECISIONS.md) — QĐ-08, QĐ-09, QĐ-19, QĐ-20, QĐ-24, QĐ-26.
