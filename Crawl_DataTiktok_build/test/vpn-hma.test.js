// test/vpn-hma.test.js — Dieu khien HMA VPN (tat/bat lai lay IP moi khi TikTok cat feed).
//
// Muc dich: chot 5 dieu de-vo nhat, vi lam sai o day thi hau qua NANG HON ca cai benh no chua
// (mat phien dang nhap ca dan may, hoac de may chay bang IP THAT):
//   1. TUYET DOI khong dung Vpn_ConnectToOptimal_NmSvc — do that tren may nguoi dung: gateway
//      "optimal" la VN-51-HANOI (Viet Nam), noi vao do = profile khai gio London chay tren IP VN.
//   2. Chi noi lai vao city trong CUNG QUOC GIA. Doi nuoc = pha vo van tay profile (QD-05) va
//      bi ip-guard tam dung (QD-17).
//   3. Nhan quoc gia profile khong khop vung HMA dang noi -> TU CHOI, va KHONG duoc ngat VPN.
//   4. Connect that bai -> phai noi ro VPN CO THE DANG TAT (nguoi goi khong duoc chay profile).
//   5. MAC DINH noi lai DUNG server cu, khong xoay city — do that cho thay HMA cap IP tu POOL
//      moi lan ket noi (cung gateway London: 18.171.54.19 -> 18.132.40.68), nen tat/bat lai la
//      du. Vi vay KR (chi 1 gateway) KHONG phai truong hop yeu hon GB/US nhu tuong ban dau.
'use strict';

process.env.TTC_VPN_POLL_MS = '60';   // khong cho that 2s moi nhip

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function eq(a, b, name) { ok(a === b, name, `nhan "${a}", mong "${b}"`); }

// ── Manifest + exe GIA THAT tren dia: hostPath() dung fs.existsSync/readFileSync that, nen
// tao file that de khong phai mock fs (mock fs de keo theo hong nhung cho khac). ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-vpn-'));
const fakeExe = path.join(tmp, 'VpnNM.exe');
const manifest = path.join(tmp, 'VpnNM_chrome.json');
fs.writeFileSync(fakeExe, 'khong chay that', 'utf8');
fs.writeFileSync(manifest, JSON.stringify({
  name: 'com.privax.vpn', path: 'VpnNM.exe', type: 'stdio',
  allowed_origins: ['chrome-extension://poeojclicodamonabcabmapamjkkmnnk/'],
}), 'utf8');

// ── Host GIA: noi dung giao thuc native messaging that (4 byte length + JSON) ──
const GATEWAYS = [
  { id: 'GB-H9-LONDON-ULT', city: { name: 'London' }, country: { id: 'gb', name: 'United Kingdom' } },
  { id: 'GB-I2-MANCHESTER', city: { name: 'Manchester' }, country: { id: 'gb', name: 'United Kingdom' } },
  { id: 'GB-V2-GLASGOW', city: { name: 'Glasgow' }, country: { id: 'gb', name: 'United Kingdom' } },
  { id: 'KR-11-SEOUL', city: { name: 'Seoul' }, country: { id: 'kr', name: 'South Korea' } },
  { id: 'VN-51-HANOI', city: { name: 'Hanoi' }, country: { id: 'vn', name: 'Vietnam' } },
];

let sent = [];             // moi action da gui tu app -> host
let hostScript = {};       // dieu khien hanh vi host cho tung kich ban

function makeFakeChild() {
  const listeners = { data: [], error: [], exit: [] };
  const state = {
    connected: hostScript.startConnected !== false,
    gatewayId: hostScript.startGateway || 'GB-H9-LONDON-ULT',
    connectionId: 2,
  };
  const emit = (obj) => {
    const b = Buffer.from(JSON.stringify(obj), 'utf8');
    const l = Buffer.alloc(4); l.writeUInt32LE(b.length, 0);
    const frame = Buffer.concat([l, b]);
    for (const f of listeners.data) f(frame);
  };
  const gwOf = (id) => GATEWAYS.find(g => g.id === id) || null;

  const child = {
    stdin: {
      write(buf) {
        // Boc tach khung y nhu host that
        let b = buf;
        while (b.length >= 4) {
          const n = b.readUInt32LE(0);
          if (b.length < 4 + n) break;
          const msg = JSON.parse(b.slice(4, 4 + n).toString('utf8'));
          b = b.slice(4 + n);
          sent.push(msg.action);
          setTimeout(() => {
            if (msg.action === 'Vpn_GetState_NmSvc') {
              const g = state.connected ? gwOf(state.gatewayId) : null;
              emit({
                action: 'Vpn_GetState_NmSvc',
                data: {
                  activeGateway: g ? { ...g, id: g.id } : {},
                  connectionInfo: { connectionId: state.connectionId, connectedTime: 111 },
                  gateways: GATEWAYS,
                },
              });
            } else if (msg.action === 'Vpn_Disconnect_NmSvc') {
              if (hostScript.disconnectFails) { emit({ action: 'Vpn_Disconnect_NmSvc', data: null, error: { code: 1, description: 'gia lap loi ngat' } }); return; }
              state.connected = false;
              emit({ action: 'Vpn_Disconnect_NmSvc', data: {} });
            } else if (msg.action === 'Vpn_Connect_NmSvc') {
              if (hostScript.connectFails) { emit({ action: 'Vpn_Connect_NmSvc', data: null, error: { code: 2, description: 'gia lap loi noi' } }); return; }
              const want = msg.data && msg.data.gateway && msg.data.gateway.id;
              state.gatewayId = hostScript.forceGateway || want;
              state.connected = true;
              state.connectionId++;
              emit({ action: 'Vpn_Connect_NmSvc', data: {} });
            }
          }, 10);
        }
      },
    },
    stdout: { on(ev, f) { if (ev === 'data') listeners.data.push(f); } },
    stderr: { on() {} },
    on(ev, f) { if (listeners[ev]) listeners[ev].push(f); },
    kill() {},
  };
  return child;
}

// Mock child_process: spawn -> host gia; execFile -> gia lap `reg query` tra ve manifest tam.
const cpPath = require.resolve('child_process');
const realCp = require('child_process');
require.cache[cpPath] = new Module(cpPath, null);
require.cache[cpPath].filename = cpPath;
require.cache[cpPath].loaded = true;
require.cache[cpPath].exports = {
  ...realCp,
  spawn: () => makeFakeChild(),
  execFile: (file, args, opts, cb) => {
    // `reg query <key> /ve` -> tra dong REG_SZ tro toi manifest tam
    setTimeout(() => cb(null, `\r\n    (Default)    REG_SZ    ${manifest}\r\n`, ''), 5);
  },
};

const vpn = require('../src/vpn-hma.cjs');

console.log('\n=== Dieu khien HMA VPN ===\n');

(async () => {
  // ── 1. pickGateway: chi trong cung nuoc, uu tien city KHAC ──
  console.log('1. Chon gateway: cung nuoc, uu tien city khac');
  for (let i = 0; i < 8; i++) {
    const p = vpn.pickGateway(GATEWAYS, 'GB', 'GB-H9-LONDON-ULT');
    ok(p.id !== 'GB-H9-LONDON-ULT', 'GB: khong chon lai dung server cu');
    ok(String(p.id).startsWith('GB-'), 'GB: khong bao gio nhay sang nuoc khac', `chon "${p.id}"`);
    if (fail) break;
  }
  const pKr = vpn.pickGateway(GATEWAYS, 'KR', 'KR-11-SEOUL');
  eq(pKr.id, 'KR-11-SEOUL', 'KR chi co 1 gateway -> noi lai dung server cu');
  eq(pKr.rotated, false, 'KR: bao ro la KHONG xoay vong duoc');
  eq(pKr.total, 1, 'KR: dem dung 1 server trong nuoc');
  const pNone = vpn.pickGateway(GATEWAYS, 'JP', 'GB-H9-LONDON-ULT');
  eq(pNone.id, 'GB-H9-LONDON-ULT', 'khong co gateway nuoc do -> giu nguyen, khong bia');
  // BUG THAT bat duoc luc trien khai: nhan profile dung "UK", HMA/ISO dung "GB" — so chuoi
  // thang la moi profile UK bi coi la lech vung -> tinh nang tu choi chay voi TOAN BO profile
  // UK cua nguoi dung. Phai dung chung normalizeCountry cua ip-guard (bay QD-10).
  const pUk = vpn.pickGateway(GATEWAYS, 'UK', 'GB-H9-LONDON-ULT');
  ok(String(pUk.id).startsWith('GB-'), 'nhan "UK" phai quy doi ra GB (khong tra ve nuoc khac)', `chon "${pUk.id}"`);
  eq(pUk.total, 3, 'nhan "UK" dem dung 3 gateway GB');

  // ── 2. Tim host qua registry ──
  console.log('\n2. Tim VpnNM.exe qua registry (khong hardcode duong dan)');
  eq(await vpn.hostPath(), fakeExe, 'doc manifest tu reg roi giai ra duong dan exe');
  eq(await vpn.isAvailable(), true, 'bao la co HMA tren may');

  // ── 3. Chu trinh TAT -> BAT thanh cong ──
  // MAC DINH la NOI LAI DUNG GATEWAY CU, khong xoay city. Do that: disconnect+connect lai dung
  // GB-H9-LONDON-ULT cho IP 18.171.54.19 -> 18.132.40.68 => HMA cap IP tu POOL moi lan ket noi,
  // nen chi tat/bat lai la du doi IP. Xoay city vua du thua vua dua IP sang vung dia ly khac.
  console.log('\n3. MAC DINH: tat roi bat lai DUNG server cu (khong xoay city)');
  hostScript = {}; sent = [];
  const r1 = await vpn.cycle({ expectCountry: 'UK' });
  ok(r1.ok, 'cycle thanh cong', r1.msg);
  eq(r1.before.gatewayId, 'GB-H9-LONDON-ULT', 'ghi nhan dung gateway TRUOC khi ngat');
  eq(r1.after && r1.after.gatewayId, 'GB-H9-LONDON-ULT',
    'noi lai DUNG gateway cu (mac dinh KHONG xoay city)');
  eq(r1.after && r1.after.countryId, 'GB', 'van dung quoc gia GB');
  ok(sent.includes('Vpn_Disconnect_NmSvc'), 'co gui lenh ngat');
  ok(sent.includes('Vpn_Connect_NmSvc'), 'co gui lenh noi lai');
  ok(sent.indexOf('Vpn_GetState_NmSvc') < sent.indexOf('Vpn_Disconnect_NmSvc'),
    'DOC trang thai TRUOC khi ngat (khong thi khong biet noi lai vao dau)');

  // ── 3b. rotate:true van con dung duoc (duong du phong) ──
  console.log('\n3b. rotate:true (du phong) van xoay sang city khac cung nuoc');
  hostScript = {}; sent = [];
  const r1b = await vpn.cycle({ expectCountry: 'UK', rotate: true });
  ok(r1b.ok, 'cycle voi rotate:true thanh cong', r1b.msg);
  ok(r1b.after && r1b.after.gatewayId !== 'GB-H9-LONDON-ULT', 'da noi sang city KHAC');
  ok(String(r1b.after && r1b.after.gatewayId).startsWith('GB-'), 'van trong cung quoc gia GB');

  // ── 4. Khang dinh QUAN TRONG NHAT ──
  console.log('\n4. TUYET DOI khong dung ConnectToOptimal (no tra ve Hanoi/Viet Nam)');
  ok(!sent.includes('Vpn_ConnectToOptimal_NmSvc'),
    'khong he gui ConnectToOptimal trong ca chu trinh');
  ok(!sent.includes('Vpn_GetOptimalGateway_NmSvc'),
    'cung khong hoi optimal gateway (khong dung tin do de quyet dinh)');

  // ── 5. Nhan quoc gia profile khong khop vung HMA -> TU CHOI, KHONG duoc ngat VPN ──
  console.log('\n5. Profile khai (US) nhung HMA dang o GB -> tu choi, KHONG ngat VPN');
  hostScript = {}; sent = [];
  const r2 = await vpn.cycle({ expectCountry: 'US' });
  eq(r2.ok, false, 'tu choi doi IP');
  ok(/GB/.test(r2.msg) && /US/.test(r2.msg), 'thong bao noi ro lech vung nao', r2.msg);
  ok(!sent.includes('Vpn_Disconnect_NmSvc'),
    'KHONG gui lenh ngat — tu choi truoc khi dung tay vao VPN');

  // ── 6. HMA dang tat san -> khong biet noi lai vao dau, phai tu choi ──
  console.log('\n6. HMA dang TAT san -> tu choi (khong ro nen noi lai vao dau)');
  hostScript = { startConnected: false }; sent = [];
  const r3 = await vpn.cycle({});
  eq(r3.ok, false, 'tu choi khi HMA dang tat');
  ok(/KHÔNG kết nối/i.test(r3.msg), 'noi ro la HMA dang khong ket noi', r3.msg);
  ok(!sent.includes('Vpn_Disconnect_NmSvc'), 'khong gui lenh ngat');

  // ── 7. Connect that bai -> phai canh bao VPN CO THE DANG TAT ──
  console.log('\n7. Bat lai that bai -> phai canh bao VPN co the DANG TAT');
  hostScript = { connectFails: true }; sent = [];
  const r4 = await vpn.cycle({});
  eq(r4.ok, false, 'bao that bai');
  ok(/ĐANG TẮT/.test(r4.msg), 'canh bao ro VPN co the DANG TAT', r4.msg);
  ok(/đừng chạy profile|ĐỪNG chạy profile/i.test(r4.msg),
    'noi thang: dung chay profile nao luc nay', r4.msg);

  // ── 8. Bat lai nhung SAI NUOC -> phai bao that bai ──
  // Gia lap HMA noi vao Viet Nam du ta yeu cau GB (vd server GB het cho, HMA tu fallback).
  console.log('\n8. Bat lai nhung SAI NUOC -> phai bao that bai, khong im lang cho qua');
  hostScript = { forceGateway: 'VN-51-HANOI' }; sent = [];
  const r5 = await vpn.cycle({});
  eq(r5.ok, false, 'bao that bai khi len lai sai nuoc');
  ok(/SAI NƯỚC/.test(r5.msg), 'noi ro la SAI NUOC', r5.msg);
  ok(/GB/.test(r5.msg) && /VN/.test(r5.msg), 'ghi ro truoc GB, gio VN', r5.msg);

  // ── 8b. ipv6LeakRisk: quyet dinh dung RIENG 1 profile hay dung HET ──
  // Do that 2026-08-06: duong ham WireGuard cua HMA chi dinh tuyen IPv4. Luc VPN TAT, IPv6 di
  // thang ra IP that (2001:db8:... VN, lot trong 241ms) du systemKillSwitchActive=true.
  // Ham nay sai la mat phien ca dan may -> phai co khang dinh.
  console.log('\n8b. ipv6LeakRisk: nhan dien IPv6 cong khai (quyet dinh dung 1 hay dung het)');
  const osMod = require('os');
  const realNetIf = osMod.networkInterfaces;
  const fakeNet = (map) => { osMod.networkInterfaces = () => map; };

  // ⚠ DUNG DAI TAI LIEU `2001:db8::/32` (RFC 3849). TUYET DOI khong dan IPv6 THAT cua may vao
  // day: repo nay PUBLIC, ma IPv6 khong co NAT nen mot dia chi day du la dia chi truy cap duoc
  // TRUC TIEP tu internet (da tung lo mot lan, phai sua lai). `2001:db8:` van bat dau bang '2'
  // nen van kiem dung nhanh global unicast 2000::/3.
  // Ca THAT tren may nguoi dung: Ethernet giu IPv6 cong khai -> CO rui ro.
  fakeNet({
    Ethernet: [
      { family: 'IPv4', address: '192.168.1.10', internal: false },
      { family: 'IPv6', address: '2001:db8:1cfa:3f10::e5d', internal: false },
    ],
    Tailscale: [{ family: 'IPv6', address: 'fd7a:115c:a1e0::3f32:3234', internal: false }],
  });
  let rk = vpn.ipv6LeakRisk();
  eq(rk.risky, true, 'Ethernet co IPv6 cong khai -> CO rui ro (phai dung het)');
  eq(rk.addresses.length, 1, 'dem dung 1 dia chi ro ri');
  eq(rk.addresses[0].iface, 'Ethernet', 'chi ro adapter nao ro ri');

  // Sau khi TAT IPv6 tren Ethernet: chi con link-local + Tailscale ULA -> KHONG rui ro.
  fakeNet({
    Ethernet: [
      { family: 'IPv4', address: '192.168.1.10', internal: false },
      { family: 'IPv6', address: 'fe80::abcd:1234:5678:9abc', internal: false },
    ],
    Tailscale: [{ family: 'IPv6', address: 'fd7a:115c:a1e0::3f32:3234', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv6', address: '::1', internal: true }],
  });
  rk = vpn.ipv6LeakRisk();
  eq(rk.risky, false, 'chi con fe80 (link-local) + fd7a (Tailscale ULA) -> KHONG rui ro');
  eq(rk.addresses.length, 0, 'khong dia chi nao bi tinh la ro ri');

  // Tailscale dung fd7a: (ULA rieng tu) — TUYET DOI khong duoc tinh la ro ri, neu khong thi
  // tinh nang tu khoa minh tren moi may co Tailscale.
  fakeNet({ Tailscale: [{ family: 'IPv6', address: 'fd7a:115c:a1e0::1', internal: false }] });
  eq(vpn.ipv6LeakRisk().risky, false, 'Tailscale ULA fd7a: KHONG phai ro ri');

  // Adapter cua chinh VPN co IPv6 cong khai la binh thuong (di trong duong ham), va no bien
  // mat khi VPN tat -> khong phai nguon ro ri.
  fakeNet({ 'HMA VPN WireGuard': [{ family: 'IPv6', address: '2a00:1234::1', internal: false }] });
  eq(vpn.ipv6LeakRisk().risky, false, 'IPv6 tren adapter VPN KHONG tinh la ro ri');

  // Node moi tra family dang SO (6) thay vi chuoi 'IPv6' — phai nhan ca hai, neu khong thi
  // ham am tham luon tra "khong rui ro" va app dung 1 profile trong khi dang ro ri that.
  fakeNet({ Ethernet: [{ family: 6, address: '2001:db8::1', internal: false }] });
  eq(vpn.ipv6LeakRisk().risky, true, 'nhan ca family dang SO (6), khong chi chuoi "IPv6"');

  // ── 8c. tunnelState(): canh nguoi dung TU tat/bat HMA (QD-32 bo sung 2) ──
  // Day la tin hieu duy nhat app co de biet NGUOI DUNG tu toggle HMA. Sai o day thi hoac mat
  // tinh nang (khong khoa nut) hoac te hon: KHOA OAN nut Chay tren ca 4 may ao.
  console.log('\n8c. tunnelState: nhan dien duong ham HMA len/xuong');

  fakeNet({
    'HMA VPN WireGuard': [{ family: 'IPv4', address: '10.252.32.18', internal: false }],
    Ethernet: [{ family: 'IPv4', address: '192.168.1.115', internal: false }],
  });
  let ts = vpn.tunnelState();
  eq(ts.up, true, 'HMA bat -> up');
  eq(ts.address, '10.252.32.18', 'tra dung IP TRONG DUONG HAM (de nhan ra luot noi lai)');
  eq(ts.iface, 'HMA VPN WireGuard', 'bao dung ten adapter');

  // Chi con Ethernet -> HMA tat. Neu nham Ethernet la duong ham thi nut Chay khoa vinh vien.
  fakeNet({ Ethernet: [{ family: 'IPv4', address: '192.168.1.115', internal: false }] });
  eq(vpn.tunnelState().up, false, 'HMA tat -> up=false (KHONG nham Ethernet la duong ham)');

  // ⛔ Bay LON NHAT: Tailscale la DUONG VAO may ao. Tinh no la VPN thi Tailscale nhap nhay se
  // khoa nut Chay oan tren ca 4 VPS, dung luc mang co van de lai cang can bam duoc.
  fakeNet({ Tailscale: [{ family: 'IPv4', address: '100.122.50.50', internal: false }] });
  eq(vpn.tunnelState().up, false, 'Tailscale TUYET DOI khong duoc tinh la duong ham HMA');

  // May ao co ban HMA cu (di qua OpenVPN/TAP, ten adapter khong co chu "HMA") -> van nhan ra.
  fakeNet({ 'TAP-Windows Adapter V9': [{ family: 'IPv4', address: '10.8.0.6', internal: false }] });
  ts = vpn.tunnelState();
  eq(ts.up, true, 'adapter TAP/OpenVPN -> van nhan la duong ham (du phong cho may ao ban HMA cu)');
  eq(ts.viaFallback, true, 'co danh dau la nhan qua duong DU PHONG');

  // Co CA HMA lan adapter ham khac: adapter ten HMA phai thang TUYET DOI, khong phu thuoc thu tu
  // Windows liet ke. Neu phu thuoc thu tu thi 2 lan doc co the khac nhau -> chuyen tiep GIA.
  const both = {
    'TAP-Windows Adapter V9': [{ family: 'IPv4', address: '10.8.0.6', internal: false }],
    'HMA VPN WireGuard': [{ family: 'IPv4', address: '10.252.32.18', internal: false }],
  };
  fakeNet(both);
  eq(vpn.tunnelState().address, '10.252.32.18', 'HMA thang khi adapter HMA liet ke SAU');
  fakeNet({
    'HMA VPN WireGuard': both['HMA VPN WireGuard'],
    'TAP-Windows Adapter V9': both['TAP-Windows Adapter V9'],
  });
  eq(vpn.tunnelState().address, '10.252.32.18', 'HMA thang khi adapter HMA liet ke TRUOC (tat dinh)');

  // Adapter con day nhung MAT dia chi IPv4 (HMA tat kieu nay tren mot so may) -> phai la down.
  fakeNet({ 'HMA VPN WireGuard': [{ family: 'IPv6', address: 'fe80::1', internal: false }] });
  eq(vpn.tunnelState().up, false, 'adapter con nhung khong con IPv4 -> coi la TAT');

  // family dang SO (4) — cung bay da gap o ipv6LeakRisk.
  fakeNet({ 'HMA VPN WireGuard': [{ family: 4, address: '10.252.32.18', internal: false }] });
  eq(vpn.tunnelState().up, true, 'nhan ca family dang SO (4), khong chi chuoi "IPv4"');

  // Khong co adapter nao -> down, khong nem loi (may khong cai HMA).
  fakeNet({});
  eq(vpn.tunnelState().up, false, 'may khong cai HMA -> down, khong nem loi');

  // os.networkInterfaces() nem loi -> phai tra unknown, KHONG duoc lam sap renderer (bo canh goi
  // ham nay 2 giay/lan, nem loi la spam loi lien tuc).
  osMod.networkInterfaces = () => { throw new Error('gia lap loi he thong'); };
  ts = vpn.tunnelState();
  eq(ts.up, false, 'os loi -> up=false');
  eq(ts.unknown, true, 'os loi -> danh dau unknown, khong nem ra ngoai');

  osMod.networkInterfaces = realNetIf;   // tra lai ban that

  // ── 9. status() chi doc, khong dung tay vao VPN ──
  console.log('\n9. status() chi DOC trang thai');
  hostScript = {}; sent = [];
  const s = await vpn.status();
  ok(s.ok, 'doc duoc trang thai');
  eq(s.state.countryId, 'GB', 'bao dung quoc gia dang noi');
  eq(s.state.connected, true, 'bao dang ket noi');
  eq(sent.filter(a => a !== 'Vpn_GetState_NmSvc').length, 0,
    'chi gui DUY NHAT lenh doc trang thai, khong gui lenh nao lam doi VPN');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} dat, ${fail} truot\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('LOI TEST:', e); process.exit(1); });
