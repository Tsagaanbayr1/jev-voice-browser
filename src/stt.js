/**
 * Server талын speech-to-text. Аудио нь browser-т бичигдэж, энд WAV хэлбэрээр
 * ирж, API key-г эзэмшдэг provider-ээр transcribe хийгддэг.
 *
 * ЯАГААД БАЙГАА ВЭ: Web Speech API үнэгүй бөгөөд үг үгээр stream хийдэг, гэхдээ
 * энэ нь Chrome-ийн өөрийн service бөгөөд Монгол хэлийг найдвартай санал болгодоггүй.
 * Duudlaga Flow нь Монгол хэлэнд зориулж бүтээгдсэн.
 *
 * ХОЁР RAIL, НЭГ KEY. Batch rail (POST) нь дууссан нэг utterance илгээж, нэг
 * transcript буцааж авдаг. Streaming rail (WebSocket) нь та ярьж байх хооронд
 * interim text, utterance дуусахад final frame буцаадаг тул апп таныг ярихаа
 * болихоос өмнө шийдвэр гаргаж чадна — streamSocketUrl болон
 * src/public/recorder.js-ийг үз. Хуудас key-г хэзээ ч барихгүй: тэр /ws/stt
 * нээж, server key-г upstream руу танилцуулна.
 *
 * DUUDLAGA_API_KEY-ээр тохируулна. Энэ л чамд хэрэгтэй цорын ганц тохиргоо;
 * үгүй бол апп browser-ийн өөрийн recognizer руу буцна.
 */

const TIMEOUT_MS = 20_000;

/** Provider ямар хэлбэрээр хариулсан ч transcript-ийг гаргаж авна. */
function readTranscript(contentType, body) {
  if ((contentType || "").includes("application/json")) {
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return body.trim();
    }
    // Нэг талбарыг таамаглахын оронд түгээмэл field нэрсийг хүлээж авна.
    const direct = json.text ?? json.transcription ?? json.transcript ?? json.result ?? json.data?.text;
    if (typeof direct === "string") return direct.trim();
    if (Array.isArray(json.results)) {
      const joined = json.results.map((r) => r.text ?? r.transcript ?? "").join(" ").trim();
      if (joined) return joined;
    }
    return "";
  }
  return String(body || "").trim();
}

async function post(url, { headers, body, signal }) {
  const res = await fetch(url, { method: "POST", headers, body, signal });
  const text = await res.text();
  return { ok: res.ok, status: res.status, headers: res.headers, text };
}

// Developer rail. Server зөвхөн `Authorization: Bearer` header-ийг уншина
// — бусад header хэлбэр бүр "Missing authorization token" гэж хариулна.
//
// `POST /transcribe` бол desktop rail: Clerk session (эсвэл device token) дээр нэмээд
// subscription-ийг баталгаажуулдаг тул `dk_` API key тэнд хэзээ ч 401 гэж хариулна,
// хичнээн эрүүл байсан ч. `/v1/stt/transcriptions` бол developer key олгогддог rail
// бөгөөд хэлийг header-т биш, query-д авдаг.
const DEFAULT_HOST = "https://api.duudlaga.dev";

/** Энэ апп-ийн ашигладаг хоёр path, хоёулаа developer rail дээр. */
const RAIL = { batch: "/v1/stt/transcriptions", stream: "/v1/stt/stream" };

// Энэ key-гээр баталгаажуулж чадахгүй rail-ууд. DUUDLAGA_API_URL нь API
// host гэж бичигдсэн ч эдгээрийн нэгийг нэрлэсэн override нь боломжийн
// харагдаж, зөвхөн 401 үүсгэх л чаддаг тул path-ыг нь хасаж, host-ыг нь
// үлдээнэ — host нь л override-ийн хэлэх гэсэн утга. Үүнгүйгээр
// `https://api.duudlaga.dev/transcribe` гэсэн override нь utterance бүрийг desktop
// rail руу явуулж, тэнд `dk_` key үргэлж татгалзагдана.
const FOREIGN_RAIL_PATHS = ["/transcribe", "/transcribe/stream"];

/** Rail-ууд өлгөгддөг API host, DUUDLAGA_API_URL эсвэл default-оос. */
function apiBase() {
  const override = (process.env.DUUDLAGA_API_URL || "").trim();
  if (override) {
    try {
      const u = new URL(override);
      if (FOREIGN_RAIL_PATHS.includes(u.pathname.replace(/\/+$/, ""))) u.pathname = "";
      return u;
    } catch {
      // Гэмтсэн override бүхэл feature-ийг унагах ёсгүй.
    }
  }
  return new URL(DEFAULT_HOST);
}

/**
 * Нэг rail-ийн URL. Бидний танихгүй base path нь урд нь хэвээр үлддэг тул
 * path prefix дор deploy хийсэн API ажилласаар байна; харин бидний таних path —
 * өөрсдийнх эсвэл өөр rail-ийнх — орлуулагдана.
 */
function railUrl(railPath) {
  const u = apiBase();
  const path = u.pathname.replace(/\/+$/, "");
  const known = [RAIL.batch, RAIL.stream, ...FOREIGN_RAIL_PATHS];
  u.pathname = known.includes(path) ? railPath : `${path}${railPath}`;
  return u;
}

/** Batch endpoint: нэг дууссан utterance орж, нэг transcript гарна. */
export function batchEndpoint() {
  return railUrl(RAIL.batch).toString();
}

/** API нь BCP-47 tag шаарддаг; апп-ийн өөрийн код хоёр үсэгтэй. */
const BCP47 = { en: "en-US", mn: "mn-MN" };
const languageTag = (lang) => BCP47[lang] || lang;

/** Provider-ийн олгосон key, эсвэл нэг ч тохируулаагүй бол "". */
export function apiKey() {
  return (process.env.DUUDLAGA_API_KEY || "").trim();
}

/**
 * Streaming rail, batch-тай ижил host дээр, тиймээс DUUDLAGA_API_URL-ийг
 * staging host руу чиглүүлбэл хоёр rail хамт шилжинэ.
 * DUUDLAGA_STREAM_URL нь шууд дарж бичнэ.
 */
export function streamEndpoint() {
  return process.env.DUUDLAGA_STREAM_URL || railUrl(RAIL.stream).toString();
}

/**
 * Нэг streaming session-ийн socket URL.
 *
 * Хэл нь query string-ээр явна — streaming rail үүнийг тэндээс уншдаг,
 * batch rail-ийн адил — scheme нь endpoint-ийг дагадаг тул энгийн
 * http:// override (хөгжүүлэлтийн үеийн локал API) нь ws:// болж хувирна.
 */
export function streamSocketUrl(lang = "mn") {
  const url = new URL(streamEndpoint());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("languages", languageTag(lang));
  return url.toString();
}

/**
 * Duudlaga Flow-ийн өөрийн HTTP API. API key бол цорын ганц шаардлагатай тохиргоо.
 *
 * Host нь api.duudlaga.dev-ээр default болно; DUUDLAGA_API_URL дарж бичнэ. Rail
 * path-ууд тохируулагддаггүй — key нь developer rail-д зориулж олгогддог.
 */
const duudlaga = {
  name: "duudlaga",
  configured: () => Boolean(apiKey()),
  describe: () => `Duudlaga Flow (${batchEndpoint()}, streaming ${streamEndpoint()})`,
  async transcribe(wav, { lang = "mn", signal }) {
    const key = apiKey();
    const endpoint = batchEndpoint();
    // Override нь аль хэдийн query string-тэй байж болно; түүнийг бүү дар.
    const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}languages=${encodeURIComponent(languageTag(lang))}`;
    const base = {
      "Content-Type": "audio/wav",
      Accept: "application/json, text/plain",
    };

    const r = await post(url, { headers: { ...base, Authorization: `Bearer ${key}` }, body: wav, signal });
    if (r.status === 401 || r.status === 403) {
      // Server буруу key болон хугацаа нь дууссан key-д ижилхэн хариулдаг тул
      // алийг нь ч гэж таамаглахын оронд юуг шалгахыг хэлнэ.
      throw new Error(`Duudlaga rejected the API key (HTTP ${r.status}). Check DUUDLAGA_API_KEY is current and active.`);
    }
    if (!r.ok) throw new Error(`Duudlaga HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    return readTranscript(r.headers.get("content-type"), r.text);
  },
};

export const PROVIDERS = [duudlaga];

/** Эхний тохируулагдсан provider, эсвэл нэг ч байхгүй бол null. */
export function activeProvider() {
  const forced = process.env.STT_PROVIDER;
  if (forced) {
    const p = PROVIDERS.find((x) => x.name === forced);
    if (!p) throw new Error(`Unknown STT_PROVIDER "${forced}" (have: ${PROVIDERS.map((x) => x.name).join(", ")})`);
    return p.configured() ? p : null;
  }
  return PROVIDERS.find((p) => p.configured()) ?? null;
}

export function sttStatus() {
  const p = activeProvider();
  const streaming = Boolean(p && p.name === "duudlaga" && apiKey());
  return {
    available: Boolean(p),
    provider: p?.name ?? null,
    detail: p ? p.describe() : "no server-side STT configured (using the browser recognizer)",
    // Streaming нь мөн ижил provider, ижил key, зөвхөн socket хэлбэрээр нээгдэнэ.
    // Хуудас ярих зуур текст харуулж чадах эсэхийг шийдэхийн тулд үүнийг асуудаг.
    streaming,
    streamUrl: streaming ? streamEndpoint() : null,
  };
}

/** sttStatus-ийн зөвхөн streaming хагас, server-ийн socket route-д зориулав. */
export function streamingStatus() {
  const available = Boolean(activeProvider()) && Boolean(apiKey());
  return {
    available,
    url: available ? streamEndpoint() : null,
    detail: available
      ? `Duudlaga Flow stream (${streamEndpoint()})`
      : "no streaming STT configured (use the batch rail or the browser recognizer)",
  };
}

/**
 * Нэг utterance-ийг transcribe хийнэ. { text, provider, latencyMs } буцаана.
 * Provider тохируулаагүй эсвэл дуудлага бүтэлгүйтвэл throw хийнэ.
 */
export async function transcribe(wav, { lang = "mn" } = {}) {
  const p = activeProvider();
  if (!p) throw new Error("No STT provider configured. Set DUUDLAGA_API_KEY.");
  if (!wav?.length) throw new Error("empty audio");
  const t0 = performance.now();
  const text = await p.transcribe(wav, { lang, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { text, provider: p.name, latencyMs: Math.round(performance.now() - t0) };
}

export { readTranscript };
