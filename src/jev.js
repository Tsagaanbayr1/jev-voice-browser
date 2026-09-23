/**
 * Transcript update бүрт ганц Jev request: state + speculative question fan-out-ийг бүтээж,
 * API-г дуудаж, latency / usage / cost-той typed хариултуудыг буцаана.
 *
 * API key нь server талд үлдэнэ. TYPESAFE_API_KEY-г уншиж, байхгүй бол JEV_API_KEY руу шилжинэ.
 */
import { TypeSafeClient, choice, noul, score, APIUserAbortError } from "@typesafe-ai/sdk";
import { MODEL, PRICE_PER_M_INPUT_TOKENS_USD, questionsForLang, MAX_TRANSCRIPT_CHARS, MAX_CONTEXT_ACTIONS } from "./constants.js";
import { extractTextCandidates, extractUrlCandidates } from "./spans.js";
import { DEFAULT_LANG, getLang } from "./lang.js";
import { clip, clipEnd, sanitizeDeep, stripLoneSurrogates } from "./text.js";

let _client = null;

export function getClient() {
  if (_client) return _client;
  const apiKey = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key: set TYPESAFE_API_KEY (or JEV_API_KEY). See run.sh / .env.example.");
  }
  _client = new TypeSafeClient({
    apiKey,
    defaultModel: MODEL,
    timeout: 8000,
    retry: { maxRetries: 1, backoffInitialMs: 150, backoffMaxMs: 600 },
    logLevel: "off",
  });
  return _client;
}

export function hasApiKey() {
  return Boolean(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY);
}

export function costUsd(usage) {
  const tokens = usage?.input_tokens ?? 0;
  return (tokens / 1_000_000) * PRICE_PER_M_INPUT_TOKENS_USD;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** `e09 link "GitHub - typesafe-ai" → github.com` — богино, хүн уншихад ойлгомжтой, цөөн token. */
export function encodeElement(el, pageHost = "") {
  let s = `${el.id} ${el.role}`;
  const text = el.text || "";
  if (text) s += ` "${text}"`;
  if (el.placeholder && el.placeholder !== text) s += ` (placeholder: ${el.placeholder})`;
  if (el.href) {
    const host = el.href.split("/")[0];
    if (host && host !== pageHost) s += ` → ${host}`;
  }
  if (el.below_fold) s += " [below fold]";
  return s;
}

/**
 * Шахмал conversation context: хэрэглэгч сая хаанаас ирсэн, сүүлд гүйцэтгэсэн цөөн үйлдэл,
 * хамгийн сүүлийнх нь эхэндээ. Юу ч болоогүй бол `null`.
 */
export function encodeContext(context) {
  if (!context) return null;
  const out = {};
  if (context.previousPage?.url) {
    out.previous_page = {
      url: clip(context.previousPage.url, 200),
      title: clip(context.previousPage.title || "", 120),
    };
  }
  const actions = (context.recentActions || []).slice(-MAX_CONTEXT_ACTIONS).reverse();
  if (actions.length) {
    const now = Date.now();
    out.recent_actions = actions.map((a) => {
      const e = { said: clip(a.said || "", 120), action: a.type };
      if (a.targetLabel) e.target = clip(a.targetLabel, 80);
      if (a.text) e.text = clip(a.text, 80);
      if (a.url) e.url = clip(a.url, 200);
      e.outcome = a.outcome || (a.ok === false ? "failed" : "done");
      if (a.at) e.seconds_ago = Math.max(0, Math.round((now - a.at) / 1000));
      return e;
    });
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Нэг шийдвэрт зориулж state object болон question map-ийг бүтээнэ.
 * Jev яг юу харж байгааг тестүүд шалгаж чадахын тулд export хийсэн.
 */
export function buildRequest({ transcript, snapshot, pendingConfirmation = null, tabs = null, context = null, lang = DEFAULT_LANG }) {
  // `clipEnd` нь сүүлийн 400 тэмдэгтийг суррогат хосыг хуваалгүй авна;
  // `stripLoneSurrogates` нь recognizer-ээс шууд ирсэн ганц бие суррогатыг ч цэвэрлэнэ
  // (text_span / url_span-ийн candidate-ууд энэ мөрөөс гаргаж авдаг тул энд цэвэрлэх ёстой).
  const text = stripLoneSurrogates(clipEnd(String(transcript || ""), MAX_TRANSCRIPT_CHARS));
  // Candidate-ууд `text_span` / `url_span`-ийн CRITERIA KEY болдог ба `sanitizeDeep`
  // object-ийн VALUE-уудыг л цэвэрлэдэг тул тэдгээрийг энд тусдаа цэвэрлэнэ.
  const textCandidates = extractTextCandidates(text, lang).map(stripLoneSurrogates);
  const urlCandidates = extractUrlCandidates(text, lang).map(stripLoneSurrogates);
  const QUESTIONS = questionsForLang(lang);
  const pack = getLang(lang);

  const elements = snapshot?.elements || [];
  const pageHost = hostOf(snapshot?.url);
  const state = {
    transcript: text,
    page: {
      url: clip(snapshot?.url || "about:blank", 200),
      title: clip(snapshot?.title || "", 120),
      site: snapshot?.site || "blank",
    },
    // Element бүрт нэг compact мөр, харагдах дарааллаар (viewport эхэнд). `target` асуултын
    // option-ууд нь эдгээр id; token-ийг хагасалхын тулд тэдгээрийн текст энд байрлана (semantic-find pattern).
    elements: elements.map((el) => encodeElement(el, pageHost)),
  };
  // Jev transcript-ийг ямар хэлээр ирсэн тэр хэлээр нь уншдаг; ямар хэл хүлээж
  // байгааг хэлж өгснөөр богино imperative нь chit-chat мэт харагдахаас сэргийлнэ.
  if (pack.code !== "en") state.spoken_language = pack.label;
  const ctx = encodeContext(context);
  if (ctx) state.context = ctx;
  if (pendingConfirmation) state.pending_confirmation = pendingConfirmation;
  if (tabs && tabs.length > 1) state.open_tabs = tabs.length;

  const targetCriteria = {};
  for (const el of elements) targetCriteria[el.id] = null;
  targetCriteria.none = "No element on this page is referred to";

  const questions = {
    intent: choice(QUESTIONS.intent.instructions, QUESTIONS.intent.criteria),
    target: choice(QUESTIONS.target.instructions, targetCriteria),
    site: choice(QUESTIONS.site.instructions, QUESTIONS.site.criteria),
    complete: noul(QUESTIONS.complete.instructions, QUESTIONS.complete.criteria),
    is_command: noul(QUESTIONS.is_command.instructions, QUESTIONS.is_command.criteria),
    destructive: noul(QUESTIONS.destructive.instructions, QUESTIONS.destructive.criteria),
    scroll_amount: score(QUESTIONS.scroll_amount.instructions, QUESTIONS.scroll_amount.criteria),
    tab_direction: choice(QUESTIONS.tab_direction.instructions, QUESTIONS.tab_direction.criteria),
  };
  if (ctx?.recent_actions?.length) {
    questions.is_correction = noul(QUESTIONS.is_correction.instructions, QUESTIONS.is_correction.criteria);
  }

  if (textCandidates.length) {
    const c = Object.fromEntries(textCandidates.map((s) => [s, null]));
    c.none = "Nothing should be typed or searched";
    questions.text_span = choice(QUESTIONS.text_span.instructions, c);
  }
  if (urlCandidates.length) {
    const c = Object.fromEntries(urlCandidates.map((s) => [s, null]));
    c.none = "No web address is mentioned";
    questions.url_span = choice(QUESTIONS.url_span.instructions, c);
  }

  // Сүүлчийн баталгаа: state-д ганц бие суррогат үлдээгүй. Jev API ийм хүсэлтийг
  // 400-аар үгүйсгэдэг ба Controller-ийн `error` event нь бүх серверийг унагадаг.
  sanitizeDeep(state);
  return { state, questions, candidates: { text: textCandidates, url: urlCandidates } };
}

/**
 * Jev-ээс асуу. { answers, latencyMs, usage, costUsd, model, requestId, candidates, state } руу
 * resolve хийнэ, эсвэл `signal` abort хийхэд (шинэ transcript ирэхэд) APIUserAbortError-оор reject хийнэ.
 */
export async function decide(input, { signal } = {}) {
  const client = getClient();
  const { state, questions, candidates } = buildRequest(input);
  const t0 = performance.now();
  const { data, requestId } = await client
    .systemOne({ state, questions, model: MODEL }, { signal })
    .withResponse();
  const latencyMs = Math.round(performance.now() - t0);
  return {
    lang: input.lang ?? DEFAULT_LANG,
    answers: data.answers,
    latencyMs,
    usage: data.usage,
    costUsd: costUsd(data.usage),
    model: data.model,
    requestId,
    candidates,
    state,
    questionCount: Object.keys(questions).length,
  };
}

export function isAbortError(err) {
  return err instanceof APIUserAbortError || err?.name === "AbortError" || err?.name === "APIUserAbortError";
}
