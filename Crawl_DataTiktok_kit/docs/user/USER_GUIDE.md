# Hướng dẫn sử dụng — TikTok Crawler

> Cập nhật: 2026-07-28

## Thêm profile

Nhấn **➕ Thêm / Quản lý**, có 3 cách:

| Cách | Dùng khi |
|---|---|
| Tạo profile trống | Bắt đầu mới, sẽ đăng nhập bằng 🦊 |
| Import folder có sẵn trong app | Đã tự tay copy thư mục vào `profiles/` |
| 📁 Chọn thư mục từ ổ đĩa | Có sẵn profile Firefox Portable ở nơi khác — app **sao chép** vào, giữ nguyên bản gốc |

Với Firefox Portable, chọn đúng thư mục chứa `App`, `Data`, `FirefoxPortable.exe` —
**không** chọn thư mục bọc ngoài (thừa một cấp là app không tìm thấy).

Sau khi thêm, nhấn **🦊** để mở trình duyệt. Nếu chưa đăng nhập, đăng nhập ngay trong cửa
sổ đó — app tự lưu phiên. Toast sẽ báo *"đã đăng nhập TikTok"* nếu thành công.

## Các chế độ crawl

Chọn ở cột **Chế độ** hoặc trong ⚙️ Cài đặt.

| Chế độ | Mô tả |
|---|---|
| **For You** | Cuộn feed For You liên tục, thu link sound |
| **Tìm kiếm** | Gõ từ khóa rồi cuộn kết quả video |
| **Tab đang mở** | Cào trên tab bạn tự mở bằng 🦊 (dừng thì giữ trình duyệt) |
| **Xem video** | Xem danh sách link đã dán, không thu thập |
| **Quét ⇄ Xem** | Tự động luân phiên: quét X giờ → nghỉ → xem Y phút → nghỉ → lặp lại |

## Cài đặt quan trọng (⚙️)

| Mục | Ý nghĩa |
|---|---|
| Chỉ lấy Original Sound | Bỏ qua nhạc bản quyền, chỉ lấy "original sound" / "nhạc nền" |
| Lọc theo số video | Chỉ giữ sound có số video trong khoảng đã đặt |
| Delay | Nghỉ giữa 2 lần cuộn — càng lớn càng giống người thật, càng chậm |
| Không tải ảnh/video | Giảm RAM/CPU đáng kể. Nên bật khi chạy dài |
| Tải lại feed sau mỗi N lần cuộn | Xả bộ nhớ. Số nhỏ = an toàn hơn nhưng feed hay nhảy về đầu |
| Số luồng đếm video đồng thời | **Cài đặt chung toàn app.** Khuyến nghị 2 — càng cao càng dễ bị TikTok chặn |
| Thời lượng mỗi pha (chu kỳ) | Quét bao nhiêu giờ, xem bao nhiêu phút, nghỉ giữa 2 pha bao lâu |

## Chạy và dừng

| Nút | Hành vi |
|---|---|
| **▶ Chạy đã chọn** | Chạy các profile đã tick — bật **lần lượt từng profile**, không bật ồ ạt |
| **■ Dừng đã chọn** | Dừng **ngay lập tức** — sound trong hàng đợi chưa check sẽ bị bỏ |
| **🕓 Dừng mềm đã chọn** | Ngừng quét ngay nhưng **check nốt** hàng đợi rồi mới dừng |

**Bật lần lượt (từ 2026-07-31):** chọn nhiều profile rồi bấm ▶ thì app bật **từng profile
một** — chờ profile vừa bật quét được sound đầu tiên mới bật profile kế tiếp (tối đa chờ 25
giây/profile, nếu profile nào chậm thì tự bật tiếp, không đứng chờ mãi). Nút sẽ hiện
`▶ Đang bật 2/5...` và tạm khóa cho tới khi xong lượt. Lý do: bật cùng lúc làm mấy profile
tranh nhau CPU → có profile bị đứng, không quét được (lỗi cũ hay gặp trên VPS).

Số sound sẽ mất khi dừng cứng = **cột Quét − cột Đã check**. Khoảng cách này giờ được giữ
**nhỏ** (tối đa ~20 sound/profile): khi hàng đợi chờ đếm đầy, app **tạm dừng cuộn** và ghi rõ
*"Tạm dừng cuộn — chờ đếm số video cho N sound đang xếp hàng..."* rồi cuộn tiếp — đây là bình
thường, không phải treo. Muốn đếm nhanh hơn thì tăng **"Số luồng đếm video đồng thời"** trong
⚙ (càng cao càng dễ bị TikTok chặn trang đếm — khuyến nghị giữ 2, tối đa 4–5).

## Đọc bảng profile

| Cột | Ý nghĩa |
|---|---|
| **Quét** | Số sound tìm thấy trên feed (đã lọc trùng) |
| **Đã check** | Số sound đã đi qua bước đếm video (kể cả bị bỏ) |
| **Hợp lệ** | Số sound đạt bộ lọc và đã vào bảng kết quả |
| **Trạng thái** | Việc đang làm; chế độ chu kỳ có thêm chip đếm ngược `⏳ Quét · còn 4g52p → Xem` |

Nhấn **📄** để xem log chi tiết của từng profile — đây là nơi đầu tiên cần xem khi có vấn đề.

## 📊 Lịch sử thu thập theo ngày

Nút **📊 Lịch sử** trên thanh trên cùng mở bảng sản lượng từng ngày:

| Ngày | Sound thu được | Theo profile |
|---|---|---|
| 03/08/2026 *(hôm nay)* | 230 | `vzvazzrbw1083...: 72 · jfmpjtks750...: 59 · …` |
| 02/08/2026 | 265 | … |

Kèm 4 ô tổng kết: **Hôm nay** · **7 ngày gần nhất** · **Tổng N ngày** · **TB ngày có chạy**
(trung bình chỉ chia cho những ngày thực sự thu được sound, không chia đều cả ngày nghỉ).
Cột "Theo profile" hiện 1 dòng cho gọn — **trỏ chuột vào để xem đầy đủ** danh sách.

**Đếm gì:** số sound **thực sự thu được** = cột **Hợp lệ** (đã qua bộ lọc số video và vào bảng
dữ liệu). Không đếm số lần lướt, cũng không đếm sound quét được rồi bị lọc bỏ.

**Lưu ở đâu:** `config/history.json` **cạnh file .exe** (cùng chỗ với `config/profiles.json`)
— nên chép máy hay sao lưu là mang theo được, và **không mất khi bạn cập nhật `.exe`** vì chỉ
thay đúng file .exe trong cùng thư mục. Giữ 400 ngày rồi tự dọn ngày cũ nhất.

✅ **Lịch sử chỉ nằm trong app, KHÔNG đẩy gì lên Google Sheet** — không thêm tab, không thêm
cột, không gọi Google API. Sheet của bạn giữ nguyên như cũ.

⚠️ **Số liệu là của RIÊNG máy này** — không gộp sound do 5 VPS khác thu. Muốn xem tổng cả dàn
thì cộng tay từ từng máy.

⚠️ Lịch sử chỉ bắt đầu ghi **từ khi cập nhật bản này** — những ngày trước không dựng lại được
(Google Sheet không có cột thời gian nên không đếm ngược lại được).

Nút **🗑 Xóa lịch sử** xóa sạch số liệu trên máy này, **không hoàn tác được** (có hỏi xác nhận).

## Google Sheet

Modal **☁ Google Sheet**:

1. Dán Spreadsheet ID hoặc URL
2. Tên tab (mặc định `Data`)
3. Dán toàn bộ file JSON của Service Account
4. **Chia sẻ Sheet cho email `client_email` với quyền Editor** — thiếu bước này sẽ lỗi 403
5. Nhấn 🔌 Test kết nối

Dữ liệu ghi vào 4 cột **A–D**: Tên sound | Link | Số video | Profile. Các cột từ E trở đi
để trống cho bạn tự dùng.

**Chạy nhiều máy cùng một Sheet — chống trùng thế nào (cải tiến 2026-08-03):**
- App **tự đọc phần MỚI thêm ở cuối Sheet mỗi phút** (rẻ + nhanh) → máy này biết sound máy khác
  vừa đẩy trong vòng **~1 phút**, thay vì 5–15 phút như trước.
- Ô **"Đọc lại toàn bộ Sheet mỗi X phút"** (mặc định 10) chỉ là chu kỳ đọc lại **toàn bộ** để
  đồng bộ lại mốc (cần khi có dòng bị xóa làm các dòng phía sau dịch lên). **Không cần hạ
  xuống thấp** — phần mới đã đọc mỗi phút rồi; hạ thấp chỉ làm nặng thêm.

- **Quan trọng nhất:** ngay **TRƯỚC MỖI LẦN GHI** lên Sheet, app đọc lại phần mới nhất một lần
  nữa rồi lọc lại. Nên nếu 2 máy quét trúng cùng 1 link, **máy đẩy sau sẽ thấy máy trước vừa
  đẩy và tự bỏ** — không ghi trùng.

⚠️ **Thành thật:** vẫn không thể hết trùng 100%. Google Sheets không có cơ chế "giành quyền"
nên nếu 2 máy đọc-rồi-ghi lồng vào nhau trong **cùng dưới một giây** thì cả hai vẫn thấy "chưa
có" rồi cùng ghi. Cửa sổ đã co từ 5–15 phút xuống dưới 1 giây, nhưng không phải 0. Trùng còn
sót thì dùng nút **🧹 Dọn trùng trên Sheet** để dọn.

⚠️ Khi dọn trùng trên Sheet, luôn **xóa cả dòng** (Delete rows), đừng xóa nội dung ô — xóa
nội dung sẽ làm app ghi lệch cột ở lần đẩy sau.

**🧹 Dọn trùng trên Sheet** (trong modal ☁ Google Sheet, mục "Bảo trì"): quét lại **toàn bộ**
tab, tìm các dòng có Link bị lặp và tự xóa bớt — mỗi link chỉ giữ lại đúng 1 dòng (ưu tiên
giữ dòng bạn đã tự ghi chú ở cột E trở đi, tránh mất ghi chú tay). Bấm nút sẽ hiện **xem
trước** số dòng sẽ xóa trước, phải xác nhận mới xóa thật (không thể hoàn tác). Sheet càng
lớn quét càng lâu (có thể vài phút với Sheet >100 nghìn dòng) — đây là việc dọn dẹp định kỳ,
không phải cơ chế chống trùng chính (cơ chế chính đã tự chạy ngầm khi đẩy dữ liệu, xem mục
"Chạy nhiều máy" bên dưới); dùng khi nghi ngờ có sẵn link trùng từ trước.

## Chạy nhiều máy

- **App giờ TỰ CHẶN chạy cùng một profile trên 2 máy** (từ 2026-07-28) — nếu bạn bấm "▶ Chạy"
  một profile đang thật sự chạy ở máy khác, app báo lỗi ngay và **không cho chạy**, thay vì
  để TikTok hủy phiên đăng nhập của cả hai. Cơ chế này cần **đã cấu hình ☁ Google Sheet**
  (dùng chính Sheet bạn chia sẻ giữa các máy) — nếu chưa cấu hình Sheet, app vẫn cho chạy
  bình thường (không chặn được, nhưng cũng không đứng im chờ).
- Chuyển profile sang máy khác: **chép cả thư mục profile** (gồm `session.state.json`,
  `fingerprint.json` và thư mục `Data` nếu có), không chỉ chép file session.
- Bật VPN đúng quốc gia của profile **trước khi** mở app.
- Chắc ăn nhất sau khi chuyển máy: bấm 🦊 đăng nhập lại một lần.
- App tự tạo tab **`_locks`** trên Sheet để ghi nhịp tim, tab này ở dạng **ẨN** nên
  **không hiện** trên thanh tab (không làm phiền các tab dữ liệu khác của bạn). Đừng xóa nội
  dung ô trong đó, chỉ xóa cả dòng nếu cần dọn. Xem
  [TROUBLESHOOTING.md](../technical/TROUBLESHOOTING.md) mục 11-12 nếu gặp "chỉ profile đầu
  chạy" hoặc thấy tab này hiện công khai.

### App tự canh IP đúng quốc gia

Profile có nhãn quốc gia trong tên (`(US)`, `(UK)`…) sẽ được app kiểm IP thật — nếu VPN tụt
sang nước khác, app **tự tạm dừng** profile đó và ghi log:

```
⚠ TẠM DỪNG: IP hiện tại ở DE nhưng profile khai (US)...
```

Không cần bấm gì: bật lại VPN đúng vùng là app tự chạy tiếp (`✅ IP đã về đúng vùng`). Mất
mạng tạm thời thì app **không** tạm dừng. Chi tiết: [TROUBLESHOOTING.md](../technical/TROUBLESHOOTING.md) mục 9.

### Cập nhật phiên bản (đang làm thủ công)

Tự cập nhật hiện **tắt** (repo phát hành để private). Sau mỗi lần build, copy `.exe` mới sang
từng máy — và **phải copy cho HẾT các máy trong cùng một lần**: máy chạy bản cũ lẫn vào vẫn
gây trùng dữ liệu trên Sheet.

## Khuyến nghị vận hành

- **5 profile mỗi máy** là mức cân bằng tốt. 15 profile trên một máy sẽ nghẹt CPU và bị
  TikTok chặn nhiều hơn, sản lượng không tăng tương ứng.
- Chạy dài/qua đêm: bật **Chạy ẩn** + **Không tải ảnh/video**.
- Gặp sự cố: xem [TROUBLESHOOTING.md](../technical/TROUBLESHOOTING.md).
