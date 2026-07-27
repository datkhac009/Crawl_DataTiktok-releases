# Quyết định kiến trúc

> Ghi lại các quyết định quan trọng **và lý do** — đọc file này trước khi đề xuất thay đổi
> có thể xung đột. Cập nhật: 2026-07-27

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
