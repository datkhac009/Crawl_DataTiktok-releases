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
| **▶ Chạy đã chọn** | Chạy các profile đã tick |
| **■ Dừng đã chọn** | Dừng **ngay lập tức** — sound trong hàng đợi chưa check sẽ bị bỏ |
| **🕓 Dừng mềm đã chọn** | Ngừng quét ngay nhưng **check nốt** hàng đợi rồi mới dừng |

Số sound sẽ mất khi dừng cứng = **cột Quét − cột Đã check**.

## Đọc bảng profile

| Cột | Ý nghĩa |
|---|---|
| **Quét** | Số sound tìm thấy trên feed (đã lọc trùng) |
| **Đã check** | Số sound đã đi qua bước đếm video (kể cả bị bỏ) |
| **Hợp lệ** | Số sound đạt bộ lọc và đã vào bảng kết quả |
| **Trạng thái** | Việc đang làm; chế độ chu kỳ có thêm chip đếm ngược `⏳ Quét · còn 4g52p → Xem` |

Nhấn **📄** để xem log chi tiết của từng profile — đây là nơi đầu tiên cần xem khi có vấn đề.

## Google Sheet

Modal **☁ Google Sheet**:

1. Dán Spreadsheet ID hoặc URL
2. Tên tab (mặc định `Data`)
3. Dán toàn bộ file JSON của Service Account
4. **Chia sẻ Sheet cho email `client_email` với quyền Editor** — thiếu bước này sẽ lỗi 403
5. Nhấn 🔌 Test kết nối

Dữ liệu ghi vào 4 cột **A–D**: Tên sound | Link | Số video | Profile. Các cột từ E trở đi
để trống cho bạn tự dùng.

**Chạy nhiều máy cùng một Sheet:** đặt "Đồng bộ lọc trùng liên máy mỗi X phút" (mặc định 5)
để các máy biết nhau vừa đẩy gì, tránh trùng.

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
