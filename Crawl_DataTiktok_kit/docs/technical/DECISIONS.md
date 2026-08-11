# Quyết định kiến trúc

> Ghi lại các quyết định quan trọng **và lý do** — đọc file này trước khi đề xuất thay đổi
> có thể xung đột. Cập nhật: 2026-08-06 (bổ sung QĐ-07, QĐ-32, QĐ-33)

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

### Bổ sung (2026-08-06): THỬ LẠI trọn vòng 1 lần — đảo ngược phần "không retry"

**Quyết định:** cả 2 bước trượt mà sound **còn sống** → mở lại trang `/music/` và làm lại **cả 2
bước**, tối đa `COUNT_READ_ATTEMPTS = 2` lượt. Hết lượt vẫn trượt → tab chờ (QĐ-33) như cũ.

**Vì sao đảo ngược:** trang lỗi của TikTok ghi thẳng *"Something went wrong — Sorry about that!
Please try again later"* kèm nút **Refresh** — **chính TikTok khai đây là lỗi TẠM THỜI**. App cũ
bỏ ngay sau 1 lượt, nên mỗi lỗi tạm thời = 1 sound mất hoặc 1 dòng người phải kiểm tay.

**Không mâu thuẫn với QĐ-07:** QĐ-07 chặn việc **ghi số không chắc** vào dữ liệu. Thử lại rồi đọc
được **số thật** không tạo dòng bẩn nào. Câu "không retry" trong bản gốc là **phương tiện**, mục
đích là "dữ liệu sạch" — phương tiện thay được, mục đích thì không.

**Giới hạn đã cân:**

| Điểm | Lựa chọn | Lý do |
|---|---|---|
| Chỉ 2 lượt | Không nhiều hơn | Thử mãi = tự dội IP mình, đúng cái gây chặn |
| **Không** thử lại khi sound đã xóa (`10201`) | Bỏ ngay | Xóa rồi thì lượt 2 cũng thế — tốn request vô ích |
| **Không** thử lại khi lượt 1 đã đọc được | Bỏ qua | Tự tăng tải vô cớ |
| **Giữ nguyên** slot đếm suốt các lượt | Không nhả rồi xin lại | Slot để hãm nhịp request `/music/` từ 1 IP; lúc TikTok đang lỗi thì chậm lại là **đúng hướng** |
| `TTC_COUNT_ATTEMPTS=1` | Tắt được không cần build lại | Nếu đo thấy retry gây hại thì tắt ngay trên VPS |

**Cũng sửa cùng lúc — `statusCode` lạ không còn bị bỏ qua trong IM LẶNG.** Code cũ chỉ có comment
*"Trường hợp khác (statusCode lạ) → để raw=null"* và **không log gì**. Hệ quả thật: mã `10203`
(đo 2026-08-06, body chỉ 205 byte, không có `musicInfo`) tồn tại không biết bao lâu mà không ai
hay — tôi chỉ tình cờ thấy khi đo tay một link người dùng gửi. Nay ghi rõ mã + độ dài body vào
log, để sau vài ngày có **dữ liệu thật** mà phân loại thay vì đoán.

⚠️ **Việc còn nợ:** lỗi CỦA LINK (`statusCode` lạ) và BỊ CHẶN (không có response nào) vẫn đang bị
gộp — cả hai cùng tăng `failStreak` nên cùng bị **phạt tốc độ toàn cục**. Nghĩa là gặp vài link
`10203` liền nhau là app tự làm chậm **mọi profile** dù TikTok chẳng chặn gì. Chưa tách vì chưa
biết `10203` phổ biến đến đâu — chờ log ở trên có số liệu rồi mới sửa, không đoán.

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

**Bổ sung (2026-08-03) — ĐỌC TĂNG DẦN phần đuôi, cửa sổ trùng co từ 5–15 phút xuống ~1 phút.**
Đánh đổi ở trên đã thành sự cố thật: người dùng chạy 2 máy với profile cùng vùng (UK/KR/US),
ảnh chụp Sheet cho thấy nhiều dòng trùng. Người dùng tự chẩn đoán đúng gốc rễ: *"cả 2 máy đều
lấy API từ sheet về, nhưng khi quét thì cả 2 đều trả về 1 sound rồi đẩy lên"*.

Gốc rễ là **ĐỘ TRỄ BIẾT TIN**, không phải logic lọc sai: đọc lại **toàn bộ** cột B của tab
156.000 dòng mất hàng chục giây nên chỉ dám chạy 5–15 phút/lần. Nghịch lý: muốn giảm trùng thì
phải đọc dày hơn, mà đọc dày hơn thì càng nặng/càng dễ timeout (QĐ-20 đã gặp).

Cách thoát nghịch lý: dòng mới **luôn được append vào CUỐI** tab (QĐ-08) → chỉ cần đọc **phần
đuôi** kể từ mốc lần trước (`readLinkColumn({ startRow })`). Vài trăm dòng thì rẻ + nhanh →
chạy được **mỗi phút**, vừa nhanh hơn 5–15 lần vừa **nhẹ hơn** cách cũ.

- `rawRows` (số dòng THÔ, kể cả dòng rỗng) mới là thứ tính mốc — **không** dùng
  `links.length` vì nó đã lọc bỏ dòng rỗng → mốc lệch dần, đọc lặp vô ích (có test riêng).
- Vẫn đọc lại **toàn bộ** thưa hơn (`reseedMinutes`, mặc định đổi 5 → **10 phút**) để đồng bộ
  lại mốc: nút "🧹 Dọn trùng trên Sheet" hoặc người dùng tự xóa dòng làm mọi dòng phía sau
  **dịch lên** → đọc từ mốc cũ sẽ bỏ sót.
- Nhãn cài đặt đổi thành *"Đọc lại toàn bộ Sheet mỗi X phút"* cho khớp nghĩa mới.

**Bổ sung lần 2 (2026-08-03, cùng ngày) — ĐỌC MỚI NHẤT NGAY TRƯỚC KHI GHI.** Người dùng nêu
đúng phần còn hở: *"2 máy chủ quét cùng 1 link, máy kia quét check xong đẩy lên trước, xong
máy kia quét check xong đẩy lên → bị trùng"* — đọc định kỳ mỗi phút vẫn hở đúng 1 phút đó.

Sửa: `flush()` gọi `refreshKnownLinks()` **ngay trước khi append**, rồi **lọc lại lô** một lần
nữa. Máy đẩy SAU nhìn thấy dòng máy trước vừa ghi và tự bỏ → cửa hở co từ ~1 phút xuống còn
đúng thời gian của 1 request (dưới 1 giây). Rẻ vì chỉ đọc vài dòng mới kể từ mốc.

Nguyên tắc đi kèm:
- **Lỗi mạng ở bước đọc này KHÔNG được chặn việc ghi** — thà chấp nhận cửa hở như cũ còn hơn
  nghẽn/mất dữ liệu. Chỉ ghi log rồi đi tiếp (có test).
- Khi append lỗi, chỉ trả **phần thực sự định ghi** về buffer — số bị bỏ vì máy khác đã đẩy thì
  KHÔNG đẩy lại nữa.
- **Mốc dòng nằm ở MỘT NƠI DUY NHẤT** (`sheets.cjs`), có gộp lời gọi trùng (`_refreshInFlight`).
  Ban đầu tôi để mốc ở cả `main.js` lẫn `sheets.cjs` → đúng bẫy QĐ-10 (2 bản sao SẼ lệch) và
  2 nơi cùng đọc sẽ cùng đẩy mốc → **nhảy qua mất dòng chưa đọc**. Đã gộp về `sheets.cjs`.
- Đầu phiên dùng `refreshKnownLinks({ full: true })` chứ không phải `readLinks()`: vừa nạp bộ
  lọc vừa **đặt mốc**, nếu không thì lần đẩy đầu tiên lại đọc lại 156.000 dòng lần nữa.
- `configure()` chỉ quên mốc khi **thực sự đổi** Sheet/tab — reset vô điều kiện là lặp lại bẫy
  QĐ-19 (configure được gọi ở mỗi lần bấm Chạy).

**Thành thật về giới hạn còn lại:** vẫn **KHÔNG thể về 0 tuyệt đối**. Google Sheets không có
phép "giành quyền" nguyên tử (atomic claim): nếu 2 máy đọc-rồi-ghi **lồng vào nhau trong cùng
dưới một giây** thì cả hai vẫn thấy "chưa có" rồi cùng ghi. Cửa sổ đã co từ 5–15 phút xuống
dưới 1 giây, nhưng không phải 0. Trùng còn sót thì dọn bằng nút "🧹 Dọn trùng trên Sheet" (QĐ-20).

**Bài học test (2026-08-03):** helper test ban đầu dùng `76000000000000000 + n` để sinh ID sound
— con số này **vượt `Number.MAX_SAFE_INTEGER`** (~9.007e15) nên mọi `n` cho ra **cùng một số** →
mọi link test giống nhau → bộ test `sheets-incremental` **pass một cách vô nghĩa**. Phải ghép
CHUỖI khi dựng ID dài. Chính lỗi này che mất việc `flush()` chưa hoạt động ở lần chạy đầu.

**Đã cân nhắc và LOẠI — chia vùng ID theo máy** (máy i chỉ lấy sound có `id % N == i`): diệt
trùng liên máy 100% *bằng thiết kế*, nhưng mỗi máy phải bỏ (N−1)/N số sound quét được → với 6
máy là bỏ 5/6. Bước đếm vốn đã là cổ chai (QĐ-21) nhưng bước QUÉT thì có hạn (~20 lần lướt/phút)
nên hàng đợi đếm sẽ bị bỏ đói → **tổng sản lượng cả dàn giảm mạnh**. Không đáng.

---

## QĐ-10 — Hàm chuẩn hóa link để ở một nơi duy nhất

**Quyết định:** `canonicalSoundUrl` + `normalizeKey` nằm trong `src/linkkey.cjs`, cả
crawler và sheets cùng dùng.

**Lý do:** Trước đây mỗi file giữ một bản sao và **đã lệch nhau thật** — crawler được thêm
rút gọn link nhưng bản trong sheets không cập nhật theo, khiến nút đẩy bù coi link dài và
link ngắn là 2 sound khác nhau.

**Bài học chung:** Khi có ≥2 bản sao của cùng một logic, chúng **sẽ** lệch nhau. Đây cũng là
nguyên nhân của bug mất dòng log khi sao chép vòng cuộn giữa các chế độ.

**Bổ sung (2026-07-30) — `normalizeKey()` giờ so trùng theo ID, không theo nguyên văn URL.**
Sự cố thật: 1 sound là bài hát có bản quyền (slug tiếng Thái) bị đẩy trùng lên Sheet dù đã
lọc cả lúc quét lẫn lúc đẩy. Nguyên nhân: `canonicalSoundUrl()` cố tình **giữ nguyên slug**
cho bài hát có bản quyền (chỉ rút gọn `original-sound`/`nhạc-nền` về `/music/original-sound-
<id>`) — để URL lưu/hiển thị vẫn đọc được tên bài. Nhưng `normalizeKey()` cũ chỉ
`.toLowerCase()` nguyên văn URL đó để so trùng — TikTok đôi khi trả về **slug hơi khác nhau
cho cùng 1 ID** (viết hoa/thường không xử lý hết, dấu nháy thẳng/cong, chuẩn hóa Unicode khác
nhau cho chữ không phải Latin) → 2 lần gặp cùng sound bị coi là 2 sound khác nhau.

Sửa: `normalizeKey()` giờ **trích riêng số ID cuối URL `/music/...-<id>`** làm khóa so trùng —
dùng chung cho cả `original-sound` lẫn bài hát bản quyền, bất kể slug khác nhau thế nào.

**Bổ sung lần 2 (2026-07-30, cùng ngày) — `canonicalSoundUrl()` rút gọn MỌI link theo ID.**
Đoạn trên ban đầu ghi *"vẫn không đụng đến `canonicalSoundUrl()`, bài hát bản quyền vẫn giữ
slug đọc được"* — **điều đó đã thay đổi trong cùng ngày**, ghi lại để không hiểu sai.

Sự cố thật tiếp theo: cùng 1 profile chạy trên 2 máy cho ra link **định dạng khác nhau** —
máy dev ra link ngắn chuẩn, máy ảo ra `/music/оригинальный-звук-7648030600474299169`. Nguyên
nhân **không phải** máy/phiên bản khác nhau (người dùng đã nghi ngờ đúng hướng này và loại
trừ): TikTok gắn nhãn "original sound" theo **ngôn ngữ của NGƯỜI ĐĂNG video**, không theo
người xem. Feed mỗi máy phục vụ nội dung theo IP/vùng VPN khác nhau → máy ảo gặp nhiều sound
của tác giả nước ngoài hơn nên lộ lỗi. Liệt kê nhãn theo từng thứ tiếng để rút gọn là bắt cóc
bỏ đĩa (TikTok hỗ trợ hàng chục ngôn ngữ).

Quyết định (người dùng chốt): `canonicalSoundUrl()` rút gọn **MỌI** link `/music/` về
`/music/original-sound-<id>` **theo ID**, bỏ hoàn toàn phần chữ — độc lập tuyệt đối với ngôn
ngữ/slug. TikTok resolve trang sound theo ID, phần chữ bị bỏ qua nên link vẫn mở đúng.

⚠ **BẪY đi kèm, đã chặn:** `addSound()` trước đây gọi `isOriginalSound(url, name)` với `url`
**đã rút gọn**. Sau thay đổi này, mọi link đều chứa `original-sound-` → bộ lọc "Chỉ lấy
Original Sound" sẽ **mất tác dụng hoàn toàn, toàn bộ nhạc bản quyền lọt vào dữ liệu**. Đã
sửa `addSound()` xét **link GỐC** (`rawUrl`) và ghi chú cảnh báo ở cả 2 nơi
(`crawler.cjs`, `crawler/util.cjs`).

Đánh đổi đã biết và người dùng chấp nhận: URL của nhạc bản quyền giờ cũng mang tiền tố
`original-sound-` → **không còn nhìn URL mà biết được original hay bản quyền**; việc phân biệt
hoàn toàn dựa vào bộ lọc lúc quét.

**Bổ sung — nhãn "original sound" đa ngôn ngữ cho BỘ LỌC** (`ORIGINAL_SOUND_LABELS` trong
`crawler/util.cjs`): sound gốc của tác giả nước ngoài trước đây bị bộ lọc **loại oan** (coi là
nhạc bản quyền) vì chỉ nhận biết tiếng Anh + tiếng Việt — đây cũng là lý do máy ảo sản lượng
thấp hơn dù cùng profile. Đã thêm 22 ngôn ngữ. Người dùng chốt **giữ** cơ chế lọc thật (thay
vì bỏ lọc để nhận tất cả). ⚠ Danh sách này **best-effort, không đầy đủ**, chưa kiểm chứng
từng chuỗi khớp đúng chuỗi TikTok thật: thiếu nhãn nào thì sound đó bị loại oan (mất sản
lượng, **không** gây dữ liệu sai); thêm nhãn sai thì vô hại. Gặp link lạ dạng
`/music/<chữ nước ngoài>-<id>` thì bổ sung vào danh sách. **Việc rút gọn link KHÔNG phụ
thuộc danh sách này** — làm theo ID nên luôn đúng.

**Kiểm chứng:** `test/linkkey.test.js` (12 assertion — cùng ID/khác slug ra cùng key; mọi
ngôn ngữ rút gọn đúng, có cả link thật người dùng gửi) + `test/original-sound-filter.test.js`
(21 assertion — nhận biết đa ngôn ngữ, nhạc bản quyền vẫn bị loại, **và test chứng minh cái
bẫy "truyền link đã rút gọn" là thật** để không ai vô tình phá lại).

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
đăng nhập; sửa sai là mất đăng nhập trên cả dàn máy, mà khôi phục phải bấm 🦊 từng profile qua
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
mất cả đêm sản lượng trên cả dàn máy.

**Triết lý xử lý (giống `checkLoginState`) — không kết luận khi không chắc:**

| Tình huống | Xử lý |
|---|---|
| Lệch quốc gia rõ ràng | Tạm dừng |
| Không tra được IP (mất mạng) | **KHÔNG chặn** — mạng lỗi vài giây không được làm treo cả dàn máy |
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
chạy trùng ở máy khác. Vì không có hạ tầng dùng chung nào khác ngoài chính Sheet đó (các VPS
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

## QĐ-21 — Bật profile LẦN LƯỢT (không ồ ạt) + hạ trần hàng đợi đếm để 2 cột đi sát nhau

**Bối cảnh:** người dùng báo 2 việc, hóa ra liên quan nhau qua cùng một gốc là **tranh chấp
tài nguyên khi bật nhiều profile cùng lúc**.

**Vấn đề 1 — "Chạy đã chọn" bật ồ ạt, 1-2 profile ngẫu nhiên bị đứng không quét.**
`runSelected()` trong renderer *đã có* `await startProfileById(id)` nên trông như tuần tự,
NHƯNG `crawler.startProfile()` **trả về ngay** sau khi dựng xong — vòng crawl chạy nền, không
await. Nên `await` đó gần như vô nghĩa: 5 profile khởi động **gần như cùng lúc**, 5 context
cùng tải trang TikTok trên 1 Chromium dùng chung (QĐ-02) → CPU/RAM dội lên.

Đây chính là **gốc rễ** của hiện tượng mà QĐ-17 *(bổ sung 2026-07-30)* và bản v0.1.49 chỉ vá
được phần ngọn (nới trần chờ `page.evaluate` 5s → 15s trong `stuck.cjs`): profile "thua" trong
tranh chấp CPU bị chẩn đoán nhầm là "không đọc được trạng thái trang" → kích hoạt thoát kẹt →
tải lại trang → càng tốn CPU → vòng luẩn quẩn.

**Quyết định:** bật lần lượt — chờ profile vừa bật **quét được sound đầu tiên** rồi mới bật
profile kế tiếp (`waitProfileWarmedUp()`), với các chốt an toàn:
- **Trần 25s/profile** (`STAGGER_MAX_MS`) — 1 profile hỏng/feed kẹt KHÔNG được chặn cả dàn.
- Bỏ chờ ngay nếu profile đó đã dừng/lỗi (`!runningSet.has(id)`).
- Nghỉ tối thiểu 3s (`STAGGER_MIN_MS`) kể cả khi quét được ngay.
- Khóa nút "▶ Chạy đã chọn" + hiện tiến trình `▶ Đang bật 2/5...` trong lúc chạy lượt, tránh
  bấm chồng gây double-start.
- ⚠ `_runningSelectedBatch` phải khai báo ở **đầu file**, không để cạnh `runSelected`:
  `updateRunSelectedBtnState()` đọc biến này và được gọi rất sớm lúc dựng bảng → `let` nằm
  dưới sẽ vướng vùng chết (TDZ) → ReferenceError.

**Vấn đề 2 — "Quét 60 mà Đã check chỉ 5", người dùng tưởng lỗi.** KHÔNG phải lỗi: bước đếm
video bị **điều tiết TOÀN CỤC** (`count-throttle.cjs`, mặc định 2 request `/music/` đồng thời
cho **cả app**, không phải mỗi profile) để TikTok không chặn trang đếm — sự cố thật đã ghi
trong file đó: để cao thì cả 5 profile kẹt "nghỉ 300s". Chạy 5 profile → tốc độ đếm chỉ bằng
~1/5 tốc độ quét, khoảng cách là **tất yếu về mặt toán học**, không sửa code cho bằng được.

Người dùng gửi ảnh 5 profile có Quét == Đã check (705/705…) tưởng là phản bác, nhưng đọc cột
Trạng thái thì cả 5 đang **"Đã dừng (chu kỳ)"** — hết pha Quét nên `countLoop` tiêu hết hàng
đợi → bằng nhau. Hai quan sát nhất quán: lệch khi ĐANG quét, bằng khi NGƯNG quét. Ảnh đó thực
ra là **bằng chứng không mất dữ liệu** (hàng đợi rồi cũng được check hết).

Nhưng có 2 thứ **thật sự sai** và đã sửa:
1. **`QUEUE_MAX` 500 → 20.** Trần 500 cho backlog phình rất to trước khi quét tự dừng lại →
   khoảng cách 2 cột lớn, **và số chênh đó chính là số sound MẤT khi bấm Dừng cứng**
   (USER_GUIDE: *"Số sound sẽ mất khi dừng cứng = cột Quét − cột Đã check"*). Hạ xuống 20 →
   quét **tự điều tiết theo tốc độ đếm**, 2 cột luôn đi sát nhau, mất ít hơn hẳn.
   **KHÔNG giảm tổng sản lượng** — đếm vẫn là cổ chai, quét nhanh hơn chỉ để dồn hàng rồi mất.
2. **Vòng chờ khi hàng đợi đầy trước đây IM LẶNG hoàn toàn** — cột Quét đứng yên, không dòng
   trạng thái nào, trông y như app treo (đúng hiện tượng người dùng báo). Giờ báo rõ *"Tạm
   dừng cuộn — chờ đếm số video cho N sound đang xếp hàng..."* → *"Đếm đã theo kịp — cuộn
   tiếp..."*.

**Muốn CẢ HAI nhanh hơn** thì chỉ có một cách: nâng "Số luồng đếm video đồng thời" trong ⚙.
Đánh đổi có thật (càng cao càng dễ bị chặn trang đếm) nên **không tự nâng mặc định** — để
người dùng tự cân.

**Cân nhắc đã LOẠI:** cho `countLoop` chạy nhiều worker song song **mỗi profile**. Vô ích với
5 profile — trần toàn cục (2) mới là cổ chai, thêm worker không tăng thông lượng, mà mỗi
worker cần thêm 1 tab riêng → tốn RAM. Chỉ có lợi khi chạy 1-2 profile.

---

## QĐ-22 — Kết luận "chế độ KHÁCH" phải ỔN ĐỊNH mới được tin

**Sự cố thật:** nút **🔑 Kiểm tra đăng nhập** báo *"Đã đăng nhập"*, nhưng bấm **▶ Chạy** thì
app báo *"Profile đang ở chế độ KHÁCH"* và dừng hẳn. Dừng rồi chạy lại **~2 lần là bình
thường**. Cùng một profile, cùng một file session — hai luồng cho hai kết luận khác nhau.

**Nguyên nhân — BẤT ĐỐI XỨNG giữa 2 luồng** (cả hai dùng chung `_loadStorageState()` nên
KHÔNG phải do file session khác nhau):

| Luồng | Cách đọc trang | Kết quả |
|---|---|---|
| `verifyProfileLogin()` (nút 🔑) | Đọc lại tối đa **12 lần × 2s = 24s** | Kiên nhẫn, ra đúng |
| Luồng crawl (`checkLoginState`) | Đọc **MỘT LẦN DUY NHẤT** rồi chốt luôn | Gặp đúng nhịp là sai |

Chú thích sẵn có trong `verifyProfileLogin()` chính là bằng chứng bài học này đã từng được đo:
*"kiểm tra sớm quá sẽ ra 'unknown' (đã gặp: 9s chưa đủ, 20s đủ)"* — nhưng luồng crawl **không
được áp dụng cùng mức kiên nhẫn**. Trang TikTok trong lúc hydrate có thể hiện nút `Log in`
(`[data-e2e="top-login-button"]`) **thoáng qua** trước khi cookie được áp → đọc trúng nhịp đó
là kết luận KHÁCH và **dừng cả profile**. Chi tiết *"chạy lại 2 lần thì được"* khớp chính xác
với lỗi phụ thuộc thời điểm: lần sau trang đã có cache, hydrate nhanh hơn nên không kịp lộ nút.

**Quyết định:** thêm `checkLoginStateStable()` — **tin ngay tin TỐT, bắt tin XẤU phải ổn định**:
- Thấy `logged-in` → tin **ngay** (nav đã dựng + không có nút Log in = chắc chắn).
- Thấy `guest` → **chưa** kết luận; phải **3 lần đọc LIÊN TIẾP** (cách nhau 2s, ~4-6s) cùng nói
  guest mới chốt. Có `unknown` xen vào thì **đếm lại từ đầu**.
- Hết trần 20s mà chưa chắc → `unknown` → **KHÔNG chặn** crawl.
- Nhận `stop` và thoát ngay khi người dùng bấm Dừng — nếu không thì nút Dừng phản hồi chậm
  tới 20s (đã bắt được lỗi này ngay lúc triển khai, xem test #7/#8).

Đây đúng triết lý đã dùng ở **ip-guard** (2 nhà cung cấp phải đồng thuận mới chốt "lệch vùng")
và **sheet-lock** (chỉ chặn khi CHẮC CHẮN). Áp dụng cho **cả 3** điểm quyết định: kiểm lúc bắt
đầu (chế độ thường + pha Quét của chu kỳ) và `makeLoginWatcher` giữa lúc chạy — cắt một phiên
đang chạy tốt hàng giờ chỉ vì 1 lần đọc trúng nhịp hydrate là quá đắt.

**Giả thuyết phụ CHƯA kiểm chứng:** khi bật *"Không tải ảnh/video (giảm RAM)"*, luồng crawl
gắn `resource-blocker` **trước** khi mở trang, còn nút 🔑 thì **không** chặn gì. Chính
`resource-blocker.cjs` đã ghi cảnh báo *"chặn media làm TikTok đổi hành vi"*, nên trang thiếu
ảnh/font có thể hydrate khác đi và dễ lộ nút Log in hơn. Nếu sau bản vá này vẫn còn báo khách
oan → thử tắt *"Không tải ảnh/video"* để xác nhận, rồi cân nhắc chỉ gắn blocker **sau** khi
kiểm đăng nhập xong.

**Kiểm chứng:** `test/session-watch.test.js` (12 assertion — dựng lại đúng kịch bản nút Log in
nháy 1-2 nhịp rồi mất → phải ra `logged-in`; khách thật vẫn chốt `guest`; tôn trọng cờ Dừng).
`test/crawl-modes.test.js` kịch bản GUEST đã nới `runMs` 600ms → 9000ms cho khớp ngưỡng mới
(vẫn báo đúng lỗi chế độ khách).

---

## QĐ-23 — Lịch sử thu thập theo ngày: tự ghi vào `config/history.json`, không gộp liên máy

**Vấn đề:** người dùng muốn biết "hôm nay/mỗi ngày thu được bao nhiêu sound". **Không thể đếm
lại từ Google Sheet** vì Sheet KHÔNG có cột thời gian — muốn biết thì phải tự ghi ngay lúc thu.

**Quyết định:** `src/history.cjs` + nút **📊 Lịch sử** (modal bảng theo ngày).

| Chọn | Lý do |
|---|---|
| Đếm **cột "Hợp lệ"** (dòng vào bảng dữ liệu) | Đúng nghĩa "thu được". Không đếm số lướt, không đếm sound bị lọc bỏ |
| Ghi ở `config/history.json` **cạnh .exe** | Cùng quy ước `config/profiles.json` → chép máy/sao lưu mang theo được, và **không mất khi cập nhật `.exe`** (chỉ thay 1 file trong cùng thư mục). electron-store nằm sâu trong AppData, khó sao lưu/đối chiếu |
| Móc ở callback `onData` của `crawler.startProfile` (main.js) | Đúng một chỗ mọi sound hợp lệ đi qua. KHÔNG móc ở chỗ đẩy Sheet: người dùng có thể tắt đẩy Sheet nhưng vẫn muốn biết sản lượng |
| Ghi **trễ 5s** + **atomic** (tạm → rename) | Một đêm 5 profile thu vài trăm sound, ghi đĩa mỗi sound là vô ích. Atomic để app bị giết giữa lúc ghi không để lại file cắt cụt (như QĐ-04) |
| `flush()` ở `window-all-closed` **và** `before-quit` | Đóng app bằng đường nào cũng không mất số liệu đang chờ trong RAM |
| Ngày theo **giờ máy**, không UTC | Người dùng nghĩ theo ngày ở chỗ mình; các VPS đã đặt theo múi giờ vận hành |
| Giữ **400 ngày** rồi tự dọn | Hơn 1 năm để so cùng kỳ, file vẫn rất nhỏ (vài trăm byte/ngày) |

**⛔ RÀNG BUỘC BẮT BUỘC — lịch sử CHỈ lưu trong app, TUYỆT ĐỐI không đẩy lên Google Sheet**
(người dùng chốt 2026-08-03): không thêm tab, không thêm cột, không gọi Google API. Lý do:
(a) người dùng đã phản đối việc app tự thêm tab lạ trên Sheet của họ — QĐ-19 đã phải chuyển
tab `_locks` sang **ẩn** vì việc này; (b) tải Google API đang chính là điểm nghẽn (QĐ-20:
Sheet >130k dòng gây timeout thật). Ràng buộc được **thi hành bằng thiết kế**: `history.cjs`
chỉ `require` `fs` / `path` / `paths.cjs` — thấy ai thêm `google-api.cjs` hay `sheets.cjs`
vào file đó là SAI.

**Hệ quả đã chấp nhận — KHÔNG gộp liên máy:** số liệu là của riêng từng máy. Muốn tổng cả dàn
cả dàn (5 máy) thì cộng tay từng máy.

**Bài học layout bắt được nhờ chụp ảnh kiểm tra (không đoán mắt thường):** modal ban đầu dùng
lại `.result-table` của bảng dữ liệu chính — bảng đó có `min-width: 720px` (cố ý, cho 5 cột)
nên nhồi vào modal 520px là **ép sinh thanh cuộn ngang**, bó hết nội dung. Đã tách bộ style
riêng (`.history-table`/`.history-wrap`, modal 780px, `table-layout: fixed`). Dựng dữ liệu mẫu
9 ngày rồi **render thật trong Chromium + đo `scrollWidth - clientWidth`** ở 2 khổ (1180/720px)
mới phát hiện thêm 2 lỗi mà đọc code không thấy:
- `-webkit-line-clamp: 2` **cắt không sạch** — hở một dải của dòng bị cắt, trông như lỗi hiển
  thị (chiều cao dòng làm tròn lẻ). Đổi sang **1 dòng + ellipsis**, chi tiết xem bằng `title`.
- Trạng thái rỗng còn **dải trắng** vì khung tổng kết rỗng vẫn chiếm chỗ → ẩn hẳn khi rỗng.

**Kiểm chứng:** `test/history.test.js` (20 assertion — đếm đúng/tách theo profile, ghi trễ,
mở lại app không mất số cũ, **file hỏng không làm chết app**, dọn ngày quá hạn không xóa mất
hôm nay, tên profile rỗng gom vào "(không rõ)"). `npm run test:ui` vẫn 0/5 khổ lỗi layout.

---

## QĐ-24 — Cầu dao chống dội quota Google API + dùng Service Account RIÊNG cho từng máy

**Câu hỏi của người dùng (2026-08-03):** *"Nếu lượt call API nhiều quá nó sẽ bị nghẽn thì sao?
Bạn đã fix được lỗi đấy không và liệu có phải chia profile ra không?"* — hỏi đúng chỗ: các bản
vá chống trùng trong ngày (QĐ-09 bổ sung 1 & 2) **đã LÀM TĂNG số lần gọi API**, mà lúc đó app
**không có một dòng nào** xử lý 429/quota.

**Giới hạn thật của Google Sheets API v4:** 300 request/phút mỗi **project** và **60 request/phút
mỗi "người dùng"** — *người dùng* ở đây là **danh tính xác thực**, tức chính Service Account.
⚠ Cả **5 máy** (4 VPS + máy của người dùng, mỗi máy 5 profile theo khu vực) đang dùng
**CHUNG MỘT** file Service Account → hạn 60/phút áp cho **TỔNG cả 5 máy**,
không phải mỗi máy 60.

**Ước lượng tải sau các bản vá** (mỗi máy, mỗi phút):

| Nguồn gọi | Đọc | Ghi |
|---|---|---|
| Đồng bộ định kỳ (đọc tăng dần) | 1 | 0 |
| Mỗi lần `flush` (đọc-trước-khi-ghi + append) | ~2–3 | ~2–3 |
| Nhịp tim `sheet-lock` | 1 | 1 |
| **Tổng 1 máy** | **~4–5** | **~3–4** |
| **× 5 máy (chung 1 Service Account)** | **~20–25** | **~15–20** |

→ Ở tải bình thường vẫn **dưới 60/phút**, nhưng **không nhiều dư địa**. Lúc dồn dập (`flush` tối
đa mỗi 5s = 12 lần/phút → ~14 đọc/máy) thì 5 máy vẫn có thể vượt 60 → Google trả 429.

**Quyết định 1 — cầu dao `src/quota-guard.cjs`:** thấy 429 (hoặc 403 *có* chữ quota/rateLimit)
thì **mở cầu dao 60 giây** (bằng cửa sổ quota của Google) — mọi lời gọi **tự động** tạm ngưng:
- `refreshKnownLinks()` bỏ qua, **vẫn trả đúng mốc dòng** để hết cooldown đọc tiếp, không mất dòng.
- `flush()` **không ghi**, giữ nguyên lô trong bộ đệm và hẹn lại đúng phần cooldown còn lại
  (không hẹn 5s để khỏi tỉnh dậy vô ích 12 lần/phút).
- **Dữ liệu KHÔNG mất**: hết cooldown là lô cũ được đẩy tiếp (có test).

⚠ **403 phải soi nội dung, KHÔNG được coi mọi 403 là quota**: 403 còn nghĩa *"chưa chia sẻ Sheet
cho service account"* — báo nhầm thành quota sẽ **che mất** lỗi thiếu quyền, rất khó đoán ra
(đã có test riêng chốt điều này).

**Quyết định 2 (khuyến nghị vận hành, chưa làm) — mỗi máy một Service Account RIÊNG:** vì hạn
60/phút tính **theo từng Service Account**, tạo 6 service account và chia mỗi máy một cái sẽ
nâng trần từ 60 lên **60 × 5 = 300/phút** — bằng đúng hạn project (300/phút), tức dùng hết dư địa
Google cho phép. Không cần đổi code — chỉ dán JSON khác vào modal ☁ trên từng máy, và chia sẻ
Sheet cho cả 5 email đó (quyền Editor).

**Trả lời "có phải chia profile ra không": KHÔNG.** Chia profile **không giải quyết** vấn đề
quota: số lần gọi tỉ lệ với **lượng sound thu được** (mỗi lần `flush`) chứ không phải với số
profile — dồn profile về ít máy hơn thì giảm phần cố định (đồng bộ + nhịp tim) nhưng lại giảm
luôn sản lượng. Đúng chỗ cần chia là **Service Account**, không phải profile.

**Kiểm chứng:** `test/quota-guard.test.js` (21 assertion — nhận diện đúng 429/403-quota,
**không** nhầm 403-thiếu-quyền, mở cầu dao, không gọi thêm khi đang cooldown, và **lô chờ không
mất dữ liệu** sau khi hết chặn).

---

## QĐ-25 — Hiện SỐ DÒNG DATA trên Sheet ở dòng trạng thái, và không để nó xóa mất thông báo lỗi

**Yêu cầu người dùng (2026-08-03):** *"thay cái 5 profile chạy bằng số data lấy được từ Sheet"*
— câu `Đang chạy N profile.` vô ích (bảng phía trên đã cho biết profile nào đang chạy), thay
bằng **số dòng data thật đang có trên Sheet**, và *"data của Sheet thay đổi thì cũng phải
update vì có tận 5 máy cũng đang đẩy lên đó"*.

**Cập nhật ở 3 chỗ** để con số theo sát Sheet, không chỉ đúng lúc mới đọc:

| Thời điểm | Cách tính |
|---|---|
| Đọc lại **toàn bộ** (10 phút/lần) | Gán `= rawRows` — resync tuyệt đối, sửa mọi lệch |
| Đọc **phần đuôi** (mỗi phút) | `+= rawRows` — bắt được dòng **máy khác** vừa đẩy |
| Ngay sau khi **máy này** đẩy xong | `+= số dòng vừa ghi` — không phải chờ tới lần đọc sau |

**Cái bẫy đã chặn — KHÔNG được ghi đè thông báo lỗi.** Dòng trạng thái này **dùng chung** với
thông báo lỗi/cảnh báo (`Không đọc được Sheet...`, `Google Sheet: ...`). Nếu cứ 5 giây ghi đè số
dòng lên đó thì **lỗi bị xóa trước khi người dùng kịp đọc**. Nên chỉ ghi khi dòng đang "rảnh":
trống, `Chưa chạy`, hoặc đang là chính số dòng / câu `Đã nạp N link...`. Gặp lỗi thì **để nguyên
lỗi**. Đã kiểm chứng bằng render thật trong Chromium (có lỗi → nhận số mới → **vẫn giữ lỗi**).

**Đã cân nhắc và LOẠI — badge riêng.** Ban đầu tôi làm badge `Sheet: N dòng` cạnh badge
"Bỏ qua trùng" (bền hơn vì không bị ghi đè). Nhưng người dùng chốt đặt ở dòng trạng thái, và
giữ cả hai là hiện **trùng một thông tin ở 2 chỗ** → đã bỏ badge.

**Giới hạn đã biết:** vòng đồng bộ chỉ chạy **khi đang crawl** (`crawler.isAnyRunning()`), nên
dừng hết profile thì con số **đứng lại** cho tới lần chạy sau. Cố ý không poll khi rảnh để
không tốn quota vô ích (QĐ-24).

**Kiểm chứng:** `test/sheets-read-before-push.test.js` mục 9–11 (máy KHÁC đẩy 3 dòng → tăng
đúng 3; không ai đẩy → không tự nhảy; máy này đẩy → tăng ngay và lần đọc sau **không đếm
trùng**; đổi Sheet → reset 0).

---

## QĐ-26 — Lỗi "tab không tồn tại" phải nói thẳng, không để nguyên thông báo của Google

**Sự cố thật (2026-08-03):** app đóng gói báo
`đọc Sheet HTTP 400: {"error":{"message":"Unable to parse range: Data!B:B"}}` và **không
đọc/ghi được gì**. Nguyên nhân: ô **"Tên tab"** trong cấu hình để `Data` (giá trị mặc định)
nhưng Sheet của người dùng **không có tab nào tên đó** (tab thật: `Total_Link_Voice`).

Thông báo gốc của Google rất khó hiểu — *"Unable to parse range"* nghe như lỗi cú pháp, không
ai đoán ra là **thiếu tab**. Người dùng đã mất thời gian tưởng là bug code.

**Sửa:** bắt riêng `HTTP 400` + nội dung khớp `/unable to parse range/i` (ở **cả** đường đọc và
đường ghi) rồi ném ra thông báo chỉ đúng chỗ sửa: *"Không có tab tên "X" trên Google Sheet này.
Mở ☁ Google Sheet → sửa lại đúng "Tên tab" → Lưu. Bấm 🔌 Test kết nối để xem danh sách tab có
thật."*

⚠ **Bài học vận hành:** cấu hình của **app đóng gói** và **app dev** nằm ở 2 chỗ KHÁC NHAU
(`%APPDATA%/TikTokCrawler` vs `%APPDATA%/TikTokCrawler-Dev`). Lần này dev đúng tab mà bản đóng
gói vẫn sai → chẩn đoán bằng cách **đọc thẳng 2 file config** mới ra, đoán thì không ra. Xem
TROUBLESHOOTING.md mục 13.

**Kiểm chứng:** `test/sheets-read-before-push.test.js` mục 12 (dựng lại đúng phản hồi 400 của
Google → thông báo phải nói "Không có tab", nhắc đúng tên tab, chỉ chỗ sửa, và **không** để lọt
chữ "Unable to parse range").

---

## QĐ-27 — Chế độ "profile Chromium riêng" là CÔNG TẮC, mặc định TẮT

**Bối cảnh (2026-08-04):** profile hay bị TikTok hạ xuống chế độ khách. Người dùng đề nghị
chuyển hẳn sang FirefoxPortable cho đỡ ngốn RAM. Đo thật 3 profile chạy ẩn: **Chromium 8–10
tiến trình / ~3.2GB / CPU 23–32%** so với **Firefox 13 tiến trình / 4.6GB / CPU 60%** — Firefox
tốn HƠN, và code hiện tại vốn đã Chromium-only (`FirefoxPortable` chỉ còn là **rác đĩa
~2.6GB**, không dòng code nào đọc tới). Nên hướng "chuyển sang Firefox" bị loại.

Phương án còn lại để phiên bền hơn: **`chromium.launchPersistentContext`** — mỗi profile một
thư mục Chromium riêng, giữ được cả `localStorage`/`IndexedDB` chứ không chỉ cookie, nên giống
trình duyệt thật hơn và TikTok ít hủy phiên hơn.

**Quyết định:** làm nó thành **công tắc trong ⚙ Cài đặt crawl, mặc định TẮT**, chứ không thay
thế đường cũ. Lý do: `launchPersistentContext` **bắt buộc mỗi profile một Chromium riêng** →
mất hẳn lợi ích "1 Chromium dùng chung" của QĐ-02 (~+150–250MB/profile, 5 profile ≈ +1GB).
Máy đo lúc quyết định chỉ còn **2.2GB RAM trống** — bật mặc định là đổi một lỗi (mất phiên)
thành một lỗi nặng hơn (hết RAM, sập cả 5 profile). Có công tắc thì A/B test được trên **một**
máy trước khi áp cho cả 5.

**4 cái bẫy của chế độ này, đã xử trong code:**

| Bẫy | Xử lý |
|---|---|
| Một `user-data-dir` chỉ cho **MỘT** Chromium mở → mở tab đếm bằng trình duyệt ẩn riêng sẽ lỗi *"profile is already in use"* | `acquireCountContext` **dùng chung context của chính profile** (trả `{shared:true}`); `releaseCountContext` thấy `shared` thì **không đóng** — đóng là sập luôn tab đang quét |
| Nút 🦊 mở trình duyệt thứ hai trên cùng thư mục → cũng lỗi khóa | `getContext` **dùng lại đúng context đang crawl** nếu profile đang chạy; đăng nhập trong cửa sổ đó ghi thẳng vào profile |
| App bị giết giữa chừng để lại `SingletonLock`/`SingletonSocket` → lần sau Chromium **không mở nổi** (đúng phản đối của QĐ-03) | `_clearStaleLocks()` xóa các file khóa trước mỗi lần mở |
| Bật công tắc lần đầu = thư mục Chromium trống = **5 profile thành khách hết** | Lần đầu (chưa có `<dir>/Default`) thì **bơm cookie từ `session.state.json`** vào bằng `addCookies()` |

**Vẫn giữ `session.state.json`** dù Chromium đã tự lưu trạng thái: nó là bản sao **gọn
(~150KB)** để chép profile sang máy khác không phải mang cả thư mục Chromium, và để cơ chế
**phiên VÀNG** (`session.good.json`) tiếp tục làm đường cứu phiên. Vì vậy timer lưu 20s được
giữ ở **cả hai** chế độ.

**Vân tay dùng CHUNG một hàm** cho 2 chế độ (`_profileContextOptions`) — 2 đường tự dựng option
riêng là sớm muộn lệch vân tay, mà lệch vân tay giữa tab đếm và tab chính đúng bằng "1 phiên
đăng nhập, 2 thiết bị" → TikTok hủy phiên (QĐ-05).

**Đổi công tắc KHÔNG áp cho profile đang chạy** — chúng giữ chế độ cũ tới khi dừng (cờ chỉ đọc
lúc mở context). Đã ghi rõ ngay dưới công tắc để không tưởng là không ăn.

**Kiểm chứng:** `test/chromium-profile.test.js` — 26 khẳng định: mặc định TẮT, mở đúng thư mục
`<profile>/ChromiumProfile`, có `--disk-cache-size`/`--media-cache-size`, dọn `SingletonLock`,
vân tay khớp `contextOptions(fp)` từng khóa, lần đầu bơm đủ cookie xác thực + định tuyến, lần
sau **không** bơm lại, tab đếm không mở thêm trình duyệt và không bị đóng oan, tắt công tắc thì
quay về `chromium.launch()`.

**Bổ sung (2026-08-05) — TAB ĐẾM chỉ dùng chung context khi chạy ẨN; chạy HIỆN thì TÁCH ra
trình duyệt ẩn riêng.**

Bảng "4 cái bẫy" ở trên ghi đánh đổi: *"nếu chạy CHẾ ĐỘ HIỆN thì tab đếm sẽ hiện trong chính
cửa sổ của profile"*. Đánh đổi đó **người dùng không chấp nhận** — báo thật: bấm ▶ Chạy thì cửa
sổ profile hiện ra **HAI tab**, tab feed và tab `/music/original-sound-...` của bước đếm, trong
khi họ chỉ muốn thấy tab chính; "tab sound kia cho chạy ngầm".

⚠ **Lý do QĐ-27 nêu để BẮT dùng chung là một chẩn đoán SAI phạm vi.** Nó viết: *"mở tab đếm
bằng trình duyệt ẩn riêng sẽ lỗi profile is already in use"*. Điều đó chỉ đúng nếu mở thêm một
**persistent context trên CÙNG thư mục**. Nhưng đường tab đếm của chế độ thường KHÔNG làm thế:
`_ensureSharedHeadless()` gọi `chromium.launch()` — một Chromium riêng với `user-data-dir` tạm
của Playwright — rồi `_newProfileContext()` chỉ **ĐỌC** `fingerprint.json`, tuyệt đối không mở
`persistDir`. Cookie được copy từ context đang chạy, y hệt chế độ thường vẫn làm. **Không có
tranh chấp khóa nào.**

**Quyết định:** phân biệt theo `headless` của chính profile đó.

| Profile persistent chạy | Tab đếm | Vì sao |
|---|---|---|
| **ẨN** | Dùng chung context (như cũ) | Không ai thấy tab đếm, mà tiết kiệm đúng 1 instance Chromium |
| **HIỆN** | **Trình duyệt ẩn RIÊNG** | Tab `/music/` nhấp nháy trong cửa sổ người dùng đang xem là thứ họ báo lỗi |

Chi phí đúng bằng **1 instance cho CẢ APP**, không phải mỗi profile một cái — `_sharedHeadless`
là một trình duyệt dùng chung cho mọi tab đếm. Nên câu *"bù lại một phần RAM"* của QĐ-27 vốn đã
nhỏ hơn nó nghe.

Vân tay vẫn khớp: cả hai đường đi qua cùng `_newProfileContext(…, profilePath)` nên tab đếm
trình bày cùng thiết bị với tab chính — bắt buộc, vì hai bên xài chung cookie (QĐ-05).

**Vì sao chọn phân biệt theo `headless` chứ không tách cả hai:** tách cả hai thì mất luôn phần
tiết kiệm 1 instance ở trường hợp chạy ẩn (là cách chạy chính khi vận hành qua đêm), mà chẳng
giải quyết thêm gì — chạy ẩn thì vốn đã không ai thấy tab nào. Và nó khiến **49 khẳng định sẵn
có của `chromium-profile.test.js` phải sửa hàng loạt** (mọi ca trong đó đều `headless: true`),
tức mất lưới an toàn đúng lúc đang sửa phần dễ vỡ nhất. Cách này giữ nguyên cả 49 khẳng định.

**Kiểm chứng:** `test/chromium-profile.test.js` — **58 khẳng định** (49 cũ giữ nguyên không sửa
một chữ, + 9 mới ở mục 11): chạy HIỆN thì tab đếm **không** trả handle `shared` và **không** mở
thêm persistent context nào (chứng minh không đụng khóa thư mục); chạy ẨN thì **vẫn** dùng chung
— nửa sau này dễ bị "dọn dẹp" mất nhất nên phải có khẳng định giữ lại.

---

## QĐ-28 — "Profile Chromium riêng" là cài đặt RIÊNG TỪNG PROFILE, không phải toàn app

**Sự cố báo cáo (2026-08-04, ngay sau khi QĐ-27 ra bản v0.1.58):** người dùng mở ⚙ ở **một**
profile, tick công tắc, rồi mở ⚙ ở profile khác thì **thấy đã tick sẵn** → báo *"đang lỗi à?
tại sao tôi click bật riêng cho 1 profile mà các profile khác lại tick theo"*.

Không phải lỗi kỹ thuật — QĐ-27 cố tình làm nó **chung toàn app** (`store.chromium_profile`,
theo mẫu `count_concurrency`) vì cho rằng đây là quyết định cấp máy. Nhưng modal
"⚙ Cài đặt crawl" mở ra **từ hàng của một profile cụ thể**, nên đặt một công tắc toàn app vào
đó là **sai ngữ cảnh giao diện**: người dùng hiểu đúng theo cái họ thấy, và họ đúng.

**Quyết định:** chuyển thành cài đặt **riêng từng profile** (`profileSettings[id].chromiumProfile`).

Ngoài chuyện giao diện, riêng-từng-profile còn **tốt hơn về bản chất**:

1. **A/B test được trên MỘT máy.** QĐ-27 đề nghị "bật 1 máy, giữ 4 máy tắt" — nhưng 5 máy khác
   nhau còn khác cả IP/VPN/tài khoản nên so sánh không sạch. Bật 2 profile / tắt 3 profile trên
   **cùng một máy** thì cùng IP, cùng giờ, cùng phiên bản → so sánh mới có nghĩa.
2. **Chia được RAM theo mức quan trọng.** Máy 4GB không phải chọn "tất cả hoặc không gì": bật
   cho 1–2 profile hay mất phiên nhất, còn lại giữ chế độ nhẹ.

**Trộn 2 chế độ trên cùng máy là an toàn** — đã kiểm: profile bật có Chromium riêng, các profile
tắt vẫn dùng chung một Chromium (refs của browser dùng chung chỉ đếm nhóm tắt), và **tab đếm của
profile tắt vẫn mở trình duyệt ẩn riêng** chứ không ăn theo context của profile bật.

**Cách truyền cờ:** bỏ hẳn `browser.setPersistentProfiles()` (cờ module toàn cục), thay bằng
**option mỗi lần mở**: `acquireProfileContext(path, { headless, persistent })`,
`getContext(path, { persistent })`, `openForLogin(path, { persistent })`. Tab đếm không cần
truyền — nó tra `_profileCtx.get(profilePath).persistent` của profile đang chạy, nên **không thể
lệch** với chế độ mà profile đó thực sự đang mở.

⚠ **Nút 🦊 phải nhận cùng cờ với lúc crawl.** Nếu 🦊 mở ở chế độ khác thì đăng nhập xong lại
"không ăn" sang lượt chạy (đăng nhập vào thư mục Chromium mà lượt chạy lại đọc file cookie, hoặc
ngược lại). Renderer gửi kèm `chromiumProfile` của đúng profile đó; main.js còn tra lại
`profile_settings` trong store để phòng lời gọi cũ không gửi cờ.

**Bài học chung:** vị trí của một điều khiển trên giao diện **là một lời hứa về phạm vi của nó**.
Đặt cài đặt toàn app vào modal mở-từ-một-profile thì dù có ghi chữ "(toàn app)" ngay cạnh, người
dùng vẫn hiểu là của profile đó — và đó là cách hiểu hợp lý hơn.

⚠ **Nút 🔑 "Kiểm tra đăng nhập" vẫn kiểm bằng bản sao cookie**, không mở thư mục Chromium — cố ý:
mở thư mục sẽ đụng khóa khi 🦊 đang mở profile đó, làm hỏng cả lượt kiểm 25 profile. Hệ quả: với
profile bật chế độ này, 🔑 và 🦊 **có thể nói khác nhau** nếu `session.state.json` cũ hơn phiên
thật. Tin 🦊 (nó đọc cookie thẳng trong context, `_setSessionInfo(..., 'chromium-profile', ...)`).
Xem TROUBLESHOOTING.md mục 14.

**Kiểm chứng:** `test/chromium-profile.test.js` — 49 khẳng định (QĐ-27 có 36, thêm 13):
`setPersistentProfiles` phải **không còn tồn tại**; không truyền `persistent` thì đi đường cũ;
mục 9 dựng lại đúng cảnh **trộn 2 chế độ trên cùng máy** (profile bật mở Chromium riêng + tab đếm
dùng chung context, profile tắt vẫn mở trình duyệt ẩn riêng, không ăn theo nhau); mục 10 chốt việc
🦊 **vẫn báo được "đã đăng nhập / là khách"** ở chế độ này (từ lần chạy thứ 2 không còn đọc
`session.state.json` nên phải đọc cookie thẳng trong context, không thì mất hẳn chẩn đoán).

---

## QĐ-29 — Số dòng Sheet phải có Ô RIÊNG, không dùng chung với dòng thông báo

**QĐ-25 đã sai một nửa và nó hỏng ĐÚNG HAI LẦN theo cùng một kiểu.**

QĐ-25 cho số dòng Sheet ghi vào **cùng** `#crawlStatusMsg` với thông báo/lỗi, rồi phải thêm luật
"chỉ ghi khi dòng đang rảnh" để không xoá mất lỗi trước khi người dùng đọc. Luật đó đúng ý định
nhưng tạo ra một cái bẫy: **không có gì xoá câu đang đậu ở đó**, nên chỉ cần một câu bất kỳ ghi
vào là con số **không bao giờ hiện lại** cho tới khi khởi động lại app.

| Lần | Câu kẹt lại | Người dùng thấy |
|---|---|---|
| 1 (2026-08-04) | `Không đọc được Sheet để lọc trùng: Không có tab tên "Data"…` | Sửa đúng tên tab, log đọc được 161.045 dòng, mà dòng trạng thái vẫn nguyên câu lỗi → tưởng chưa ăn |
| 2 (2026-08-04) | `Đã bật đẩy Sheet giữa phiên — nạp 161040 link cũ để lọc trùng (4 link mới thêm).` | Không còn thấy số dòng nữa, dù mọi thứ chạy tốt |

Lần 1 tôi định vá bằng cách cho "số mới được ghi đè lên **lỗi đọc Sheet**". Người dùng bác ngay:
*"tôi vẫn thích kiểu cũ là auto hiện data Sheet ở dòng đó và cứ mỗi 1 lúc là nó sẽ update lại"* —
tức là **con số phải LUÔN hiện**, không có điều kiện gì cả. Đúng: đây là số liệu theo dõi liên
tục (5 máy cùng đẩy lên), không phải thông báo nhất thời.

**Quyết định:** tách `#sheetRowsInfo` thành **ô riêng**, đặt ngay sau 2 badge đếm →
`[ 716 sound ] [ Bỏ qua trùng: 644 ] Sheet: 161.067 dòng data   <thông báo>`.

Bỏ hẳn `_statusIsIdle()`. Được **cả hai** thứ mà QĐ-25 phải đánh đổi:

- số dòng **luôn hiện**, tự cập nhật, không ai chặn được;
- thông báo/lỗi nằm nguyên chỗ của nó, **không bị số dòng xoá** — mối lo của QĐ-25 vẫn được giữ,
  chỉ là giải bằng **tách chỗ** thay vì bằng **luật nhường nhau**.

CSS `flex: 0 0 auto` để câu thông báo dài bị cắt trước, **không bao giờ cắt mất con số**;
`.sheet-rows:empty { display: none }` để lúc chưa đọc được Sheet thì không chiếm khoảng trắng.

**Bài học:** khi hai thứ **khác bản chất** (số liệu theo dõi liên tục vs thông báo nhất thời)
tranh nhau một chỗ, đừng viết luật ưu tiên cho chúng nhường nhau — luật đó sẽ luôn có kẽ hở.
**Cho mỗi thứ một chỗ.**

**Kiểm chứng:** `test/sheet-rows-status.test.js` — 15 khẳng định, trong đó mục 3 và 4 dựng lại
**đúng 2 câu đã gây lỗi thật** rồi đòi số dòng vẫn phải hiện *và* câu đó vẫn phải còn nguyên.
Mục 7 đọc thẳng `renderer.js`/`index.html`/`styles.css` để bản sao logic trong test không lệch
âm thầm khỏi bản gốc (test dùng bản sao vì `renderer.js` chạy trong DOM, không `require` được).

---

## QĐ-30 — Lời gọi IPC có gọi mạng thì nút bấm phải khoá + báo trạng thái, và IPC phải có trần

**Sự cố thật (2026-08-04):** người dùng sửa tên tab trong ☁ Google Sheet rồi bấm **Lưu** —
*"click vào k thấy phản hồi gì"*. Thực tế **đã lưu thành công**, chỉ là giao diện không nói gì.

Hai lỗi cộng lại:

1. `saveSheetsConfig()` `await api.sheetsSetConfig(...)` mà **không khoá nút, không đổi chữ**.
   Chờ vài chục giây mà nút vẫn sáng như chưa bấm → không thể phân biệt "đang làm" với "nút chết",
   và người dùng bấm lại nhiều lần.
2. Handler `sheets-set-config` gọi `await sheets.flushAll()` **không có trần**. Bước đó gọi mạng
   (đọc lại Sheet + append); với Sheet 161k dòng thì trần đọc là **120s × 2 lần thử** — renderer
   đứng hàng **phút**.

**Đã sửa (chỉ phần giao diện, theo yêu cầu *"chỉ fix lỗi hiện thị UI thôi, đừng sửa gì logic"*):**
khoá nút + đổi chữ thành `Đang lưu...` + `try/finally` mở lại (kể cả khi lỗi). Người dùng thấy
ngay là app đang làm việc, không bấm lại nhiều lần nữa.

**CHƯA sửa — đề xuất, chờ quyết:** bọc `withDeadline(sheets.flushAll(), 8000, null)` trong handler
`sheets-set-config`. Tôi đã làm rồi **hoàn lại** vì đó là thay đổi logic backend, không phải UI.
Lý do vẫn nên làm sau này:

- Bước `flushAll()` chạy bằng cấu hình **CŨ**. Khi người dùng bấm Lưu để **sửa cấu hình sai**
  thì lần xả đó chắc chắn thất bại → chờ nó xong là **chờ vô ích** hàng phút.
- Quá hạn **không mất dòng nào**: lô vẫn nằm trong bộ đệm và được đẩy ở nhịp flush kế tiếp bằng
  cấu hình **MỚI** — đúng cái người dùng muốn.

**Nguyên tắc rút ra:** mọi nút `await` một IPC có gọi mạng đều phải khoá + báo trạng thái; và mọi
`ipcMain.handle` gọi mạng nên có trần thời gian (`withDeadline`). Đã có tiền lệ y hệt ở
`profile-start` (trần 8s cho `sheetLock.check` — QĐ-19) và ở nút 🔌 Test kết nối / 🧹 Dọn trùng
(đều đã khoá nút sẵn); nút **Lưu** bị bỏ sót vì "chỉ là lưu cấu hình", không ai nghĩ nó gọi mạng.

---

## QĐ-31 — FEED CẠN (TikTok không cấp thêm video): phát hiện đúng rồi ĐỔI HƯỚNG, không có cách nào ép nó cấp thêm

**Sự cố thật (2026-08-05):** một máy ảo có profile **còn đăng nhập tốt** — nút 🔑 xác nhận
"Đã đăng nhập" — nhưng trang chỉ có **2 video** và nút "video kế tiếp" của TikTok bị **TẮT**
(`aria-disabled="true"`). App quay vòng thoát kẹt cách 1→2→3 gần **2 giờ**, cho ra **0 sound
hợp lệ**. Ảnh bảng profile cùng lúc đó cho thấy 5 profile mang **3 bệnh khác nhau** mà từ ngoài
trông y hệt: một profile khoẻ (`gặp 94 sound khác nhau/100 lần cuộn`), một profile bị chặn
**trang đếm** (`23 sound liên tiếp lỗi — nghỉ 374s`), hai profile **feed cạn**.

**⛔ NÓI THẲNG GIỚI HẠN TRƯỚC: KHÔNG có cách nào trong code làm TikTok cấp thêm video.**
Cuộn không thể cuộn tới cái không tồn tại. Nút xuống bị `aria-disabled` nghĩa là băng chuyền
đã ở cuối và **máy chủ từ chối nạp thêm** — không có thao tác client nào ép được. Đã cân và
LOẠI 3 hướng, đừng thử lại:

| Đã cân | Vì sao loại |
|---|---|
| `window.scrollBy` / dispatch synthetic wheel event | QĐ-13: feed For You là băng chuyền CSS, `scrollIntoView` đã thất bại 100%; và React bỏ qua event không `isTrusted` |
| Điều hướng thẳng tới video kế tiếp bằng `href` có trong DOM | Trang chỉ còn 1–2 href — hết, không có gì để nhảy tới |
| Gọi thẳng API feed (`/api/recommend/item_list/`) | Cần tham số ký `X-Bogus`/`msToken` sinh phía client — đúng lý do QĐ-06 chọn **NGHE** response thay vì **GỌI** endpoint |

**Vậy quyết định là gì:** không cố sửa cái không sửa được. Mục tiêu chỉ còn 3 việc —
**phát hiện đúng, ngừng dội, đổi hướng.**

**Phát hiện — phải đủ CẢ 4 điều kiện** (thiếu một là KHÔNG kết luận):

| # | Điều kiện | Vì sao cần |
|---|---|---|
| 1 | Đã vào trạng thái kẹt (20 lần đọc trúng cùng 1 sound) | Không có nó thì feed vừa tải xong tạm 1–2 video cũng bị báo oan |
| 2 | Trang chỉ còn **≤2** link video | Feed khoẻ dựng nhiều video — đo thật: 94 sound khác nhau/100 lần cuộn |
| 3 | Không có nút "xuống" **dùng được** (không tồn tại, hoặc tồn tại nhưng `aria-disabled`) | Chính TikTok nói "hết video" |
| 4 | Đã thử **trọn một vòng 3 cấp** thoát kẹt mà feed không cho sound mới nào | Phân biệt "cạn thật" với "kẹt tạm, gỡ được" |

Cộng điều kiện thứ 5 trước khi báo: `checkLoginStateStable` phải **không** ra `guest`. Nếu là
khách thì hướng chữa khác hoàn toàn (bấm 🦊 đăng nhập lại) — báo sai là **đẩy người dùng đi
sai đường**. Tốn tới 20s nhưng chỉ chạy đúng 1 lần ở thời điểm đã bế tắc.

Đây đúng triết lý đã dùng ở **ip-guard** (2 nhà cung cấp phải đồng thuận), **session-watch**
(`guest` phải ổn định 3 lần liên tiếp) và **sheet-lock** (lỗi mạng thì KHÔNG chặn): *chỉ kết
luận khi CHẮC CHẮN*. Báo oan ở đây làm **profile khoẻ tự tạm dừng** — tệ hơn cả bệnh.

**Đổi hướng — khác nhau theo chế độ:**

| Chế độ | Xử lý | Vì sao |
|---|---|---|
| **Quét ⇄ Xem** | **Kết thúc pha QUÉT sớm → sang pha XEM luôn** | Dùng đúng máy móc đã có. Hết dội ngay; pha Xem là hoạt động **giống người thật nhất** app có (mở link sound, xem 40–70% thời lượng, thỉnh thoảng like) nên có cơ hội để TikTok nới lại; hết pha Xem thì vòng sau **tự thử quét lại** |
| **For You / Tìm kiếm / Tab đang mở** | **Tạm dừng 5 → 15 → 30 phút** rồi tải lại thử tiếp | Không có pha Xem để nhảy sang. Theo khuôn ip-guard: TẠM DỪNG chứ không dừng hẳn — siết thường tự hết, dừng hẳn là mất cả đêm sản lượng |

Riêng chế độ `current` **không tải lại** khi hết giờ tạm dừng — đó là tab của người dùng.

**Vì sao TẠM DỪNG chứ không "dừng rồi chạy lại" (người dùng đề nghị):** cấp 3 của thoát kẹt
*đã là* tải lại trang và đã thất bại. Dừng-chạy-lại về bản chất chỉ là reload đắt hơn — cùng
IP, cùng cookie, cùng vân tay, cùng endpoint; không có biến nào đổi thì không có lý do gì kết
quả đổi. Tệ hơn: vòng dừng-chạy liên tục **chính là "càng dội càng bị chặn sâu"** mà backoff
của bước đếm được dựng ra để tránh.

**Thời gian kết luận thực tế: 2–3 phút** (20 lần đọc × delay 2–3s cho mỗi cấp, cộng ~2.1s cho
cấp 2 vì nó cuộn 3 nhịp có `sleep(700)`) — thay cho ~2 giờ ra 0 sound.

**Tách 2 ca chẩn đoán trước đây bị GỘP.** `_findNextButtonInPage` cũ loại nút `aria-disabled`
ngay trong bộ lọc rồi trả `null`, nên log chỉ in được một câu `KHÔNG thấy nút kế tiếp` cho hai
tình huống nghĩa khác hẳn nhau: *không có nút nào* (có thể TikTok đổi bố cục / trang chưa dựng
xong) và *có nút nhưng đang TẮT* (bằng chứng **trực tiếp** của feed cạn). Giờ trả 3 hình dạng
(`null` / `{x,y,label}` / `{disabled,label}`) và log nói rõ từng ca.

**⚠ Dùng status `running` cho dòng tạm dừng, KHÔNG dùng `error`:** renderer coi `error` là đã
dừng (`setRowRunning(false)` + xoá chip pha) nên hàng đổi về nút "▶ Chạy" trong khi profile
VẪN đang sống → bấm vào bị từ chối *"Profile đang chạy"*. Đường **canh IP (QĐ-17) hiện đang
mắc đúng cái vênh này** — chưa sửa để giữ phạm vi thay đổi hẹp, nhưng đừng lặp lại nó.

**Còn cách nào "lướt tiếp" thật không — CÓ, nhưng không phải trên For You:** khi mở một video
từ một **LƯỚI** (kết quả Tìm kiếm, trang hashtag, Explore, trang tác giả), TikTok dựng trình
phát với **băng chuyền riêng theo ngữ cảnh lưới đó**, không dùng feed For You. Đó chính là cách
chế độ **Tìm kiếm** đang hoạt động. Nên For You bị siết **không** kéo theo Tìm kiếm bị siết →
đổi profile sang Tìm kiếm là đường đi tiếp có thật. Thông báo tạm dừng đã nói thẳng điều này.
⚠ Nhưng nếu bị siết ở tầng **IP/tài khoản** thì lưới cũng có thể cụt — lúc đó chỉ đổi IP mới
xong. **Chưa kiểm chứng** trên profile thật (chưa ai thử Tìm kiếm trên đúng profile bị cạn).

**Đã cân và HOÃN — tự động chuyển sang Tìm kiếm khi For You cạn:** làm được, nhưng profile
được cấu hình For You mà app tự đi quét Tìm kiếm là **tự mở rộng phạm vi ngoài cái người dùng
thấy** — đúng bài học QĐ-28 (vị trí điều khiển là lời hứa về phạm vi). Nếu làm thì phải là
công tắc, không phải hành vi mặc định ngầm.

**Kiểm chứng:** `test/crawl-modes.test.js` — thêm **17 khẳng định THẬT** (trượt là exit ≠ 0),
kiểm **cả hai chiều**. Chiều "không báo oan" quan trọng hơn: nút còn bấm được → KHÔNG báo;
feed còn 8 video → KHÔNG báo; đang là khách → báo KHÁCH chứ không báo feed cạn.

⚠ **Lưu ý về chính bộ test này:** 13 kịch bản GỐC của file chỉ `console.log` rồi `process.exit(0)`
— **không có khẳng định nào**, nên chúng KHÔNG tự bắt được hồi quy, phải có người đọc output.
Chỉ phần thêm 2026-08-05 mới có khẳng định thật. Đừng tin "bộ test này pass" là "hành vi đúng"
cho 13 kịch bản cũ.

**Bài học lúc viết test:** đặt cửa sổ chạy 2600ms thì chỉ tới được **kẹt lần 2** → chưa đủ điều
kiện (4) → khẳng định trượt oan, trông như code sai. Nguyên nhân: cấp 2 mất ~2.1s. Đã ghi chú
ngưỡng thời gian vào test để không ai đặt lại quá ngắn.

---

## QĐ-32 — Tự đổi IP khi feed cạn: LUÔN DỪNG HẾT profile (chốt cuối 2026-08-06)

> **HIỆN TẠI — hai đường, chọn bằng công tắc "Tự đổi IP" trong ⚙ (chung toàn app):**
>
> | Công tắc | TikTok cắt feed thì app làm gì |
> |---|---|
> | **BẬT** | **DỪNG HẾT** profile → tắt/bật lại HMA VPN → chờ **59s** → chạy lại **cả nhóm**, lần lượt |
> | **TẮT** | Dừng **đúng profile đó** → nghỉ **5 → 15 → 30 phút** → tự bật lại chính nó |
>
> Cả hai đường đều **TỰ CHẠY LẠI** — người dùng chốt: *"nhiều khi tôi treo máy nên không thể ấn
> Chạy thủ công được"*. Dừng hẳn mà không ai bấm lại = mất cả đêm sản lượng.
>
> **VPN TẮT (bạn tự tắt, hoặc VPN tụt) → cũng DỪNG HẾT.** Người dùng chốt: *"khi tôi tắt HMA thì vẫn
> thấy các profile chạy... Tắt HMA là dừng hết luôn không cho chạy"*. Bản trước chỉ **cảnh báo** —
> vô nghĩa khi họ treo máy: mỗi giây profile còn chạy là một giây gửi request bằng **IP THẬT**. Khi
> VPN lên lại, app hẹn chạy lại **đúng nhóm vừa bị dừng** sau 59 giây (VPN tụt lúc 3h sáng vẫn tự
> phục hồi).
>
> ### ⚠️ VÌ SAO LUÔN DỪNG HẾT — nhánh "chỉ dừng 1 profile" đã bị XOÁ HẲN
>
> Bản đầu cho phép chỉ dừng 1 profile **nếu máy không rò rỉ IPv6**. Người dùng chỉ ra lỗ hổng mà
> phép đo IPv6 **không** che được:
>
> > 4 profile kia **vẫn đang chạy**. Chúng bắt đầu phiên quét trên **IP A** rồi **giữa chừng** bị
> > chuyển sang **IP B**. Với TikTok, một phiên đang hoạt động bỗng đổi IP giữa lúc quét là đúng
> > khuôn "tài khoản bị chiếm" mà [QĐ-15](#qđ-15--phòng-thủ-nhiều-lớp-cho-phiên-đăng-nhập) gọi là
> > nguyên nhân số 1 khiến nó huỷ phiên.
>
> Rò rỉ IPv6 chỉ là **một** trong hai vấn đề; "đổi IP giữa phiên" là vấn đề còn lại và nó xảy ra
> **kể cả khi không có IPv6 nào**. Nên nhánh "dừng 1" bị xoá, không để làm tuỳ chọn — một tuỳ chọn
> mà bật lên là tự hại thì không nên tồn tại.
>
> Nhờ vậy chốt an toàn ở backend trở nên **rất đơn giản**: `vpn-cycle` từ chối nếu
> `crawler.isAnyRunning()`. Không cần hỏi `ipv6LeakRisk()` để quyết định gì nữa — hàm đó giờ chỉ
> dùng để **phân mức cảnh báo** khi VPN tắt (có IPv6 = đang lộ IP thật; không có = chỉ lỗi mạng).
>
> **Bài học chung:** một tài nguyên **dùng chung cấp máy** (IP, VPN, cổng mạng) thì không thể "sửa
> cho riêng một đơn vị công việc". Trước khi tự động hoá thao tác trên tài nguyên đó, phải hỏi
> *"ai khác đang dùng nó, và việc mình làm ảnh hưởng họ thế nào?"* — không chỉ hỏi *"việc này có
> chữa được vấn đề trước mắt không?"*.
>
> ### Vì sao DỪNG rồi BẬT LẠI, không "tạm dừng tại chỗ"
>
> Backend vốn đã có backoff 5/15/30 tại chỗ, nhưng dựng lại context thì hơn: trang feed mới, cookie
> nạp lại, vân tay áp lại → TikTok thấy một phiên **mở mới** thay vì một phiên đang bị siết cố cào
> tiếp. Và bật lại đi qua `waitForCorrectCountry` (ip-guard, QĐ-17) nên VPN tụt lúc không ai trông
> thì profile **tự chờ đúng vùng**, không chạy sai nước. "Tạm dừng tại chỗ" không có bước này.
>
> ⚠️ Việc dừng này **đè lên** logic cũ của backend: chế độ chu kỳ không còn cắt sang pha Xem, chế độ
> khác không còn backoff tại chỗ.
>
> ### Các chốt an toàn (đều có test)
>
> | Chốt | Vì sao |
> |---|---|
> | Bấm **■ Dừng** lúc đang chờ → **huỷ** mọi hẹn | Người dùng đã tiếp quản; không huỷ thì app tự bật lại đúng profile họ vừa tắt |
> | Bấm **▶ Chạy** lúc đang chờ → chạy ngay, **giữ `streak`** | Vẫn bị cắt tiếp thì lần nghỉ sau phải dài hơn |
> | Tới giờ mà **VPN đang tắt** → không bật, kiểm lại mỗi **5 giây** | Bật lên là chạy bằng IP thật. 5 giây vì VPN tắt do người dùng nên có thể hết bất cứ lúc nào |
> | Đổi IP **thất bại** → hẹn thử lại **cả nhóm** | Người dùng treo máy; bỏ mặc nhóm ở trạng thái dừng = mất cả đêm |
> | App đang tự đổi IP → **bộ canh HMA đứng ngoài** | Hai đường cùng bật một nhóm = bật 2 lần |
> | Đếm ngược **hiện ra badge** từng giây | Vòng chờ im lặng luôn bị báo là "app treo" (QĐ-21) — mà đây chờ tới 30 phút |
> | Chờ backend xác nhận **dừng sạch** trước khi tắt VPN | Không tin `runningSet` của renderer (bài học đồng bộ trạng thái 2026-07-28) |
>
> **Kiểm chứng:** `test/vpn-run-lock.test.js` **71 khẳng định** + `test/starve-restart.test.js`
> **41 khẳng định**. Cả hai đã kiểm có "cắn": bỏ `api.profilesStopAll()` trong bộ canh → 3 khẳng
> định trượt; bỏ dòng đặt hẹn tự-bật-lại → 20 khẳng định trượt.

---

### (Lưu trữ) Thiết kế và các phép đo — vẫn đúng, đọc để hiểu tại sao làm thế

**Người dùng chốt (2026-08-05), ngay sau QĐ-31:** *"Nếu tiktok block cuộn xuống thì sẽ dừng
profile đó và tắt HMA VPN đi rồi bật lại và tự chạy lại profile đó"*. QĐ-31 chỉ phát hiện đúng
và đổi hướng (tạm dừng có backoff / nhảy sang pha Xem) — đó là **giảm thiệt hại**, không sửa
được nguyên nhân. Đổi IP là thứ duy nhất chạm tới **gốc rễ**: gần như chắc chắn feed cạn là do
tầng IP/máy, không phải tài khoản (phiên đăng nhập vẫn tốt — đã xác nhận ở QĐ-31).

### Tìm đường điều khiển HMA — 3 cách đã thử, đo TRỰC TIẾP trên máy thật

HMA (Privax) không có CLI chính hãng. Đã cân và **loại 2 hướng**, giữ hướng thứ 3:

| Cách | Kết quả đo thật | Kết luận |
|---|---|---|
| **UI Automation** (cửa sổ HMA) | Cây UI Automation chỉ có **1 node duy nhất**, `BoundingRectangle=Empty`, **0 phần tử con** | GUI là **WebView2**, không phơi accessibility tree ra ngoài — kể cả bấm theo toạ độ cũng không đáng tin (`BoundingRectangle` rỗng). **Loại hẳn.** Trên máy ảo mà RDP ngắt/khoá màn hình thì càng chắc chắn không dùng được. |
| **Windows Service Control** (`net stop/start HmaProVpn`) | `sc sdshow HmaProVpn` cho ACL: `IU`/`SU` (user thường) chỉ có `CCLCSWLORC` (Query/Status/Interrogate) — **không có** `RP`/`WP` (Start/Stop). Chỉ SYSTEM + Administrators mới dừng/khởi động được. User hiện tại `IsAdmin: False` dù tên tài khoản là "Admin" (token bị UAC bó) | Không đồng nhất được trên cả dàn máy (tuỳ máy chạy dưới quyền gì) — bắt người dùng chạy app bằng admin là quá đắt. **Loại.** |
| **Native messaging host** (`VpnNM.exe`, HMA tự đăng ký `com.privax.vpn` cho extension trình duyệt của chính họ) | Chạy dưới **quyền người dùng thường**, không cần credential riêng (dùng lại phiên đã đăng nhập của `HmaProVpn` service) | **Dùng cách này.** |

### Giao thức: dò bằng chuỗi trong binary, xác nhận bằng gọi thật

`VpnNM.exe` là Chrome native messaging host chuẩn (4-byte length little-endian + JSON UTF-8,
gọi với `argv[1]` = origin extension). Không có tài liệu công khai. Quét chuỗi ASCII/UTF-16
trong file lộ ra từ vựng (namespace `asw` = hạ tầng dùng chung của Avast/Gen Digital, HMA chỉ
là một sản phẩm dùng lại nó):

```
Vpn_GetState_NmSvc · Vpn_GetApiVersion_NmSvc · Vpn_GetOptimalGateway_NmSvc
Vpn_Connect_NmSvc · Vpn_ConnectToOptimal_NmSvc · Vpn_Disconnect_NmSvc
Vpn_OnStateChanged_SvcNm · Vpn_OnErrorOccurred_SvcNm
```

Xác nhận bằng gọi **thật** trên máy có HMA đang chạy: gửi `{}` (thiếu field) → host tự trả lỗi
rõ ràng `"expected an object with required field: action"` — tự khai luôn schema. Từ đó gọi
đúng `{"action":"Vpn_GetState_NmSvc","args":{},"requestId":"<uuid>"}` → nhận về **toàn bộ danh
sách gateway** + `activeGateway`. Đo tiếp bằng chu trình Disconnect → Connect{gatewayId} thật:
ngắt xong `activeGateway` về `null` trong 3s; nối lại xong `activeGateway` khớp gateway yêu cầu
trong 1.5s. Không cần quyền admin, không cần credential.

**Số gateway theo quốc gia (đo thật):**

| Quốc gia | Số gateway | Ghi chú |
|---|---|---|
| GB (UK) | 5 | London, Manchester, Nottingham, Edinburgh, Glasgow |
| US | 25 | Phoenix, LA, NYC, Chicago, Seattle... |
| KR | 1 duy nhất | Seoul |

### ⚠ ĐÃ SỬA MỘT GIẢ ĐỊNH SAI: không cần đổi city, chỉ tắt/bật lại là đủ

Bản đầu của module mặc định **xoay sang city khác** trong cùng quốc gia, dựa trên giả định:
*"nối lại đúng server cũ thì HMA cấp lại đúng IP cũ, nên không đổi được gì"*. **Giả định đó
SAI** — người dùng chỉ ra (*"KR chỉ có 1 gateway thì không cần đổi city đâu, chỉ cần tắt đi bật
lại là được, mấy IP khác cũng thế"*), và đo thật xác nhận ngay:

```
Gateway: GB-H9-LONDON-ULT (KHÔNG đổi)
IP trước disconnect+connect: 18.171.54.19
IP sau  disconnect+connect: 18.132.40.68   → ĐÃ ĐỔI IP
```

HMA cấp IP từ một **POOL** mỗi lần kết nối, không gán tĩnh theo gateway. Nên:

- **Mặc định giờ là `rotate: false`** — nối lại đúng gateway cũ.
- Xoay city không chỉ **dư thừa** mà **có hại**: nó đưa IP sang một vùng địa lý khác trong cùng
  nước, lệch với vùng mà phiên đăng nhập của profile đã quen — thêm rủi ro, không đổi lấy lợi
  ích nào. `rotate: true` vẫn còn nhưng chỉ là đường dự phòng.
- **KR (1 gateway) KHÔNG còn là trường hợp yếu hơn GB/US.** Tài liệu bản đầu ghi *"KR nối lại
  vẫn có thể ra cùng IP, không đảm bảo đổi được gì"* — điều đó dựa trên chính giả định sai ở
  trên và **không đúng**.

**Bài học:** giả định "cùng server ⇒ cùng IP" nghe rất hợp lý nên tôi không kiểm — trong khi
việc kiểm chỉ tốn một lần disconnect/connect và đọc IP. Cứ đo được thì đừng suy luận.

### ⛔ CÁI BẪY QUAN TRỌNG NHẤT: TUYỆT ĐỐI không dùng `Vpn_ConnectToOptimal_NmSvc`

Đo thật: `Vpn_GetOptimalGateway_NmSvc` (server "tối ưu") trả về **`VN-51-HANOI` (Việt Nam)** —
vì "optimal" nghĩa là server **gần nhất theo địa lý** (máy đo vật lý ở Việt Nam), **không phải**
server đang được chọn hay phù hợp với profile. Nối vào gateway "optimal" thì một profile khai
giờ London/Seoul/New York sẽ bỗng chạy trên IP Việt Nam — đúng mâu thuẫn "IP nước này, giờ nước
khác" mà QĐ-05 gọi là dễ bị nhận diện proxy nhất, và `ip-guard` (QĐ-17) sẽ tạm dừng cả dàn máy.
**Luôn Connect bằng `gatewayId` tường minh, chọn trong đúng quốc gia profile đang khai — không
bao giờ dùng optimal/tự động.**

### Kiến trúc: vpn-hma.cjs "câm" về VPN, điều phối nằm ở renderer

**`src/vpn-hma.cjs`** chỉ biết nói chuyện với `VpnNM.exe` — không biết gì về crawler/profile:

- `hostPath()` — tìm `VpnNM.exe` qua **registry NativeMessagingHosts → đọc manifest → lấy
  field `path`** (đúng cách Chrome tự resolve native host, không hardcode đường dẫn — máy khác
  có thể cài ở ổ đĩa/thư mục khác, kể cả x86 vs x64).
- `status()` — chỉ đọc, không đụng gì tới VPN.
- `pickGateway(gateways, countryId, currentId)` — chỉ dùng khi `rotate: true`: chọn city
  **KHÁC, CÙNG quốc gia**. Chỉ 1 gateway (KR) thì trả về đúng gateway cũ, `rotated: false` —
  thành thật về giới hạn, không bịa ra một city không tồn tại.
- `cycle({expectCountry, rotate = false})` — chu trình Disconnect → Connect **lại đúng gateway
  cũ** (mặc định) → xác nhận, với **3 lớp chốt an toàn**:
  1. **Từ chối nếu HMA đang KHÔNG kết nối** — không biết nên nối lại vào đâu, bắt người dùng tự
     bật tay trước.
  2. **Từ chối nếu quốc gia HMA đang nối KHÔNG khớp `expectCountry`** — không tự "sửa" giùm,
     vì làm vậy có thể vô tình nối đúng nước profile khai nhưng **sai với nước IP thật đang
     phục vụ khu vực đó** (vd máy VPS đặt ở Đức nhưng đang cố nối US) mà không ai kiểm tra được.
  3. **Sau khi nối lại, nếu SAI NƯỚC so với trước khi ngắt** → báo thất bại rõ ràng, không im
     lặng cho qua.
- Dùng chung `normalizeCountry` của `ip-guard.cjs` (UK→GB) — không tự viết bảng alias thứ hai
  (bẫy QĐ-10). Bản đầu tự so chuỗi thẳng đã bị chính test bắt được: mọi profile `(UK)` bị coi
  là lệch vùng khi HMA báo `GB`, làm tính năng tự chối chạy với **toàn bộ** profile UK.

**Điều phối (dừng hết → đổi IP → chạy lại) nằm ở `renderer.js` (`handleFeedStarved`), KHÔNG
phải `crawler.cjs`** — quyết định có chủ đích:

- `crawler.cjs` chỉ phát status **RIÊNG** `'feed-starved'` (không phải `'running'` hay
  `'error'`) khi một profile phát hiện cạn (QĐ-31). Status này vừa là dòng log, vừa là **tín
  hiệu máy** để renderer quyết định có can thiệp hay không.
- Renderer nghe status đó, và **nếu** công tắc "Tự đổi IP" đang bật thì gọi `handleFeedStarved`.
- `crawler.cjs` vẫn giữ nguyên vòng backoff cục bộ của nó (QĐ-31: tạm dừng 5→15→30 phút) làm
  **phương án dự phòng** — nếu tính năng tắt, hoặc HMA không cài, hoặc renderer đang bận việc
  khác, profile vẫn tự phục hồi theo đường cũ mà không cần biết gì về VPN. Hai lớp không xung
  đột: renderer gọi `profilesStopAll()` → mọi `stop.requested` bật lên → `interruptibleSleep`
  trong vòng backoff cục bộ của `crawler.cjs` tự thoát ngay, không phải chờ hết giờ.

### Dừng RIÊNG 1 profile hay dừng HẾT — và phát hiện RÒ RỈ IPv6

Yêu cầu ban đầu là *"dừng profile ĐÓ"* (chỉ 1). Bản đầu tôi làm **dừng HẾT**, lý do nêu ra là
*"lúc VPN tắt máy dùng IP thật"* — nhưng đó là **đánh giá rủi ro tôi chưa đo**. Người dùng phản
biện bằng quan sát thực địa: *"tôi thấy rerender HMA thì các profile chạy mượt không bị cắt vẫn
hoạt động"*. Quan sát đó **đúng** — nên phải đo thật thay vì bảo vệ giả định.

Đo cho ra một thứ **quan trọng hơn cả câu hỏi ban đầu**:

```
HMA BẬT : IPv4 → 13.40.11.3 (GB)         IPv6 → bị chặn (EACCES)        ✅ an toàn
HMA TẮT : IPv6 → 2001:db8:… (VN)  lọt ra chỉ trong 241ms               ❌ RÒ RỈ
```

Đường hầm WireGuard của HMA **chỉ định tuyến IPv4**. Khi VPN tắt, IPv6 mở ra và đi thẳng ra
internet bằng IP thật. Và `systemKillSwitchActive: true` của HMA **KHÔNG chặn IPv6** — đã đo,
đừng tin cờ đó (chính vì tin tên cờ nghe rất thuyết phục mà tôi gần như đã kết luận "có kill
switch nên an toàn").

Vì sao quan sát của người dùng và rủi ro thật **không mâu thuẫn**: rò rỉ này **im lặng**. Profile
vẫn chạy mượt, không lỗi, không dừng — hậu quả là mất phiên **sau đó**. Nên *"chạy mượt"* và
*"an toàn"* là hai chuyện khác nhau, và đây đúng là loại nguyên nhân mất phiên mà
TROUBLESHOOTING mục 3 liệt kê nhưng **không ai truy ra được**. Nó xảy ra **mỗi lần VPN tắt**,
kể cả VPN tụt tự nhiên lúc 3h sáng — không riêng gì lúc app tự đổi IP.

**Quyết định: app tự đo rồi chọn, không cấu hình tay.** `ipv6LeakRisk()` trong `vpn-hma.cjs`
đọc `os.networkInterfaces()` (đồng bộ, không spawn gì, không cần admin) và tìm địa chỉ
**global unicast 2000::/3** trên adapter **không phải VPN**:

| Máy | Hành vi | Lý do |
|---|---|---|
| Không có IPv6 công khai | **Chỉ dừng profile bị cạn** — các profile khác chạy tiếp | Request của chúng chỉ bị lỗi mạng vài giây, không lộ gì |
| Có IPv6 công khai | **Dừng HẾT** + hướng dẫn tắt IPv6 | Không dừng là lộ IP thật cả nhóm |

Chốt ở **hai tầng**: renderer hỏi trước để quyết định dừng bao nhiêu, và `main.js` **tự kiểm lại**
trong `vpn-cycle` (không tin renderer — nó có thể lỗi/bị reload giữa dòng). Hỏi thất bại thì coi
như **CÓ rủi ro** → dừng hết; an toàn hơn là đoán rồi mất phiên.

Chỉ tính `2000::/3` là đúng: `fe80` (link-local) và `fd/fc` (ULA riêng tư) **không ra được
internet** nên không thể rò rỉ. Quan trọng với máy này — **Tailscale dùng `fd7a:…`**, nếu tính
cả ULA thì tính năng sẽ tự khoá mình trên mọi máy có Tailscale. Adapter của chính VPN cũng bỏ
qua: IPv6 ở đó đi trong đường hầm, và nó biến mất khi VPN tắt.

**Cách bịt (nên làm trên mọi máy, không chỉ để phục vụ tính năng này):** tắt IPv6 trên adapter
vật lý — `Disable-NetAdapterBinding -Name "Ethernet" -ComponentID ms_tcpip6` (cần admin). Xem
TROUBLESHOOTING mục 17. **Đừng tắt trên adapter Tailscale.**

⚠ **Đã thử và LOẠI — đóng gói việc tắt IPv6 thành script `.ps1` trong repo:** Windows Defender
chặn hẳn (*"file contains a virus or potentially unwanted software"*) vì sửa binding mạng là
hành vi bị heuristic đánh dấu — chặn cả việc **chạy** lẫn việc **xoá** file. Với thao tác chỉ 1
dòng lệnh thì script là thừa: để lệnh trong tài liệu, người dùng copy-paste.

### Phòng thủ ở tầng backend — không tin renderer

`main.js` (`ipcMain.handle('vpn-cycle', ...)`) **tự kiểm tra lại `crawler.isAnyRunning()`**
trước khi cho phép chạm vào VPN — không tin renderer đã dừng hết thật (nó có thể lỗi/bị reload
giữa dòng). Cùng tinh thần phòng thủ 2 lớp với `withDeadline` ở `profile-start` (QĐ-19).

**Bổ sung (2026-08-06) — CHỜ ~1 PHÚT cho IP mới "nguội" trước khi chạy lại profile.**
Người dùng chốt: *"khi bật lại HMA thì set khoảng 1 phút, hết 1 phút thì profile mới được chạy —
để tránh TikTok chặn profile vì spam đăng nhập liên tục"*. Đúng: sau khi đổi IP, 5 profile khởi
động lại gần như cùng lúc trên **một IP vừa mới xuất hiện** — với TikTok đó là 5 phiên đăng nhập
cũ bỗng chuyển sang IP mới trong vài giây, đúng khuôn "tài khoản bị chiếm" mà QĐ-15 gọi là
nguyên nhân số 1 khiến nó hủy phiên. Mất 1 phút sản lượng rẻ hơn mất phiên cả nhóm.

Việc chờ này **độc lập** với `startProfilesStaggered` (QĐ-21): cái đó giãn **từng profile** ra để
không tranh CPU, cái này giãn **cả nhóm** ra khỏi thời điểm IP vừa đổi. Có đếm ngược hiện trên
dòng trạng thái — vòng chờ im lặng từng bị báo là bug (QĐ-21). Bấm **Dừng** trong lúc chờ thì
**huỷ luôn** việc tự chạy lại, nếu không app sẽ tự bật lại ngay sau khi người dùng vừa chủ động dừng.

**Giới hạn nhịp đổi IP** (chặn ở backend, không phải chỉ renderer): tối thiểu **10 phút** giữa
2 lần, tối đa **6 lần/ngày**. Lý do: đổi IP quá dày tự nó là tín hiệu bất thường với TikTok, và
mỗi lượt đã tốn thời gian dừng + bật lại cả dàn profile — không có lý do gì để chạy liên tục.
Bị chặn vì nhịp (`skipped: 'rate'`) thì **VPN không hề bị đụng tới** — renderer coi là an toàn
để chạy lại profile ngay với IP hiện tại (không phải chờ).

Sau khi `cycle()` thành công, `main.js` **ép `ip-guard` đọc lại IP ngay** (`getPublicIp({force:
true})`) — nó có cache 1 phút, không ép thì profile khởi động lại ngay sau đó có thể thấy IP
CŨ trong cache và tạm dừng oan (hoặc tệ hơn: tưởng đúng vùng khi IP thật chưa kịp đổi).

### Kiểm chứng

`test/vpn-hma.test.js` — **74 khẳng định**, mock toàn bộ `child_process` (không cần cài HMA
thật để chạy test — máy CI/máy dev khác không có HMA vẫn test được):

1. `pickGateway`: GB xoay vòng đúng city khác *(8 lần lặp, không bao giờ nhảy sang nước
   khác)*; KR chỉ 1 gateway → giữ nguyên + báo rõ `rotated:false`; quốc gia không có gateway
   nào → giữ nguyên, không bịa; nhãn `"UK"` phải quy đổi ra `"GB"` — bắt đúng bẫy QĐ-10 đã
   xảy ra lúc triển khai.
2. Tìm `VpnNM.exe` qua registry (giả lập `reg query` trả về manifest, đọc field `path`).
3. Chu trình tắt/bật thành công theo **mặc định**: đọc trạng thái **TRƯỚC** khi ngắt (thứ tự
   lệnh gửi đúng), nối lại **đúng gateway cũ** (không xoay city), vẫn đúng quốc gia. Mục 3b
   kiểm `rotate: true` (đường dự phòng) vẫn xoay được sang city khác cùng nước.
4. **Khẳng định quan trọng nhất**: suốt cả chu trình **không hề gửi** `Vpn_ConnectToOptimal_NmSvc`
   lẫn `Vpn_GetOptimalGateway_NmSvc` — không dùng tin đó để quyết định bất cứ điều gì.
5. Profile khai quốc gia không khớp vùng HMA đang nối → từ chối, **không gửi lệnh ngắt** (từ
   chối trước khi đụng tay vào VPN, không phải đụng rồi mới phát hiện sai).
6. HMA đang tắt sẵn → từ chối (không biết nên nối lại vào đâu).
7. Bật lại thất bại → phải cảnh báo rõ **VPN CÓ THỂ ĐANG TẮT**, nói thẳng "đừng chạy profile
   nào lúc này".
8. Bật lại nhưng SAI NƯỚC (giả lập HMA tự fallback sang server khác) → phải báo thất bại rõ
   ràng, không im lặng cho qua.
9. `status()` chỉ gửi **đúng 1** lệnh đọc, không gửi lệnh nào làm đổi trạng thái VPN.

**Giới hạn đã biết:** không có gì đảm bảo IP mới **không bị siết sẵn** — pool của HMA là hữu hạn
và nhiều người dùng chung, nên có thể rút được một IP cũng đang bị TikTok hạn chế. Vì vậy tính
năng này giảm xác suất chứ không phải thuốc chữa tuyệt đối, và trần 6 lần/ngày tồn tại chính vì
lý do đó (đổi mãi cũng không thoát được thì vấn đề ở chỗ khác).

### Bổ sung (2026-08-06): việc CHỜ phải KHÓA NÚT, không chỉ hiện đếm ngược

**Lỗi thật, do người dùng bắt được:** bản đầu của việc chờ 1 phút chỉ **ghi đếm ngược vào dòng
trạng thái**. Người dùng thử ở máy mình và báo: *"khi bật lại HMA thì tôi ấn Chạy nó vẫn chạy
được luôn"* — tức việc chờ **không ngăn được đúng cái nó sinh ra để ngăn**. Yêu cầu: *"tôi muốn
khi bật lại thì disable nút đó luôn và hiện thị ở nút đó là từ 59s, khi hết 59s thì hiện Chạy".*

**Đã sửa — khóa **CẢ HAI** pha, không chỉ pha chờ.** Lúc rà lại mới thấy pha còn nguy hiểm hơn
đang **hở hoàn toàn**:

| Pha | Nhãn nút | Vì sao phải khóa |
|---|---|---|
| **Đang tắt/bật lại VPN** (`_vpnRunLock`) | `⏳ đổi IP` | HMA **vừa bị tắt** → bật profile lúc này là chạy bằng **IP THẬT**. Nguy hiểm hơn pha chờ mà bản đầu không hề chặn |
| **Chờ IP nguội** (`_vpnCooldownUntil`) | `⏳ 59s` → `⏳ 1s` | Tránh 5 phiên cũ đồng loạt xuất hiện trên IP vừa đổi (QĐ-15) |
| Hết chờ | `▶ Chạy` | **Mở khóa NGAY**, trước cả lúc app tự bật lại từng profile — VPN đã ổn định nên bấm tay là an toàn |

Nút **"■ Dừng" luôn bấm được** ở mọi pha — người dùng còn phải dừng được profile khác.

**3 cái bẫy đã xử, mỗi cái đều đủ để tính năng vô dụng trong im lặng:**

1. **`renderProfiles()` vẽ lại cả bảng** và **`setRowRunning()` ghi lại nhãn nút** — hai chỗ này
   không biết về khóa thì **chỉ cần một lần vẽ lại giữa lúc chờ là nút mở khóa trở lại**. Nên mọi
   đường ghi chữ lên nút đều phải đi qua `applyVpnCooldown()` (đúng bài học QĐ-10).
2. **Chỉ dựa vào `disabled` của nút là không kín** — `toggleProfile()` và `runSelected()` **tự
   kiểm tra lại** `vpnRunLocked()`. Cùng khuôn "backend không tin renderer" ở mục trên.
3. **Mở khóa phải nằm trong `finally`** — thiếu là nút **kẹt khóa vĩnh viễn** trên các đường
   `return` sớm (bị giới hạn nhịp, đổi IP thất bại, người dùng hủy giữa chừng), và người dùng
   không còn cách nào bật profile bằng tay.

**Sửa kèm — nút "■ Dừng" trên TỪNG HÀNG cũng phải hủy việc tự chạy lại.** Trước đây chỉ
`stopSelected()` làm việc đó, nên dừng bằng nút hàng thì app vẫn tự bật lại profile người dùng
vừa tắt. Đã dồn về **một chỗ duy nhất** trong `stopProfileById()` (cả hai đường đều đi qua đó);
`handleFeedStarved()` gọi `api.profileStop` **trực tiếp** nên không tự hủy lượt của chính nó.

### Bổ sung 2 (2026-08-06): phải khoá cả khi NGƯỜI DÙNG tự tắt/bật HMA

**Lỗi tiếp, cũng do người dùng bắt:** bản vá trên chỉ khoá nút trong `handleFeedStarved()`, tức
**chỉ khi APP tự đổi IP**. Người dùng tự tay tắt/bật HMA thì app **không biết gì** → nút Chạy vẫn
sáng. Họ gửi ảnh: HMA vừa `ON 00:00:02`, 5 profile đã dừng, mà cả 5 nút Chạy lẫn nút tổng đều sáng
bình thường. Yêu cầu chốt: *"kể cả app tự động hay là tôi thì đều phải là khi bật lại HMA thì các
nút chạy sẽ bị disable trong vòng 59 giây"*.

**Bài học chung:** một ràng buộc chỉ được cài ở **một trong nhiều đường** dẫn tới nó thì kể như
chưa có. Lần trước là "đường vẽ lại bảng ghi đè nhãn nút", lần này là "đường người dùng tự làm".
Phải hỏi **ai có thể gây ra trạng thái này**, không chỉ **code của tôi gây ra ở đâu**.

**Tín hiệu dùng để canh — chọn theo CHI PHÍ, đo trước khi chọn:**

| Cách | Chi phí đo thật | Kết luận |
|---|---|---|
| `status()` qua native messaging | **spawn `VpnNM.exe` + chờ 600ms** mỗi lần → poll 2s/lần ≈ **1800 tiến trình/giờ** | ❌ Quá tốn cho VPS yếu |
| `os.networkInterfaces()` (`tunnelState()`) | **2.1ms/lần**, đồng bộ, không spawn, không gọi mạng | ✅ Chọn cách này |

Đo trên máy thật: HMA bật → adapter `"HMA VPN WireGuard"` có IPv4 `10.252.32.18`; 3 lần đọc liên
tiếp **giống nhau** (ổn định, không sinh chuyển tiếp giả).

**So cả ĐỊA CHỈ, không chỉ cờ `up`** — nếu HMA nối lại mà adapter *không* biến mất thì `up` luôn
`true` và sẽ **không nhận ra lượt nối lại**; IP trong đường hầm thì vẫn đổi
(`10.252.32.18` → `10.252.40.7`). Nhờ vậy hàm đúng ở **cả hai kiểu hành vi** của adapter, không
phải đoán kiểu nào.

**Lần poll đầu chỉ LẤY MỐC, không hành động.** Nếu coi lần đọc đầu là "VPN vừa sập" thì máy mở app
lúc HMA đang tắt — hoặc **máy không cài HMA** — sẽ bị khoá nút ngay khi mở app, không bấm được gì.
Chỉ hành động khi thấy trạng thái **ĐỔI**. Đó cũng là lý do hàm này **an toàn khi sai**: nếu HMA đổi
tên adapter thì `up` bất biến `false` → không sinh chuyển tiếp → **mất tính năng, không khoá oan**.

**Ba trạng thái, ba nhãn khác nhau** (gộp thành một chữ là bắt người dùng đoán):

| Nhãn nút | Khi nào | Người dùng phải làm gì |
|---|---|---|
| `⏳ đổi IP` | App đang tắt/bật lại VPN | Chờ, app tự lo |
| `⛔ VPN tắt` | VPN **đang tắt** (họ tắt / VPN tụt) | **Bật lại HMA** |
| `⏳ 59s` → `⏳ 1s` | VPN vừa lên | Chờ hết đếm ngược |

Khi VPN tắt mà **còn profile đang chạy**, app cảnh báo rõ số lượng: *"⚠ Còn 2 profile ĐANG CHẠY:
nên dừng ngay, chúng đang dùng IP thật"*. **Không tự dừng** — người dùng đang chủ động điều khiển
VPN, tự ý dừng profile của họ là vượt quyền.

**Chạy BẤT KỂ công tắc "Tự đổi IP".** Công tắc đó quyết định app có **tự** đổi IP hay không; còn
việc phản ánh trạng thái VPN lên nút bấm là chuyện khác — người dùng chốt "kể cả app tự động hay
là tôi".

**Một bộ đếm duy nhất** (1 giây/nhịp) lo cả việc vẽ đếm ngược và canh đường hầm (2 giây/lần) — hai
timer cùng ghi vào nút là lặp lại đúng bẫy QĐ-10.

**Kiểm chứng:** `test/vpn-run-lock.test.js` — **54 khẳng định**. Test **trích đúng mã nguồn** 6 hàm
quyết định từ `renderer.js` rồi chạy trong Chromium với DOM thật — **không chép logic sang test**,
vì bản chép sẽ lệch âm thầm và test pass trong khi app hỏng. Phủ đủ: lần poll đầu chỉ lấy mốc, máy
không cài HMA không bao giờ bị khoá, tắt→bật, bật→tắt, chu trình đầy đủ, **nối lại mà adapter còn
nguyên**, poll lại khi không có gì đổi **không được đặt lại đồng hồ** (nếu không thì đếm ngược đứng
mãi), app đang tự đổi IP thì bộ canh đứng ngoài, và cảnh báo khi tắt VPN lúc còn profile chạy.

Đã kiểm test có "cắn": đổi `btn.disabled = locked` thành `= false` → 2 khẳng định trượt ngay.

⚠️ **Bẫy trong chính test** (đã sửa, ghi lại để không lặp): hàm trích mã nguồn tìm
`"function <tên>("` nên với `async function watchVpnTunnel` nó **cắt mất chữ `async`** → thân hàm
có `await` → SyntaxError → cả harness không nạp được và Playwright báo `"T is not defined"`, một
thông báo **chẳng liên quan gì** tới nguyên nhân. Hàm trích phải kéo theo `async` phía trước.

---

## QĐ-33 — Link TikTok trả "Something went wrong": KHÔNG bỏ nữa, đưa sang TAB CHỜ kiểm tay

**Sự cố thật (2026-08-06):** người dùng thấy app *"bỏ qua rất nhiều sound không rõ nguyên nhân"*.
Mở tay các link bị bỏ thì trang `/music/` hiện **"Something went wrong — Sorry about that! Please
try again later."** Nhưng phần header **vẫn có đủ** tên sound, tác giả (`duita102`) và **số video
(`19 videos`)** — tức **sound VẪN TỒN TẠI**, chỉ là TikTok lỗi lúc dựng phần lưới video. Đối
chiếu với một link bình thường thì trang hiện đủ lưới video.

**Xung đột với QĐ-07 và cách giải.** QĐ-07 chốt: *"API lỗi → đọc giao diện → cả hai lỗi thì BỎ
LINK, không ghi dòng `?`"*, lý do người dùng đưa ra là *"thà mất một ít link còn hơn dữ liệu
bẩn"*. Nhưng "một ít" hoá ra là **rất nhiều**, và những link đó **không phải sound chết** — bỏ
hẳn là mất dữ liệu thật.

Cách giải **không phá QĐ-07**: dữ liệu chính vẫn sạch tuyệt đối (không có dòng `?` nào lọt vào
bảng/tab chính), nhưng link lỗi được ghi sang **một tab RIÊNG** để người kiểm tay. QĐ-07 vẫn
đúng ở chỗ nó bảo vệ — chỉ là chỗ chứa link lỗi giờ không còn là thùng rác.

**Phân biệt 2 ca — khác nhau hoàn toàn:**

| Ca | Dấu hiệu | Xử lý | Vì sao |
|---|---|---|---|
| Sound **đã bị xóa** | API trả HTTP 400 + `statusCode 10201` (đã verify, QĐ-06) | **BỎ HẲN** | Không có gì cho người kiểm — sound không còn tồn tại |
| Sound **còn sống** nhưng không đọc được số | API lẫn DOM đều không ra số (gồm ca "Something went wrong") | **→ TAB CHỜ** | Dữ liệu thật, đáng giữ lại |

### Bổ sung (2026-08-06): BẬT SẴN với tên tab mặc định — "để trống = tắt" là sai thiết kế

**Quyết định:** ô "Tên tab CHỜ KIỂM TAY" để trống **không còn nghĩa là tắt**. Trống → dùng
`PENDING_TAB_DEFAULT = "Total_Link_Voice_Pending"`. Đường tắt bây giờ là **xoá/đổi tên tab trên
Sheet**: app tự phát hiện, **ngưng cho cả phiên** và báo rõ *"link không đọc được số video sẽ bị
BỎ"*.

**Vì sao đảo ngược:** cấu hình nằm trong `electron-store` tại `%APPDATA%` — **riêng từng máy,
không đồng bộ qua Sheet**. Người dùng chạy **5 máy** (1 chính + 4 VPS). Kết quả thật: họ hỏi
**3 lần** *"sao tôi không thấy link nào ở tab Total_Link_Voice_Pending"*, và **cả 3 lần** nguyên
nhân đều là ô trống ở đúng cái máy đang chạy. Lần thứ 3 họ gửi ảnh chứng minh thiệt hại: một sound
**262K video** bị bỏ ở VPS (`/music/original-sound-7385710780424243974` — VPS hiện "Something went
wrong", máy chính mở cùng link thì hiện `som original · 262K video`).

**Bài học rút ra:** một tính năng **cứu dữ liệu** mà mặc định TẮT và phải bật tay trên từng máy thì
trên thực tế là **KHÔNG TỒN TẠI**. Chi phí của mặc định sai lệch về hai phía không bằng nhau:

| Mặc định | Nếu sai thì sao |
|---|---|
| **TẮT** (cũ) | **Mất dữ liệu vĩnh viễn, im lặng** — không có dấu vết nào để phát hiện |
| **BẬT** (mới) | Ghi thêm vài dòng vào một tab; nếu tab không có thì app **báo ngay** ở dòng thông báo |

Chọn mặc định phải theo **hậu quả khi sai**, không theo "cẩn thận thì để tắt". Đây cũng **không
phải đoán ý người dùng**: họ đã nêu **đúng tên tab này 3 lần** trong lúc chốt yêu cầu, và nó vốn
là chuỗi gợi ý sẵn trong ô nhập (mà họ tưởng là giá trị đã lưu — chính chỗ đó gây nhầm).

**Hai đường phát hiện tab không tồn tại, đều phải tự ngưng:**

| Lúc nào | Xử lý |
|---|---|
| **Đầu phiên** (`seedPendingLinks`) | Rẻ nhất — 1 lần gọi API. Trả `{missingTab}` để `main.js` in câu chỉ đúng chỗ sửa kèm **5 tiêu đề cần tạo** |
| **Giữa phiên** (tab bị xoá lúc đang chạy, `flushPending`) | **Xoá lô, không hẹn thử lại.** Đường "giữ lô thử lại" bình thường (cho lỗi mạng/quota) mà áp vào đây sẽ thành **thử lại mãi mãi mỗi 5 giây** |

**Kiểm chứng:** `test/sheets-pending.test.js` lên **40 khẳng định** — thêm mục 4 (ô trống → dùng
tên mặc định, vẫn không làm bẩn tab chính) và 4b (cả hai đường phát hiện thiếu tab: tự ngưng,
**không gọi API nào nữa**, thông báo có tên tab + nói thẳng hậu quả; sửa tên tab thì xoá cờ ngưng
để thử lại). Mock trả **nguyên văn** `HTTP 400 "Unable to parse range: X!B:B"` như Google thật, để
test còn kiểm được đường dịch lỗi của QĐ-26.

**Ghi gì vào tab chờ:** 4 cột `A:D` y như tab chính — Tên sound | Link | Số video | Profile.
Cột **Số video để TRỐNG** (không đọc được thì không bịa). Cột **"Tình trạng" (E) TUYỆT ĐỐI không
ghi** — người dùng tự điền, đó là yêu cầu rõ ràng.

**KHÔNG tự tạo tab.** Người dùng đã phản đối việc app tự thêm tab lạ lên Sheet của họ — QĐ-19 đã
phải chuyển `_locks` sang **ẩn** vì chuyện đó. Tab chờ do người dùng tự tạo (họ đã tạo sẵn
`Total_Link_Voice_Pending` với đúng 5 tiêu đề); thiếu tab thì báo lỗi chỉ đúng chỗ sửa (dùng lại
đường dịch lỗi của QĐ-26), không im lặng bỏ qua.

**Để trống tên tab = TẮT tính năng** — link lỗi lại bị bỏ như trước. Mặc định tắt, không bật ngầm.

**Link ở tab chờ VẪN được thử lại ở phiên sau — cố ý.** `seedPendingLinks()` chỉ nạp vào
`_pendingKnown` (chặn ghi trùng), **không** nạp vào `_knownLinks` của tab chính lẫn bộ lọc quét
`_collected` của crawler. Lý do: "Something went wrong" thường là **lỗi tạm thời**; lần sau đọc
được số video thật thì sound vào **tab CHÍNH với dữ liệu đầy đủ** — tốt hơn hẳn việc nằm mãi ở
tab chờ. Mà vẫn không sinh dòng trùng vì `_pendingKnown` chặn ở cửa ghi.

Hệ quả đã chấp nhận: một sound có thể **vừa ở tab chờ, vừa ở tab chính** (chờ từ lần lỗi, chính
từ lần đọc được). Người dùng dọn tay khi xử lý tab chờ — đổi lấy việc không mất dữ liệu.

**Dùng lại hạ tầng sẵn có, không viết lại:** `appendRows` (phạm vi `A:Z`, QĐ-08), `normalizeKey`
(so trùng theo ID nên slug khác ngôn ngữ vẫn nhận ra là cùng sound, QĐ-10), cầu dao quota
(QĐ-24 — bị chặn thì giữ lô, hẹn lại đúng phần cooldown còn lại), và nguyên tắc **không bỏ rơi
lô lỗi** (trả về đầu buffer để thử lại, như `flush()` chính).

**Kiểm chứng:** `test/sheets-pending.test.js` — **26 khẳng định**, mock `google-api.cjs` (không
gọi mạng): ghi đúng 4 cột (**không** có cột E), ghi đúng tab chờ và **tuyệt đối không** ghi vào
tab chính, không ghi trùng (link đã có trên Sheet / vừa ghi / **cùng ID khác slug ngôn ngữ**),
để trống tên tab = tắt hoàn toàn (không gọi API nào), đổi tên tab thì quên danh sách tab cũ,
và lỗi ghi thì **giữ lại lô rồi ghi lại được** (không mất dữ liệu).

**Bổ sung (2026-08-06) — ĐO LẠI: "Something went wrong" KHÔNG ngăn app đọc số video.**

Người dùng báo *"sao tôi không thấy link nào trên tab Total_Link_Voice_Pending"* và cho rằng các
link bị bỏ là do trang lỗi. Đo thẳng chính link trong ảnh họ gửi
(`/music/original-sound-7654496108030675725`) bằng đúng cách `countLoop` làm:

```
API api/music/detail/ : HTTP 200 · statusCode=0 · videoCount=16
DOM readVideoCount()  : "16"   (thẻ <h2 data-e2e="music-video-count">16 videos</h2>)
Trang                 : BÌNH THƯỜNG, không có "Something went wrong"
→ App đọc được số = 16
```

Sound đó bị bỏ vì **chính bộ lọc của người dùng** (`minVideos=1000` → `16 < 1000`), **không phải**
vì lỗi trang. Và chính ảnh họ gửi là bằng chứng: nó hiện `19 videos` **cùng lúc** với dòng
"Something went wrong" — tức **header (chứa số) vẫn dựng bình thường**, chỉ **lưới video** bị lỗi.
App đọc số từ API + header, **không** đọc từ lưới, nên lỗi đó **vô hại** với việc đếm.

Hệ quả: tab chờ đúng ra sẽ **rất ít link** — chỉ khi API *lẫn* header đều lỗi thật. Đó là hành vi
đúng, không phải tính năng hỏng. Nguyên nhân thật của "không thấy link nào" là
**`pendingTab` chưa được điền** trong ☁ Google Sheet (đọc thẳng `config.json` mới ra:
`pendingTab: undefined`) → tính năng đang TẮT.

Người dùng chốt lại phạm vi sau khi biết số đo: **chỉ** link không đọc được số video vào tab chờ,
**không** đưa link bị lọc vì ngoài ngưỡng vào (ngưỡng là bộ lọc có chủ đích của họ).

**Bổ sung (2026-08-06) — công tắc HIỆN TAB ĐẾM phải dùng CHUNG context, không mở browser thứ hai.**

Để người dùng soi được trang `/music/` bằng mắt, tôi thêm công tắc *"Hiện tab đếm"*. Cách làm đầu
tiên: mở `_ensureSharedHeadless()` ở chế độ **hiện**. **Sai hướng** — Playwright mở mỗi
browser/context thành **cửa sổ riêng**, nên nó sinh ra **CỬA SỔ THỨ HAI** cạnh cửa sổ profile,
tốn thêm cả một instance Chromium. Người dùng gửi ảnh 2 cửa sổ và bác ngay: *"nên hiện chung
trong 1 browser thôi, đừng để 2 browser thế kia rất tốn RAM"*.

Cách đúng: khi bật công tắc thì **dùng chính context của profile** (`{ ctx: seedContext, shared:
true }`) — tab đếm thành **một TAB trong cùng cửa sổ**. Đây chính là đường mà chế độ persistent đã
đi sẵn, chỉ là dùng lại cho mục đích chẩn đoán. Được thêm 2 thứ miễn phí: **không** thêm instance
nào, và cookie/vân tay **tự khớp** (khỏi copy).

Đo thật bằng CDP `Browser.getWindowForTarget` trên đúng cấu hình người dùng (`persistent:false`,
`headless:false`):
```
trang FEED : windowId = 499155786
trang ĐẾM  : windowId = 499155786   → CÙNG cửa sổ = 2 TAB
log        : chỉ "Đã mở Chromium dùng chung (hiện)", không có instance thứ hai
```

`_ensureSharedHeadless()` được trả về **luôn ẩn** — nó cũng được `verifyProfileLogin` (nút 🔑)
dùng, mà nút đó không có lý do gì phải hiện cửa sổ ra.

⚠ Giới hạn: chỉ **thấy** được nếu profile đang chạy ở chế độ **hiện**; profile chạy ẩn thì cửa sổ
chung cũng ẩn. Đã ghi rõ trong UI.

⚠ **Bài học:** đừng tin việc "người dùng thấy trang lỗi" là đủ để kết luận nguyên nhân — mở đúng
link đó bằng đúng đường code đi mới biết. Ở đây suy luận hợp lý ("trang lỗi ⇒ không đọc được số")
lại sai, vì phần lỗi và phần app cần đọc là **hai phần khác nhau của trang**.

⚠ **Bài học lúc viết test (lặp lại đúng bẫy QĐ-09):** ban đầu tôi dùng ID sound giả ngắn (`222`,
`111`). `_extractMusicId` đòi **tối thiểu 8 chữ số**, nên ID ngắn không trích được ID → `normalizeKey`
lùi về so **nguyên văn URL** → 2 slug khác ngôn ngữ của cùng một sound bị coi là 2 sound khác
nhau, và khẳng định lọc trùng thành **vô nghĩa** (test đã bắt được ngay). Phải dùng **ID dài 19
chữ số thật** — hiện đang dùng đúng 2 ID lấy từ ảnh người dùng gửi.

---

## QĐ-34 — Bước đếm KHÔNG được giữ slot toàn cục quá lâu: đó là gốc rễ của "feed ngừng cuộn" trên máy ảo

**Hiện tượng người dùng báo (2026-08-06):** máy ảo *"cứ dừng mãi ở 1 video"*, link sound không đổi,
**mà không hề bị TikTok chặn**. Máy chính thì bình thường. Họ tự chẩn đúng một nửa: *"tại vì nó
không cuộn lướt video nữa"*.

**Chuỗi nhân quả (đo bằng số, không đoán):**

```
readVideoCount có trần RIÊNG 5s mỗi lần gọi
   → "6 vòng × 500ms" KHÔNG phải 3s: trên máy chậm là tới 30s (12 vòng → 60s)
   → suốt thời gian đó GIỮ 1 trong 2 slot đếm TOÀN APP
   → thông lượng đếm tụt còn 2–4 sound/phút (VPS lag)
   → nhưng vòng quét cuộn ra ~20 sound/phút
   → hàng đợi QUEUE_MAX=20 ĐẦY VĨNH VIỄN
   → vòng quét đứng ở `while (soundQueue.length >= QUEUE_MAX)`
   → FEED NGỪNG CUỘN
```

| Máy | Trước | Sau |
|---|---|---|
| Khoẻ (`evaluate` ~50ms) | 14.2s giữ slot → 8.5 sound/phút | 9.3s → **12.9/phút** |
| VPS lag (~800ms) | 27.7s → 4.3/phút | 9.3s → **12.9/phút** |
| VPS rất lag (~2s) | 49.3s → **2.4/phút** | 9.3s → **12.9/phút** |

**Quyết định 1 — ngân sách tính bằng ĐỒNG HỒ, không đếm vòng.** `COUNT_DOM_BUDGET_MS = [2500, 5000]`.
Đếm vòng thì chi phí phụ thuộc *máy chậm đến đâu* — tức là **không có trần**. Đếm giờ thì có trần
cứng, và đó chính là thứ làm cột "Sau" ở trên **bằng nhau ở mọi loại máy**.

**Quyết định 2 — NHẢ slot trong lúc ngủ giữa 2 lượt thử lại.** Bản đầu (cùng ngày) giữ nguyên slot
với lý lẽ *"TikTok đang lỗi thì chậm lại là đúng hướng"*. **Lý lẽ đó sai**: slot là tài nguyên
**TOÀN APP** (2 slot cho mọi profile), không phải của riêng sound đó. Giữ slot lúc ngủ = chặn cả 5
profile trên máy vì một link hỏng.

⚠️ **Tự phê bình:** hai lỗi trên do **chính bản vá thử-lại của tôi cùng ngày** gây ra, và nó biến
một vấn đề đã có (`30.8/phút`) thành vấn đề nghiêm trọng (`2.4/phút`). Bài học: khi thêm việc vào
một đoạn đang **giữ tài nguyên dùng chung**, phải tính lại **thông lượng**, không chỉ tính "tốn thêm
mấy giây cho một link". Câu hỏi đúng là *"cái này giữ tài nguyên chung bao lâu, và ai đang chờ?"*.

### Bổ sung (2026-08-06): hai CHẾ ĐỘ ĐẾM, chọn theo từng máy

**Vì sao có công tắc thay vì chọn một cách.** Người dùng chạy **cùng một file `.exe`** trên 5 máy,
mà máy chính (mạnh) và máy ảo (yếu) cần đánh đổi **ngược nhau**. Họ nhìn mô tả quy trình của một máy
đang chạy **v0.1.63** rồi yêu cầu *"setup quy trình check số video của máy kia vào máy này"*. Sửa
code là đổi **cả 5 máy** — đúng thứ vừa gây đứng feed trên VPS. Nên biến nó thành **cài đặt riêng
từng máy** (`count_mode` trong electron-store, chọn ở ⚙):

| Chế độ | Chờ API | Ngân sách đọc giao diện | Số lượt | Dùng cho |
|---|---|---|---|---|
| `fast` **(mặc định)** | 8s | 2.5s / 5s — **trần cứng** | 2 (có thử lại) | Máy ảo / máy yếu |
| `patient` | 20s | 30s | 1 (không thử lại) | Máy mạnh — đúng khuôn v0.1.63 |

**Mặc định là `fast`** vì hai hướng chọn sai không đối xứng: sai ở máy mạnh chỉ **mất chút cơ hội**
đọc được link chậm; sai ở máy yếu là **ĐỨNG FEED** (đo thật: 1 sound lỗi chiếm slot đếm toàn app
~28 giây → thông lượng ~4 sound/phút trong khi vòng quét cần ~20 → hàng đợi đầy vĩnh viễn).

⚠️ **Một điểm KHÔNG sao chép nguyên văn v0.1.63:** bản đó đọc giao diện bằng *"6 vòng × 500ms"*, mà
mỗi lần đọc có trần riêng 5 giây → vòng đó **không có trần thật** (máy yếu trôi tới 30 giây).
`patient` dùng **ngân sách 30 giây**: trên máy mạnh hành vi y hệt v0.1.63 (6 vòng × ~550ms ≈ 3.3s là
xong), còn máy yếu thì có trần thay vì trôi tự do. **Cố ý không dựng lại vòng không trần** — chính
nó là bug.

Thông số được **chốt một lần cho mỗi sound** (`const cfg = _countCfg()`), nên đổi cài đặt giữa dòng
không làm sound đang chạy đổi luật. Biến môi trường (`TTC_COUNT_API_MS`, `TTC_COUNT_ATTEMPTS`,
`TTC_COUNT_RETRY_MS`) vẫn **ghi đè** chế độ — để soi lỗi không cần vào ⚙.

**Kiểm chứng:** `crawl-modes.test.js` kiểm **hành vi thật**, không chỉ đọc hằng số: cùng một kịch bản
(lượt 1 `statusCode` lạ, lượt 2 API tốt) thì `patient` **mất sound vào tab chờ** còn `fast`
**cứu được** với số đúng `4321`. Đó là bằng chứng công tắc có tác dụng, không phải cài đặt trang trí.

---

**Quyết định 3 — trần chờ API 20s → 8s** *(áp cho chế độ `fast`)*. Đo được đây mới là phần **TỐN NHẤT**: trang lỗi thì
`api/music/detail/` **không bao giờ chạy**, nên mỗi lượt đốt trọn 20 giây mà không thu được gì —
2 lượt = 40s/sound. 8 giây là dư: `waitForResponse` đăng ký **trước** `goto`, mà trang tự gọi API
ngay lúc tải nên response bình thường về trong ~1s. Đoán sai cũng chỉ rơi xuống bước đọc giao diện,
**không mất dữ liệu**. Chỉnh được bằng `TTC_COUNT_API_MS`.

**Quyết định 4 — TẮC HÀNG ĐỢI thì BỎ lượt thử lại.** Thử lại là thứ *đáng có* nhưng **không đáng
đánh đổi việc feed đứng hẳn**. Khi hàng đợi đã quá nửa, bước đếm chính là cổ chai. Bỏ lượt 2
**không mất link**: nó vẫn vào **tab chờ**, và link ở tab chờ vẫn được thử lại ở phiên sau (QĐ-33).
Đổi lại feed chạy tiếp — quét được sound mới đáng giá hơn.

**Toàn cảnh, đo trên đúng ca người dùng gặp** (TikTok trả trang lỗi; 4 profile × 20 sound chờ):

| Bản | s/sound | sound/phút | Tiêu hết 80 sound |
|---|---|---|---|
| v0.1.64 (bản đang chạy trên máy ảo) | 132.5s | 0.9 | **88 phút** |
| + ngân sách DOM bằng đồng hồ | 50.0s | 2.4 | 33 phút |
| + trần chờ API 8s | 26.0s | 4.6 | 17 phút |
| + tắc hàng đợi thì bỏ lượt 2 | **10.5s** | **11.4** | **7 phút** |

⚠️ **Bài học lặp lại LẦN THỨ HAI trong cùng một ngày:** vá xong "ngân sách DOM" tôi tưởng đã xong,
mà **chưa đo lại toàn bộ đường đi** — nên bỏ sót `waitForResponse` 20s, vốn là phần lớn nhất
(40/132 giây). Phải **đo lại cả đường đi sau mỗi lần vá**, không chỉ đo phần vừa sửa.

### Bổ sung (2026-08-06): NHỊP CUỘN TỰ GIÃN + phát hiện kẹt theo THỜI GIAN

Ba bản vá trên làm bước đếm **nhanh hơn**, nhưng cổ chai vẫn còn thật. Người dùng yêu cầu tiếp:
*"tránh bị đứng feed, nếu đứng thì bạn phải có cách để nó cuộn tiếp"*. Hai thay đổi:

**1. Thay ngưỡng BẬT/TẮT bằng GIÃN DẦN.** Trước đây vòng quét chạy **hết tốc** cho tới lúc hàng đợi
đầy `20/20` rồi **ĐỨNG HẲN** ở nhánh chờ. Chính hành vi bật/tắt đó là hiện tượng "đứng feed" — không
phải TikTok chặn. Giờ nghỉ giữa 2 lần cuộn **nhân theo áp lực hàng đợi**:

| Hàng đợi | Hệ số | Delay thực (gốc 2–4s) | Nhịp quét tối đa |
|---|---|---|---|
| < 50% | ×1 | 2–4s | 20 sound/phút |
| 75% | ×2.5 | 5–10s | 8 sound/phút |
| 100% | ×4 | 8–16s | 5 sound/phút |

Vòng quét **tự khớp tốc độ** với bước đếm (chế độ `fast` cho ~11–13 sound/phút) nên **hiếm khi tới
ngưỡng đầy**. Vì sao đây là cách đúng: bước đếm là cổ chai **có thật**, không xoá được — nhưng "chậm
dần" giữ feed **luôn chuyển động**, vừa không mất sound nào (khác với cuộn qua mà không thu), vừa
không để một video mở đứng hàng phút (bản thân việc đó cũng là tín hiệu bất thường với TikTok).
⚠️ **Vẫn giữ ngưỡng đầy** làm chốt chống hàng đợi phình vô hạn — chỉ là giờ rất ít khi tới.

**2. Phát hiện kẹt phải có TRẦN THỜI GIAN, không chỉ đếm lần.** Hệ quả trực tiếp của thay đổi 1:
nhịp giãn tới ×4 nghĩa là 20 lần đọc có thể mất **tới 5 phút** mới tới ngưỡng — quá chậm. Thêm điều
kiện: **ở trên cùng 1 sound quá 90 giây** (và đã đọc ít nhất 5 lần) cũng là kẹt.

- Đòi **tối thiểu 5 lần đọc** vì người dùng có thể đặt delay rất lớn (30s) — kết luận từ 1–2 lần đọc
  là báo oan.
- ⚠️ **Cố ý đo "cùng 1 sound bao lâu", KHÔNG đo "bao lâu không có sound MỚI"**: người dùng đã nạp
  173.000 link để lọc trùng nên feed khoẻ vẫn có thể hàng phút không ra sound mới — đo cái đó là báo
  oan hàng loạt. Đây đúng bài học mà chính bộ tracker này đã ghi ở đầu file.
- ⚠️ `clearStuck()` phải reset **cả đồng hồ**. Không reset thì sau lần can thiệp đầu, vòng đọc kế
  tiếp đã "quá 90s" → báo kẹt ngay → cách vừa thử không có cơ hội tỏ hiệu quả. Đúng cái bẫy mà chú
  thích `clearStuck()` đã cảnh báo với `lastHref`.

**Kiểm chứng:** đã kiểm cả hai có "cắn" — bỏ hệ số giãn nhịp → 1 khẳng định trượt; bỏ điều kiện thời
gian → 2 khẳng định trượt. Test kiểm cả **đường không báo oan** (2 lần đọc dù đã quá 90s → không báo)
và **đường `clearStuck` reset đồng hồ**.

---

**Kiểm chứng:** `crawl-modes.test.js` có **spy trên semaphore** kiểm cả hai chiều — xin/nhả phải
**cân bằng** (nhả thừa làm semaphore tưởng còn chỗ → hơn 2 request `/music/` song song, đúng thứ
QĐ-21 sinh ra để chặn), và thử lại phải **xin slot 2 lần riêng biệt** (bằng chứng có nhả ra lúc
ngủ). Đã kiểm test có "cắn": bỏ dòng nhả slot → 2 khẳng định trượt ngay.

---

## Những điều KHÔNG nên làm lại

| Đã thử | Kết quả |
|---|---|
| Tinh chỉnh giảm số tiến trình Firefox (`dom.ipc.processCount=1`…) | Gây crash "Your tab just crashed" — đừng chống lại mô hình đa tiến trình |
| Tự tính số dòng rồi ghi cứng lên Sheet | 2 máy ghi đè lẫn nhau |
| Chuyển sang chế độ hiện để tránh bị chặn trang đếm | Đã A/B test: ẩn và hiện giống hệt nhau, không phải nguyên nhân |
| Chuyển toàn bộ sang FirefoxPortable cho "đỡ ngốn RAM" | Đo thật thì Firefox tốn HƠN: 13 tiến trình / 4.6GB / CPU 60% so với Chromium 8–10 / 3.2GB / 23–32% — xem QĐ-27 |
| Bật `launchPersistentContext` cho mọi profile thay cho file cookie | Mỗi profile thành 1 Chromium riêng → mất lợi ích "1 Chromium dùng chung" (~+1GB với 5 profile). Phải là công tắc, mặc định tắt — xem QĐ-27 |
| Mở **persistent context thứ hai** trên cùng một `user-data-dir` | Chromium báo "profile is already in use" — nút 🦊 phải dùng lại đúng context đang mở, xem QĐ-27 |
| Suy từ đó ra rằng tab đếm **không thể** tách khỏi context của profile persistent | Chẩn đoán SAI PHẠM VI: trình duyệt đếm ẩn dùng `chromium.launch()` + `newContext()` + copy cookie, KHÔNG mở `persistDir` → không đụng khóa. Vì tin nhầm điều này mà chạy HIỆN bị lòi tab `/music/` vào cửa sổ người dùng — xem bổ sung 2026-08-05 của QĐ-27 |
| Đặt cài đặt **toàn app** vào modal mở ra **từ một profile** | Người dùng hiểu theo vị trí điều khiển, không theo chữ "(toàn app)" ghi cạnh → báo là bug ngay hôm phát hành. Vị trí là lời hứa về phạm vi — xem QĐ-28 |
| Giữ chế độ profile bằng **cờ module toàn cục** (`setPersistentProfiles`) | Không thể trộn 2 chế độ trên cùng máy → mất khả năng A/B test cùng IP/cùng giờ, mà đó mới là so sánh sạch. Phải truyền option mỗi lần mở — xem QĐ-28 |
| Cho nút 🦊 mở bằng chế độ khác với lúc crawl | Đăng nhập xong "không ăn": ghi vào thư mục Chromium mà lượt chạy đọc file cookie (hoặc ngược lại) — xem QĐ-28 |
| Kiểm quyền phát hành bằng `.permissions.push` của repo | Đó là quyền của **tài khoản**, không phải scope của **token**. Repo chuyển public → luôn `true` dù token không có scope nào → gate BÁO PASS SAI, build xong 8 phút mới lãnh 404. Phải đọc header `X-Oauth-Scopes` |
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
| So trùng link bằng nguyên văn URL (kể cả đã lowercase) thay vì trích ID | Bài hát có bản quyền giữ nguyên slug tên bài — TikTok trả slug hơi khác nhau cho cùng 1 ID (viết hoa/thường, dấu nháy, chuẩn hóa Unicode chữ không phải Latin) → bị đẩy trùng lên Sheet — xem QĐ-10 |
| Tin rằng `await startProfileById()` là đủ để bật profile tuần tự | `crawler.startProfile()` trả về NGAY (vòng crawl chạy nền) → 5 profile khởi động gần như cùng lúc, tranh chấp CPU làm 1-2 profile bị chẩn đoán nhầm là kẹt feed — xem QĐ-21 |
| Để trần hàng đợi đếm quá lớn (500) | Backlog phình to → khoảng cách Quét/Đã check lớn, và đó chính là số sound MẤT khi bấm Dừng cứng; quét nhanh hơn cổ chai chỉ để dồn hàng rồi mất — xem QĐ-21 |
| Vòng chờ/tạm dừng trong luồng crawl mà không phát status ra UI | Bảng đứng yên không một dòng thông báo → người dùng tưởng app treo, báo là bug — xem QĐ-21 |
| Quay vòng thoát kẹt cách 1→2→3 vô hạn khi feed đã CẠN | Gần 2 giờ cho ra 0 sound hợp lệ, mà càng thử càng dội. Bước ĐẾM có backoff từ lâu, vòng QUÉT thì không — phải có — xem QĐ-31 |
| "Dừng rồi chạy lại" profile khi feed cạn | Cấp 3 của thoát kẹt ĐÃ là tải lại trang và đã thất bại; restart chỉ là reload đắt hơn với cùng IP/cookie/vân tay. Vòng dừng-chạy liên tục chính là "càng dội càng bị chặn sâu" — xem QĐ-31 |
| Gộp "KHÔNG có nút kế tiếp" với "CÓ nút nhưng đang bị TẮT" thành cùng một thông báo | Hai thứ nghĩa khác hẳn: ca sau là bằng chứng TRỰC TIẾP TikTok nói hết video. Gộp lại thì đọc log không phân biệt được feed cạn với cơ chế cuộn hỏng — xem QĐ-31 |
| Kết luận "feed cạn" chỉ từ một dấu hiệu (vd trang còn ≤2 video) | Feed vừa tải lại cũng có lúc tạm 1–2 video → báo oan làm profile KHOẺ tự tạm dừng, tệ hơn cả bệnh. Phải đủ 4 điều kiện + không phải khách — xem QĐ-31 |
| Dùng status `error` cho thông báo TẠM DỪNG khi profile VẪN đang sống | Renderer coi `error` là đã dừng → hàng đổi về nút "▶ Chạy", bấm vào bị từ chối "Profile đang chạy". Phải dùng `running`. Đường canh IP (QĐ-17) đang mắc đúng lỗi này — xem QĐ-31 |
| Tin "bộ test pass" khi bộ test đó KHÔNG có assertion nào | `crawl-modes.test.js` (13 kịch bản gốc) chỉ `console.log` rồi `exit(0)` — pass chỉ nghĩa "không ném lỗi", không phải "hành vi đúng". Phải có người đọc output, hoặc thêm khẳng định thật — xem QĐ-31 |
| Kết luận "chế độ KHÁCH" từ MỘT lần đọc DOM rồi dừng cả profile | Trang TikTok lúc hydrate hiện nút Log in thoáng qua → báo khách OAN, dừng oan; nút 🔑 đọc lại 24s nên không bị, gây mâu thuẫn "🔑 nói đăng nhập mà ▶ nói khách" — xem QĐ-22 |
| Thêm vòng chờ/đọc lại nhiều lần mà không nhận cờ `stop` | Bấm Dừng phải chờ hết cửa sổ (tới 20s) mới phản hồi — xem QĐ-22 |
| Dùng lại `.result-table` (min-width 720px) cho bảng trong modal hẹp | Ép sinh thanh cuộn ngang, bó hết nội dung — modal cần bộ style riêng, xem QĐ-23 |
| Đọc lại TOÀN BỘ cột Link mỗi lần đồng bộ chống trùng liên máy | Tab 156k dòng mất hàng chục giây → chỉ dám chạy 5–15 phút/lần, chính khoảng hở đó sinh trùng. Dòng mới luôn ở cuối nên đọc TĂNG DẦN phần đuôi vừa nhanh hơn vừa nhẹ hơn — xem QĐ-09 |
| Dựng ID dài trong test bằng phép CỘNG số (`76000000000000000 + n`) | Vượt `Number.MAX_SAFE_INTEGER` → mọi `n` ra CÙNG một số → mọi link test giống nhau → test pass VÔ NGHĨA, che mất bug thật. Phải ghép CHUỖI — xem QĐ-09 |
| Gọi Google API mà không xử lý riêng 429/quota | Gặp là ném lỗi như lỗi mạng thường rồi timer 5s thử lại → càng dội, càng bị chặn sâu. Phải có cầu dao tạm ngưng — xem QĐ-24 |
| Để nguyên thông báo lỗi thô của Google cho người dùng đọc | `Unable to parse range: Data!B:B` nghe như lỗi cú pháp, thực ra là THIẾU TAB — người dùng mất thời gian tưởng bug code. Phải dịch thành câu chỉ đúng chỗ sửa — xem QĐ-26 |
| Ghi số liệu định kỳ vào dòng trạng thái dùng chung với thông báo lỗi | Lỗi bị xóa trước khi người dùng kịp đọc (QĐ-25). Nhưng luật "chỉ ghi khi rảnh" lại làm SỐ LIỆU biến mất vĩnh viễn khi có câu nào đậu ở đó — hỏng 2 lần. Phải cho mỗi thứ MỘT Ô RIÊNG — xem QĐ-29 |
| Để nút bấm `await` một IPC có gọi mạng mà không khoá nút / không đổi chữ | Nút trông như chết, người dùng bấm lại nhiều lần và tưởng chưa lưu được (đã lưu rồi) — xem QĐ-30 |
| Gọi mạng trong `ipcMain.handle` mà không có `withDeadline` | Trần đọc Sheet là 120s × 2 lần thử → renderer đứng hàng PHÚT. Mà chờ xong thường vô ích vì đang chạy bằng cấu hình sai — xem QĐ-30 (**chưa sửa**, chỉ là đề xuất) |
| Sửa cấu hình ở app dev rồi tưởng bản đóng gói cũng đúng | 2 app dùng 2 electron-store KHÁC NHAU (`TikTokCrawler` vs `TikTokCrawler-Dev`) — xem QĐ-26 |
| Coi MỌI lỗi 403 là vượt quota | 403 còn nghĩa "chưa chia sẻ Sheet cho service account" — báo nhầm sẽ che mất lỗi thiếu quyền, cực khó đoán. Phải soi nội dung — xem QĐ-24 |
| Để mốc đọc tăng dần ở 2 nơi (main.js + sheets.cjs) | 2 mốc lệch nhau (bẫy QĐ-10) và 2 nơi cùng đọc sẽ cùng đẩy mốc → nhảy qua mất dòng chưa đọc. Phải để MỘT nơi + gộp lời gọi trùng — xem QĐ-09 |
| Tính mốc đọc tăng dần bằng `links.length` (đã lọc dòng rỗng) | Mốc lệch dần mỗi khi Sheet có dòng rỗng → đọc lặp vô ích/bỏ sót. Phải dùng số dòng THÔ (`rawRows`) — xem QĐ-09 |
| Tin layout "nhìn code thấy ổn" mà không render thật để đo | Bỏ sót cuộn ngang, `-webkit-line-clamp` cắt hở, dải trắng ở trạng thái rỗng — chụp ảnh + đo `scrollWidth-clientWidth` mới thấy, xem QĐ-23 |
| Dùng UI Automation để điều khiển cửa sổ HMA VPN | GUI là WebView2 — cây UI Automation chỉ có 1 node, `BoundingRectangle=Empty`, 0 phần tử con. Không bấm được gì qua accessibility tree — xem QĐ-32 |
| Điều khiển VPN qua Windows Service Control (`net stop/start`) | ACL của dịch vụ chỉ cấp Start/Stop cho SYSTEM + Administrators, user thường không làm được — không đồng nhất trên mọi máy trong dàn — xem QĐ-32 |
| Dùng `Vpn_ConnectToOptimal_NmSvc` / tin `Vpn_GetOptimalGateway_NmSvc` để chọn server | "Optimal" = gần nhất theo ĐỊA LÝ máy đang chạy, không phải server phù hợp với profile. Đo thật trả về Việt Nam cho profile khai London — nối vào đó là tự tạo mâu thuẫn "IP nước này, giờ nước khác" nặng nhất có thể — xem QĐ-32 |
| Chỉ dừng đúng profile bị feed cạn, để các profile khác tiếp tục chạy trong lúc đổi IP | IP là của CẢ MÁY — lúc VPN tắt để chuẩn bị bật lại, các profile khác vẫn gửi request bằng IP THẬT (không phải IP đã đăng ký) → mất phiên hàng loạt, tệ hơn hẳn 1 profile bị cạn ban đầu. Phải dừng HẾT rồi bật lại đúng nhóm — xem QĐ-32 |
| Cho phép đổi IP dù quốc gia HMA đang nối không khớp nhãn profile, hoặc tự "sửa" giùm cho khớp | Không kiểm tra được nước IP thật đang phục vụ khu vực đó có đúng không — phải TỪ CHỐI và để người dùng tự sửa VPN trước, không đoán giùm — xem QĐ-32 |
| Xoay sang city khác khi đổi IP, vì tưởng "cùng server ⇒ cùng IP" | Giả định SAI, đo thật bác bỏ: cùng gateway London cho `18.171.54.19` → `18.132.40.68` (HMA cấp IP từ POOL mỗi lần kết nối). Xoay city còn CÓ HẠI — đưa IP sang vùng địa lý khác, lệch vùng phiên đăng nhập đã quen. Chỉ tắt/bật lại là đủ — xem QĐ-32 |
| Tin `systemKillSwitchActive: true` của HMA là đã chống rò rỉ | Cờ đó KHÔNG chặn IPv6. Đo thật: VPN tắt → IPv6 lọt ra `2001:db8:… (VN)` trong 241ms. Tên cờ nghe thuyết phục nên gần như đã kết luận sai — phải đo bằng cách gọi mạng thật lúc VPN tắt — xem QĐ-32 |
| Tính `fd/fc` (ULA) hoặc `fe80` (link-local) là rò rỉ IPv6 | Chúng KHÔNG ra được internet. Tính cả ULA thì tính năng tự khoá mình trên mọi máy có **Tailscale** (`fd7a:…`) — chỉ tính global unicast `2000::/3` — xem QĐ-32 |
| Kết luận "profile khác vẫn chạy mượt ⇒ an toàn" | Rò rỉ IPv6 IM LẶNG: không lỗi, không dừng, chỉ mất phiên SAU ĐÓ. "Chạy mượt" ≠ "an toàn" — xem QĐ-32 |
| Đóng gói việc tắt IPv6 thành script `.ps1` trong repo | Windows Defender chặn hẳn ("file contains a virus or potentially unwanted software") vì sửa binding mạng — chặn cả chạy LẪN xoá file. Để lệnh trong tài liệu cho copy-paste — xem QĐ-32 |
| BỎ HẲN link khi không đọc được số video, coi mọi ca như nhau | Ca "Something went wrong" là sound VẪN CÒN (header còn tên + số video), TikTok chỉ lỗi lúc dựng trang — bỏ là mất dữ liệu thật, và người dùng thấy mất RẤT NHIỀU. Chỉ bỏ hẳn khi sound CHẾT thật (`statusCode 10201`); còn sống thì sang tab chờ — xem QĐ-33 |
| Nạp link ở tab chờ vào bộ lọc quét (`_collected`) hoặc `_knownLinks` của tab chính | Sẽ KHÔNG BAO GIỜ thử lại được, mà "Something went wrong" thường chỉ là lỗi tạm thời — đọc được ở phiên sau thì sound vào tab CHÍNH với dữ liệu đầy đủ. Chỉ nạp vào `_pendingKnown` để chặn ghi trùng — xem QĐ-33 |
| Kết luận nguyên nhân từ "người dùng thấy trang lỗi", không mở đúng link bằng đúng đường code đi | Trang `/music/` hiện "Something went wrong" ở phần LƯỚI VIDEO, nhưng app đọc số từ API + HEADER — hai phần khác nhau. Đo thật: link "lỗi" đọc ra `videoCount=16` hoàn hảo, bị bỏ vì `16 < minVideos 1000`. Suy luận "trang lỗi ⇒ không đọc được số" nghe hợp lý nhưng SAI — xem QĐ-33 |
| Mở trình duyệt đếm ở chế độ HIỆN để "xem tab đếm" | Playwright mở mỗi browser/context thành CỬA SỔ RIÊNG → sinh ra cửa sổ thứ hai + tốn thêm cả một instance Chromium (người dùng gửi ảnh 2 cửa sổ và bác ngay). Phải dùng CHUNG context của profile để nó thành 1 TAB trong cùng cửa sổ — xem QĐ-33 |
| Chạy lại cả nhóm profile NGAY sau khi đổi IP | 5 phiên đăng nhập cũ đồng loạt xuất hiện trên một IP vừa mới đổi trong vài giây = đúng khuôn "tài khoản bị chiếm" (QĐ-15, nguyên nhân số 1 khiến TikTok hủy phiên). Phải chờ ~1 phút cho IP nguội — xem QĐ-32 |
| Dùng ID sound NGẮN làm dữ liệu test khi kiểm lọc trùng | `_extractMusicId` đòi tối thiểu 8 chữ số; ID ngắn không trích được ID nên `normalizeKey` lùi về so nguyên văn URL → 2 slug khác ngôn ngữ của CÙNG sound thành 2 key khác nhau → khẳng định lọc trùng VÔ NGHĨA. Phải dùng ID 19 chữ số thật (lặp lại đúng bẫy QĐ-09) — xem QĐ-33 |
| Cho việc CHỜ chỉ hiện đếm ngược ở dòng trạng thái, không khóa nút | Người dùng vẫn bấm "▶ Chạy" và profile vào ngay — việc chờ **không ngăn được đúng cái nó sinh ra để ngăn**. Rằng buộc nào có thật thì UI phải **chặn** được, không chỉ **thông báo** — xem QĐ-32 |
| Chỉ khóa nút Chạy trong pha CHỜ IP nguội | Pha **đang tắt/bật lại VPN** còn nguy hiểm hơn hẳn — HMA vừa bị tắt nên bật profile lúc đó là chạy bằng **IP THẬT**. Phải khóa cả hai pha — xem QĐ-32 |
| Khóa nút bằng `disabled` mà không kiểm lại trong hàm xử lý | Một lần vẽ lại bảng (`renderProfiles`/`setRowRunning` ghi lại nhãn nút) là nút mở khóa trở lại. `toggleProfile`/`runSelected` phải **tự kiểm tra lại** — cùng khuôn "backend không tin renderer" của QĐ-32 |
| Đặt việc mở khóa nút ở cuối thân hàm, không trong `finally` | Mọi đường `return` sớm (bị giới hạn nhịp, đổi IP thất bại, người dùng hủy) làm nút **kẹt khóa vĩnh viễn** — người dùng hết cách bật profile bằng tay — xem QĐ-32 |
| Chỉ cho `stopSelected()` hủy việc tự-chạy-lại-sau-đổi-IP | Dừng bằng nút "■ Dừng" **trên từng hàng** thì app vẫn tự bật lại đúng profile vừa tắt. Dồn về một chỗ duy nhất trong `stopProfileById()` — xem QĐ-32 |
| Chép logic renderer sang test để "dễ test" | Bản chép sẽ lệch âm thầm: test pass trong khi app hỏng. `vpn-run-lock.test.js` **trích đúng mã nguồn** từ `renderer.js` rồi chạy trong Chromium — ai đổi tên/xóa hàm là test báo lỗi ngay (bài học QĐ-10 áp cho cả test) |
| Bỏ link ngay sau 1 lượt đọc số thất bại | Trang lỗi của TikTok ghi thẳng *"Please try again later"* kèm nút Refresh — **chính nó khai là lỗi tạm thời**. Mỗi lỗi tạm thời thành 1 sound mất hoặc 1 dòng phải kiểm tay. Thử lại trọn vòng 1 lần, tốn đúng 1 lần tải trang và CHỈ cho ca lỗi — xem QĐ-07 |
| Thử lại cả khi sound đã XÓA (`10201`) hoặc khi lượt 1 đã đọc được số | Xóa rồi thì lượt 2 cũng thế; đọc được rồi thì thử thêm là **tự dội IP mình** — đúng cái gây ra chặn. Chỉ thử lại đúng ca "còn sống mà không đọc được" — xem QĐ-07 |
| Để `statusCode` lạ rơi xuống bước sau mà KHÔNG log gì | Mã `10203` tồn tại không biết bao lâu mà không ai hay, chỉ tình cờ phát hiện lúc đo tay một link người dùng gửi. Nhánh "chưa biết nghĩa" **phải để lại dấu**, nếu không thì vĩnh viễn không có dữ liệu để phân loại — xem QĐ-07 |
| Bắt lỗi bằng cách dò chuỗi "Something went wrong" trên trang | (a) Đo thật: chuỗi đó **cùng tồn tại** với số video đọc được (`16 videos`, `21 videos`) → bắt theo nó là đưa oan cả sound đọc số hoàn hảo vào tab chờ; (b) nó là chuỗi **đa ngôn ngữ**, profile khai `ko-KR` sẽ thấy chữ Hàn — đúng bẫy QĐ-10 đã phải thêm 22 ngôn ngữ cho nhãn "original sound" mà vẫn không đủ. Tín hiệu đáng tin duy nhất là **"có lấy được con số dùng được không"** |
| Để một tính năng CỨU DỮ LIỆU mặc định TẮT, phải bật tay trên từng máy | Cấu hình nằm ở `%APPDATA%` riêng từng máy, không đồng bộ — với 5 máy thì tính năng thực tế **KHÔNG TỒN TẠI**. Người dùng hỏi 3 lần "sao không thấy link nào", cả 3 lần đều vì ô trống ở đúng máy đang chạy; thiệt hại đo được: 1 sound **262K video** bị bỏ. Chọn mặc định theo **hậu quả khi sai** (tắt sai = mất dữ liệu IM LẶNG; bật sai = thêm vài dòng + có báo lỗi ngay) — xem QĐ-33 |
| Dùng chuỗi gợi ý (placeholder) mờ trong ô nhập làm cách "cho biết giá trị mặc định" | Người dùng đọc `Total_Link_Voice_Pending` mờ trong ô và tưởng **đã lưu rồi** — mất 3 lượt trao đổi mới truy ra. Placeholder không phải giá trị; muốn có mặc định thì phải **mặc định thật trong code** — xem QĐ-33 |
| Áp đường "giữ lô rồi thử lại" cho lỗi TAB KHÔNG TỒN TẠI | Thử lại vô ích và thành **mỗi 5 giây một lần gọi API thất bại** cho tới hết phiên. Lỗi tạm thời (mạng, quota) thì giữ lô; lỗi cấu hình thì **ngưng cả phiên + báo đúng một lần** — xem QĐ-33 |
| Cài một ràng buộc chỉ ở MỘT trong nhiều đường dẫn tới nó | Kể như chưa có. Lần 1: đường "vẽ lại bảng" ghi đè nhãn nút. Lần 2: đường "người dùng tự tắt/bật HMA" — app không biết gì nên nút vẫn sáng. Phải hỏi **AI có thể gây ra trạng thái này**, không chỉ "code của tôi gây ra ở đâu" — xem QĐ-32 |
| Poll trạng thái VPN bằng `status()` (native messaging) | Mỗi lần **spawn `VpnNM.exe` + chờ 600ms** → poll 2s/lần ≈ **1800 tiến trình/giờ**, quá tốn cho VPS yếu. Dùng `tunnelState()` đọc `os.networkInterfaces()`: đo được **2.1ms/lần**, đồng bộ, không spawn — xem QĐ-32 |
| Nhận biết VPN nối lại chỉ bằng cờ "adapter có tồn tại" | HMA nối lại mà adapter KHÔNG biến mất thì cờ luôn `true` → không nhận ra lượt nối lại. Phải so **địa chỉ IP trong đường hầm** (`10.252.32.18` → `10.252.40.7`) để đúng ở cả hai kiểu hành vi của adapter — xem QĐ-32 |
| Coi lần đọc trạng thái ĐẦU TIÊN là một "chuyển tiếp" | Máy mở app lúc HMA đang tắt — hoặc **máy không cài HMA** — bị khoá nút Chạy ngay khi mở app, không bấm được gì. Lần đầu chỉ **lấy mốc**; chỉ hành động khi thấy trạng thái ĐỔI — xem QĐ-32 |
| Gộp "VPN đang tắt" và "đang đổi IP" thành cùng một nhãn nút | Hai ca người dùng phải xử **khác nhau** (bật lại HMA / chỉ cần chờ). Gộp là bắt họ đoán — xem QĐ-32 |
| Tự dừng profile khi thấy người dùng tắt VPN | Họ đang **chủ động** điều khiển VPN; tự ý dừng profile của họ là vượt quyền. Chỉ **cảnh báo rõ số lượng** profile đang chạy bằng IP thật rồi để họ quyết — xem QĐ-32 |
| Hàm trích mã nguồn cho test tìm `"function <tên>("` | Với `async function` nó **cắt mất chữ `async`** → thân hàm có `await` → SyntaxError → harness không nạp được, và Playwright báo `"T is not defined"` — thông báo chẳng liên quan gì tới nguyên nhân, tốn thời gian truy — xem QĐ-32 |
| Đặt trần cho vòng lặp chờ bằng SỐ VÒNG khi mỗi vòng có trần riêng | "6 vòng × 500ms" nghe như 3s nhưng mỗi `readVideoCount` có trần riêng **5 giây** → thực tế tới **30 giây**. Chi phí phụ thuộc "máy chậm đến đâu" = **không có trần**. Đặt trần bằng **đồng hồ** — xem QĐ-34 |
| Giữ tài nguyên DÙNG CHUNG (slot đếm) trong lúc `sleep` | Slot đếm là semaphore **toàn app** (2 slot cho mọi profile). Giữ nó lúc ngủ = một link hỏng chặn cả 5 profile. Đo thật: thông lượng tụt còn **2.4 sound/phút** trong khi vòng quét cần 20 → hàng đợi đầy → **feed ngừng cuộn** — xem QĐ-34 |
| Thêm việc vào đoạn đang giữ tài nguyên chung mà chỉ tính "tốn thêm mấy giây cho 1 link" | Phải tính lại **THÔNG LƯỢNG** của cả hệ. Bản vá thử-lại làm 1 link đắt thêm ~7s nghe vô hại, nhưng biến thông lượng từ 30.8 → 2.4 sound/phút và làm feed đứng hẳn. Câu hỏi đúng: *"giữ tài nguyên chung bao lâu, và ai đang chờ?"* — xem QĐ-34 |
| Nhả semaphore vô điều kiện trong `finally` khi thân hàm có nhả/xin lại giữa chừng | Nhả THỪA còn nguy hiểm hơn giữ lâu: semaphore tưởng còn chỗ → nhiều hơn 2 request `/music/` song song, đúng thứ QĐ-21 sinh ra để chặn. Dùng cờ `holdingSlot` tường minh — xem QĐ-34 |
| Vá xong một phần rồi tưởng đã xong, không đo lại TOÀN BỘ đường đi | Vá "ngân sách DOM" xong mà bỏ sót `waitForResponse` 20s — vốn chiếm 40/132 giây, tức phần LỚN NHẤT. Sai lần thứ hai trong cùng một ngày. Sau mỗi lần vá phải **đo lại cả đường đi**, không chỉ phần vừa sửa — xem QĐ-34 |
| Đặt trần chờ dài cho thứ có thể KHÔNG BAO GIỜ xảy ra | Trang lỗi thì `api/music/detail/` không bao giờ chạy → `waitForResponse` đốt trọn 20s mỗi lượt, không thu được gì. Trần phải đặt theo "bao lâu thì coi như KHÔNG có", không phải "bao lâu thì chắc chắn có" — xem QĐ-34 |
| Để tính năng "nice-to-have" chạy cả khi hệ thống đang tắc | Thử lại là thứ đáng có, nhưng lúc hàng đợi đầy thì nó làm **feed đứng hẳn**. Tính năng phụ phải biết tự nhường khi tài nguyên khan — kiểm `soundQueue.length` trước khi thử lại — xem QĐ-34 |
| Cho một tab Sheet chỉ nạp danh sách lọc trùng MỘT LẦN đầu phiên | Chạy nhiều máy thì máy này không bao giờ thấy dòng máy kia ghi **sau đó** → mỗi máy đều tưởng link còn mới và ghi thêm một dòng. Tab chờ mắc đúng lỗi này suốt (ảnh người dùng: tab chờ đầy dòng trùng) trong khi tab chính không bị, vì tab chính có **đọc tăng dần + đọc lại ngay trước khi ghi** (QĐ-09). Thêm tab mới thì phải mang theo CẢ BỘ cơ chế đó, không chỉ bước nạp đầu phiên |
| Cho phép ghi lên Sheet khi CHƯA nạp được danh sách link cũ | Không biết link nào đã có thì ghi chỉ để tạo trùng. Một lần đọc Sheet thất bại (mạng chớp) là cả phiên ghi lại từ đầu. Tab chính có cổng `_seeded`; tab chờ ban đầu **thiếu** cổng đó — phải có ở mọi đường ghi |
| Đổi tên tab mà chỉ xoá bộ nhớ link, quên xoá MỐC DÒNG | Mốc cũ (vd 500) làm lần đọc đầu của tab mới bỏ qua 500 dòng đầu → mọi link trong đó bị coi là mới → ghi trùng hàng loạt |
| Trả `rows` (lô gốc) về buffer khi ghi lỗi, thay vì lô ĐÃ THỬ GHI | Những dòng vừa bị lọc bỏ vì máy khác ghi trước sẽ được đưa trở lại hàng chờ rồi thử ghi trùng lần nữa. Phải trả đúng `toWrite` |
| Giả lập lỗi mạng trong test bằng cách gán lại thuộc tính hàm của module | `sheets.cjs` **destructure** `httpRequest` lúc `require`, nên gán lại thuộc tính KHÔNG có tác dụng — test tưởng đã giả lập lỗi mà thực ra chạy đường bình thường. Phải điều khiển qua chính mock (`httpScript.readFails`) |
| Kiểm "đọc tăng dần" bằng dữ liệu tab RỖNG | Tab rỗng thì mốc = dòng 1, mà đọc từ dòng 1 chính là đọc cả cột → không phân biệt được với "đọc lại toàn bộ". Phải có sẵn vài dòng để mốc > 1 (test phải thấy `!B4:B`) |
| Đặt hẹn (setTimeout/interval) TRƯỚC khi `await` một hàm mà chính nó xoá hẹn | `handleFeedStarved` đặt hẹn tự-bật-lại rồi mới `await stopProfileById` thì chính `stopProfileById` xoá mất hẹn → profile dừng vĩnh viễn qua đêm mà không ai thấy. Phải đặt hẹn **sau** khi await xong — xem QĐ-32 |
| Kiểm `runningSet` TRƯỚC khi huỷ hẹn trong `stopProfileById` | Lúc đang đếm ngược, profile **không** nằm trong `runningSet` → hàm return sớm, hẹn sống sót → app tự bật lại đúng profile người dùng vừa tắt. Phải huỷ hẹn ở **dòng đầu**, trước mọi `return` — xem QĐ-32 |
| Xoá bộ đếm "số lần liên tiếp" mỗi lần dừng | Lần nào cũng nghỉ 5 phút, không bao giờ giãn lên 15/30 → thử dày trong lúc TikTok đang siết nặng. `streak` phải sống qua lần dừng, chỉ xoá khi **thu được sound hợp lệ** |
| Dùng status `running` làm bằng chứng "feed đã hồi" | Status đó còn phát trong cả lúc thoát kẹt/backoff nên không chứng minh được gì. Bằng chứng đúng là **`crawl-data`** — một sound đã qua bộ lọc |
| Dùng `process.env` trong renderer | Renderer chạy sandbox (contextIsolation) → `process` không tồn tại → ReferenceError làm **chết cả giao diện**. Hằng số phải viết thẳng, muốn điều chỉnh thì qua electron-store |
| `Math.round(ms / 60000)` để hiện khoảng thời gian | Mọi khoảng dưới 30 giây thành **"0 phút"** — vô nghĩa. Dùng `formatCountdown` đã có (dùng chung với chip pha chu kỳ). Test bắt được đúng lỗi này |
| Đặt thang thời gian trong test NGẮN HƠN nhịp bộ đếm | Bộ đếm chạy mỗi **1 giây**, nên thang 300/600/900ms không bao giờ tới hạn → **12 khẳng định trượt** vì test sai chứ không phải code sai. Thang test phải > nhịp đếm |
| Hẹn kiểm lại thưa (30s) cho điều kiện do NGƯỜI DÙNG gây ra | VPN tắt là do người dùng nên có thể hết bất cứ lúc nào; hẹn 30s làm profile nằm chờ vô ích sau khi VPN đã lên. 5 giây đủ nhạy mà không tốn gì (chỉ đọc một cờ trong bộ nhớ) |
| Cho phép "chỉ dừng 1 profile" khi thao tác trên tài nguyên CẢ MÁY (IP/VPN) | Phép đo IPv6 chỉ che được **một** trong hai vấn đề. Vấn đề còn lại — profile khác đang quét bị **đổi IP giữa phiên** — xảy ra kể cả khi không có IPv6 nào, và đúng khuôn "tài khoản bị chiếm" (QĐ-15). Một tuỳ chọn mà bật lên là tự hại thì **không nên tồn tại** — xoá hẳn, đừng để làm tuỳ chọn — xem QĐ-32 |
| Chỉ CẢNH BÁO khi phát hiện trạng thái nguy hiểm (VPN tắt mà profile còn chạy) | Người dùng **treo máy** — không ai đọc cảnh báo. Mỗi giây profile còn chạy là một giây gửi request bằng IP THẬT. Phát hiện được thì phải **hành động** (dừng hết), cảnh báo chỉ là phần bổ sung — xem QĐ-32 |
| Đặt khối test mới SAU `await browser.close()` | Mọi `page.evaluate` sau đó báo `Target page, context or browser has been closed` — thông báo không nói gì về nguyên nhân thật. Kiểm vị trí trước khi chèn |
| Tin `node --check` là đủ cho renderer | Nó chỉ bắt **cú pháp**, không bắt `ReferenceError` lúc chạy — mà renderer lỗi là **chết cả giao diện**, không có stack nào hiện ra ngoài. Phải có bước kiểm tĩnh: mọi biến/hàm/`api.*` được tham chiếu đều thật sự tồn tại (và không dùng `process`/`require` trong sandbox) |
| Sửa CODE khi người dùng muốn đổi hành vi của MỘT máy | Cùng một `.exe` chạy trên cả 5 máy → sửa code là đổi hết. Nếu hai loại máy cần đánh đổi **ngược nhau** (máy mạnh muốn kiên nhẫn, máy yếu cần nhanh) thì phải làm **cài đặt riêng từng máy**, không phải chọn một cách rồi áp cho tất cả — xem QĐ-34 |
| Đặt mặc định cho một công tắc theo "cái nào tốt hơn" | Phải xét **hai hướng chọn sai có đối xứng không**. Ở đây: sai ở máy mạnh chỉ mất chút cơ hội; sai ở máy yếu là **ĐỨNG FEED**. Nên mặc định phải là cái an toàn cho máy yếu, dù máy mạnh có thể tốt hơn với cái kia — xem QĐ-34 |
| Sao chép nguyên văn hành vi cũ khi chính nó là bug | v0.1.63 đọc giao diện bằng "6 vòng × 500ms" mà mỗi vòng có trần riêng 5s → **không có trần thật**. Chế độ `patient` dùng ngân sách 30 giây: giống v0.1.63 trên máy mạnh, nhưng có trần trên máy yếu. Sao chép y nguyên là dựng lại bug — xem QĐ-34 |
| Test công tắc bằng cách đọc hằng số trong mã nguồn | Chỉ chứng minh "hằng số có mặt", không chứng minh công tắc **có tác dụng**. Phải kiểm hành vi: cùng một kịch bản, hai chế độ cho **kết quả khác nhau** (`patient` mất sound, `fast` cứu được) — xem QĐ-34 |
| Xử lý áp lực tài nguyên bằng ngưỡng BẬT/TẮT (chạy hết tốc → dừng hẳn) | Đúng là hiện tượng "app treo/đứng feed" mà người dùng báo. Dùng **giãn dần** theo mức áp lực: hệ thống tự khớp tốc độ với cổ chai và **luôn chuyển động**. Giữ ngưỡng cứng chỉ làm chốt cuối — xem QĐ-34 |
| Đổi nhịp vòng lặp mà không xét lại các NGƯỠNG ĐẾM LẦN phụ thuộc nhịp đó | Nhịp cuộn giãn tới ×4 làm ngưỡng "20 lần đọc" mất tới 5 phút mới tới — bộ phát hiện kẹt phản ứng chậm gấp 4. Mỗi khi đổi nhịp, phải soát mọi ngưỡng đếm-lần và thêm trần **thời gian** — xem QĐ-34 |
| Phát hiện kẹt bằng "bao lâu không có dữ liệu MỚI" | Feed khoẻ vẫn có thể hàng phút không ra sound mới vì lọc trùng 173.000 link → báo oan hàng loạt. Phải đo "**cùng một** dữ liệu lặp lại bao lâu" — xem QĐ-34 |
| Reset bộ đếm sau khi can thiệp mà quên reset ĐỒNG HỒ đi kèm | Vòng đọc kế tiếp đã "quá hạn" → báo kẹt ngay → cách vừa thử không có cơ hội tỏ hiệu quả. Mọi trần thời gian đều phải được reset cùng bộ đếm — xem QĐ-34 |
| Dùng biến `const` khai báo PHÍA DƯỚI trong cùng hàm test | `ReferenceError: Cannot access 'src' before initialization` (vùng chết TDZ). Trong file test dài, khối mới thêm ở giữa dễ vướng — đọc lại nguồn vào biến riêng thay vì mượn biến có sẵn |

---

## QĐ-35 — Hai vòng lặp nền phải cùng kết thúc; và mọi backoff phải có ĐIỂM DỪNG (2026-08-07)

Hai lỗi khác nhau, cùng lộ ra từ một đêm chạy trên máy ảo. Cả hai đều thuộc loại **app vẫn "sống"
mà không sản xuất được gì** — thứ khó thấy nhất khi treo máy qua đêm.

### Lỗi 1 — profile kẹt vĩnh viễn "Profile đang chạy."

TikTok huỷ phiên giữa chừng → vòng QUÉT kết thúc, nhưng `countLoop` là vòng **vô hạn** (chỉ thoát
khi `stop.requested`/`stop.draining`). Nên `Promise.all([quét xong, đếm chạy mãi])` **không bao giờ
resolve** → `crawlOneProfile` không kết thúc → khối `finally` không chạy → `_active` giữ profile
**mãi mãi** → mọi lần bấm ▶ Chạy đều bị từ chối.

Tệ hơn: renderer nhận status `'error'` nên đổi hàng về nút **"▶ Chạy"** → người dùng **không bấm
được "■ Dừng"** (`stopProfileById` thoát sớm vì hàng không còn trong `runningSet`). **Bế tắc hoàn
toàn** — chỉ khởi động lại app mới thoát. Người dùng đã thử dừng/chạy lại, xoá `ChromiumProfile`,
đăng nhập lại: đều vô ích, đúng như dự đoán của cơ chế này.

**Sửa 2 lớp:**
1. **Gốc rễ** — vòng quét xong thì đặt `stop.draining = true` để `countLoop` *check nốt hàng đợi rồi
   thoát*. Dùng cờ **dừng mềm** nên không mất sound đã quét (QĐ-11). Lỗi có ở **cả 4 chế độ**.
   ⚠ Phải đặt trên `stop`, **không** phải `scanStop` — `scanStop` chỉ là object có getter đọc lại
   `stop`, gán vào nó thì bản vá **im lặng vô tác dụng**.
2. **Lưới an toàn** — backend từ chối `"Profile đang chạy"` thì renderer **tự đưa hàng về trạng thái
   đang chạy** để bấm được ■ Dừng. Bản đối xứng của lớp tự chữa đã có ở `stopProfileById`.

### Lỗi 2 — backoff không có điểm dừng

TikTok chặn **trang đếm** của riêng một profile. App backoff `30s → 2p → 5p` rồi **kẹt ở mức 5 phút
mãi mãi**: `failStreak` không bao giờ reset vì mọi lần thử đều lỗi. Mỗi sound còn được giữ 3 vòng ⇒
**~18–22 phút/sound**; hàng đợi 20 sound ⇒ **6–7 tiếng**, mà suốt thời gian đó vòng quét **đứng hẳn**
vì hàng đợi đầy.

Đo thật từ log: **40 phút → Quét 24 · Đã check 3 · Hợp lệ 0.**

**Quyết định:** ≥6 sound liên tiếp lỗi ⇒ phát status riêng `count-blocked` → renderer **dừng profile
đó rồi tự bật lại 5/15/30 phút** (dùng lại đúng cơ chế của "feed cạn"). Ngưỡng 6 = đã đi hết thang
backoff **và** nghỉ ở mức trần thêm 2 lần nữa mà vẫn không đọc nổi một sound nào.

⚠️ **TUYỆT ĐỐI không đi đường đổi IP cho ca này**, kể cả khi công tắc "Tự đổi IP" đang bật. Bằng
chứng ngay trong ảnh người dùng: **5 profile khác trên CÙNG máy vẫn đếm bình thường** (88/74,
144/126, 136/111). Chặn theo **tài khoản**, không theo IP — đổi IP cả máy là **dừng oan 5 profile
khoẻ mà vẫn không chữa được gì**.

**Người dùng chọn** "dừng + tự bật lại" thay vì "đẩy hết sang tab chờ": 20 sound đang xếp hàng bị
mất, nhưng chúng gần như chắc chắn bị lọc bỏ (`Hợp lệ 0`), còn đẩy hết sang tab chờ thì mỗi đêm
hàng trăm dòng vô dụng phải kiểm tay.

### Kiểm chứng

`crawl-modes.test.js` 74 → **83 khẳng định**. Dựng lại **cả hai** tình huống bằng mock, và kiểm
**hành vi thật** chứ không chỉ đọc hằng số:
- Huỷ phiên giữa chừng → đo `isProfileRunning` **trước khi** gọi `stopProfile`: profile **tự thoát
  sau 6.3 giây** (nếu gọi `stopProfile` rồi mới đo thì che mất bug).
- Chặn trang đếm → status `count-blocked` **thực sự phát**, và **đúng một lần**.

Thêm 2 biến môi trường để test được (`TTC_LOGIN_RECHECK_MS`, `TTC_BLOCK_BACKOFF_MS`) — không có
chúng thì phải chờ thật 15 phút và hơn 20 phút.

Đã kiểm test có "cắn": bỏ dòng đặt `draining` → 2 khẳng định trượt; bỏ ngưỡng bỏ cuộc → 3 trượt.

| KHÔNG nên làm lại | Vì sao |
|---|---|
| `Promise.all` giữa một vòng CÓ điểm dừng và một vòng VÔ HẠN | Vòng vô hạn giữ mãi lời hứa → hàm bao ngoài không bao giờ kết thúc → mọi việc dọn dẹp trong `finally` không chạy. Vòng nào cũng phải có đường được báo kết thúc |
| Gán cờ lên object chỉ có **getter** đọc lại nơi khác | `scanStop` đọc `stop.requested \|\| stop.draining`; gán `scanStop.draining` chỉ thêm thuộc tính vào chính nó, không tới được nơi đọc. Bản vá **im lặng vô tác dụng** |
| Backoff tăng dần mà **không có điểm dừng** | Chặn trần rồi thì lặp vô hạn: 1 sound mỗi ~6 phút suốt đêm, vòng quét đứng hẳn, sản lượng bằng 0. Mọi backoff phải trả lời được "sau bao lâu thì bỏ cuộc?" |
| Dùng `error` cho trạng thái mà backend CHƯA dừng | Renderer đổi hàng về "▶ Chạy" → mất luôn nút "■ Dừng" → người dùng không còn đường can thiệp. Dùng status riêng và giữ hàng ở `running` |
| Chữa vấn đề của MỘT tài khoản bằng thao tác cấp MÁY (đổi IP) | Dừng oan các profile khoẻ mà vẫn không chữa được. Phải kiểm bằng chứng phạm vi trước: các profile khác trên cùng máy có bị không? |
| Đo trạng thái SAU khi đã gọi hàm dọn dẹp | `stopProfile()` rồi mới đo `isProfileRunning` thì profile nào cũng "đã thoát" — che mất đúng cái bug đang muốn bắt. Phải đo **trước** |

---

## QĐ-36 — Kho link CỤC BỘ cạnh .exe; đọc Sheet chuyển sang chạy NỀN; thôi đọc trọn Sheet lớn (2026-08-11)

### Bối cảnh — ba số đo trên máy người dùng

Log `crawler_2026-08-10`, cấu hình `reseedMinutes = 3`, Sheet **206.572 dòng**:

| Đo được | Số |
|---|---|
| Lần "Đọc TOÀN BỘ Sheet (201.347 dòng)" trong 8 tiếng | **18** |
| Link mới thu về mỗi lần đọc trọn | **+5 … +8** |
| Google API timeout 25s trong ngày | **273** |
| Heap tiến trình main, 09:14 → 17:14 | 45 MB → **2.793 MB** (~344 MB/giờ) |
| RAM còn trống / tổng | **0,5 / 15,8 GB**, Pages/sec **1.936** (giã ổ đĩa) |

Đọc 201.347 dòng để tìm 7 link. Và vì `profile-start` **`await`** lần đọc đó *trước* khi khởi
động crawler, giao diện đứng ở "Đang khởi động..." hàng phút — người dùng thấy đúng như app treo.

Ba vấn đề khác nhau nhưng cùng một gốc: **Sheet đang bị dùng làm nơi lưu trữ lịch sử**, trong khi
nó chỉ nên là kênh trao đổi giữa các máy.

### Quyết định

**1. Kho cục bộ `known_links.txt` đặt cạnh `.exe`** (`src/linkstore.cjs`).
Mỗi dòng một khoá; nạp đồng bộ lúc khởi động, chỉ tốn mili-giây. Người dùng dán tay được, và
app **chỉ append, không bao giờ xoá**.

**2. Lần đọc Sheet chuyển sang chạy NỀN** — crawl bắt đầu ngay bằng kho cục bộ.

**3. Sheet lớn thì THÔI đọc trọn định kỳ.** Ngưỡng `SMALL_SHEET_ROWS = 5000`:
- Sheet nhỏ → đọc trọn theo chu kỳ (vài giây, và **tự miễn nhiễm** với lỗi mốc dòng khi ai đó xoá dòng giữa bảng).
- Sheet lớn → chỉ đọc phần đuôi. Kho cục bộ đã giữ lịch sử nên Sheet không cần làm bản lưu đầy đủ.

**4. Link đẩy lên Sheet thành công → ghi kho NGAY** (`sheets.setOnPushed`), không đợi vòng đồng bộ
sau đọc ngược về; app tắt trước vòng đó là mất.

### Hệ quả BẮT BUỘC phải xử — chỗ suýt sai

Bỏ `await` làm lộ ra một cái bẫy có sẵn: `enqueue()` trước đây **bỏ thẳng** dòng khi chưa seed
(`if (!_seeded) return`). Hồi đó vô hại vì cửa sổ "chưa seed" gần bằng 0. Đọc ở nền làm cửa sổ đó
dài ra thật ⇒ **mọi sound thu được trong lúc đang nạp sẽ âm thầm không bao giờ lên Sheet.**

Sửa thành **cặp chốt**:
- `enqueue()` **GIỮ** dòng trong bộ đệm (trần `BUFFER_MAX_UNSEEDED = 20000`), không bỏ.
- `flush()` **KHÔNG ghi** khi `!_seeded`, hẹn lại 3s.

An toàn vì chống trùng thật nằm ở **cửa ghi**: `flush()` lọc lại cả lô theo `_knownLinks` ngay
trước khi ghi, và còn đọc lại phần đuôi Sheet trước đó (QĐ-09).

### Điểm CỐ Ý làm khác repo tham chiếu

Bản gốc gọi `sheets.updateKnownLinks(storeKeys)` để nạp kho — hàm đó **bật `_seeded = true`**.
Ta dùng `addKnownKeys()` riêng, **không bật cờ**. Lý do: `_seeded` nghĩa hẹp là *"phiên này đã
đọc được Sheet"*, và nó là thứ duy nhất chặn đẩy mù. Kho cục bộ là bộ nhớ của **riêng máy này** —
máy khác vừa đẩy link mới lên Sheet thì nó không hề biết. Bật cờ ở đây = cho đẩy trong lúc lần đọc
nền còn đang chạy = sinh đúng cái trùng liên máy mà cờ này dựng ra để chặn. Với 5 máy chạy chung
một Sheet, đây là đánh đổi không đáng.

### Giới hạn thành thật

- Sheet lớn **không còn đồng bộ lại mốc dòng** trong phiên. Sau khi chạy 🧹 Dọn trùng thì phải
  khởi động lại app (lần seed đầu phiên vẫn đọc trọn một lần) hoặc bấm "⬇ Nạp từ Google Sheet vào kho".
- Kho là **file cục bộ, không chia sẻ giữa các máy**. Mỗi máy tự đầy kho theo những gì nó đọc được.
- **Mất file = mất bộ lọc trùng** khi Sheet đã dọn nhỏ. Phải sao lưu cùng `profiles/`.
- Rò rỉ 344 MB/giờ: đây là **nghi phạm số một** (2.748 MB ÷ 18 lần đọc trọn ≈ 153 MB/lần), nhưng
  **chưa chứng minh nhân quả** — chưa chụp heap snapshot. Bản sửa này làm giảm hẳn số lần đọc trọn,
  nên nếu rò rỉ tụt theo thì đó là bằng chứng; nếu không tụt thì phải truy tiếp.

### Kiểm chứng

`test/linkstore.test.js` — **32 khẳng định**, 13 mục. Cách ly bắt buộc bằng
`PORTABLE_EXECUTABLE_DIR` đặt **trước mọi `require`**: `getBaseDir()` ở chế độ dev trỏ thẳng vào
thư mục dự án, không cách ly là **ghi đè kho link thật của người dùng**.

Đã kiểm test có "cắn" (đột biến rồi hoàn nguyên):

| Đột biến | Kết quả |
|---|---|
| `enqueue` trả về hành vi CŨ (bỏ dòng khi chưa seed) | **3 khẳng định trượt** (25, 26, 28) |
| Bỏ chốt `_seeded` ở `flush` | **1 trượt** (24) |
| Cho `addKnownKeys` bật `_seeded` như bản gốc | **1 trượt** (22) |

Toàn bộ 20 file test cũ vẫn đạt; riêng 5 file dính `sheets.cjs`: 31 + 22 + 52 + 10 + 20 = **135
khẳng định**, 0 trượt.

| KHÔNG nên làm lại | Vì sao |
|---|---|
| `await` một lời gọi mạng dài **trước** khi khởi động việc chính | Sheet 206.000 dòng: `READ_LINKS_TIMEOUT_MS` 120s × 2 lượt ⇒ xấu nhất ~4 phút giao diện đứng im, không báo gì, nhìn hệt app treo |
| Đọc trọn một bảng lớn theo chu kỳ ngắn hơn thời gian đọc nó | Chu kỳ 3 phút mà một lần đọc mất hàng phút ⇒ app tải Sheet gần như liên tục, tự bóp nghẹt băng thông của chính nó |
| Dùng Google Sheet làm **nơi lưu trữ lịch sử** | Nó là kênh trao đổi giữa các máy. Lịch sử để dưới máy thì tra tức thì, không tốn quota, không phụ thuộc mạng |
| Bỏ dòng ở **cửa nhận** vì "chưa biết Sheet có gì" | Dòng mất vĩnh viễn khỏi đường đẩy. Phải GIỮ ở cửa nhận và gác ở **cửa ghi** — nơi vốn đã có đủ bộ lọc |
| Bật cờ "đã đọc được Sheet" từ một nguồn **cục bộ** | Cờ đó bảo vệ chống trùng LIÊN MÁY. Nguồn cục bộ không biết máy khác vừa đẩy gì |
| Ghi đè file kho bằng nội dung Sheet | Cả mục đích của kho là để **dọn bớt Sheet** ⇒ kho chứa nhiều link Sheet không còn. Ghi đè là xoá đúng phần trí nhớ quý nhất. Chỉ được append |
| Chạy test của `linkstore` mà không đặt `PORTABLE_EXECUTABLE_DIR` | `getBaseDir()` khi dev trỏ vào thư mục dự án ⇒ test ghi đè kho link THẬT |

---

## QĐ-37 — Đổi ô "GitHub repo phát hành" là CHUYỂN được bản, kể cả xuống bản cũ hơn (2026-08-11)

### Bối cảnh

Dự án có **2 người, 2 repo phát hành riêng** (QĐ-18). Người dùng muốn chạy bản của người kia
(`Hung13010/...`) và **chuyển qua chuyển lại tự do** — nguyên văn: *"app có thể thay đổi liên tục
nhờ cái phần Cập nhật... không nhất thiết phải chạy app của tôi vì tôi cũng muốn chạy bản của Hung
vì lỡ nó nhanh hơn"*.

Nhưng luật cũ `isNewer(latest, current)` **chặn hẳn** đường đó: release mới nhất bên kia là
`0.1.55` trong khi máy đang ở `0.1.70` → app báo **"Đã là bản mới nhất"** và không tải gì. Đây
đúng cái bẫy QĐ-18 đã ghi: *"tự báo nhầm đã là bản mới nhất dù thực tế đang chạy code khác hẳn"*.
Hệ quả thật: phải đi thay `.exe` bằng tay trên **từng máy trong 5 máy**.

### Quyết định

Đổi luật từ **"bản mới hơn"** thành **"bản KHÁC"**. Không thêm trạng thái lưu trữ nào.

**Vì sao không cần lưu "repo đang cài từ đâu":** sau khi chuyển xong thì `current == latest`
(bằng nhau) → không đề nghị nữa. **Không sinh vòng lặp** bằng chính tính chất của phép so, không
phải bằng một cờ nhớ thêm — ít trạng thái thì ít chỗ sai.

**Đi được cả hai chiều mà chỉ cần tính năng này ở MỘT phía:**

| Chiều | Cần gì |
|---|---|
| Bản mình (0.1.71) → bản Hung (0.1.55) | Tính năng này (hạ version) |
| Bản Hung (0.1.55) → bản mình (0.1.71) | **Không cần gì** — 0.1.71 mới hơn nên updater gốc bên Hung tự nhận |

### ⚠ Chốt an toàn — quan trọng hơn cả tính năng

**Hạ version CHỈ được đề nghị khi người dùng tự bấm "Kiểm tra"** (`manual === true`). Lần tự kiểm
lúc khởi động **tuyệt đối không** hạ ngầm. Lý do: ô repo nằm ở `%APPDATA%`, **riêng từng máy**;
gõ sai một ô là cả dàn máy âm thầm tụt về bản cũ, mất các tính năng mà không ai hay. Hạ version
phải luôn là **hành động chủ ý**.

Giao diện nói thẳng, không cài lặng lẽ:
- Nhãn version đổi thành `v0.1.55 ⚠ CŨ HƠN bản đang chạy (v0.1.71)`
- Nút đổi chữ thành `⬇ Chuyển sang bản này (hạ version)`
- Dòng trạng thái nói rõ chiều đi, tên repo, và *"bản đang chạy có thể có tính năng mà bản kia
  không có"*
- Thêm `confirm()` bắt buộc — cùng nguyên tắc với 🧹 Dọn trùng (QĐ-20): việc khó đảo ngược thì
  phải có bước xác nhận, không dựa vào việc người dùng đọc dòng trạng thái

### Sửa kèm — `normalizeRepo()`, xoá hẳn một lớp lỗi vận hành

Người dùng nhập tay ô này trên 5 máy và **đã mất thời gian 2 lần vì cùng một kiểu sai**: thêm dấu
`/` ở cuối. Đo thật:

```
[Hung13010/Crawl_DataTiktok-releases]   -> HTTP 200
[Hung13010/Crawl_DataTiktok-releases/]  -> HTTP 404
```

Vì URL thành `/repos/Owner/Repo//releases/latest`. App chỉ báo *"Không đọc được release"* — không
hề nói vì sao. Nay nhận rộng rãi rồi tự cắt về `Owner/Repo`: dán cả URL GitHub, thừa `/`, khoảng
trắng, đuôi `.git`, đuôi `/releases/tag/v1` đều được. **Chuẩn hoá cả lúc LƯU** (`update-set-repo`)
nên giá trị hỏng không bao giờ nằm lại trong store.

(Bản vá này từng được viết rồi bị hoàn lại; lần này nó nằm trong phạm vi đúng của yêu cầu
"chỉ cần ghi ô repo là chuyển được", nên đưa vào.)

### Kiểm chứng

`test/update-repo-switch.test.js` — **27 khẳng định**. Mock `https` + `electron` + `package.json`
rồi nạp `updater.cjs` **thật** (không chép logic sang test — bài học QĐ-10).

Đã kiểm test có "cắn":

| Đột biến | Kết quả |
|---|---|
| Bỏ chốt "chỉ hạ version khi `manual`" | **2 trượt** (16, 17) |
| Quay về luật cũ (chỉ nhận bản mới hơn) | **4 trượt** (12–15) |
| Bỏ `normalizeRepo` | **2 trượt** (20, 21) — hiện nguyên URL `...-releases//releases/latest` |

### Hai cái bẫy trong chính bộ test, đã sửa

1. Mock chỉ có `https.get` → `req.end is not a function`. `checkForUpdates` dùng
   `https.request()` rồi `req.end()`. Mock phải trả object có **cả** `on()` và `end()`, và chỉ
   bắn dữ liệu **khi `end()` được gọi** — sai nhịp này thì khẳng định "không đề nghị gì" pass GIẢ.
2. Mock đặt `app.getVersion()` nhưng `_currentVersion()` đọc `require('../package.json').version`
   → tham số `currentVersion` **vô tác dụng**, mọi kịch bản chạy với version thật (0.1.70) nên
   khẳng định "bằng nhau → không đề nghị" trượt oan. Phải giả lập đúng file `package.json`.

| KHÔNG nên làm lại | Vì sao |
|---|---|
| Chỉ cho updater đi LÊN khi hệ có nhiều repo phát hành | Đổi repo thành vô tác dụng, app báo "đã mới nhất" trong khi đang chạy code khác hẳn → phải thay `.exe` tay trên từng máy |
| Cho hạ version ở lần tự kiểm lúc khởi động | Gõ sai một ô cấu hình (riêng từng máy) là cả dàn máy âm thầm tụt bản, mất tính năng mà không ai hay |
| Để việc hạ version nhìn giống nâng cấp bình thường | Người dùng bấm "Cập nhật ngay" theo phản xạ. Việc đi LÙI phải đổi nhãn, đổi chữ trên nút, và có `confirm()` |
| Lưu thêm cờ "repo đang cài từ đâu" để chống lặp | Không cần: `current == latest` sau khi chuyển là đã tự dừng. Thêm trạng thái là thêm chỗ sai (và phải ghi được nó *trước* `app.quit()`) |
| Tin tham số mock mà không kiểm hàm THẬT đọc từ đâu | `_currentVersion()` đọc `package.json`, không đọc `app.getVersion()` → mock vô tác dụng, test trượt oan và tưởng code sai |
