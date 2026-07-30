# Quyết định kiến trúc

> Ghi lại các quyết định quan trọng **và lý do** — đọc file này trước khi đề xuất thay đổi
> có thể xung đột. Cập nhật: 2026-07-28

---

## QĐ-01 — Engine crawl dùng Chromium, nguồn đăng nhập là Firefox

**Quyết định:** Toàn bộ crawl chạy trên Chromium. Profile Firefox (Firefox Portable) chỉ
dùng để trích cookie một lần khi import.

**Lý do:** Đo thực tế với 3 profile chạy ẩn — Chromium 8–10 tiến trình / ~3.2GB / CPU 23–32%
so với Firefox 13 tiến trình / 4.6GB / CPU 60%. Cookie không phụ thuộc trình duyệt nên
chuyển được.

**Ràng buộc:** Chromium ẩn gửi User-Agent chứa "HeadlessChrome" → TikTok chặn trang
`/music/`. **Bắt buộc đặt User-Agent Chrome thật** cho mọi context.

---

## QĐ-02 — Một trình duyệt dùng chung, nhiều context

**Quyết định:** Các profile chia sẻ một Chromium, mỗi profile một context riêng (thay vì
mỗi profile một trình duyệt).

**Lý do:** Đo thực tế: 26 tiến trình → 13 tiến trình, giảm ~2GB RAM với 3 profile.

**Rủi ro chấp nhận:** Trình duyệt chung sập thì mất tất cả context của nó.

---

## QĐ-03 — Giữ đăng nhập bằng `session.state.json`, không dùng thư mục profile Chromium

**Quyết định:** Mỗi profile giữ đăng nhập trong một file cookie (~150KB) thay vì thư mục
Chromium persistent (hàng trăm MB).

**Lý do:** Nhẹ đĩa, dễ sao lưu/chuyển máy, không kẹt khóa thư mục profile.

**Ràng buộc:** Chỉ lưu **cookie**, không lưu localStorage — vì để lấy localStorage,
Playwright phải mở một trang tạm cho từng origin, làm **nhấp nháy cửa sổ** liên tục. Đăng
nhập TikTok là cookie-based nên đủ.

---

## QĐ-04 — Không bao giờ ghi đè phiên tốt bằng phiên khuyết

**Quyết định:** Trước khi lưu cookie, so sánh với file hiện có. Mất cookie xác thực hoặc
định tuyến → **bỏ qua lần lưu**, giữ nguyên file cũ.

**Lý do (sự cố thật 2026-07-27):** Một profile đột nhiên chạy ở chế độ khách dù `sessionid`
còn nguyên hạn tới 2027. So sánh phát hiện file thiếu 8 cookie mà Firefox vẫn có, gồm nhóm
`tt-target-idc`/`store-idc` — nhóm cho TikTok biết trung tâm dữ liệu nào giữ phiên. Thiếu
chúng, yêu cầu đi tới sai máy chủ → bị coi là khách.

Nguyên nhân mất: từ 2026-07-08 app lưu đè file mỗi 20 giây. Chỉ cần **một** nhịp cookie
thiếu là bản tốt mất vĩnh viễn, và lần sau khởi động bằng bản khuyết nên không bao giờ hồi
phục. Nghiệt hơn: mở 🦊 để *kiểm tra* một profile đang bị từ chối cũng đủ hủy phiên trong
10 giây.

**Ngoại lệ:** `sessionid` mới khác cũ = đăng nhập tài khoản khác → cho lưu. Nếu chặn cả
trường hợp này thì phiên mới hợp lệ sẽ không bao giờ ghi xuống được.

---

## QĐ-05 — Dấu vân tay cố định theo profile

**Quyết định:** Mỗi profile có `fingerprint.json` trong thư mục profile, khóa cứng múi giờ,
ngôn ngữ, số nhân CPU, RAM, card đồ họa, độ phân giải màn hình.

**Lý do:** Cookie đi theo file nhưng dấu vân tay được tính lại trên từng máy → chép profile
sang máy khác thì TikTok thấy "cùng tài khoản, khác thiết bị" → hạ xuống chế độ khách.

**Chi tiết:** Giá trị suy ra **tất định** từ tên thư mục profile nên mất file vẫn sinh lại
đúng bộ cũ. Múi giờ/ngôn ngữ lấy theo **nhãn quốc gia trong tên profile** — trước đây
profile chạy VPN Mỹ nhưng báo giờ Việt Nam, là mâu thuẫn dễ bị nhận diện proxy.

**Quan trọng:** Tab đếm số video **phải dùng cùng vân tay** với tab chính, vì hai bên xài
chung cookie — khác vân tay = "một phiên đăng nhập chạy trên hai thiết bị".

---

## QĐ-06 — Đếm số video qua API, không đọc giao diện

**Quyết định:** Nghe response `api/music/detail/` mà trang `/music/` tự gọi, thay vì dò
chữ "X videos" trên giao diện.

**Lý do:** Số chính xác (`88100` thay vì text `88.1K` đã làm tròn), về sớm ~1 giây, và phân
biệt được **sound đã bị xóa** (HTTP 400 + statusCode 10201) với **bị chặn** — sound chết
không còn tốn 3 lần thử và không bị phạt tốc độ oan.

Đọc giao diện giữ lại làm **dự phòng** phòng khi TikTok đổi endpoint.

---

## QĐ-07 — Không ghi dòng `?` vào dữ liệu

**Quyết định:** API lỗi → đọc giao diện → cả hai lỗi thì **bỏ link**, không ghi dòng `?`.

**Lý do:** Người dùng chốt: thà mất một ít link còn hơn dữ liệu bẩn.

**Bổ sung (2026-07-14):** Riêng khi **bị chặn diện rộng** (3 sound lỗi liên tiếp trở lên),
sound được **trả về đầu hàng đợi** thay vì bỏ, tối đa 3 vòng chờ. Vì lúc đó sound hoàn toàn
bình thường, chỉ là TikTok đang chặn — bỏ đi là oan. Ước tính trước khi vá: đợt chặn 6 giờ
làm mất 280–350 sound với 5 profile.

---

## QĐ-08 — `values:append` phạm vi `A:Z` khi ghi Google Sheet

**Quyết định:** Dùng `values:append` trên `A:Z`, không tự tính số dòng rồi ghi cứng.

**Lý do:** `append` được Google xử lý tuần tự nên **an toàn khi nhiều máy cùng ghi**. Từng
thử tự tính dòng → 2 máy liên tục ghi đè lên nhau vì mỗi máy chỉ biết những gì nó đã ghi.

Phạm vi phải là `A:Z` chứ không phải `A:D`: nếu cột E (Tình trạng người dùng tự điền) dài
hơn A:D thì `append` bị đánh lừa và ghi vào giữa bảng.

---

## QĐ-09 — Chống trùng liên máy bằng đọc lại Sheet định kỳ

**Quyết định:** Mỗi máy đọc lại cột Link trên Sheet mỗi N phút (mặc định 5) trong lúc chạy.

**Lý do:** Trước đây mỗi máy chỉ nạp danh sách link **một lần** lúc khởi động, sau đó mù
hoàn toàn về những gì 3 máy kia đẩy lên → sound phổ biến gần như chắc chắn bị trùng.

**Đánh đổi đã báo trước:** Không triệt để 100% — 2 máy quét trúng cùng sound trong cùng cửa
sổ 5 phút vẫn trùng. Số "Hợp lệ" của từng máy sẽ cao hơn số dòng máy đó thực đóng góp.

---

## QĐ-10 — Hàm chuẩn hóa link để ở một nơi duy nhất

**Quyết định:** `canonicalSoundUrl` + `normalizeKey` nằm trong `src/linkkey.cjs`, cả
crawler và sheets cùng dùng.

**Lý do:** Trước đây mỗi file giữ một bản sao và **đã lệch nhau thật** — crawler được thêm
rút gọn link nhưng bản trong sheets không cập nhật theo, khiến nút đẩy bù coi link dài và
link ngắn là 2 sound khác nhau.

**Bài học chung:** Khi có ≥2 bản sao của cùng một logic, chúng **sẽ** lệch nhau. Đây cũng là
nguyên nhân của bug mất dòng log khi sao chép vòng cuộn giữa các chế độ.

---

## QĐ-11 — Dừng cứng và Dừng mềm

**Quyết định:** Hai nút — Dừng (cắt ngay, bỏ hàng đợi) và Dừng mềm (ngừng quét nhưng check
nốt hàng đợi rồi mới dừng).

**Lý do:** Dừng cứng làm mất các sound đã quét nhưng chưa kịp đếm (hiệu số cột Quét − Đã
check). Người dùng cần lựa chọn "nghỉ mà không mất dữ liệu".

**Kỹ thuật:** Cờ `stop.draining` + object `scanStop` được **shadow một dòng** ở đầu mỗi
vòng quét/xem — cố ý làm vậy để không phải sửa hàng chục điều kiện rải rác (rủi ro sót).

---

## QĐ-12 — Đóng gói kèm cả Firefox

**Quyết định:** `build.bat` copy cả Chromium **và** Firefox vào `lib/ms-playwright`.

**Lý do:** Trước đây cố tình bỏ Firefox (tưởng chỉ cần trên máy dev) → máy khác import
Firefox Portable không trích được cookie, lỗi âm thầm, kẹt ở phiên khách.

**Bổ sung:** Auto-update chỉ tải `.exe` nên máy triển khai từ trước vẫn thiếu Firefox → app
tự tải `firefox-<rev>.zip` từ release tag cố định `browsers` khi phát hiện thiếu.

---

## QĐ-13 — Cuộn feed bằng CON LĂN CHUỘT, không dùng phím mũi tên

**Quyết định:** Mọi vòng cuộn dùng `page.mouse.wheel()` (hàm `scrollFeed`), không dùng
`page.keyboard.press('ArrowDown')`.

**Lý do (đo trực tiếp trên TikTok thật 2026-07-27, profile thật):** Phím mũi tên **đã ngừng
tác dụng** — bấm 6 lần liên tiếp, sound đọc được không đổi lần nào, ở **cả** viewport
800×600 lẫn 1536×864. Con lăn chuột thì chạy tốt: 8 lần cuộn ra 6 sound khác nhau ở cả hai
khổ. Đây là gốc rễ của toàn bộ hiện tượng "feed kẹt".

**Kết quả đo trước/sau trên cùng profile, cùng 120 giây:** 1 sound → **28 sound**;
số lần đọc trùng 32 → 1; không còn cảnh báo kẹt nào.

⚠️ **Tuyệt đối không** click vào vùng trang để "lấy con trỏ" rồi gửi phím: đã thử, click
làm **hỏng trạng thái trang** (sau đó không đọc được sound nào nữa).

---

## QĐ-14 — Khổ cửa sổ lấy theo vân tay, không dùng `viewport: null`

**Quyết định:** Context crawl đặt khổ cửa sổ theo `fingerprint.json` (chiều cao trừ ~120px
cho thanh trình duyệt). Riêng cửa sổ 🦊 giữ `viewport: null` để co giãn theo cửa sổ thật.

**Lý do:** `viewport: null` ở chế độ ẩn cho cửa sổ mặc định chỉ **800×600**. Ở khổ đó TikTok
phục vụ **bố cục khác hẳn** — không có cặp nút mũi tên lên/xuống, feed chỉ dựng 2 video.
Phải từ ~1536×864 mới có nút điều hướng ở mép phải (đã kiểm chứng: nút xuất hiện tại
`(1480,384)` và `(1480,440)`).

Ngoài ra 800×600 **mâu thuẫn với vân tay đang khai báo** (màn hình 1600×900) — cửa sổ lớn
hơn màn hình là bất khả thi, rất dễ bị nhận diện.

---

## QĐ-15 — Phòng thủ nhiều lớp cho phiên đăng nhập

**Quyết định:** Không chỉ vá từng lỗi mất phiên, mà dựng **5 lớp** bảo vệ:

| Lớp | Cơ chế | Chống được gì |
|---|---|---|
| 1. Phòng | Không ghi đè phiên tốt bằng phiên khuyết (QĐ-04) | Phiên tự hỏng do một nhịp lưu xấu |
| 2. Phòng | Vân tay cố định theo profile (QĐ-05) | Chuyển máy bị coi là đổi thiết bị |
| 3. Phòng | Cảnh báo chạy trùng (`profile.lock` + nhịp tim 30s) | Nguyên nhân số 1 khiến TikTok hủy phiên |
| 4. Phát hiện | Kiểm tra đăng nhập thật lúc bắt đầu **và mỗi 15 phút** khi chạy | Phiên chết giữa chừng, cào vô ích hàng giờ |
| 5. Khôi phục | Phiên VÀNG (`session.good.json`) → Firefox → báo user | Mất phiên do bất kỳ nguyên nhân nào |

**Phiên VÀNG là điểm mấu chốt:** chỉ được ghi khi đã **xác minh đăng nhập thật trên trang**
(không phải "có cookie trong file" — đã có tiền lệ cookie đủ mà TikTok vẫn cho vào chế độ
khách), và cần đủ cả nhóm định tuyến. Tối đa 10 phút ghi một lần.

**Thứ tự khôi phục:** phiên vàng **trước**, Firefox sau — vì phiên vàng đã được kiểm chứng
còn Firefox có thể cũng cũ/thiếu.

**Chỉ cảnh báo, không chặn khi thấy chạy trùng:** lock có thể sót lại từ lần app bị giết
đột ngột; chặn cứng sẽ làm user không chạy được.

**Kiểm chứng thực tế:** profile `rsgweakde533` kẹt chế độ khách nhiều ngày (24 cookie,
thiếu nhóm định tuyến) — sau bản vá, chạy lên là **tự khôi phục về 34 cookie**, TikTok xác
nhận đã đăng nhập. Test đường phiên vàng: rụng 6 cookie định tuyến → tự khôi phục đủ 34.

**Giới hạn thành thật:** nếu TikTok hủy phiên phía máy chủ thì **không cơ chế nào cứu được**
— bắt buộc đăng nhập lại bằng 🦊. Tự đăng nhập bằng email/mật khẩu không khả thi vì tài
khoản có xác minh 2 bước.

---

## QĐ-16 — Một vòng quét feed dùng chung, tách helper ra `src/crawler/`

**Quyết định:** `crawler.cjs` chỉ giữ phần điều phối; helper tách sang `src/crawler/` (util,
count-throttle, page-read, stuck, session-watch). 4 chế độ quét gọi **một** `runScanLoop()`
thay vì mỗi chế độ một bản `feedLoop` riêng.

**Lý do:** File dài 1639 dòng, trong đó 4 bản `feedLoop` gần như y hệt nhau. Đây đúng là cái
bẫy QĐ-10 đã ghi — và khi gộp thì **phát hiện 3 điểm đã lệch nhau thật**:

1. Bản chu kỳ từng **rơi mất dòng log** "feed chưa hiện, tải lại trang rồi thử lại" khi chép
   từ For You (comment trong `scanPhase` còn ghi lại sự cố này).
2. Bản `current` **thiếu `if (stop.requested) break;`** trước khối thoát kẹt → bấm Dừng vẫn
   phải chờ `handleStuck` chạy xong (tới ~10s) mới thoát.
3. Bản `current` sau khi thoát kẹt còn **cuộn thêm 1 nhịp**, 3 bản kia thì `continue`.

Gộp cùng lúc sửa cả 3. Cũng gộp `attachCountBlocker` (crawler) và `attachResourceBlocker`
(browser) — 2 bản sao y hệt — vào `resource-blocker.cjs`.

**Kết quả:** 1639 → 1167 dòng. Thêm `test/crawl-modes.test.js` (13 kịch bản, mock Playwright)
làm lưới an toàn — trước đó dự án **không có test nào**.

**Đã cân nhắc và HOÃN:** tách `browser.cjs` (770 dòng). Nó chứa toàn bộ 5 lớp bảo vệ phiên
đăng nhập; sửa sai là mất đăng nhập trên cả 6 máy, mà khôi phục phải bấm 🦊 từng profile qua
RDP. Không đáng đánh đổi khi đang có production chạy.

---

## QĐ-17 — Tạm dừng crawl khi IP không khớp nhãn quốc gia của profile

**Quyết định:** `src/ip-guard.cjs` tra quốc gia của IP công khai; nếu lệch nhãn quốc gia trong
tên profile thì **TẠM DỪNG** (kiểm lại mỗi 60s), tự chạy tiếp khi IP về đúng vùng. Kiểm 1 lần
trước khi mở trình duyệt + định kỳ 5 phút trong vòng quét.

**Lý do:** QĐ-05 đặt múi giờ/ngôn ngữ theo nhãn quốc gia — profile `(US)` luôn khai
`America/New_York`. Cách này chỉ an toàn khi IP thật cũng ở Mỹ. Trên VPS, IP đúng vùng là nhờ
VPN — **mà VPN có lúc tụt**. Khi tụt lúc 3h sáng, 5 profile vẫn khai giờ New York nhưng request
đi từ IP Đức: đúng mâu thuẫn "IP nước này, giờ nước khác" mà QĐ-05 nói *"rất dễ bị nhận diện
là dùng proxy"*. Trước đây app **không hề biết** và cào tiếp hàng giờ.

**Vì sao tạm dừng chứ không dừng hẳn:** VPN thường tự kết nối lại sau vài phút. Dừng hẳn là
mất cả đêm sản lượng trên 6 máy.

**Triết lý xử lý (giống `checkLoginState`) — không kết luận khi không chắc:**

| Tình huống | Xử lý |
|---|---|
| Lệch quốc gia rõ ràng | Tạm dừng |
| Không tra được IP (mất mạng) | **KHÔNG chặn** — mạng lỗi vài giây không được làm treo 6 máy |
| Profile không có nhãn quốc gia | Bỏ qua hoàn toàn (tương thích profile cũ chưa tag) |

**Chi tiết:** 2 nhà cung cấp dự phòng (`ifconfig.co` ~850ms, `api.country.is` ~1.5s — đo thật),
cache 1 phút nên nhiều profile kiểm cùng lúc chỉ tốn 1 request. **Quy đổi `UK` → `GB`** vì nhãn
profile dùng "UK" còn ISO 3166-1 trả "GB" — không quy đổi thì báo lệch oan.

**Giới hạn thành thật:** chỉ so **quốc gia**, không so thành phố/ASN. VPN tụt sang một IP khác
nhưng vẫn cùng quốc gia thì không phát hiện được.

**Bổ sung (2026-07-30) — 2 nhà cung cấp PHẢI đồng thuận mới kết luận, không tin ngay cái đầu
trả lời được.** Sự cố thật: 1 VPS có IP Hàn Quốc **đúng thật** (xác nhận độc lập bằng 2 dịch
vụ khác ngoài app) nhưng app vẫn TẠM DỪNG cả 5 profile. Nguyên nhân: `getPublicIp()` cũ dùng
nhà cung cấp ĐẦU TIÊN trả lời được là tin ngay, không đối chiếu nhà cung cấp còn lại —
`ifconfig.co` (đứng đầu danh sách) có lúc trả trang chặn Cloudflare thay vì JSON, hoặc xếp
nhầm quốc gia cho dải IP dạng VPN/datacenter (IP của case này thuộc "Datacamp Limited", một
nhà cung cấp hay bị các dịch vụ định vị xếp nhầm).

Sửa: hỏi **cả 2 nhà cung cấp song song**, chỉ kết luận `mismatch`/`ok` khi **đồng thuận**. Hai
bên trả về quốc gia khác nhau → coi như `unknown` (không chặn) — đúng triết lý "không kết luận
khi không chắc" đã có sẵn ở trên, chỉ là áp dụng luôn cho trường hợp "có trả lời nhưng các bên
mâu thuẫn nhau", trước đây trường hợp này lọt lưới vì chưa từng đối chiếu. Không cache kết quả
`unknown` (giữ nguyên `at: 0`) để lần kiểm tiếp theo thử lại ngay thay vì kẹt cả phút.

**Kiểm chứng:** `test/ip-guard.test.js` (8 assertion, mock module `https` qua require.cache —
dựng lại đúng 3 tình huống: 2 bên đồng thuận khớp/lệch, 2 bên bất đồng, 1 bên bị chặn/lỗi).

---

## QĐ-18 — Cập nhật thủ công, giữ repo phát hành private

**Quyết định:** Tự cập nhật **TẮT**. Repo phát hành để private, cập nhật bằng cách copy `.exe`
mới sang từng máy.

**Lý do:** `updater.cjs` gọi GitHub API **ẩn danh, không token** (chủ đích: `.exe` phát tán tới
nhiều máy nên không được nhúng token vào đó). Private repo trả 404 cho truy cập ẩn danh →
không đọc được release.

Không chuyển repo sang public vì **file `.exe` chứa nguyên `app.asar`** — ai tải về cũng
`npx asar extract` ra được **trọn mã nguồn**. Tức "repo public chỉ chứa `.exe`" vẫn là công
khai source. Người dùng chốt: chưa muốn công khai mã nguồn.

**Đánh đổi đã biết:** với nhiều máy, cập nhật tay dễ để lệch version — mà
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) mục 5 ghi rõ *"Máy bản cũ chạy lẫn sẽ vẫn đẩy trùng"*.
**Phải cập nhật hết các máy trong cùng một lần.**

**Hai đường bật lại tự cập nhật (nếu sau này cần):**
1. Chuyển repo sang public — chấp nhận công khai mã nguồn.
2. Giữ private + mỗi máy tự lưu **token chỉ có quyền đọc** trong cấu hình cục bộ (không nhúng
   vào `.exe`). Lưu ý kỹ thuật: tải asset của release private phải gọi qua API endpoint kèm
   `Accept: application/octet-stream`, GitHub trả 302 sang S3 và **phải bỏ header
   `Authorization` khi đi theo redirect**, không bỏ là S3 từ chối.

**Bổ sung (2026-07-29) — đảo ngược: đã chuyển repo sang PUBLIC.** Nguyên nhân trực tiếp:
app hiện có **2 người phát triển, tách 2 repo riêng** để tránh xung đột code — một máy ảo
trong dàn VPS đang trỏ mặc định về repo của người còn lại (`Hung13010/...`), tự báo nhầm
"đã là bản mới nhất" dù thực tế đang chạy code **khác hẳn** bản `datkhac009` (không có các
fix ngày 2026-07-28/29: khóa liên máy, chống đẩy trùng...). Rủi ro dàn máy phân kỳ code theo
2 repo khác nhau (mục 12 TROUBLESHOOTING.md) được đánh giá là **cấp bách hơn** rủi ro lộ
source qua `.exe` — nên chọn đường 1 (public) thay vì đường 2 (token cục bộ, chưa triển khai).

Trước khi đổi, đã rà toàn bộ lịch sử git (`git log --all -S"<pattern>"` với các mẫu
`BEGIN PRIVATE KEY`, `AKIA`, `ghp_`, `client_email`, `private_key`...) — **không có secret/
credential thật nào từng bị commit**, chỉ có tên trường trong code. Vậy nên public hoá không
làm lộ thêm gì ngoài đúng mã nguồn (rủi ro đã biết và được người dùng chủ động chấp nhận).

**Hệ quả cần theo dõi:** mọi VPS giờ nên trỏ về **cùng một repo** (`datkhac009/
Crawl_DataTiktok-releases`) trong ô "Nâng cao: GitHub repo phát hành" — máy nào vẫn trỏ về
repo của người phát triển kia sẽ tiếp tục chạy code phân kỳ, không có các fix mới nhất.

---

## QĐ-19 — Khóa liên máy qua tab `_locks` trên Sheet + timer JS thuần cho MỌI request Google API

**Quyết định:** `src/sheet-lock.cjs` ghi nhịp tim `{profile, host, pid, beat_ms}` lên tab
`_locks` của chính Google Sheet đã chia sẻ giữa các máy — mỗi máy chỉ ghi dòng của riêng nó
(cặp `profile+host`) để không bao giờ tranh chấp ghi. `crawler.startProfile` bị **chặn thật**
nếu phát hiện máy khác đang giữ cùng profile với nhịp tim còn tươi (<3 phút).

**Lý do:** `profile.lock` (QĐ cũ) chỉ đọc file trong thư mục profile **cục bộ** — 2 VPS mỗi
máy giữ 1 bản copy profile thì không máy nào thấy máy kia. Chạy trùng 1 profile trên 2 máy
là **nguyên nhân số 1** khiến TikTok hủy phiên. Sheet đã được chia sẻ sẵn giữa các máy nên
tận dụng làm nơi "thấy nhau", không cần thêm hạ tầng.

**Sự cố thật phát sinh ngay khi triển khai (2026-07-28), và cách sửa:**

1. **"Chạy đã chọn" 5 profile → chỉ profile đầu chạy, 4 profile sau không phản ứng gì.**
   Nguyên nhân: `httpRequest` (dùng chung cho mọi lời gọi Google API, kể cả `sheets.cjs`)
   **không có timeout nào**. `sheet-lock.check()` nằm trên đường chặn của IPC
   `profile-start`; renderer chạy **tuần tự** (`for...await`) khi bấm "Chạy đã chọn" — 1
   request bị treo (không lỗi hẳn, cũng không xong) làm **cả vòng lặp đứng yên vĩnh viễn**,
   các profile sau không bao giờ được thử.

   Sửa 2 lớp:
   - `google-api.cjs`: `httpRequest` giờ có `timeoutMs` (mặc định 10s).
   - `main.js`: thêm `withDeadline()` — trần thời gian **độc lập** ở đúng điểm gọi quan
     trọng nhất (8s), để dù tầng dưới có lỗi gì, nơi gọi cũng không bao giờ chờ quá hạn.

   **Bài học kỹ thuật quan trọng**: lần sửa đầu dùng `req.setTimeout()` của Node — kiểm bằng
   test thật (không mock) mới phát hiện nó **không phủ được giai đoạn đang kết nối**
   (DNS/TCP handshake treo) — đo được request treo **21 giây** thay vì 500ms đặt ra. Phải
   đổi sang `setTimeout()` JS thuần (đếm từ lúc gọi hàm, không phụ thuộc trạng thái socket)
   mới đảm bảo đúng hạn ở **mọi** giai đoạn. Nếu chỉ test bằng mock (như các test khác
   trong dự án) sẽ **không bao giờ bắt được lỗi này** — mock không mô phỏng đúng hành vi
   treo ở tầng TCP thật.

2. **Nghi "xung đột" khi ghi lên Sheet.** Nguyên nhân: `configure()` reset trạng thái
   (`_tabReady=false`) **vô điều kiện** mỗi lần gọi — mà nó được gọi lại ở MỖI lần bấm Chạy.
   Kết hợp `_ensureTab()` không có khóa chống gọi đồng thời: 2 profile khởi động gần nhau
   (hoặc trùng với nhịp tim định kỳ 60s) đều thấy tab **chưa tồn tại** → **cả hai cùng gửi
   lệnh tạo tab** → Google chấp nhận lệnh đầu, từ chối lệnh sau vì trùng tên.

   Sửa 2 lớp: `configure()` chỉ reset khi cấu hình **thực sự đổi** (so `spreadsheetId`+`sa`);
   `_ensureTab()` cache lời gọi đang dở dang (in-flight promise) — gọi đồng thời nhận cùng
   một promise thay vì tạo lệnh mới.

**Triết lý xử lý lỗi (giống `ip-guard.cjs`) — chỉ CHẶN khi chắc chắn:**

| Tình huống | Xử lý |
|---|---|
| Máy khác đang giữ, nhịp tim tươi | **CHẶN** — nói rõ tên máy kia |
| Mạng/API lỗi, hoặc quá 8s chưa có phản hồi | **KHÔNG chặn** — không được để cả dàn máy đứng im vì Sheet chậm/lỗi tạm thời |
| Chưa cấu hình Sheet | **KHÔNG chặn** — bỏ qua hoàn toàn |

**Nhả khóa:** khi profile dừng **hẳn** (`status === 'stopped'`) — KHÔNG nhả khi canh IP tạm
dừng (`status === 'error'` của QĐ-17, profile vẫn đang sống chờ VPN). Nếu app bị giết đột
ngột (mất điện, AV kill) thì khóa **tự hết hạn sau 3 phút** vì nhịp tim chỉ ghi cho profile
đang chạy — không kẹt vĩnh viễn.

**Tách `google-api.cjs`:** phần xác thực Service Account (ký JWT, cache token) tách khỏi
`sheets.cjs` để `sheet-lock.cjs` dùng chung — tránh lặp lại đúng bẫy QĐ-10 (2 bản sao token
cache nghĩa là gấp đôi số lần xin token).

**Kiểm chứng:** `test/sheet-lock.test.js` (30 assertion, mock HTTP) + `test/google-api-timeout.test.js`
(9 assertion — bài test #4 gọi **thật** tới `192.0.2.1` — địa chỉ dành riêng cho tài liệu/kiểm
thử, RFC 5737, đảm bảo không bao giờ có máy thật ở đó — để xác nhận timeout hoạt động trên
mạng thật, không chỉ qua mock).

**Bổ sung (2026-07-28, cùng ngày) — ẨN tab `_locks`:** người dùng phản đối việc tab `_locks`
hiện ra trên thanh tab của Sheet chính (nhìn thấy ngay khi mở Sheet, giữa các tab dữ liệu
thật). Yêu cầu: không muốn thấy tab lạ, nhưng vẫn cần thông báo rõ khi phát hiện profile
chạy trùng ở máy khác. Vì không có hạ tầng dùng chung nào khác ngoài chính Sheet đó (6 VPS
không có kết nối trực tiếp với nhau), giải pháp dung hòa: tạo tab `_locks` với thuộc tính
`hidden: true` của Google Sheets API — dữ liệu vẫn nằm trong đúng spreadsheet đó (không cần
Sheet thứ hai), nhưng **không hiện trên thanh tab** khi mở bình thường (vẫn xem được qua
"Hiện tất cả trang tính" nếu cần soi dữ liệu).

Tab đã được tạo trước khi có `hidden:true` (như trường hợp thật của người dùng) → app **tự
ẩn lại** ở lần `_ensureTab()` kế tiếp mà không cần vào Sheet sửa tay: đọc metadata kèm
`hidden`, thấy tab tồn tại nhưng chưa ẩn thì gửi `updateSheetProperties` để ẩn nó.

---

## QĐ-20 — Sheet >130.000 dòng: trần thời gian riêng cho đọc lớn + tạm dừng đẩy tự động khi chưa nạp được + công cụ dọn trùng thủ công

**Bối cảnh:** sau QĐ-19, người dùng thực tế có tab dùng để lọc trùng (`Total_Link_Voice`)
đã tích lũy **>137.000 dòng** (nhiều VPS cùng đẩy vào 1 Sheet lâu ngày). Phát sinh 2 sự cố
mới, và người dùng phát hiện thêm 1 cặp dòng bị trùng thật trên Sheet.

**Sự cố 1 — đọc cột B để lọc trùng bị timeout thật (không phải bug treo cũ).** Trần 25s
(mặc định của `httpRequest` sau QĐ-19) không đủ để Google trả hết dữ liệu cho 1 lần đọc
nguyên cột B cỡ 137k dòng — đây là **chậm chính đáng do khối lượng dữ liệu**, không phải
kết nối bị treo. Sửa: `readLinks()` trong `sheets.cjs` dùng trần thời gian **riêng, dài hơn
hẳn** (`READ_LINKS_TIMEOUT_MS = 120000`, 2 phút/lần thử, thử tối đa 2 lần) thay vì trần
chung — an toàn vì hàm này không nằm trên đường chặn "chạy tất cả" (chỉ profile đầu phiên
gọi) và nút "Đẩy lên Sheet" đã tự hiện "⏳ Đang đẩy..." nên chờ lâu hơn vẫn chấp nhận được.

**Sự cố 2 — đẩy tự động vẫn chạy dù chưa nạp được danh sách link cũ (nguyên nhân gây
trùng thật).** Nếu lần đọc Sheet đầu phiên thất bại (đúng như Sự cố 1 khi còn trần 25s),
`_knownLinks` rỗng — nhưng code cũ vẫn cho `enqueue()` đẩy tự động, coi **mọi link là mới**
vì "không biết" link nào đã có → đẩy trùng. Sửa: thêm cờ `isSeeded()` trong `sheets.cjs` —
`enqueue()` **tạm dừng đẩy tự động** cho tới khi có ít nhất 1 lần `updateKnownLinks()` thành
công (nạp lúc đầu phiên, hoặc lần đồng bộ định kỳ kế tiếp — vòng lặp 60s trong `main.js` tự
thử lại liên tục cho tới khi thành công vì `_lastReseedAt` chỉ cập nhật khi đọc OK). Dữ liệu
thu thập trong lúc chờ **không mất** — vẫn hiện đủ trong bảng ở app, có thể đẩy tay qua nút
"Đẩy lên Sheet" (tự đọc lại mới nhất trước khi đẩy, không phụ thuộc cờ `isSeeded`).

**Phát hiện thêm — 1 cặp dòng trùng thật đã tồn tại sẵn trên Sheet** (link giống hệt ở dòng
468 và dòng 139616, 2 profile khác nhau). Rất có thể là di sản của đúng Sự cố 2 từ trước khi
vá (đẩy mù lúc `_knownLinks` rỗng). Nhưng về nguyên tắc, **không thể loại bỏ 100%** khả năng
trùng chỉ bằng cách đọc kỹ hơn: nếu 2 máy cùng phát hiện 1 sound đang trend trong khoảng
thời gian giữa 2 lần đồng bộ định kỳ (mặc định 5 phút) — trước khi máy này kịp thấy máy kia
vừa đẩy — cả hai vẫn hợp lý coi đó là link mới và cùng đẩy. Đọc lại Sheet trước MỌI lần đẩy
(như "Đẩy lên Sheet" làm) sẽ đóng hoàn toàn khoảng hở này nhưng không khả thi cho đẩy tự
động realtime (phải đọc 137k dòng trước mỗi sound — quá chậm). Đây là giới hạn thật của
kiến trúc "dùng Sheet chung làm kho dữ liệu" (không có ràng buộc duy nhất/khóa nguyên tử
như database thật), không phải lỗi có thể vá triệt để.

**Quyết định — công cụ "🧹 Dọn trùng trên Sheet"** (bổ sung, không thay thế cơ chế phòng
ngừa ở trên): thêm `scanDuplicates()` / `deleteRows()` / `cleanDuplicates()` vào
`sheets.cjs`, expose qua modal ☁ Google Sheet.

- `scanDuplicates()`: đọc **toàn bộ** tab (`A:Z`, không chỉ cột B) — đọc rộng để biết dòng
  nào có dữ liệu **người dùng tự ghi** ở cột E trở đi (theo USER_GUIDE.md, các cột này để
  trống cho người dùng tự dùng). Gom theo `normalizeKey(Link)`, với mỗi nhóm trùng: giữ lại
  dòng có **nhiều dữ liệu tự ghi nhất** (tránh xóa nhầm mất ghi chú tay), ngang nhau thì giữ
  dòng **cũ hơn** (số dòng nhỏ hơn). Chỉ tính toán, KHÔNG xóa gì — dùng để hiện xem trước.
- `deleteRows()`: xóa thật qua `batchUpdate` + `deleteDimension`. Bắt buộc xóa theo thứ tự
  **giảm dần theo số dòng** — nhiều request `deleteDimension` trong cùng 1 `batchUpdate`
  được Google áp dụng **tuần tự** lên trạng thái hiện có, xóa dòng nhỏ trước sẽ làm lệch
  index của mọi dòng lớn hơn còn lại trong cùng lần gọi.
- `cleanDuplicates()`: gọi lại `scanDuplicates()` từ đầu rồi mới xóa (KHÔNG dùng kết quả
  scan cũ do renderer truyền vào) — tránh xóa nhầm nếu Sheet đã đổi giữa lúc người dùng xem
  trước và lúc bấm xác nhận (máy khác vừa đẩy/xóa thêm dòng).
- **Luồng 2 bước ở renderer** (`cleanSheetDuplicates()` trong `renderer.js`): bấm nút →
  gọi `sheets-scan-duplicates` (chỉ đọc) → hiện `confirm()` với số liệu cụ thể (bao nhiêu
  nhóm trùng, sẽ xóa bao nhiêu dòng) → chỉ khi người dùng xác nhận mới gọi
  `sheets-clean-duplicates` (xóa thật). Đây là hành động **xóa dữ liệu thật, không thể hoàn
  tác** trên Sheet sản xuất của người dùng nên bắt buộc phải có bước xác nhận rõ ràng, không
  tự động chạy ngầm.

**Kiểm chứng:** `test/sheets-readlinks.test.js` (10 assertion — trần thời gian riêng +
retry + `isSeeded` gating) và `test/sheets-clean-duplicates.test.js` (20 assertion — ưu
tiên giữ dòng có ghi chú tay, thứ tự xóa giảm dần, `cleanDuplicates()` tự đọc lại từ đầu).

---

## Những điều KHÔNG nên làm lại

| Đã thử | Kết quả |
|---|---|
| Tinh chỉnh giảm số tiến trình Firefox (`dom.ipc.processCount=1`…) | Gây crash "Your tab just crashed" — đừng chống lại mô hình đa tiến trình |
| Tự tính số dòng rồi ghi cứng lên Sheet | 2 máy ghi đè lẫn nhau |
| Chuyển sang chế độ hiện để tránh bị chặn trang đếm | Đã A/B test: ẩn và hiện giống hệt nhau, không phải nguyên nhân |
| Gọi `ctx.storageState()` định kỳ | Nhấp nháy cửa sổ liên tục (mở trang tạm cho từng origin) |
| `scrollIntoView` để thoát kẹt feed | Vô tác dụng — feed For You là băng chuyền CSS, không phải vùng cuộn |
| Cuộn feed bằng phím mũi tên xuống | **Đã ngừng tác dụng hoàn toàn** — xem QĐ-13, dùng con lăn chuột |
| Click vào trang để "lấy con trỏ" rồi gửi phím | Làm hỏng trạng thái trang, sau đó không đọc được sound nào |
| Để `viewport: null` cho context crawl | Cửa sổ ẩn ra 800×600 → TikTok đổi bố cục, mất nút điều hướng — xem QĐ-14 |
| Chép bản sao vòng quét feed cho từng chế độ | 4 bản đã lệch nhau ở 3 điểm (mất log, Dừng chậm 10s, cuộn thừa) — xem QĐ-16 |
| Để bảng `width:100%` mà không có `min-width` | Table tự bóp cột: ở 960px cột Trạng thái còn 55px, chữ bị cắt, chỉ thấy 1/5 profile |
| Chỉ đặt `overflow-y` cho khung bảng | Bảng rộng hơn khung bị **cắt mất**, không cách nào cuộn tới — phải `overflow: auto` |
| Tin nhãn quốc gia profile là đủ khi chạy VPS | VPN tụt là khai giờ nước A trên IP nước B — xem QĐ-17 |
| Để repo phát hành public "chỉ chứa .exe" cho tiện tự cập nhật | `.exe` chứa `app.asar` → extract ra trọn source, coi như công khai mã nguồn — xem QĐ-18 |
| Gọi Google API mà không đặt `timeoutMs` | Kết nối treo (không lỗi hẳn) làm cả vòng lặp tuần tự đứng yên vĩnh viễn — xem QĐ-19 |
| Dùng `req.setTimeout()` của Node để bắt request bị treo | KHÔNG phủ được giai đoạn đang kết nối (DNS/TCP) — đo được treo 21s dù đặt 500ms; phải dùng `setTimeout()` JS thuần — xem QĐ-19 |
| Reset trạng thái cache vô điều kiện mỗi lần gọi `configure()` | 2 lệnh gọi gần nhau cùng thấy "chưa khởi tạo" → cùng thực hiện việc tạo 1 lần (vd tạo tab) → xung đột — xem QĐ-19 |
| Chỉ test cơ chế timeout bằng mock | Mock không mô phỏng đúng hành vi treo ở tầng TCP thật — phải có ít nhất 1 test gọi tới địa chỉ mạng thật (RFC 5737: `192.0.2.1`) mới bắt được lỗi `req.setTimeout()` ở trên |
| Cho `enqueue()` đẩy tự động dù chưa đọc được danh sách link cũ | `_knownLinks` rỗng → coi mọi link là mới → đẩy trùng thật trên Sheet sản xuất — xem QĐ-20 |
| Xóa dòng trên Sheet theo thứ tự tăng dần (dòng nhỏ trước) trong 1 `batchUpdate` | `deleteDimension` áp dụng tuần tự lên trạng thái hiện có — xóa dòng nhỏ trước làm lệch index mọi dòng lớn hơn còn lại trong cùng lần gọi — xem QĐ-20 |
| Tin ngay nhà cung cấp định vị IP ĐẦU TIÊN trả lời được, không đối chiếu nhà cung cấp còn lại | 1 nhà cung cấp bị chặn (Cloudflare) hoặc xếp nhầm quốc gia cho dải IP VPN/datacenter → chặn oan cả 5 profile dù VPN đúng vùng thật — xem QĐ-17 |
