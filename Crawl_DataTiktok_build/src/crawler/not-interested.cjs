"use strict";
// ════════════════════════════════════════════════════════════════════════════════════════
// BAM "NOT INTERESTED" cho video vua bi loai vi ngon ngu (2026-08-21)
//
// Nguoi dung: "neu luot vao video do thi click vao Not interested trong video do luon" — vua
// loc bo sound, vua DAY THUAT TOAN di huong khac. Day la tin hieu manh nhat TikTok cho phep
// gui ma khong phai bao cao.
//
// ⚠⚠ HAI RUI RO THAT, ca hai deu da co tien le trong du an nay:
//
// 1. QD-13 do va ghi: "Click vao trang de 'lay con tro' roi gui phim -> LAM HONG TRANG THAI
//    TRANG, sau do khong doc duoc sound nao". Bam menu la click vao trang. Nen ham nay phai
//    tu phuc hoi duoc: that bai thi bam Escape, va NEM khong bao gio duoc lan ra vong quet.
//
// 2. Nut "Report" nam NGAY DUOI "Not interested" trong menu (anh nguoi dung gui). Bam lech mot
//    dong la BAO CAO VIDEO -> tai khoan co the bi danh dau. Nen:
//      • TUYET DOI khong bam theo TOA DO — chi bam phan tu khop TEN
//      • loai thang bat ky phan tu nao co chu report/bao cao, KE CA khi no cung khop chu khac
//      • khong tim thay dung muc -> Escape roi bo qua, KHONG bam gi
// ════════════════════════════════════════════════════════════════════════════════════════

// Chu "Not interested" theo ngon ngu. Profile UK/US chay locale en-* nen ban tieng Anh la
// chinh; them vai thu tieng cho truong hop locale khac (vi/es/pt/fr/de/id).
const NOT_INTERESTED_TEXTS = [
  "not interested",
  "khong quan tam", "không quan tâm",
  "no me interesa", "nao tenho interesse", "não tenho interesse",
  "pas interesse", "pas interessé", "kein interesse", "tidak tertarik",
];
// Chu phai TRANH tuyet doi — bam vao la bao cao video.
const FORBIDDEN_TEXTS = ["report", "bao cao", "báo cáo", "denunciar", "signaler", "melden", "laporkan"];

// Bam "Not interested" cho video dang xem. Tra { ok, why }.
// KHONG BAO GIO nem — moi loi deu tra ve { ok:false } de vong quet di tiep.
async function markNotInterested(page, { timeoutMs = 4000 } = {}) {
  try {
    const res = await Promise.race([
      page.evaluate(
        ([okTexts, badTexts]) => {
          const norm = (t) => String(t || "").trim().toLowerCase();
          const hasBad = (t) => badTexts.some((b) => norm(t).includes(b));

          // ── 1. Tim nut "..." cua video DANG XEM (gan giua man hinh nhat) ──
          const vh = window.innerHeight;
          const cands = Array.from(document.querySelectorAll(
            '[data-e2e*="more"], button[aria-label], div[role="button"][aria-label], svg'))
            .map((el) => (el.tagName.toLowerCase() === "svg" ? el.closest("button,div[role=button]") : el))
            .filter(Boolean)
            .filter((el) => {
              const lab = norm(el.getAttribute("aria-label")) + " " + norm(el.getAttribute("data-e2e"));
              return /more|khac|tuy chon|option/.test(lab);
            });
          let btn = null, best = Infinity;
          for (const el of cands) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const d = Math.abs(r.top + r.height / 2 - vh / 2);
            if (d < best) { best = d; btn = el; }
          }
          if (!btn) return { ok: false, why: "khong thay nut ..." };
          btn.click();
          return { ok: true, why: "da mo menu", opened: true };
        },
        [NOT_INTERESTED_TEXTS, FORBIDDEN_TEXTS]),
      new Promise((r) => setTimeout(() => r({ ok: false, why: "qua han mo menu" }), timeoutMs)),
    ]);
    if (!res || !res.opened) return { ok: false, why: (res && res.why) || "khong mo duoc menu" };

    // Cho menu dung xong. Khong dung waitForSelector vi khong biet selector on dinh nao.
    await new Promise((r) => setTimeout(r, 550));

    const click = await Promise.race([
      page.evaluate(
        ([okTexts, badTexts]) => {
          const norm = (t) => String(t || "").trim().toLowerCase();
          const nodes = Array.from(document.querySelectorAll(
            '[role="menuitem"], [role="menu"] *, [class*="menu"] *, li, button, div'));
          for (const el of nodes) {
            // Chi xet phan tu LA CHU (khong con phan tu con chua chu) de khong bam vao khoi bao
            if (el.children && el.children.length > 2) continue;
            const t = norm(el.textContent);
            if (!t || t.length > 40) continue;
            if (badTexts.some((b) => t.includes(b))) continue;   // TRANH Report
            if (!okTexts.some((o) => t === o || t.includes(o))) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            el.click();
            return { ok: true, why: 'da bam "' + t + '"' };
          }
          return { ok: false, why: "khong thay muc Not interested" };
        },
        [NOT_INTERESTED_TEXTS, FORBIDDEN_TEXTS]),
      new Promise((r) => setTimeout(() => r({ ok: false, why: "qua han bam" }), timeoutMs)),
    ]);

    // Khong bam duoc -> PHAI dong menu lai, neu khong thi menu che feed va vong quet doc sai.
    if (!click || !click.ok) {
      try { await page.keyboard.press("Escape"); } catch (_) {}
      return { ok: false, why: (click && click.why) || "khong bam duoc" };
    }
    return { ok: true, why: click.why };
  } catch (e) {
    try { await page.keyboard.press("Escape"); } catch (_) {}
    return { ok: false, why: "loi: " + (e && e.message) };
  }
}

module.exports = { markNotInterested, NOT_INTERESTED_TEXTS, FORBIDDEN_TEXTS };
