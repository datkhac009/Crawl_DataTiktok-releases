# Quy trình chẩn đoán sự cố

> Tra theo triệu chứng. Mọi lệnh chạy trong `Crawl_DataTiktok_build`.
> Cập nhật: 2026-08-05

---

## 1. Profile chạy mãi mà "0 sound"

**Đọc log 📄 của profile, tìm dòng thống kê:**

```
Cuộn 100 lần, gặp N sound khác nhau, M sound mới
```

| N (số sound khác nhau) | Kết luận |
|---|---|
| Lớn (50–100) | Feed **chạy tốt** — chỉ là mọi sound đều đã có trong bộ lọc trùng. Không phải lỗi. |
| Rất nhỏ (1–4) | Feed **đứng im** → xem mục 2 |

Nếu bộ lọc đang rất chặt (Chỉ lấy Original Sound + ngưỡng số video hẹp + đã tích lũy hàng
trăm nghìn link) thì "0 sound mới" là bình thường ở giai đoạn dữ liệu đã cày sâu.

---

## 2. Feed không chuyển video / kẹt tại một video

App tự phát hiện sau 20 lần đọc trúng cùng một sound và ghi dòng chẩn đoán:

```
⚠ feed KHÔNG chuyển video (20 lần liên tiếp cùng 1 sound) — 2 link video, video tải 4/4,
  con trỏ ở BODY, thấy nút kế tiếp "action-item" → thử cách 1: bấm nút video kế tiếp...
   ↳ đã bấm nút "action-item".
```

| Trường trong log | Ý nghĩa |
|---|---|
| `N link video` | Số video trong trang. **1–2 = feed bị giới hạn** (thường do chế độ khách) |
| `video tải 0/4` | Media **không tải được** → thử tắt "Không tải ảnh/video" trong ⚙️ |
| `video tải 4/4` | Media bình thường, không phải nguyên nhân |
| `CÓ LỚP CHE "..."` | Có hộp thoại đè lên feed (đăng nhập, cảnh báo) |
| `KHÔNG thấy nút kế tiếp` | Không tìm được nút điều hướng — có thể TikTok đổi bố cục, hoặc trang chưa dựng xong |
| `nút kế tiếp "..." ĐANG BỊ TẮT (TikTok báo hết video)` | **Chính TikTok nói hết video.** Đây là bằng chứng trực tiếp của **FEED CẠN** → xem mục 16 |

⚠️ Hai dòng cuối **trước v0.1.61 bị gộp** thành cùng một câu `KHÔNG thấy nút kế tiếp`, nên đọc
log không phân biệt được "feed cạn" với "cơ chế cuộn hỏng". Từ v0.1.61 tách riêng — xem
[QĐ-31](DECISIONS.md).

**App tự thoát kẹt theo 3 cấp**, xoay vòng: bấm nút "video kế tiếp" của TikTok → click lấy
con trỏ rồi gửi phím xuống → tải lại trang.

**Cả 3 cách đều thất bại + chỉ có 1–2 link video** → hai khả năng, phân biệt bằng nút 🔑:

| 🔑 Kiểm tra đăng nhập nói gì | Kết luận | Đi tới |
|---|---|---|
| `CHẾ ĐỘ KHÁCH` | Mất phiên đăng nhập | mục 3 |
| `Đã đăng nhập` | **FEED CẠN** — tài khoản tốt nhưng TikTok không cấp thêm video | **mục 16** |

### Cách tự kiểm tra "feed có cuộn được không" bằng tay

Nếu nghi cơ chế cuộn hỏng (như sự cố 2026-07-27 khi phím mũi tên ngừng tác dụng), chạy
đoạn này để so sánh các cách cuộn trên chính profile đang lỗi:

```bash
node -e '
process.env.PLAYWRIGHT_BROWSERS_PATH=require("path").join(process.env.LOCALAPPDATA,"ms-playwright");
const {chromium}=require("./node_modules/playwright"); const fs=require("fs");
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const P="<đường dẫn>/session.state.json";
const rs=()=>{const a=[...document.querySelectorAll("a[data-e2e=\"video-music\"]")].filter(x=>x.getBoundingClientRect().height>0);
 if(!a.length)return null; let b=null,d=1e9; for(const x of a){const r=x.getBoundingClientRect();
 const q=Math.abs(r.top+r.height/2-innerHeight/2); if(q<d){d=q;b=x;}} return (b.getAttribute("href")||"").slice(-19);};
(async()=>{ const br=await chromium.launch({headless:true});
 const c=await br.newContext({storageState:JSON.parse(fs.readFileSync(P,"utf8")),userAgent:UA,viewport:{width:1536,height:864}});
 const pg=await c.newPage(); await pg.goto("https://www.tiktok.com/",{waitUntil:"domcontentloaded"});
 await pg.waitForSelector("a[data-e2e=\"video-music\"]",{timeout:45000}).catch(()=>{}); await pg.waitForTimeout(10000);
 const seen=[]; for(let i=0;i<8;i++){ seen.push(await pg.evaluate(rs));
  await pg.mouse.move(768,432); await pg.mouse.wheel(0,864); await pg.waitForTimeout(2800); }
 console.log("sound doc duoc:",seen.join(" "), "=>", new Set(seen.filter(Boolean)).size, "khac nhau");
 await br.close(); })()'
```

Nhiều sound khác nhau = feed chạy tốt, lỗi nằm chỗ khác. Chỉ 1 sound = feed thật sự kẹt.

---

## 3. Profile không nhận đăng nhập / chạy ở chế độ khách

### Cách nhanh nhất: nút 🔑 Kiểm tra đăng nhập

Tick các profile cần kiểm tra (hoặc không tick gì = kiểm tra tất cả) rồi bấm
**🔑 Kiểm tra đăng nhập**. App mở TikTok thật cho từng profile và hỏi thẳng, khoảng **20–30
giây mỗi profile**. Kết quả hiện ở thông báo và log 📄 từng profile:

| Kết quả | Nghĩa |
|---|---|
| `Đã đăng nhập` | Phiên còn tốt; app tự chốt bản này làm **phiên vàng** để sau còn khôi phục |
| `CHẾ ĐỘ KHÁCH — cần đăng nhập lại bằng 🦊` | Phiên đã chết, phải đăng nhập tay |
| `Không xác định được` | Trang tải chậm hoặc bị chặn — thử lại |
| `Đang chạy — bỏ qua` | Profile đang crawl, dừng nó trước rồi kiểm tra |

App **tự khôi phục** trước khi kết luận: nếu phiên hiện tại khuyết, nó thử phiên vàng, rồi
thử trích lại từ Firefox. Chỉ khi cả hai đường đều không cứu được mới báo chế độ khách.


App tự kiểm tra sau khi feed hiện và dừng ngay nếu là khách:

```
Profile đang ở chế độ KHÁCH (chưa đăng nhập) — TikTok chỉ cho xem 1-2 video...
```

### Kiểm tra nhanh trạng thái mọi profile

```bash
node -e '
const fs=require("fs"),path=require("path");
const R="D:/1.TotaTool/2.Crawl_DataTiktok_Release/profiles";   // đổi cho đúng máy
for(const p of fs.readdirSync(R)){
  const f=path.join(R,p,"session.state.json"); if(!fs.existsSync(f))continue;
  const j=JSON.parse(fs.readFileSync(f,"utf8"));
  const ck=(j.cookies||[]).filter(c=>String(c.domain||"").includes("tiktok"));
  const sid=ck.some(c=>c.name==="sessionid");
  const idc=ck.some(c=>c.name==="tt-target-idc");
  console.log(p.padEnd(34), ck.length+" cookie", sid?"có sessionid":"** KHÁCH **",
    idc?"":"** THIẾU ĐỊNH TUYẾN **");
}'
```

| Kết quả | Xử lý |
|---|---|
| `** KHÁCH **` | Bấm 🦊 đăng nhập lại |
| `** THIẾU ĐỊNH TUYẾN **` | App sẽ tự trích lại từ Firefox khi chạy; không được thì đăng nhập lại bằng 🦊 |
| Đủ cookie nhưng vẫn khách | Phiên bị TikTok hủy phía máy chủ → đăng nhập lại bằng 🦊 |

### Kiểm tra dứt điểm: hỏi thẳng TikTok

```bash
node -e '
process.env.PLAYWRIGHT_BROWSERS_PATH=require("path").join(process.env.LOCALAPPDATA,"ms-playwright");
const {chromium}=require("playwright"); const fs=require("fs");
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const P="<đường dẫn>/session.state.json";
(async()=>{
  const b=await chromium.launch({headless:true});
  const c=await b.newContext({storageState:JSON.parse(fs.readFileSync(P,"utf8")),userAgent:UA});
  const pg=await c.newPage(); await pg.goto("https://www.tiktok.com/",{waitUntil:"domcontentloaded"});
  await pg.waitForTimeout(20000);
  console.log(await pg.evaluate(()=>({
    khach: !!document.querySelector("[data-e2e=\"top-login-button\"]"),
    soVideo: document.querySelectorAll("a[data-e2e=\"video-music\"]").length })));
  await pg.screenshot({path:"kiemtra.png"}); await b.close();
})()'
```

`khach: true` → phiên đã chết. Ảnh `kiemtra.png` cho thấy đúng những gì TikTok hiển thị.

### Nguyên nhân thường gặp làm chết phiên

1. **Chạy cùng một profile trên 2 máy cùng lúc** → TikTok thấy 1 phiên, 2 IP → hủy cả hai.
2. **Mở FirefoxPortable trong khi app đang chạy** cùng profile đó → tương tự.
3. **Đổi vùng VPN** so với lúc tạo phiên.
4. **Bấm 🦊 kiểm tra một profile đang bị từ chối** (đã vá — trước đây thao tác này tự hủy phiên).

---

## 4. Mở FirefoxPortable thấy đăng nhập nhưng app thì không

Kiểm tra theo thứ tự:

1. **Thư mục lồng thừa cấp?** File `session.state.json` phải nằm **ngay trong** thư mục
   profile, không phải trong thư mục con trùng tên. Nếu sai chỗ: cắt file ra thư mục cha.
2. **Thiếu thư viện hệ thống?** Log 📄 báo `Host system is missing dependencies:
   msvcp140_1.dll` → cài [Visual C++ Redistributable x64](https://aka.ms/vs/17/release/vc_redist.x64.exe).
3. **Thiếu Firefox trong bản đóng gói?** Log báo `Executable doesn't exist` → app tự tải,
   hoặc copy tay `firefox-<rev>` vào `lib\ms-playwright` cạnh file .exe.
4. **FirefoxPortable đang mở** → đóng hẳn rồi thử lại (profile bị khóa).
5. **Cookie chỉ sống trong phiên Firefox** (khôi phục phiên làm việc) → không nằm trong file
   cookie nên không trích được → đăng nhập lại bằng 🦊.

---

## 5. Dữ liệu bị trùng trên Google Sheet

1. **Mọi máy đã cập nhật cùng phiên bản chưa?** Máy bản cũ chạy lẫn sẽ vẫn đẩy trùng.
2. **Chu kỳ đồng bộ**: modal ☁ → "Đồng bộ lọc trùng liên máy mỗi X phút". Giảm xuống 2–3
   phút nếu nhiều máy quét trùng chủ đề.
3. Trùng còn sót lại: dọn bằng Google Sheets → Data → Data cleanup → Remove duplicates,
   **xóa cả dòng** chứ đừng xóa nội dung ô.

⚠️ **Xóa nội dung ô A–D mà để lại cột E sẽ làm app ghi lệch sang cột E–H** ở lần đẩy sau,
vì `append` dò khối dữ liệu liền mạch cuối bảng. Luôn xóa nguyên dòng.

---

## 6. App tự tắt khi chạy dài (qua đêm)

Mở file log mới nhất trong thư mục `logs/` cạnh file .exe, xem các dòng cuối:

```
[blackbox] Heap main 320/512MB, RSS 890MB | Tab 1250MB, GPU 180MB
[blackbox] Renderer (giao diện) CHẾT: {"reason":"oom",...}
```

| Dấu vết | Kết luận |
|---|---|
| `Heap main` leo dần về ~4000MB rồi log **im bặt** | Hết bộ nhớ tiến trình chính (giới hạn ~4GB/tiến trình, không liên quan RAM máy còn nhiều) |
| Có dòng `CHẾT reason:"oom"` | Tab Chromium chết vì hết bộ nhớ riêng |
| Log **dừng đột ngột**, mọi số đều thấp | Bị bên ngoài giết: diệt virus, Windows Update, mất điện |

Giảm tải: bật Chạy ẩn, bật "Không tải ảnh/video", giảm "Tải lại feed sau mỗi N lần cuộn",
chạy ít profile hơn trên một máy.

---

## 7. Bị chặn trang đếm số video

```
TikTok đang chặn trang đếm (N sound liên tiếp lỗi) — nghỉ 34s...
Đang bị chặn — giữ lại "tên sound" thử vòng 1/3 sau khi nghỉ...
```

Đây là **hành vi đúng**, không phải lỗi: app nghỉ để thoát chặn sớm hơn, và giữ lại sound
thay vì bỏ oan. Nếu xảy ra liên tục:

- Giảm "Số luồng đếm video đồng thời" trong ⚙️ (khuyến nghị 2, đừng tăng cao)
- Giảm số profile chạy đồng thời trên cùng một IP

---

## 8. Cập nhật xong app đóng luôn không mở lại

Đã vá (2026-07-08). Nếu tái diễn: chạy tay file `%TEMP%\ttcrawler_updater.bat` để xem lỗi,
hoặc tải `.exe` mới từ GitHub Releases và thay thủ công.

---

## 9. Profile báo "TẠM DỪNG: IP hiện tại ở XX nhưng profile khai (YY)"

```
⚠ TẠM DỪNG: IP hiện tại ở DE nhưng profile khai (US). Chạy tiếp sẽ để lộ mâu thuẫn
  "IP nước này, giờ nước khác" — thường do VPN tụt. App tự kiểm lại mỗi 60s và chạy
  tiếp ngay khi VPN về đúng vùng.
```

Đây là **hành vi đúng**, không phải lỗi (xem [DECISIONS.md](DECISIONS.md) QĐ-17). App phát hiện
IP thật không còn khớp nhãn quốc gia trong tên profile nên tự tạm dừng để không phơi mâu thuẫn
vân tay ra TikTok.

**Xử lý:** kiểm VPN trên máy đó (bật lại / đổi location đúng quốc gia của nhóm profile). Không
cần bấm gì trong app — thấy dòng `✅ IP đã về đúng vùng (XX) — chạy tiếp.` là nó tự chạy lại.

| Tình huống | App làm gì |
|---|---|
| VPN tụt, IP sang nước khác | Tạm dừng, kiểm lại mỗi 60s, tự chạy tiếp khi về vùng |
| Mất mạng, không tra được IP | **Không chặn** — vẫn chạy bình thường (tránh treo cả dàn máy vì mạng chớp) |
| Profile không có nhãn quốc gia trong tên | Bỏ qua kiểm tra hoàn toàn |

⚠️ Chỉ so **quốc gia**, không so thành phố/ASN — VPN tụt sang IP khác nhưng cùng quốc gia thì
app không phát hiện.

**Tự kiểm IP của máy bằng tay:**

```bash
node -e "require('./src/ip-guard.cjs').getPublicIp().then(r=>console.log(r))"
```

---

## 10. Bấm "⬆ Cập nhật" báo không đọc được release

```
Không đọc được release của "datkhac009/Crawl_DataTiktok-releases". Repo phát hành đang
ở chế độ PRIVATE nên app không đọc được bản mới (GitHub trả 404 cho truy cập ẩn danh).
```

**Đây là trạng thái có chủ đích**, xem [DECISIONS.md](DECISIONS.md) QĐ-18. Repo để private nên
tự cập nhật không hoạt động — đang **cập nhật thủ công**: build xong thì copy `.exe` mới sang
từng máy.

⚠️ **Phải cập nhật HẾT các máy trong cùng một lần.** Máy chạy bản cũ lẫn vào vẫn gây trùng dữ
liệu trên Sheet (xem mục 5).

---

## 11. Bấm "▶ Chạy đã chọn" nhiều profile — chỉ profile đầu tiên chạy, các profile sau im lặng

Đã vá 2026-07-28 (xem [DECISIONS.md](DECISIONS.md) QĐ-19) — nguyên nhân là request tới Google
API bị treo trong lúc kiểm khóa liên máy, làm cả vòng lặp tuần tự đứng yên. Nếu bạn đang chạy
bản cũ hơn ngày đó và vẫn gặp:

- **Kiểm tra**: profile không chạy có hiện dòng lỗi màu đỏ nào không, hay chỉ đứng im ở "Chờ".
  Đứng im (không có lỗi) đúng là dấu hiệu của sự cố này.
- **Xử lý tạm**: đóng app, mở lại (dừng vòng lặp đang treo), chạy **từng profile một** thay vì
  tick tất cả rồi bấm 1 lần.
- **Cập nhật lên bản mới nhất** — bản vá thêm trần thời gian 8 giây, không bao giờ để 1
  profile bị treo làm nghẽn các profile khác nữa.

## 12. Google Sheet báo "xung đột" / tự nhiên có thêm tab lạ

Tab **`_locks`** là tab app **tự tạo** cho tính năng khóa liên máy (QĐ-19) — không phải lỗi.
Từ bản vá 2026-07-28, tab này được tạo ở dạng **ẨN** nên sẽ **không hiện** trên thanh tab khi
mở Sheet bình thường (muốn xem thì vào menu chọn "Hiện tất cả trang tính"). Đừng xóa nội
dung ô bên trong, chỉ được **xóa cả dòng** nếu cần dọn (giống nguyên tắc ở mục 5). Xóa cả
tab `_locks` cũng an toàn — app tự tạo lại khi cần.

**Nếu bạn thấy tab `_locks` vẫn HIỆN công khai** (tạo từ trước ngày vá, hoặc ai đó lỡ bấm hiện
lại): không cần tự vào Sheet ẩn tay — app **tự ẩn lại** ở lần chạy tiếp theo. Nếu vẫn thấy hiện
sau khi đã cập nhật bản mới, kiểm tra Service Account có quyền Editor trên Sheet không (thiếu
quyền thì không ẩn được, nhưng vẫn đọc/ghi nhịp tim bình thường).

Nếu thấy **2 tab** kiểu `_locks` và `_locks 2`: đây là dấu vết của sự cố tranh chấp tạo tab đã
vá cùng ngày (2 máy/2 profile khởi động cùng lúc, cả hai đều tưởng tab chưa có nên cùng tạo).
Xóa tab thừa (`_locks 2`), giữ lại đúng 1 tab `_locks`. Cập nhật bản mới sẽ không còn tái diễn.

---

## 15. Không thấy dòng "Sheet: N dòng data" / bấm Lưu trong ☁ Google Sheet không phản hồi

### Không thấy số dòng Sheet

Nó chỉ hiện khi app **đọc Sheet thành công ít nhất 1 lần**. Chưa đọc được lần nào thì để trống
(thà không hiện gì còn hơn hiện số bịa). Kiểm bằng log:

```bash
grep "reseed] Đọc" logs/crawler_<mới nhất>.log | tail -3
```

- Thấy `Đọc TOÀN BỘ Sheet (N dòng)` → đọc được, số sẽ hiện trong ~1 phút.
- Thấy `Không có tab tên "X"` → **sai tên tab trong app** (mục 13). Đây là nguyên nhân số 1.
- Không thấy dòng `reseed` nào → chưa bật "đẩy lên Google Sheet", hoặc chưa có Service Account.

⚠️ **Trước v0.1.60** còn một nguyên nhân nữa: số dòng ghi chung ô với dòng thông báo, nên chỉ cần
một câu bất kỳ đậu ở đó (`Không đọc được Sheet…`, `Đã bật đẩy Sheet giữa phiên…`) là con số
**không bao giờ hiện lại** cho tới khi khởi động lại app. Từ v0.1.60 nó có ô riêng — xem
[QĐ-29](DECISIONS.md). Đang chạy bản cũ thì **khởi động lại app** là thấy.

### Bấm Lưu không phản hồi

**Trước v0.1.60:** nút không khoá, không đổi chữ, mà backend có thể chờ mạng hàng **phút** (xả
buffer + đọc lại Sheet 161k dòng). Nhìn như nút chết, nhưng **cấu hình ĐÃ được lưu** ngay dòng
đầu của handler. Kiểm chứng:

```bash
node -e "const c=require(process.env.APPDATA+'/TikTokCrawler/config.json');console.log(c.sheets_config.tab)"
```

Ra đúng tên tab mới = đã lưu, khỏi bấm lại. Từ v0.1.60 nút đổi thành `Đang lưu...` nên biết ngay
là app đang làm việc. Backend **vẫn** có thể chờ mạng lâu (chưa đặt trần — xem
[QĐ-30](DECISIONS.md)), nên cứ để nút chạy, đừng bấm lại.

---

## Nguyên tắc chẩn đoán chung

1. **Log 📄 của từng profile trước** — hầu hết sự cố đã có dòng chẩn đoán sẵn.
2. **So sánh profile hỏng với profile chạy tốt** — cùng máy, cùng cài đặt thì khác biệt
   nằm ở chính profile.
3. **Đừng tin cookie có trong file là còn đăng nhập** — phải hỏi TikTok mới biết.
4. **Chụp màn hình trang thật** khi bí — nhìn tận mắt nhanh hơn suy đoán rất nhiều.

## 13. Báo "Không có tab tên X trên Google Sheet này" / "Unable to parse range"

Tên tab trong ☁ Google Sheet **không khớp** tab thật trên Sheet. Đã gặp thật (2026-08-03):
app đóng gói để tab mặc định `Data` nhưng Sheet không có tab nào tên đó → không đọc/ghi được
gì, và thông báo gốc của Google (`Unable to parse range: Data!B:B`) rất khó hiểu nên mất thời
gian mới tìm ra.

Sửa: mở **☁ Google Sheet** → sửa **"Tên tab"** cho khớp chính xác (phân biệt chữ hoa/thường,
đúng cả dấu gạch dưới, vd `Total_Link_Voice`) → **Lưu**. Bấm **🔌 Test kết nối** để xem danh
sách tab có thật.

⚠️ Cấu hình của **app đóng gói** và **app dev** nằm ở 2 chỗ KHÁC NHAU
(`%APPDATA%/TikTokCrawler` vs `%APPDATA%/TikTokCrawler-Dev`) — sửa ở bản này không ảnh hưởng
bản kia. Đã gặp: dev đúng tab mà bản đóng gói vẫn sai.

---

## 14. Bật "profile Chromium riêng" rồi báo lỗi mở trình duyệt / RAM tăng vọt

Chỉ xảy ra với profile đang **BẬT** công tắc **"Dùng profile Chromium riêng cho tài khoản này"**
(⚙ Cài đặt crawl). Công tắc là **riêng từng profile** — xem [QĐ-27](DECISIONS.md),
[QĐ-28](DECISIONS.md).

**Mở ⚙ ở profile khác thấy đã tick sẵn?** Đó là bản **v0.1.58** (công tắc còn để chung toàn app).
Từ v0.1.59 đã sửa thành riêng từng profile. Cập nhật app là hết.

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| `profile is already in use` / `SingletonLock` | Thư mục Chromium đang bị một tiến trình khác giữ. Một `user-data-dir` chỉ cho **một** Chromium mở | App tự xóa file khóa cũ trước mỗi lần mở. Còn lỗi = **vẫn còn Chromium sống**: Task Manager → tắt hết `chrome.exe`/`Crawl_DataTiktok.exe` rồi chạy lại |
| RAM tăng ~1GB sau khi bật | Đúng như thiết kế: mỗi profile bật là 1 Chromium riêng | Máy dưới 4GB trống thì **giảm số profile bật** (vd chỉ bật 1–2 profile hay mất phiên nhất) chứ không cần tắt hết |
| Bật xong 5 profile thành khách hết | Cookie chưa được mang sang (vd `session.state.json` đã hỏng/rỗng từ trước) | Log sẽ ghi *"KHÔNG có cookie để mang sang"*. Bấm 🦊 đăng nhập lại một lần — từ lần sau Chromium tự giữ phiên |
| Đĩa phình nhanh | Mỗi profile ~100–200MB | Xóa tay thư mục `profiles/<tên>/ChromiumProfile` khi app đã tắt — **an toàn**, lần sau app dựng lại từ `session.state.json` |
| Nút **🔑 Kiểm tra đăng nhập** báo KHÁCH mà 🦊 mở ra vẫn đăng nhập | 🔑 kiểm bằng **bản sao cookie** (`session.state.json`), không mở thư mục Chromium — nếu bản sao đó cũ hơn phiên thật thì 2 nút nói khác nhau. Cố ý làm vậy: 🔑 mà mở thư mục Chromium sẽ đụng khóa khi 🦊 đang mở, hỏng cả 25 lượt kiểm | Tin **🦊** (nó đọc cookie thẳng trong profile, log ghi `profile Chromium riêng`). Muốn 🔑 khớp lại thì chạy profile đó vài chục giây — timer 20s sẽ ghi phiên mới xuống `session.state.json` |
| Chạy chế độ **hiện** thì thấy tab `/music/` nhấp nháy trong cửa sổ profile | **Đã sửa từ v0.1.61.** Trước đó chế độ này bắt tab đếm dùng chung cửa sổ của profile | Cập nhật app là hết — từ v0.1.61 tab đếm chạy trong trình duyệt **ẩn riêng** khi profile chạy hiện (chạy ẩn thì vẫn dùng chung, không ai thấy). Xem bổ sung 2026-08-05 của [QĐ-27](DECISIONS.md). Đang chạy bản cũ thì tạm chuyển sang chạy **ẩn** |

Đổi công tắc **không** áp cho profile đang chạy — phải **dừng rồi chạy lại** profile đó.

---

## 16. FEED CẠN — "TikTok KHÔNG cấp thêm video cho profile này"

```
⛔ TikTok KHÔNG cấp thêm video cho profile này — trang chỉ còn 2 video và nút
  "video kế tiếp" ĐANG BỊ TẮT, đã thử 3 lượt thoát kẹt đều không hiệu quả.
  Phiên đăng nhập vẫn TỐT — cuộn thêm chỉ làm TikTok siết nặng hơn.
```

Đây **không phải lỗi app và không phải mất đăng nhập** — profile vẫn đăng nhập tốt (app đã tự
kiểm trước khi kết luận). TikTok chủ động cấp cho profile/IP đó một feed cụt 1–2 video và không
nạp thêm. Gặp thật 2026-08-05 trên một máy ảo. Xem [QĐ-31](DECISIONS.md).

**⛔ Không có cách nào trong app làm TikTok cấp thêm video.** Cuộn không thể cuộn tới cái không
tồn tại. Đừng đi tìm "cách cuộn khác" — 3 hướng đã bị loại có ghi lý do trong QĐ-31.

### App tự làm gì

| Chế độ | Hành vi |
|---|---|
| **Quét ⇄ Xem** | **Kết thúc pha QUÉT sớm, sang pha XEM luôn.** Vòng sau tự thử quét lại |
| **For You / Tìm kiếm / Tab đang mở** | **Tạm dừng 5 → 15 → 30 phút** rồi tải lại thử tiếp |

Không cần bấm gì. Mất **2–3 phút** để app kết luận (phải thử trọn một vòng 3 cấp thoát kẹt
trước) — trước v0.1.61 thì nó quay vòng vô hạn, đã đo được gần **2 giờ ra 0 sound**.

### Cách xử lý, theo thứ tự

0. **Bật "Tự đổi IP" trong ⚙ nếu máy có cài HMA VPN** — xem mục 17 ngay dưới đây. Đây là cách
   duy nhất chạm tới **gốc rễ** (đổi IP thật); các cách còn lại chỉ là vòng qua.
1. **Đổi profile đó sang chế độ Tìm kiếm** (đổi ngay ở cột **Chế độ** trên bảng, không cần vào ⚙).
   Đây là đường **có thật** để lướt tiếp: khi mở video từ một **lưới** (kết quả tìm kiếm,
   hashtag, Explore, trang tác giả), TikTok dựng trình phát với **băng chuyền riêng theo ngữ
   cảnh lưới đó**, không dùng feed For You. Nên For You bị siết **không** kéo theo Tìm kiếm bị siết.
2. **Search cũng cụt** ⇒ đang bị siết ở tầng **IP/tài khoản** ⇒ đổi endpoint VPN sang **thành
   phố/ASN khác**, không chỉ khác quốc gia. Nhắc lại giới hạn của QĐ-17: app **chỉ so quốc gia**,
   VPN tụt sang IP khác *cùng nước* thì không phát hiện được.
3. **Xem các profile khác trên CÙNG máy đó.** Nếu có profile khác cũng đang báo
   `đang chặn trang đếm (N sound liên tiếp lỗi)` (mục 7) thì gần như chắc chắn là **IP của máy
   đó bị siết**, không phải 2 lỗi độc lập. Đối chiếu với một máy đang khoẻ: profile khoẻ ghi
   `cuộn 100 lần, gặp 94 sound khác nhau`.
4. **Chuyển profile sang máy có IP khoẻ.** Nhớ chép **cả thư mục profile** (`session.state.json`
   + `fingerprint.json`), và **không chạy cùng profile ở 2 máy** — app sẽ chặn (QĐ-19).

### Vì sao app không tự "dừng rồi chạy lại" bằng phản xạ

Cấp 3 của thoát kẹt **đã là** tải lại trang và đã thất bại. Dừng-chạy-lại KHÔNG đổi IP chỉ là
reload đắt hơn với cùng IP, cùng cookie, cùng vân tay — không có biến nào đổi thì kết quả không
đổi. Và vòng dừng-chạy liên tục đúng là "càng dội càng bị chặn sâu". Vì vậy khi tính năng tự đổi
IP (mục 17) đang **tắt**, app chỉ **tạm dừng có backoff** (tự thử lại sau 5/15/30 phút) chứ
không dừng hẳn cũng không restart gấp. Bật tính năng đó lên thì app **có** tự dừng/đổi IP/chạy
lại — chỉ là việc đổi IP cần chạm tới VPN, nên đặt sau công tắc riêng, không tự động ngầm.

---

## 18. App bỏ RẤT NHIỀU sound "không rõ nguyên nhân" — TikTok trả "Something went wrong"

**Triệu chứng:** log đầy dòng `Bỏ "<tên sound>" (không lấy được số video — API lẫn giao diện đều
lỗi)`, cột **Hợp lệ** thấp hơn hẳn cột **Đã check**.

**Cách xác minh:** copy link sound bị bỏ từ log, mở tay trong trình duyệt. Nếu thấy:

```
Something went wrong
Sorry about that! Please try again later.
```

thì đây đúng là ca này. Để ý: phần **header vẫn có đủ** tên sound, tác giả và số video — nghĩa là
**sound VẪN TỒN TẠI**, chỉ là TikTok lỗi lúc dựng phần lưới video. So sánh với link bình thường:
lưới video hiện đầy đủ.

**Đây KHÔNG phải lỗi app** — app đã thử cả 2 đường (API `api/music/detail/` và đọc giao diện,
QĐ-06) và cả hai đều không ra số. Nó cũng **không phải sound chết**: sound chết thì API trả
`statusCode 10201` và log ghi rõ *"sound đã bị xóa/không tồn tại"*.

**Cách xử — đừng để mất dữ liệu:** bật **tab CHỜ KIỂM TAY**.

1. Tạo tab mới trên Sheet, ví dụ `Total_Link_Voice_Pending`, dòng 1 đặt 5 tiêu đề:
   `Tên Sound | Link | Số Video | Profile | Tình trạng`.
2. Mở **☁ Google Sheet** → điền tên tab đó vào ô **"Tên tab CHỜ KIỂM TAY"** → **Lưu**.
3. Từ đó, link lỗi được ghi sang tab đó (4 cột A–D, **cột E để trống cho người điền**) thay vì bị bỏ.

Log sẽ đổi từ `Bỏ "..."` thành `⏳ "..." → tab CHỜ kiểm tay`.

Xem [QĐ-33](DECISIONS.md). Vài điểm cần biết:

- **App không tự tạo tab** — sai tên tab thì báo `Không có tab tên "X"`, không im lặng.
- **Không ghi trùng**: app đọc cột B của tab chờ lúc bắt đầu phiên.
- **Link ở tab chờ vẫn được thử lại** phiên sau (lỗi này thường tạm thời). Đọc được số thì sound
  vào **tab chính** — lúc đó nó có ở **cả 2 tab**, dọn tay dòng ở tab chờ khi xử lý.
- Sound **đã bị xóa thật** vẫn bị **bỏ hẳn**, không vào tab chờ (không có gì cho người kiểm).

---

## 17. Tự đổi IP khi TikTok cắt feed — bật/tắt lại HMA VPN rồi tự chạy lại profile

**Yêu cầu:** đã cài **HMA VPN** trên máy này và **đang đăng nhập** (đã kết nối ít nhất 1 lần).
Bật ở ⚙ Cài đặt crawl → mục **"Tự đổi IP khi TikTok cắt feed"** → tick
**"Tắt/bật lại HMA VPN rồi tự chạy lại profile"**. Đây là cài đặt **chung toàn app**, mặc định
**TẮT**.

### Xảy ra như thế nào khi bật

Khi một profile bất kỳ báo **feed cạn** (mục 16):

```
⛔ "tên profile" bị TikTok cắt feed — dừng 5 profile để đổi IP (IP là của cả máy nên
   phải dừng hết, không thể dừng riêng 1 profile)...
Đang tắt HMA VPN rồi bật lại để lấy IP mới (nối lại đúng server cũ — HMA cấp IP khác
   mỗi lần kết nối nên không cần đổi city)...
✅ HMA đã tắt/bật lại (London) — GB. IP mới: 18.132.40.68 (GB).
```

rồi tự chạy lại đúng nhóm profile vừa dừng, **lần lượt** (như nút ▶ Chạy đã chọn, QĐ-21).

### Dừng RIÊNG 1 profile hay dừng HẾT — app tự quyết theo máy

App **tự kiểm máy có rò rỉ IPv6 hay không** rồi chọn:

| Máy | App làm gì | Vì sao |
|---|---|---|
| **Không** có IPv6 công khai | **Chỉ dừng đúng profile bị cắt feed** — các profile khác chạy tiếp | Lúc VPN tắt, request của chúng chỉ bị lỗi mạng vài giây, **không lộ gì** |
| **Có** IPv6 công khai | **Dừng HẾT** | Lúc VPN tắt, IPv6 đi thẳng ra IP thật — profile nào còn chạy là mất phiên |

⚠️ **Rò rỉ IPv6 — đo thật 2026-08-06.** Đường hầm WireGuard của HMA **chỉ định tuyến IPv4**:

```
HMA BẬT : IPv4 → 13.40.11.3 (GB)          IPv6 → bị chặn (EACCES)      ✅ an toàn
HMA TẮT : IPv6 → 2405:4802:… (VN)  lọt ra chỉ trong 241ms              ❌ RÒ RỈ
```

`systemKillSwitchActive: true` của HMA **KHÔNG** chặn IPv6 — đã đo, **đừng tin cờ đó**.

Rò rỉ này **im lặng**: profile vẫn chạy mượt, không lỗi gì — chỉ mất phiên **sau đó**. Đó là lý
do nó không bao giờ bị truy ra. Nó xảy ra **mỗi lần VPN tắt**, kể cả VPN tụt tự nhiên lúc 3h
sáng, không riêng gì lúc app tự đổi IP.

### Tắt IPv6 để chỉ cần dừng 1 profile (nên làm trên MỌI máy)

Chạy **PowerShell với quyền Administrator**, xem tên adapter đang giữ IPv6 công khai rồi tắt:

```powershell
# 1. Xem adapter nào đang giữ IPv6 công khai (bắt đầu bằng 2 hoặc 3)
Get-NetIPAddress -AddressFamily IPv6 | Where-Object { $_.IPAddress -match '^[23]' } |
  Select-Object InterfaceAlias, IPAddress

# 2. Tắt IPv6 trên đúng adapter đó (thường là "Ethernet")
Disable-NetAdapterBinding -Name "Ethernet" -ComponentID ms_tcpip6

# 3. Kiểm chứng — lệnh này phải KHÔNG ra dòng nào
Get-NetIPAddress -AddressFamily IPv6 | Where-Object { $_.IPAddress -match '^[23]' }
```

Muốn bật lại: `Enable-NetAdapterBinding -Name "Ethernet" -ComponentID ms_tcpip6`

⚠️ **Đừng tắt IPv6 trên adapter Tailscale** — nó dùng `fd7a:…` (địa chỉ ULA riêng tư, không ra
được internet nên không phải nguồn rò rỉ); tắt ở đó chỉ làm hỏng Tailscale. App cũng **không**
tính `fd/fc` (ULA) và `fe80` (link-local) là rò rỉ, nên sau khi tắt trên Ethernet là xong.

Tắt xong, lần sau app tự nhận ra và **chỉ dừng 1 profile** — không cần cấu hình gì thêm trong app.

### Chỉ tắt/bật lại đúng server — KHÔNG đổi thành phố

HMA cấp **IP từ một pool mỗi lần kết nối**, không gán tĩnh theo server. Đo thật: disconnect rồi
connect lại **đúng** `GB-H9-LONDON-ULT` cho IP `18.171.54.19` → `18.132.40.68`. Nên chỉ cần
tắt/bật lại là đã đổi IP — **không cần đổi thành phố**, và những nước HMA chỉ có 1 thành phố
(KR — Seoul) vẫn hoạt động bình thường như GB/US.

Xoay sang city khác còn **có hại**: nó đưa IP sang vùng địa lý khác trong cùng nước, lệch với
vùng mà phiên đăng nhập của profile đã quen. App vẫn giữ khả năng đó (`rotate: true`) nhưng
**không dùng theo mặc định**.

App không bao giờ nối VPN sang **nước** khác với nước profile đang khai — đổi nước sẽ phá vỡ vân
tay (QĐ-05) và bị `ip-guard` tạm dừng (QĐ-17).

⚠️ **Không đảm bảo IP mới sạch:** pool IP của HMA hữu hạn và nhiều người dùng chung, nên vẫn có
thể rút được một IP cũng đang bị TikTok siết. Đổi 2–3 lần vẫn bị cắt feed thì nguyên nhân ở chỗ
khác — quay lại mục 16.

### Giới hạn nhịp — không đổi IP liên tục

Tối thiểu **10 phút** giữa 2 lần đổi, tối đa **6 lần/ngày**. Chạm giới hạn thì app báo và **giữ
nguyên IP hiện tại**, tự chạy lại profile luôn (VPN không hề bị đụng tới nên an toàn). Nếu chạm
giới hạn này thường xuyên, nguyên nhân rất có thể không phải "cần đổi IP thường hơn" mà là máy
đang bị siết nặng — xem lại mục 16 (đổi sang Tìm kiếm, đổi máy).

### Khi đổi IP thất bại

```
⚠ Đổi IP thất bại: ... — KHÔNG tự chạy lại profile vì VPN có thể đang tắt.
  Kiểm tra HMA rồi bấm ▶ chạy lại.
```

App **cố tình không tự chạy lại profile** trong trường hợp này — nếu VPN thật sự đang tắt
(không rõ vì sao Connect thất bại), chạy profile lúc đó là chạy bằng IP thật, mất phiên chắc
chắn. Mở cửa sổ HMA lên **kiểm tra bằng mắt** đã kết nối chưa, rồi mới bấm ▶ Chạy lại tay.

### Kiểm tra nhanh HMA có đang chạy đúng không

Nếu nghi tính năng không hoạt động: mở cửa sổ HMA (không cần đóng), xem có đang **ON** và đúng
quốc gia của nhóm profile trên máy đó không. App tự dò `VpnNM.exe` qua registry
(`NativeMessagingHosts\com.privax.vpn`) — cài HMA ở vị trí khác thư mục mặc định vẫn tìm được,
miễn còn đăng ký native messaging host bình thường (không gỡ/cài lại phần mở rộng trình duyệt
của HMA).

---
