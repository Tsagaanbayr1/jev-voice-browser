/**
 * Юникод-аюулгүй мөр боловсруулах туслах функцууд.
 *
 * Яагаад хэрэгтэй вэ: JavaScript-ийн мөр UTF-16 код нэгжээр хадгалагддаг ба emoji
 * гэх мэт BMP-д багтахгүй тэмдэгт бүр хоёр нэгж (суррогат хос) эзэлнэ. `slice`-ээр
 * тайрах нь тэр хосыг дундуур нь хувааж болох ба хагас үлдсэн нэгж нь хүчингүй
 * Unicode болно. Jev API ийм хүсэлтийг бүхэлд нь
 * `400 Request contains invalid Unicode text.`-ээр үгүйсгэдэг — тиймээс хуудсан дээрх
 * нэг emoji (жишээ нь 120 тэмдэгтээр тайрагдсан page title-ийн яг таслах цэг дээр)
 * бүх хүсэлтийг унагахад хангалттай.
 */

const HIGH = /[\uD800-\uDBFF]/; // өндөр суррогат
const LOW = /[\uDC00-\uDFFF]/; // бага суррогат

/** Суррогат хосыг бүү хуваа: эхнээс нь хамгийн ихдээ `n` тэмдэгт авна. */
export function clip(s, n) {
  s = String(s ?? "");
  if (n <= 0) return "";
  if (s.length <= n) return s;
  // n-р байрлал дээрх тэмдэгт өндөр суррогат бол хос нь таслагдаж байна — түүнийг орхино
  return s.slice(0, HIGH.test(s[n - 1]) ? n - 1 : n);
}

/** Суррогат хосыг бүү хуваа: төгсгөлөөс нь хамгийн ихдээ `n` тэмдэгт авна. */
export function clipEnd(s, n) {
  s = String(s ?? "");
  if (n <= 0) return "";
  if (s.length <= n) return s;
  let start = s.length - n;
  // эхний үлдэх тэмдэгт бага суррогат бол хос нь таслагдаж байна — түүнийг ч орхино
  if (LOW.test(s[start])) start += 1;
  return s.slice(start);
}

/** Ганц бие суррогат бүрийг U+FFFD-ээр солино (Jev API үүнийг хүлээн авдаг). */
export function stripLoneSurrogates(s) {
  s = String(s ?? "");
  if (!HIGH.test(s) && !LOW.test(s)) return s;
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}

/**
 * Object/array доторх бүх мөрийг газар дээр нь цэвэрлэнэ (prototype-ийг хөндөхгүй,
 * тиймээс SDK-ийн question object-ууд ч аюулгүй).
 *
 * Энэ нь Jev рүү явуулахаас өмнөх сүүлчийн баталгаа: дээрх `clip`-ууд аль нэг
 * таслах цэгээ алдсан ч хүсэлт хүчингүй Unicode-той явахгүй.
 */
export function sanitizeDeep(value) {
  if (typeof value === "string") return stripLoneSurrogates(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = sanitizeDeep(value[i]);
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = sanitizeDeep(value[key]);
    return value;
  }
  return value;
}
