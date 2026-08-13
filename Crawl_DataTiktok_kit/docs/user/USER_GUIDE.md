# Hướng dẫn sử dụng — TikTok Crawler

> Cập nhật: 2026-08-06 (tab CHỜ bật sẵn; app tự thử lại khi TikTok lỗi trang; đếm ngược trên nút Chạy khi đổi IP)

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
| **Chế độ đếm** | **Riêng từng máy.** Để `Nhanh` (mặc định) trên **mọi** máy — xem mục dưới |
| Dùng profile Chromium riêng cho tài khoản này | **Riêng từng profile.** Mặc định **tắt**. Bật khi profile đó bị **mất đăng nhập liên tục** — đổi lại tốn thêm ~150–250MB RAM (xem mục dưới) |
| Thời lượng mỗi pha (chu kỳ) | Quét bao nhiêu giờ, xem bao nhiêu phút, nghỉ giữa 2 pha bao lâu |

### Chọn "Chế độ đếm" nào cho máy nào?

Cùng một file `.exe` chạy trên mọi máy, nhưng **máy mạnh và máy ảo cần đánh đổi ngược nhau**. Nên
đây là cài đặt **riêng từng máy** (lưu ở máy đó, không đồng bộ).

| | **Nhanh** (mặc định) | **Kiên nhẫn** (như bản 0.1.63) |
|---|---|---|
| Chờ API `api/music/detail/` | 8 giây | 20 giây |
| Đọc giao diện (dự phòng) | trần cứng 2.5s → 5s | tới 30 giây |
| Thử lại khi TikTok trả trang lỗi | **có**, 1 lượt | không |
| Tự bỏ lượt thử lại khi hàng đợi tắc | **có** | — |

**Cả 5 máy đều nên để Nhanh — kể cả máy mạnh.** (Sửa lại lời khuyên cũ, 2026-08-10: bản trước
của tài liệu này khuyên máy mạnh dùng Kiên nhẫn. Đo lại thì sai.)

Lý do, tính từ chính hai bộ tham số ở bảng trên:

- **Khi đọc THÀNH CÔNG, hai chế độ giống hệt nhau** (~1 giây). Các mốc chờ 8s/20s và 2.5s/30s là
  *trần*, đọc xong sớm thì không ai chờ tới trần — nên "kiên nhẫn hơn" không mang lại gì.
- **Khi đọc THẤT BẠI, Kiên nhẫn luôn đắt hơn** ở mọi tốc độ máy: 23,3s so với 21,8s trên máy mạnh;
  27,8s so với 23,5s trên VPS lag.
- **Kiên nhẫn KHÔNG có lượt thử lại.** Đây là điểm quyết định: cùng một link mà TikTok trả trang
  lỗi lần đầu, `Nhanh` thử lại và đọc được số video, còn `Kiên nhẫn` mất luôn sound đó sang tab chờ.

⚠️ **Máy ảo yếu → PHẢI để Nhanh.** Đo thật trên VPS lag: chế độ Kiên nhẫn làm **một** sound lỗi
chiếm slot đếm **của cả app** tới **~28 giây** → thông lượng tụt còn ~4 sound/phút trong khi vòng
quét cần ~20 → hàng đợi đầy vĩnh viễn → **vòng quét đứng, feed ngừng cuộn** (đúng hiện tượng
*"cứ dừng mãi ở 1 video"*).

Đổi xong **áp dụng ngay** cho sound kế tiếp, không cần chạy lại profile.

### Chuyển qua lại giữa 2 bản phát hành (2 repo)

Dự án có **2 người, 2 repo phát hành riêng**. Bạn chuyển được qua lại chỉ bằng **một ô**:

**⬆ Cập nhật → Nâng cao → GitHub repo phát hành** → gõ tên repo → **Lưu** → bấm **Kiểm tra**.

| Muốn chạy bản của | Gõ vào ô |
|---|---|
| Bạn (`datkhac009`) | `datkhac009/Crawl_DataTiktok-releases` — hoặc **để trống** (mặc định) |
| Hung13010 | `Hung13010/Crawl_DataTiktok-releases` |

Dán cả URL GitHub cũng được, app tự cắt về dạng `Owner/Repo`. Thừa dấu `/` ở cuối cũng không sao
nữa — trước đây nó gây lỗi *"Không đọc được release"*.

⚠️ **Nếu bản bên kia CŨ HƠN bản đang chạy** thì app vẫn cho chuyển, nhưng:

- Nhãn hiện `v0.1.55 ⚠ CŨ HƠN bản đang chạy (v0.1.71)`
- Nút đổi thành **⬇ Chuyển sang bản này (hạ version)**
- Có hộp xác nhận, phải bấm đồng ý

**Chỉ khi bạn TỰ bấm "Kiểm tra"** thì app mới đề nghị hạ version. Lần tự kiểm lúc khởi động
**không bao giờ** tự hạ — để một ô gõ sai không làm cả dàn máy âm thầm tụt về bản cũ.

**Dữ liệu KHÔNG bị đụng** khi chuyển: `profiles/`, `config/`, `known_links.txt` giữ nguyên. Chỉ
file `.exe` bị thay.

⚠️ Nhớ **mỗi máy phải gõ riêng** — ô này lưu trong máy, không đồng bộ qua Sheet. Máy nào để trống
là về mặc định `datkhac009`.

### Khi nào bật "Dùng profile Chromium riêng"?

Bình thường app lưu phiên đăng nhập trong **một file cookie** và cho mọi profile **dùng chung
một Chromium** — cách này tốn ít RAM nhất.

Bật công tắc này thì **tài khoản đó có một thư mục Chromium riêng**, giữ được nhiều thứ hơn
chỉ cookie (localStorage, IndexedDB) nên **giống trình duyệt thật hơn → TikTok ít hủy phiên
hơn**.

Đây là cài đặt **riêng từng profile**: bật ở profile này **không** ảnh hưởng profile khác. Bật
vài profile, để vài profile tắt trên **cùng một máy** là hoàn toàn được — và đó chính là cách
dùng nên làm (xem "Cách làm an toàn" dưới).

| | Tắt (mặc định) | Bật |
|---|---|---|
| RAM | Ít nhất | **+150–250MB mỗi profile bật** (bật cả 5 ≈ +1GB) |
| Đĩa | ~150KB/profile | ~100–200MB/profile |
| Độ bền phiên đăng nhập | Bình thường | Tốt hơn |

**Nên bật khi:** máy còn dư RAM (≥ 4GB trống) **và** đang bị mất đăng nhập nhiều lần trong
ngày dù không chạy trùng profile ở máy khác.

**Không nên bật khi:** máy ảo chỉ 2–4GB RAM — hết RAM sẽ sập cả 5 profile, tệ hơn mất phiên.

**Cách làm an toàn — so sánh ngay trên cùng một máy:** bật cho **2 profile**, để **3 profile
còn lại tắt**, chạy 1 đêm rồi so số sound (📊 Lịch sử có số theo từng profile) và số lần phải
bấm 🦊. Cùng máy nghĩa là **cùng IP, cùng giờ, cùng phiên bản** → khác biệt thấy được là do
đúng công tắc này, không phải do máy khác nhau. Hơn thật thì mới bật thêm.

Lưu ý:
- Lần đầu bật, cookie đang có được **mang sang tự động** → **không mất đăng nhập**.
- **Tab đếm số video chạy ngầm** (từ v0.1.61): chạy ở chế độ **hiện** thì cửa sổ profile chỉ có
  **một tab chính**, tab `/music/` của bước đếm nằm trong trình duyệt ẩn riêng. Trước v0.1.61
  nó nằm chung cửa sổ nên bạn thấy 2 tab — cập nhật app là hết.
- Đổi công tắc chỉ áp cho **lần bật profile tiếp theo**; profile đang chạy giữ nguyên chế độ cũ
  tới khi dừng.
- Muốn quay lại: tắt công tắc là xong. Thư mục `ChromiumProfile` trong profile có thể **xóa
  tay** để lấy lại đĩa, không mất đăng nhập.

## Chạy và dừng

| Nút | Hành vi |
|---|---|
| **▶ Chạy đã chọn** | Chạy các profile đã tick — bật **lần lượt từng profile**, không bật ồ ạt |
| **■ Dừng ô đã chọn** | Ngừng quét ngay nhưng **CHECK NỐT** hàng đợi rồi mới dừng hẳn — **không mất sound** |
| **⏹ Dừng ngay ô đã chọn** | **Cắt tức thì** — sound trong hàng đợi chưa check sẽ bị **BỎ**. Có hỏi xác nhận kèm số sound sẽ mất |

### Bấm "■ Dừng" thì profile vẫn chạy thêm một lúc — ĐÚNG, không phải lỗi

Từ **v0.1.74**, nút **■ Dừng** (cả trên từng hàng lẫn trên thanh trên) là **dừng mềm**: nó ngừng
quét **ngay**, nhưng **check nốt** những sound đã quét mà chưa kịp đếm số video rồi mới dừng hẳn.

Lý do: số sound **mất** khi dừng cứng = **cột Quét − cột Đã check**. Với 6 profile, mỗi profile
tối đa 20 sound chờ, một lần bấm Dừng có thể mất tới ~120 sound đã quét được.

Trong lúc đó log ghi rõ từng sound:

```
Dừng mềm: đang check nốt "original sound - mohammad tilavi" (còn 72 sound chờ)...
Bỏ "original sound  - Shanenahshane" (1 < 1000 video)
Dừng mềm: đang check nốt "original sound - aso_gak2" (còn 69 sound chờ)...
```

và nút đổi thành **⏹ Dừng ngay** — **bấm lần nữa là cắt luôn**.

⚠️ **Khi nào phải cắt ngay:**

| Tình huống | Làm gì |
|---|---|
| **VPN tụt / bạn sắp tắt HMA** | **Cắt ngay** (bấm nút lần 2, hoặc **⏹ Dừng ngay ô đã chọn**). Mỗi giây profile còn chạy là một giây gửi request bằng **IP thật** |
| Log kẹt ở `TikTok đang chặn trang đếm` | **Cắt ngay** — bước đếm đang hỏng nên hàng đợi gần như không tiêu được (đo thật: 20 sound cần 6–7 tiếng) |
| Bình thường, muốn nghỉ | Bấm **■ Dừng** một lần rồi để yên — app tự dừng khi check xong |

✅ Các đường **TỰ ĐỘNG** (feed cạn, bị chặn trang đếm, VPN tụt) vẫn **cắt ngay** như cũ — không
bị chậm lại vì thay đổi này.

**Bật lần lượt (từ 2026-07-31):** chọn nhiều profile rồi bấm ▶ thì app bật **từng profile
một** — chờ profile vừa bật quét được sound đầu tiên mới bật profile kế tiếp (tối đa chờ 25
giây/profile, nếu profile nào chậm thì tự bật tiếp, không đứng chờ mãi). Nút sẽ hiện
`▶ Đang bật 2/5...` và tạm khóa cho tới khi xong lượt. Lý do: bật cùng lúc làm mấy profile
tranh nhau CPU → có profile bị đứng, không quét được (lỗi cũ hay gặp trên VPS).

Số sound sẽ mất khi dừng cứng = **cột Quét − cột Đã check**. Khoảng cách này được giữ **nhỏ**
(tối đa ~20 sound/profile) bằng cách **tự giãn nhịp cuộn**: hàng đợi chờ đếm càng đầy thì app cuộn
càng chậm, nên vòng quét **tự khớp tốc độ** với bước đếm.

| Hàng đợi | Delay thực (nếu bạn đặt 2–4s) |
|---|---|
| Dưới nửa | 2–4s (bình thường) |
| 3/4 | 5–10s |
| Đầy | 8–16s |

Trước đây app chạy **hết tốc** rồi **dừng cứng** ở một video khi hàng đợi đầy — trông y như treo,
đúng hiện tượng *"cứ dừng mãi ở 1 video"*. Giờ nó chậm dần thay vì đứng.

Nếu vẫn thấy dòng *"Tạm dừng cuộn — chờ đếm số video cho 20 sound đang xếp hàng..."* thì bước đếm
đang quá chậm cho máy đó → kiểm **Chế độ đếm** phải là **Nhanh** (xem mục trên).

Muốn đếm nhanh hơn thì tăng **"Số luồng đếm video đồng thời"** trong ⚙ — càng cao càng dễ bị TikTok
chặn trang đếm, khuyến nghị giữ 2, tối đa 4–5.

**Feed đứng thật thì app tự gỡ.** Nhận biết bằng **hai** đường (đủ một là đủ): đọc trúng cùng 1 sound
**20 lần**, hoặc ở trên cùng 1 sound quá **90 giây**. Rồi thử **3 cách** xoay vòng: bấm nút "video kế
tiếp" của TikTok → cuộn mạnh 3 nhịp con lăn → tải lại trang. Cả 3 đều trượt mà trang chỉ còn 1–2
video ⇒ **feed cạn** (xem mục dưới).

## Đọc bảng profile

| Cột | Ý nghĩa |
|---|---|
| **Quét** | Số sound tìm thấy trên feed (đã lọc trùng) |
| **Đã check** | Số sound đã đi qua bước đếm video (kể cả bị bỏ) |
| **Hợp lệ** | Số sound đạt bộ lọc và đã vào bảng kết quả |
| **Trạng thái** | Việc đang làm; chế độ chu kỳ có thêm chip đếm ngược `⏳ Quét · còn 4g52p → Xem` |

Nhấn **📄** để xem log chi tiết của từng profile — đây là nơi đầu tiên cần xem khi có vấn đề.

### Khi TikTok chặn riêng bước đếm

Dấu hiệu trong log, lặp đi lặp lại:

```
TikTok đang chặn trang đếm (5 sound liên tiếp lỗi) — nghỉ 322s...
Tạm dừng cuộn — chờ đếm số video cho 20 sound đang xếp hàng...
```

Cột của profile đó đứng yên kiểu **Quét 24 · Đã check 3 · Hợp lệ 0** — feed vẫn quét được, chỉ bước
đếm bị chặn.

Từ **v0.1.68** app **bỏ cuộc sau 6 lần lỗi liên tiếp**: dừng profile đó rồi **tự bật lại sau
5 → 15 → 30 phút** cho tài khoản nghỉ. Trước đây nó thử mãi 1 sound mỗi ~6 phút — đo thật: **40 phút
ra 0 sound hữu ích**, và hàng đợi 20 sound cần **6–7 tiếng** mới tiêu hết.

⚠️ Đây thường là TikTok siết **riêng tài khoản đó**, không phải IP. Cách kiểm: nhìn các profile khác
**trên cùng máy** — nếu chúng vẫn đếm bình thường thì đổi IP **không giải quyết được gì**, chỉ làm
dừng oan những profile đang khoẻ. Tài khoản bị siết nhiều lần trong ngày thì nên cho nghỉ hẳn vài
tiếng.

## Khi TikTok không cho lướt tiếp ("feed cạn")

Đôi khi một profile **vẫn đăng nhập tốt** nhưng TikTok chỉ cho nó **1–2 video** rồi không nạp
thêm — nút mũi tên xuống trên trang bị làm mờ. App nhận ra và báo:

```
⛔ TikTok KHÔNG cấp thêm video cho profile này — trang chỉ còn 2 video và nút
  "video kế tiếp" ĐANG BỊ TẮT, đã thử 3 lượt thoát kẹt đều không hiệu quả.
  Phiên đăng nhập vẫn TỐT — cuộn thêm chỉ làm TikTok siết nặng hơn.
```

**Không phải đăng nhập lại** — app đã tự kiểm phiên trước khi kết luận, nên đừng mất công bấm 🦊.

**App DỪNG đúng profile đó rồi TỰ BẬT LẠI** (từ 2026-08-06):

```
⛔ "tên profile" bị TikTok cắt feed (lần 1 liên tiếp) — DỪNG profile này,
   sẽ TỰ BẬT LẠI sau 5p0s.
```

Badge trạng thái của hàng đó đếm ngược để bạn biết app **đang chờ có chủ đích**, không phải treo:

```
⏸ Bị cắt feed — tự bật lại sau 4p12s
```

**Nghỉ lâu dần theo số lần bị cắt LIÊN TIẾP: 5 → 15 → 30 phút** (giữ mức 30). Bị cắt lại ngay nghĩa
là TikTok đang siết nặng — thử dày chỉ siết thêm. Thu được **1 sound hợp lệ** là chuỗi này về 0, lần
cắt sau lại nghỉ từ 5 phút.

| Việc bạn làm | App làm gì |
|---|---|
| **Không làm gì** (treo máy) | Tự bật lại theo đúng lịch trên — không cần bấm |
| Bấm **▶ Chạy** lúc đang đếm ngược | Chạy **ngay**, khỏi chờ hết giờ |
| Bấm **■ Dừng** lúc đang đếm ngược | **Huỷ** hẹn tự bật lại — app không tự bật nữa (bạn đã tiếp quản) |
| Tắt HMA lúc đang đếm ngược | Tới giờ app **không bật** (sẽ chạy bằng IP thật). Kiểm lại mỗi 5 giây, HMA lên là bật |

Các profile khác **chạy bình thường, không bị đụng tới**. Áp dụng cho **mọi chế độ**, kể cả
**Quét ⇄ Xem** — không có ngoại lệ, không có công tắc nào.

App mất **2–3 phút** mới dám kết luận (phải thử đủ 3 cách thoát kẹt trước) — đó là cố ý, để
không báo oan làm profile đang khoẻ bị dừng.

⛔ **Đã bỏ** (2026-08-06): trước đây app *tự tắt/bật lại HMA VPN* rồi mới chạy lại. Bỏ vì **IP là
của cả máy**: đổi IP giữa lúc các profile khác đang quét làm chúng chuyển từ IP A sang IP B **giữa
phiên** — đúng khuôn "tài khoản bị chiếm" mà TikTok dùng để hủy phiên. Giờ app **chỉ dừng/bật lại
đúng một profile**, không bao giờ tự đụng vào VPN.

💡 **Nếu muốn đổi IP nữa** thì làm tay trong lúc profile đang đếm ngược (dừng hết profile → tắt/bật
HMA → chờ 59 giây). App tự nhận ra VPN vừa đổi và **không bật profile trong lúc VPN còn tắt**.

**Nếu bị lặp lại nhiều lần thì nguyên nhân ở NGOÀI app**, làm theo thứ tự:

0. **Đổi IP bằng tay**: dừng HẾT profile trên máy đó → tắt/bật lại HMA → chờ hết 59 giây → chạy lại. Xem mục ngay dưới
   đây. Đây là cách duy nhất chạm tới **gốc rễ** (đổi IP thật); các cách còn lại chỉ là vòng qua.
1. **Đổi profile đó sang chế độ Tìm kiếm** (đổi ngay ở cột **Chế độ**). Đây là cách lướt tiếp
   **có thật**: video mở từ kết quả tìm kiếm dùng danh sách phát riêng của trang tìm kiếm, không
   dùng feed For You — nên For You bị siết không có nghĩa Tìm kiếm cũng bị.
2. **Tìm kiếm cũng cụt** ⇒ đang bị siết theo IP/tài khoản ⇒ **tắt rồi bật lại VPN** để lấy IP
   mới (HMA cấp IP khác mỗi lần kết nối — không cần đổi thành phố). Nhớ **dừng hết profile
   trước khi tắt VPN**, vì lúc VPN tắt máy dùng IP thật.
3. Xem các profile khác **trên cùng máy đó**: nếu có profile khác cũng báo `TikTok đang chặn
   trang đếm` thì gần như chắc là **IP của máy đó** bị siết, không phải lỗi riêng 1 profile.
   So với máy đang khoẻ — profile khoẻ ghi `cuộn 100 lần, gặp 94 sound khác nhau`.
4. Chuyển profile sang máy có IP khoẻ (chép **cả thư mục profile**, và đừng chạy cùng profile
   ở 2 máy — app sẽ chặn).

⚠️ **Bản thân app không có cách nào bắt TikTok cấp thêm video** khi nó đã quyết định cắt — đây
là giới hạn thật, không phải app thiếu tính năng. Nhưng **đổi IP máy** (mục dưới) thường giải
quyết được, vì khi đó TikTok gặp một "máy" hoàn toàn khác.

### Đổi IP bằng tay khi bị cắt feed

App **không tự đổi IP** — tính năng đó đã **bỏ** (xem cuối mục này). Làm tay theo đúng thứ tự này
để không phá phiên của profile khác:

1. **Dừng HẾT profile** trên máy đó — tick tất cả rồi bấm **■ Dừng ô đã chọn**
2. **Tắt rồi bật lại HMA** (không cần đổi thành phố — HMA cấp **IP khác mỗi lần kết nối**; đo thật:
   cùng server London cho `18.171.54.19` → `18.132.40.68`, nên cả nước chỉ có 1 thành phố như Hàn
   Quốc vẫn đổi IP được)
3. App tự phát hiện, **khóa nút Chạy và đếm ngược 59 giây**
4. Hết đếm ngược → bấm **▶ Chạy** lại

**Vì sao phải dừng HẾT trước khi tắt VPN:** lúc VPN tắt, máy dùng **IP thật**. Profile nào còn chạy
sẽ gửi request bằng IP thật trong khi vẫn khai múi giờ London/Seoul/New York — mâu thuẫn đó là thứ
TikTok dễ nhận ra nhất.

⛔ **Vì sao BỎ tính năng "app tự tắt/bật HMA rồi tự chạy lại"** (2026-08-06):

**IP là của CẢ MÁY**, không của riêng một profile. Chỉ có hai cách làm, cả hai đều tệ:

| Cách | Vấn đề |
|---|---|
| Chỉ dừng profile bị cắt rồi đổi IP luôn | 4 profile kia đang quét trên **IP A** bị chuyển sang **IP B giữa phiên** — đúng khuôn "tài khoản bị chiếm" khiến TikTok hủy phiên |
| Dừng HẾT profile rồi mới đổi | Mỗi lần **một** profile bị cắt là **cả dàn phải nghỉ** + chờ 59 giây + bật lại lần lượt — đắt hơn nhiều so với mất một profile |

Nên bỏ hẳn, thay bằng: **cắt feed → dừng đúng profile đó, bạn tự xử lý IP rồi tự chạy lại**.
### Nút "▶ Chạy" bị khóa trong lúc đổi IP — bình thường, không phải app treo

Nhãn trên nút cho biết đang ở đâu:

App **không bao giờ tự đổi IP** (tính năng đó đã bỏ 2026-08-06 — xem dưới). Phần này áp dụng khi **bạn tự tay tắt/bật HMA**.

| Nút hiện | Nghĩa | Vì sao không cho bấm |
|---|---|---|
| `⏳ đổi IP` | **App** đang tắt/bật lại HMA | **HMA đang TẮT** — chạy lúc này là chạy bằng **IP thật của bạn** |
| `⛔ VPN tắt` | HMA **đang tắt** (bạn tự tắt, hoặc VPN tụt) | Cùng lý do trên → **bật lại HMA** |
| `⏳ 59s` → `⏳ 1s` | Đang chờ IP mới ổn định | 5 profile cùng đăng nhập trên một IP vừa đổi trong vài giây = TikTok coi là **tài khoản bị chiếm** |
| `▶ Chạy` | Xong | Mở khóa ngay khi hết đếm ngược — bấm tay được luôn nếu không muốn chờ app tự bật |

- Nút **"■ Dừng" luôn bấm được**, kể cả trong lúc chờ. Cả nút trên **từng hàng** và nút
  **"■ Dừng ô đã chọn"**.
- Bấm **"■ Dừng"** lúc đang chờ sẽ **hủy** việc tự chạy lại — app báo *"Đã huỷ việc tự chạy lại sau
  đổi IP"* và không tự bật lại profile bạn vừa tắt.
- Bạn bấm **OFF** trên HMA mà **còn profile đang chạy** → app cảnh báo *"⚠ Còn N profile ĐANG CHẠY:
  nên dừng ngay, chúng đang dùng IP thật"*. App **không tự dừng** — bạn đang chủ động điều khiển VPN
  nên quyền quyết là của bạn.
- **Máy không cài HMA** thì nút Chạy hoạt động bình thường, không bị khóa bao giờ.

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

⚠️ **Số liệu là của RIÊNG máy này** — không gộp sound do các máy khác thu. Muốn xem tổng cả dàn
(5 máy) thì cộng tay từ từng máy.

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

### Tab CHỜ KIỂM TAY — cứu những link TikTok bị lỗi trang

Có những sound mà app **không đọc được số video** vì TikTok trả trang lỗi:

```
Something went wrong
Sorry about that! Please try again later.
```

Sound đó **vẫn còn** (mở tay vẫn thấy tên tác giả và số video ở phần đầu trang) — chỉ là TikTok
lỗi lúc dựng trang. Trước đây app **bỏ luôn** những link này, và thực tế bỏ khá nhiều.

**Máy yếu / VPS lag là nguyên nhân rất hay gặp.** Đã đo thật (2026-08-06): cùng một link
`/music/original-sound-7385710780424243974`, **VPS** hiện "Something went wrong" nhưng **máy chính**
mở lên lại hiện đủ `som original · 262K video`. Cùng link, khác máy, khác kết quả — nên sound đó
hoàn toàn tốt, chỉ là VPS không dựng nổi trang.

**Chỉ cần 1 việc: tạo tab trên Sheet.** Tính năng **bật sẵn**, không phải cấu hình gì trong app.

1. Tạo tab tên **`Total_Link_Voice_Pending`** trên Sheet.
2. Dòng 1 đặt 5 tiêu đề: `Tên Sound | Link | Số Video | Profile | Tình trạng`.
3. Xong. Từ đó link lỗi tự vào tab đó.

| | |
|---|---|
| App ghi | 4 cột **A–D**: `Tên Sound \| Link \| Số Video \| Profile`. Cột **Số video để TRỐNG** (không đọc được thì không bịa) |
| App **KHÔNG** ghi | Cột **E "Tình trạng"** — để trống cho **bạn tự điền** |
| Trùng lặp | Không. App đọc tab chờ lúc bắt đầu chạy nên link đã có thì không ghi lại |

⚠️ **Chưa tạo tab thì app báo ngay** lúc bắt đầu chạy: *"Chưa có tab Total_Link_Voice_Pending trên
Sheet → link không đọc được số video sẽ bị BỎ"*. Không im lặng. Tạo tab rồi chạy lại là xong.

Muốn dùng **tên tab khác** thì điền vào ô **"Tên tab CHỜ KIỂM TAY"** trong modal ☁ Google Sheet.
Để trống ô đó = dùng tên mặc định ở trên (**không** phải tắt).

Muốn **tắt hẳn**: đổi tên hoặc xoá tab đó trên Sheet.

### ⚠️ "Something went wrong" thường KHÔNG phải lý do sound bị bỏ

Đo thật (2026-08-06): trang `/music/` hiện "Something went wrong" ở phần **lưới video**, nhưng
phần **đầu trang vẫn có số video** — và app đọc số từ đó, **không** đọc từ lưới. Nên lỗi đó
thường **vô hại**, app vẫn đếm được bình thường.

Nếu bạn thấy nhiều sound bị bỏ, **xem đúng dòng log** để biết lý do thật:

| Log ghi | Nghĩa | Có vào tab chờ? |
|---|---|---|
| `Bỏ "..." (16 < 1000 video)` | Đọc số OK, nhưng **không đạt bộ lọc** của bạn trong ⚙ | ❌ Không — đây là bộ lọc bạn tự đặt |
| `Bỏ "..." (sound đã bị xóa/không tồn tại)` | Sound chết thật | ❌ Không — không có gì để kiểm |
| `"...": TikTok trả trang lỗi — thử lại lượt 2/2...` | Lượt 1 không ra số, app **đang thử lại** | Chưa — chờ kết quả lượt 2 |
| `"...": TikTok trả statusCode lạ 10203 (body 205 byte)` | TikTok trả mã app chưa biết nghĩa | ✅ Có |
| `⏳ "..." → tab CHỜ kiểm tay` | **Không đọc được số** — đây mới là ca cần kiểm | ✅ Có |

Nếu phần lớn là dòng đầu (`< 1000 video`) thì không phải lỗi — chỉ là **ngưỡng lọc đang chặt**.
Muốn lấy cả sound ít video thì hạ **"Số video từ"** trong ⚙ Cài đặt crawl.

**App tự thử lại 1 lần** trước khi bỏ (từ 2026-08-06), vì trang lỗi của TikTok ghi thẳng *"Please
try again later"* kèm nút Refresh — chính nó khai là lỗi tạm thời. Lượt 2 đọc được thì sound vào
**tab chính** với số đầy đủ, không phải kiểm tay. **Không** thử lại khi sound đã xoá hoặc khi lượt 1
đã đọc được số (thử thêm chỉ làm TikTok chặn mình).

### Muốn xem tận mắt trang sound thì bật tab đếm

⚙ Cài đặt crawl → **"Hiện tab đếm số video trong cùng cửa sổ profile (chẩn đoán)"**.

Bình thường app đếm trong cửa sổ **ẩn** nên bạn không thấy gì. Bật cái này lên, tab `/music/` sẽ
hiện thành **một tab ngay trong cửa sổ của profile** — **không mở thêm browser thứ hai**, nên
không tốn thêm RAM (đo thật: cả 2 tab cùng `windowId`, chỉ 1 Chromium).

⚠️ **Chỉ bật khi cần soi lỗi.** Mỗi lần đếm là một lần mở trang nên tab đó **nhấp nháy liên tục**.
Chỉ thấy được khi profile chạy ở chế độ **hiện** (bỏ tick "Chạy ẩn") — profile chạy ẩn thì cửa sổ
chung cũng ẩn. Đổi công tắc chỉ áp cho **lần chạy profile tiếp theo**.

✅ **Link ở tab chờ vẫn được thử lại** những lần chạy sau. Lỗi *"Something went wrong"* thường chỉ
là tạm thời — lần sau đọc được số video thì sound vào **tab chính với dữ liệu đầy đủ**. Lúc đó nó
sẽ **có ở cả hai tab** (tab chờ từ lần lỗi, tab chính từ lần đọc được) — bạn dọn dòng ở tab chờ
khi xử lý. Đổi lấy việc không mất dữ liệu.

⚠️ **"Tên tab" phải khớp CHÍNH XÁC** tên tab trên Sheet (phân biệt chữ hoa/thường, đúng cả dấu
gạch dưới — vd `Total_Link_Voice`). Sai tên tab thì app báo:
*"Không có tab tên "X" trên Google Sheet này"* và **không đọc/ghi được gì**. Bấm **🔌 Test kết
nối** để xem danh sách tab có thật trên Sheet.

**Số dòng trên Sheet hiện ở dòng trạng thái** (cạnh badge "N sound"):

```
[ 86 sound ]  [ Bỏ qua trùng: 30 ]   Sheet: 156.946 dòng data
```

Con số này **tự cập nhật** khi Sheet thay đổi — kể cả khi **máy khác** đẩy dữ liệu lên (biết
trong vòng ~1 phút), và tăng **ngay lập tức** khi chính máy này đẩy. Khi có lỗi/cảnh báo thì
dòng đó ưu tiên hiện lỗi (số dòng sẽ hiện lại sau khi hết lỗi).

**Chạy nhiều máy cùng một Sheet — chống trùng thế nào (cải tiến 2026-08-03):**
- App **tự đọc phần MỚI thêm ở cuối Sheet mỗi phút** (rẻ + nhanh) → máy này biết sound máy khác
  vừa đẩy trong vòng **~1 phút**, thay vì 5–15 phút như trước.
- Ô **"Đọc lại toàn bộ Sheet mỗi X phút"** (mặc định 10) chỉ là chu kỳ đọc lại **toàn bộ** để
  đồng bộ lại mốc (cần khi có dòng bị xóa làm các dòng phía sau dịch lên). **Không cần hạ
  xuống thấp** — phần mới đã đọc mỗi phút rồi; hạ thấp chỉ làm nặng thêm.

- **Quan trọng nhất:** ngay **TRƯỚC MỖI LẦN GHI** lên Sheet, app đọc lại phần mới nhất một lần
  nữa rồi lọc lại. Nên nếu 2 máy quét trúng cùng 1 link, **máy đẩy sau sẽ thấy máy trước vừa
  đẩy và tự bỏ** — không ghi trùng.

**Nếu Google báo quá giới hạn gọi API (429):** app **tự tạm ngưng 60 giây** rồi làm tiếp —
**không mất dữ liệu**, lô đang chờ vẫn nằm trong bộ đệm và tự đẩy lại sau. Log ghi rõ
`[quota] Google API báo vượt giới hạn — tạm ngưng gọi tự động 60s`.

⚠️ **Quan trọng khi chạy nhiều máy:** giới hạn của Google là **60 request/phút cho mỗi Service
Account**, mà cả **5 máy** (4 VPS + máy của bạn) đang dùng **CHUNG một** file Service Account →
hạn đó chia cho cả 5 máy (hiện dùng khoảng 20–25 đọc + 15–20 ghi mỗi phút).
Nếu hay bị báo vượt giới hạn, **tạo Service Account riêng cho từng máy** (mỗi máy dán một file
JSON khác trong modal ☁, và chia sẻ Sheet cho cả 5 email đó với quyền Editor) — trần sẽ tăng từ
60 lên **300 request/phút**. **Không cần chia lại profile** — chia profile không giúp gì cho
giới hạn này.

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
