// test/ui-responsive.test.js — Do layout that o nhieu kho cua so bang Chromium.
//
// Muc dich: phat hien "giao dien bi vo" mot cach DINH LUONG thay vi doan — kiem tra
// scrollWidth > clientWidth (tran ngang = noi dung bi cat vi khong the cuon), va tim
// dung phan tu nao gay tran. Chay: node test/ui-responsive.test.js
'use strict';

const path = require('path');
const fs = require('fs');

const INDEX = 'file:///' + path.join(__dirname, '..', 'renderer', 'index.html').replace(/\\/g, '/');
const SHOT_DIR = path.join(__dirname, '..', '.ui-shots');
const WIDTHS = [1180, 960, 860, 720, 640];  // 1180 = kho mac dinh, 720 = kho toi thieu

// Profile ten dai + trang thai dai giong THUC TE (email 29 ky tu, log chu ky dai)
const FAKE_PROFILES = [
  'gytsjcmozy074@hotmail.com(UK)', 'lykrxron2448@hotmail.com(UK)',
  'tudesfdmf892@hotmail.com(UK)', 'uslhqtchxt263@hotmail.com(UK)',
  'yqkisoiac853@hotmail.com(UK)',
];
const LONG_STATUS = 'Chu kỳ [Quét]: tải lại feed để xả RAM (đã quét 693 sound)...';

(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 700 } });
    const page = await ctx.newPage();

    // Stub window.api TRUOC khi renderer.js chay (no goi api ngay trong init()).
    await page.addInitScript(({ profiles, longStatus }) => {
      const noop = async () => {};
      window.api = new Proxy({
        getVersion: async () => '0.1.44',
        isDev: async () => false,
        profilesList: async () => profiles.map((n, i) => ({ id: 'p' + i, name: n, note: '', folderName: n })),
        storeGet: async () => ({}),
        storeSet: noop,
        crawlRunningIds: async () => [],
        sheetsGetConfig: async () => ({}),
        updateGetRepo: async () => ({ repo: '', default: 'x/y' }),
        onCrawlData: () => {}, onCrawlStatus: () => {}, onBrowserClosed: () => {},
        onUpdateAvailable: () => {}, onUpdateNotAvailable: () => {}, onUpdateError: () => {},
        onDownloadProgress: () => {}, removeAllListeners: () => {},
      }, { get: (t, k) => (k in t ? t[k] : noop) });
      window.__LONG_STATUS = longStatus;
    }, { profiles: FAKE_PROFILES, longStatus: LONG_STATUS });

    await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    // Nhoi trang thai DAI + vai dong du lieu ket qua cho giong that
    await page.evaluate(() => {
      document.querySelectorAll('.pstat-badge').forEach(el => { el.textContent = window.__LONG_STATUS; });
      const tb = document.getElementById('resultBody');
      if (tb) {
        for (let i = 1; i <= 3; i++) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${i}</td><td>original sound - nguoi dung co ten rat dai de test</td>`
            + `<td>https://www.tiktok.com/music/original-sound-7612345678901234567</td>`
            + `<td>88100</td><td>gytsjcmozy074@hotmail.com(UK)</td>`;
          tb.appendChild(tr);
        }
      }
      const msg = document.getElementById('crawlStatusMsg');
      if (msg) msg.textContent = 'Kiểm tra xong 5 profile — 0 profile cần đăng nhập lại.';
    });
    await page.waitForTimeout(200);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const over = [];
      // Tim phan tu that su tran ra ngoai chieu ngang cua body
      const bodyRight = document.body.getBoundingClientRect().right;
      document.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > bodyRight + 1) {
          over.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 40),
            id: el.id || '',
            overflowBy: Math.round(r.right - bodyRight),
          });
        }
      });
      // Khung nao co noi dung rong hon chinh no ma KHONG the cuon ngang
      const clipped = [];
      document.querySelectorAll('.result-wrap, .panel, .layout-col, .modal').forEach(el => {
        const cs = getComputedStyle(el);
        const canScrollX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        if (el.scrollWidth > el.clientWidth + 1 && !canScrollX) {
          clipped.push({
            cls: String(el.className || '').slice(0, 40),
            scrollW: el.scrollWidth, clientW: el.clientWidth,
            hiddenPx: el.scrollWidth - el.clientWidth, overflowX: cs.overflowX,
          });
        }
      });
      return {
        docScrollW: de.scrollWidth, docClientW: de.clientWidth,
        docOverflow: de.scrollWidth - de.clientWidth,
        overflowing: over.slice(0, 6),
        clipped,
      };
    });

    await page.screenshot({ path: path.join(SHOT_DIR, `w${w}.png`), fullPage: false });
    results.push({ width: w, ...m });
    await ctx.close();
  }
  await browser.close();

  console.log('\n' + '='.repeat(78));
  console.log('KET QUA DO LAYOUT (anh luu o .ui-shots/)');
  console.log('='.repeat(78));
  let fail = 0;
  for (const r of results) {
    const bad = r.docOverflow > 0 || r.clipped.length > 0;
    if (bad) fail++;
    console.log(`\n[${bad ? 'VO' : 'OK'}] width=${r.width}px  doc scrollW=${r.docScrollW} clientW=${r.docClientW} (tran ${r.docOverflow}px)`);
    for (const c of r.clipped) {
      console.log(`   ✂ BI CAT (khong cuon ngang duoc): .${c.cls} — an mat ${c.hiddenPx}px (overflow-x: ${c.overflowX})`);
    }
    for (const o of r.overflowing) {
      console.log(`   ↦ tran ra ngoai body: <${o.tag}${o.id ? '#' + o.id : ''} class="${o.cls}"> vuot ${o.overflowBy}px`);
    }
  }
  console.log(`\n=> ${fail}/${results.length} kho bi loi layout`);
  process.exit(0);
})();
