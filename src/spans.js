/**
 * Candidate гаргалгаа (Jev биш, код). Jev хэзээ ч текст үүсгэдэггүй: бид энд transcript-ээс
 * candidate span-уудыг хэт ихээр үүсгэдэг, Jev зөвхөн тэдний нэгийг *сонгодог*.
 * Сонгосон option нь браузер руу үгчлэн хуулагдана.
 *
 * Функц бүр language code (эсвэл pack) авдаг. Кирилл transcript-ууд автоматаар Монгол
 * гэж задлагддаг тул яригдсан хэл нь UI-ийн тохиргоог үргэлж дийлнэ. Хэл тус бүрийн
 * өгөгдлийг src/lang.js-с үз, үүнд Монгол хэл payload-ыг үйл үгийн ӨМНӨ тавьдаг
 * гэдгийг оруулаад ("муур хай" = cats search).
 */

import { packForTranscript, DEFAULT_LANG } from "./lang.js";

const TLDS = "com|org|net|io|ai|dev|co|edu|gov|de|uk|us|app|xyz|info|me|tv|ch|at|fr|nl|es|it|mn";

/** Code, pack, эсвэл transcript өөрөөс нь language pack гаргана. */
function packOf(langOrPack, transcript = "") {
  if (langOrPack && typeof langOrPack === "object" && langOrPack.code) return langOrPack;
  return packForTranscript(transcript, langOrPack || DEFAULT_LANG);
}

export function cleanTranscript(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripFiller(s, pack) {
  return s
    .replace(pack.fillerRe, " ")
    .replace(/\s+/g, " ")
    .replace(/[.,!?]+$/g, "")
    .trim();
}

function pushUnique(list, value, pack) {
  const v = stripFiller(value, pack);
  if (!v) return;
  if (v.length > 120) return;
  if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return;
  list.push(v);
}

/**
 * type/search intent-уудад зориулсан candidate text payload-ууд.
 * Transcript хоосон үед [] буцаана. Дараалал: хамгийн магадлалтай нь эхэнд.
 */
export function extractTextCandidates(transcript, lang = DEFAULT_LANG) {
  const t = cleanTranscript(transcript);
  if (!t) return [];
  const pack = packOf(lang, t);
  const out = [];

  // 1. quote-д авсан span-ууд
  for (const m of t.matchAll(/["“”']([^"“”']{1,120})["“”']/g)) pushUnique(out, m[1], pack);

  // 2. Үйл үгийн ДАРААХ payload ("search for cats"): хамгийн эрт үйл үг эхэнд
  const leading = pack.textVerbsLeading
    .map((re) => re.exec(t))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index || b[0].length - a[0].length);
  for (const m of leading) {
    let tail = t.slice(m.index + m[0].length);
    tail = tail.replace(pack.leadingSiteRe, "");
    const stripped = tail.replace(pack.trailingDestRe, "");
    pushUnique(out, stripped, pack);
    if (stripped !== tail) pushUnique(out, tail, pack);
  }

  // 3. Үйл үгийн ӨМНӨХ payload ("муур хай"): төгсгөлийн үйл үгийг хасна, дараа нь
  //    эхний site хэллэгийг хасна ("википедиа дээр муур хай" -> "муур")
  for (const re of pack.textVerbsTrailing) {
    const m = re.exec(t);
    if (!m || m.index === 0) continue;
    const head = t.slice(0, m.index);
    // Эхэнд хэлсэн destination ("хайлтын талбарт …") болон эхэнд хэлсэн site
    // ("википедиа дээр …") хоёуланг хасна; сул хэлбэрүүдийг fallback болгон үлдээнэ.
    let payload = head.replace(pack.trailingDestRe, "");
    if (pack.leadingDestRe) payload = payload.replace(pack.leadingDestRe, "");
    pushUnique(out, payload.replace(pack.leadingSiteRe, ""), pack);
    pushUnique(out, payload, pack);
    pushUnique(out, head, pack);
  }

  // 4. эхний "for"-той төстэй үгийн дараах сүүл (зөвхөн English; Монголд байхгүй)
  const forIdx = t.toLowerCase().indexOf(" for ");
  if (forIdx >= 0) pushUnique(out, t.slice(forIdx + 5).replace(pack.trailingDestRe, ""), pack);

  // 5. эхний үгийн дараах сүүл ("type hello"-г хамарна)
  const firstSpace = t.indexOf(" ");
  if (firstSpace > 0) pushUnique(out, t.slice(firstSpace + 1).replace(pack.trailingDestRe, ""), pack);

  // 6. сүүлийн арга болгон бүх transcript
  pushUnique(out, t, pack);

  return out.slice(0, 8);
}

/** "example dot com" / "жишээ цэг ком" -> "example.com". */
export function normalizeSpokenUrl(text, lang = DEFAULT_LANG) {
  const raw = String(text || "");
  const pack = packOf(lang, raw);
  let s = raw.toLowerCase();
  for (const [re, to] of pack.urlReplacements) s = s.replace(re, to);
  return s
    .replace(/\s*\.\s*/g, ".")
    .replace(/\bwww\s+/g, "www.")
    .replace(/\bh\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\//g, (m) => (m.includes("s") ? "https://" : "http://"));
}

/** Transcript доторх domain шиг span-ууд (spoken-url normalize хийсний дараа). */
export function extractUrlCandidates(transcript, lang = DEFAULT_LANG) {
  const t = normalizeSpokenUrl(cleanTranscript(transcript), lang);
  if (!t) return [];
  // Latin domain-ууд, дээр нь ASCII TLD-тэй Кирилл label-ууд ("жишээ.com") —
  // Монгол recognizer нь яригдсан domain-д яг ийм зүйл үүсгэдэг.
  const re = new RegExp(`(?:https?://)?(?:[a-z0-9\\u0400-\\u04ff-]+\\.)+(?:${TLDS})(?:/[^\\s]*)?`, "gi");
  const out = [];
  for (const m of t.matchAll(re)) {
    const v = m[0].replace(/[.,!?]+$/, "");
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, 6);
}

export function toHttpUrl(domainish) {
  const v = String(domainish).trim();
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

/**
 * Дэлгэц дээр дугаартай candidate overlay-ууд байх үед ганц тоо ("two", "хоёр",
 * "хоёр дахь") нь детерминистик сонголт — Jev-ээс асуух шаардлагагүй.
 * 1-ээс эхэлсэн index эсвэл null буцаана.
 */
export function parseCandidatePick(transcript, max = 5, lang = DEFAULT_LANG) {
  const t = cleanTranscript(transcript).toLowerCase().replace(/[.,!?]/g, "");
  if (!t) return null;
  const pack = packOf(lang, t);
  const stop = new Set(pack.pickStopwords);
  const meaningful = t.split(" ").filter((w) => !stop.has(w));
  if (meaningful.length === 0 || meaningful.length > 2) return null;
  for (const w of meaningful) {
    const n = pack.numberWords[w];
    if (n && n <= max) return n;
  }
  if (meaningful.length === 1) {
    const n = pack.numberHomophones[meaningful[0]];
    if (n && n <= max) return n;
  }
  return null;
}
