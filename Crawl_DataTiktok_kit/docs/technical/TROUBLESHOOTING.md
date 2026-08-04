# Quy trình chẩn đoán sự cố

> Tra theo triệu chứng. Mọi lệnh chạy trong `Crawl_DataTiktok_build`.
> Cập nhật: 2026-07-28

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
| `KHÔNG thấy nút kế tiếp` | Không tìm được nút điều hướng của TikTok |

**App tự thoát kẹt theo 3 cấp**, xoay vòng: bấm nút "video kế tiếp" của TikTok → click lấy
con trỏ rồi gửi phím xuống → tải lại trang.

**Cả 3 cách đều thất bại + chỉ có 1–2 link video** → gần như chắc chắn là chế độ khách hoặc
tài khoản bị hạn chế → xem mục 3.

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
| Chạy chế độ **hiện** thì thấy tab `/music/` nhấp nháy trong cửa sổ profile | Chế độ này bắt tab đếm dùng chung cửa sổ của profile (không mở được Chromium thứ 2 trên cùng thư mục) | Bình thường, không phải lỗi. Muốn không thấy thì chạy **ẩn** |

Đổi công tắc **không** áp cho profile đang chạy — phải **dừng rồi chạy lại** profile đó.

---
