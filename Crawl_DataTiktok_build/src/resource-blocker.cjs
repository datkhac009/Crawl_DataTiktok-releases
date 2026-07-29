// src/resource-blocker.cjs — Chặn ảnh/video/font + domain quảng cáo để giảm RAM/băng thông.
//
// Vì sao tách riêng (2026-07-28): logic này TRƯỚC ĐÂY có 2 BẢN SAO y hệt nhau —
// `attachCountBlocker` trong crawler.cjs (dùng cho tab đếm số video) và
// `attachResourceBlocker` trong browser.cjs (dùng cho cửa sổ 🦊 khi bật "Không tải
// ảnh/video"). Cùng danh sách domain, cùng danh sách loại resource, chép tay 2 nơi.
// Đây đúng là cái bẫy mà DECISIONS.md QĐ-10 đã ghi lại: "Khi có ≥2 bản sao của cùng một
// logic, chúng SẼ lệch nhau" — thêm 1 domain quảng cáo mà chỉ sửa 1 bên là lệch ngay.
//
// Playwright: cả `Page` lẫn `BrowserContext` đều có `.route()` với cùng chữ ký, nên MỘT
// hàm dùng được cho cả hai (crawler truyền page, browser.cjs truyền context).
'use strict';

const AD_DENYLIST = [
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'amazon-adsystem.com', 'adnxs.com',
];
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);

// target = Page HOẶC BrowserContext. Best-effort: lỗi thì bỏ qua, không làm chết luồng gọi.
// ⚠ CHỈ dùng cho tab đếm hoặc khi người dùng chủ động bật "Không tải ảnh/video".
// KHÔNG bật mặc định cho tab cuộn feed: chặn media làm TikTok đổi hành vi và làm
// diagnoseFeed báo "video tải 0/4" gây nhiễu chẩn đoán.
async function attachResourceBlocker(target) {
  try {
    await target.route('**/*', (route) => {
      const req = route.request();
      if (BLOCKED_TYPES.has(req.resourceType()) || AD_DENYLIST.some(d => req.url().includes(d))) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });
  } catch (_) {}
}

module.exports = { attachResourceBlocker, AD_DENYLIST, BLOCKED_TYPES };
