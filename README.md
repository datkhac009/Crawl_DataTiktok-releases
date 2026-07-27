# TikTok Crawler

Ứng dụng desktop (Electron + Playwright) thu thập link sound TikTok theo nhiều profile,
lọc theo số video và đẩy kết quả lên Google Sheet.

```
Crawl_DataTiktok_build/   ← MÃ NGUỒN THẬT (chạy & build ở đây)
Crawl_DataTiktok_kit/     ← Tài liệu, quyết định kiến trúc, hướng dẫn
```

## Dựng lại trên máy mới

```bash
git clone https://github.com/Hung13010/Crawl_DataTiktok.git
cd Crawl_DataTiktok/Crawl_DataTiktok_build

pnpm install                                   # KHÔNG dùng npm (xem ghi chú bên dưới)
pnpm exec playwright install chromium firefox  # tải trình duyệt (~1GB)

start.bat                                      # chạy bản dev
```

**Bắt buộc dùng `pnpm`** — `npm` trên môi trường này lỗi ESM. `start.bat` đã tự gỡ 2 biến
môi trường gây lỗi (`ELECTRON_RUN_AS_NODE`, `PORTABLE_EXECUTABLE_DIR`), nên hãy chạy qua nó
thay vì gọi electron trực tiếp.

## Dữ liệu KHÔNG nằm trong git

Những thứ sau **cố ý không đẩy lên** vì chứa cookie đăng nhập TikTok của tài khoản thật:

| Thư mục/File | Nội dung |
|---|---|
| `profiles/` | Phiên đăng nhập, vân tay, profile Firefox từng tài khoản |
| `config/profiles.json` | Danh sách profile |
| `logs/` | Log chạy |
| `lib/ms-playwright/` | Trình duyệt đóng gói (tải lại bằng lệnh trên) |

Muốn dùng lại profile cũ ở máy mới: **chép cả thư mục profile** (gồm `session.state.json`,
`session.good.json`, `fingerprint.json` và `Data/` nếu có) sang `profiles/`, rồi thêm vào app
bằng nút **➕ Thêm / Quản lý → Import folder có sẵn trong app**.

⚠️ **Không chạy cùng một profile trên 2 máy cùng lúc** — TikTok sẽ hủy phiên đăng nhập của
cả hai. Xem thêm [hướng dẫn sử dụng](Crawl_DataTiktok_kit/docs/user/USER_GUIDE.md).

## Build bản phát hành

```bash
build.bat    # tăng version → đóng gói .exe → copy trình duyệt → tạo GitHub Release
```

Bản phát hành đẩy sang repo riêng `Hung13010/Crawl_DataTiktok-releases` (chỉ kèm file `.exe`,
không kèm mã nguồn hay profile). App tự cập nhật từ đó.

## Tài liệu

| File | Nội dung |
|---|---|
| [ARCHITECTURE.md](Crawl_DataTiktok_kit/docs/technical/ARCHITECTURE.md) | Bản đồ module, luồng dữ liệu, kiến trúc trình duyệt |
| [DECISIONS.md](Crawl_DataTiktok_kit/docs/technical/DECISIONS.md) | **Đọc trước khi sửa kiến trúc** — 15 quyết định kèm lý do, và những hướng đã thử & thất bại |
| [TROUBLESHOOTING.md](Crawl_DataTiktok_kit/docs/technical/TROUBLESHOOTING.md) | Chẩn đoán 8 nhóm sự cố, kèm lệnh chạy được ngay |
| [DATABASE.md](Crawl_DataTiktok_kit/docs/technical/DATABASE.md) | Sơ đồ file dữ liệu, nhóm cookie bắt buộc |
| [USER_GUIDE.md](Crawl_DataTiktok_kit/docs/user/USER_GUIDE.md) | Hướng dẫn vận hành |
