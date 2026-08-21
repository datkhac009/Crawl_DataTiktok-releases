"use strict";
// ════════════════════════════════════════════════════════════════════════════════════════
// LOC THEO NGON NGU TIEU DE, PHU THUOC QUOC GIA CUA PROFILE (2026-08-21)
//
// LUAT nguoi dung chot: "chi lay tieu de tieng Anh. Neu IP la KR thi lay title tieng Anh HOAC
// tieng Han. Neu IP la AU thi lay AU hoac UK US vi no deu la tieng Anh."
//   => DUOC PHEP = TIENG ANH (luon luon) + ngon ngu CUA CHINH quoc gia profile.
// Loai ro rang: chu A Rap (Trung Dong), Devanagari (An Do/Nepal), va cac he chu khac.
//
// ⚠ Ban dau toi lam SAI: cho Han/Nhat/Trung qua voi MOI profile. Sai vi profile (US) dang le
// phai LOAI tieu de tieng Han. Quoc gia lay tu NHAN trong ten thu muc profile — dung nguon ma
// `ip-guard` da dung (`fingerprint.countryOf`), khong tu khai lai (QD-10).
//
// HAI dau hieu DOC LAP, moi cai bat mot loai khac nhau:
//   1. `uploaderLangLabel(name, cc)` — TikTok gan nhan "original sound" theo NGON NGU NGUOI
//      DANG (QD-10). Tien to ten sound chinh la ngon ngu ho:
//        "original sound - x"  -> tieng Anh   -> LAY voi moi profile
//        "sonido original - x" -> Tay Ban Nha -> LOAI
//        "오리지널 사운드 - x"    -> tieng Han   -> LAY voi (KR), LOAI voi (US)
//      Day la thu DUY NHAT bat duoc nguoi dang dung CHU LATIN ma khong phai tieng Anh
//      (Tay Ban Nha, Bo, Phap, Indonesia, Viet...).
//   2. `foreignScripts(name, cc)` — bat ten KHONG co tien to (vd ten bai hat that
//      `أدعية إسلامية` trong anh nguoi dung gui). Xet HE CHU Unicode tung ky tu.
//
// ⚠ PHAI bo emoji / so / dau cau truoc khi xet. Ten sound day emoji ("original sound - S")
// — tinh emoji la "chu la" thi LOAI OAN gan het. Chi xet KY TU CHU.
//
// ⛔ GIOI HAN THAT, PHAI DOC: rat nhieu ngon ngu chau Phi dung CHU LATIN (Swahili, Hausa,
// Yoruba, Zulu, Somali, Nigerian Pidgin). Neu nguoi dang dat may o tieng Anh thi ten sound la
// "original sound - ..." va CA HAI bo loc deu cho qua. Noi dung chau Phi tieng Anh VAN VAO.
// Chan triet de hon phai nhan dien NGON NGU thay vi chu viet — dung cai ma QD-10 chung minh
// khong bao gio du (da them 22 ngon ngu ma van "best-effort").
// ════════════════════════════════════════════════════════════════════════════════════════

const { ORIGINAL_SOUND_LABELS } = require("./crawler/util.cjs");

// ⚠ PHAI dung REGEX LITERAL. Dung tu chuoi thi mot dau BACKSLASH bi mat khi ghi file -> JS doc
// thanh "p{Script=Arabic}" -> regex sai -> moi lan `new RegExp` deu NEM va bi try/catch NUOT
// IM (bo loc van chan dung nhung log mat het ten ngon ngu). Da bi dung loi nay that.
const SCRIPTS = [
  { name: "Latin", re: /\p{Script=Latin}/u, label: "Latin" },
  { name: "Arabic", re: /\p{Script=Arabic}/u, label: "A Rap (Trung Dong)" },
  { name: "Hebrew", re: /\p{Script=Hebrew}/u, label: "Do Thai" },
  { name: "Devanagari", re: /\p{Script=Devanagari}/u, label: "Devanagari (An Do / Nepal)" },
  { name: "Bengali", re: /\p{Script=Bengali}/u, label: "Bengal" },
  { name: "Gurmukhi", re: /\p{Script=Gurmukhi}/u, label: "Punjab" },
  { name: "Gujarati", re: /\p{Script=Gujarati}/u, label: "Gujarat" },
  { name: "Oriya", re: /\p{Script=Oriya}/u, label: "Odia" },
  { name: "Tamil", re: /\p{Script=Tamil}/u, label: "Tamil" },
  { name: "Telugu", re: /\p{Script=Telugu}/u, label: "Telugu" },
  { name: "Kannada", re: /\p{Script=Kannada}/u, label: "Kannada" },
  { name: "Malayalam", re: /\p{Script=Malayalam}/u, label: "Malayalam" },
  { name: "Sinhala", re: /\p{Script=Sinhala}/u, label: "Sinhala" },
  { name: "Thai", re: /\p{Script=Thai}/u, label: "Thai Lan" },
  { name: "Lao", re: /\p{Script=Lao}/u, label: "Lao" },
  { name: "Khmer", re: /\p{Script=Khmer}/u, label: "Khmer" },
  { name: "Myanmar", re: /\p{Script=Myanmar}/u, label: "Myanmar" },
  { name: "Ethiopic", re: /\p{Script=Ethiopic}/u, label: "Ethiopia (Amharic/Tigrinya)" },
  { name: "Tifinagh", re: /\p{Script=Tifinagh}/u, label: "Berber (Bac Phi)" },
  { name: "Nko", re: /\p{Script=Nko}/u, label: "N'Ko (Tay Phi)" },
  { name: "Adlam", re: /\p{Script=Adlam}/u, label: "Adlam (Fulani, Tay Phi)" },
  { name: "Vai", re: /\p{Script=Vai}/u, label: "Vai (Liberia)" },
  { name: "Cyrillic", re: /\p{Script=Cyrillic}/u, label: "Kirin (Nga/Ukraina)" },
  { name: "Greek", re: /\p{Script=Greek}/u, label: "Hy Lap" },
  { name: "Armenian", re: /\p{Script=Armenian}/u, label: "Armenia" },
  { name: "Georgian", re: /\p{Script=Georgian}/u, label: "Gruzia" },
  { name: "Han", re: /\p{Script=Han}/u, label: "Han (Trung/Nhat)" },
  { name: "Hiragana", re: /\p{Script=Hiragana}/u, label: "Nhat" },
  { name: "Katakana", re: /\p{Script=Katakana}/u, label: "Nhat" },
  { name: "Hangul", re: /\p{Script=Hangul}/u, label: "Han Quoc" },
];
const _LETTER = /\p{L}/u;
const EN_LABEL = "original sound";

// Ngon ngu RIENG cua tung quoc gia (NGOAI tieng Anh). Nuoc noi tieng Anh -> khong them gi.
// `labels` phai TRUNG KHOP chuoi trong ORIGINAL_SOUND_LABELS (crawler/util.cjs).
// `scripts` de TRONG voi nuoc dung chu Latin (Viet, Indonesia, Duc, Phap, Brazil): luc do chi
// bo loc TIEN TO phan biet duoc, he chu thi khong.
const BY_COUNTRY = {
  US: { labels: [], scripts: [] },
  UK: { labels: [], scripts: [] },
  GB: { labels: [], scripts: [] },
  AU: { labels: [], scripts: [] },
  CA: { labels: [], scripts: [] },
  SG: { labels: [], scripts: [] },
  KR: { labels: ["오리지널 사운드"], scripts: ["Hangul"] },
  JP: { labels: ["オリジナル楽曲"], scripts: ["Hiragana", "Katakana", "Han"] },
  TW: { labels: ["原声"], scripts: ["Han"] },
  TH: { labels: ["เสียงต้นฉบับ"], scripts: ["Thai"] },
  ID: { labels: ["suara asli"], scripts: [] },
  MY: { labels: ["bunyi asal"], scripts: [] },
  PH: { labels: ["orihinal na sound"], scripts: [] },
  VN: { labels: ["nhạc nền"], scripts: [] },
  DE: { labels: ["originalton"], scripts: [] },
  FR: { labels: ["son original"], scripts: [] },
  BR: { labels: ["som original"], scripts: [] },
};
// CO Y KHONG co IN (An Do): nguoi dung noi thang chu Devanagari la LOAI. Neu sau nay chay
// profile (IN) that thi them dong: IN: { labels: ["मूल ध्वनि"], scripts: ["Devanagari"] }.

// Profile khong co nhan quoc gia -> khong biet "ngon ngu ban dia" -> CHI cho tieng Anh.
// CO Y siet: bo loc nay nguoi dung tu bat, muc dich la siet lai, nen khong ro thi siet.
function _rule(country) {
  const cc = String(country || "").trim().toUpperCase();
  return BY_COUNTRY[cc] || { labels: [], scripts: [] };
}

// Nhan cac he chu KHONG duoc phep xuat hien trong `name`. Rong = khong co gi la.
function foreignScripts(name, country) {
  const s = String(name == null ? "" : name);
  if (!s) return [];
  const allow = new Set(["Latin"].concat(_rule(country).scripts));
  const out = [], seen = new Set();
  for (const ch of s) {
    if (!_LETTER.test(ch)) continue;
    let hit = null;
    for (const sc of SCRIPTS) if (sc.re.test(ch)) { hit = sc; break; }
    if (hit && allow.has(hit.name)) continue;
    const label = hit ? hit.label : "chu khac (chua ro he)";
    if (!seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

// Ten sound bat dau bang nhan cua ngon ngu KHONG duoc phep? Tra nhan do, hoac null neu:
//   • bat dau bang nhan tieng Anh, hoac nhan cua chinh quoc gia profile
//   • khong khop nhan nao (ten bai hat that) -> khong ket luan duoc -> cho qua
function uploaderLangLabel(name, country) {
  const s = String(name == null ? "" : name).trim().toLowerCase();
  if (!s) return null;
  const keep = [EN_LABEL].concat(_rule(country).labels).map((x) => String(x).toLowerCase());
  for (const k of keep) if (s.startsWith(k)) return null;
  for (const lab of ORIGINAL_SOUND_LABELS) {
    const l = String(lab).toLowerCase();
    if (keep.includes(l)) continue;
    if (s.startsWith(l)) return lab;
  }
  return null;
}

module.exports = { foreignScripts, uploaderLangLabel, EN_LABEL, BY_COUNTRY, SCRIPTS };
