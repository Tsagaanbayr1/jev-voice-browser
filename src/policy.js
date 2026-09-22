/**
 * Гүйцэтгэлийн policy: Jev-ийн хариултыг ACT / WAIT / IGNORE / CONFIRM /
 * DISAMBIGUATE болгодог цэвэр код. Gate бүр constants.js-ийн тоо байдаг тул
 * UI нь ЯАГААД гэдгийг харуулж чадна.
 *
 * ХОЁР ҮЗЭГЧ, НЭГ STRING. Энд байгаа бүхэн нэг бол англи хэл, нэг бол key хосыг уншина:
 *   - `summary` / `reasons[].note` нь англи string бөгөөд хэвээр нь үлддэг, учир нь
 *     log, scripts/demo.js болон integration тестүүдийн failure output бүгд
 *     тэдгээрийг уншдаг, бас оператор debug-ийг англиар хийдэг.
 *   - `summaryKey` / `reasons[].noteKey` нь `{key, params}` бөгөөд control
 *     page нь уншигчийн сонгосон аль ч хэлээр эдгээрийг render хийнэ. Англи
 *     string нь key-ээс ГЕНЕРЕЙТ хийгддэг (`note`/`sum`-ыг үз), тиймээс хоёулаа
 *     зөрж чадахгүй.
 */
import {
  T,
  TARGET_INTENTS,
  sitesFor,
  DEFAULT_SEARCH_ENGINE,
  SILENCE_COMPLETE_MS,
  PAYLOAD_SILENCE_MS,
  PAYLOAD_INTENTS,
} from "./constants.js";
import { toHttpUrl } from "./spans.js";
import { t, has, actionLabel, actionRef } from "./public/i18n.js";

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Gate-ийн үр дүнг бүртгэнэ. `note` нь нэг бол энгийн string (element-ийн label
 * гэх мэт page data — хэзээ ч орчуулагдахгүй) эсвэл prose-д зориулсан `{key, params}`.
 */
function check(reasons, name, value, threshold, pass, note) {
  const keyed = note && typeof note === "object";
  const params = keyed ? note.params : undefined;
  reasons.push({
    name,
    value: typeof value === "number" ? r2(value) : value,
    threshold,
    pass,
    note: keyed ? t("en", note.key, params) : (note ?? ""),
    ...(keyed ? { noteKey: { key: note.key, params } } : {}),
  });
  return pass;
}

/** Summary: log/тестэд англи, page-д key-тэй. */
function sum(key, params, extra = {}) {
  return { summary: t("en", key, params), summaryKey: { key, params }, ...extra };
}

/**
 * Action-ыг дотроо агуулсан summary. Action нь NESTED parts хэлбэрээр ордог тул
 * уншигчийн хэл түүний дотор хүрдэг: page нь `summary.needConfirm`-ыг монголоор
 * render хийхэд доторх action ч бас монголоор гарч ирнэ, харин log болон model
 * нь мөн адил зүйлийг англиар харна.
 */
function actionSum(key, action) {
  const parts = actionRef(action);
  return { summary: t("en", key, { action: parts }), summaryKey: { key, params: { action: parts } } };
}

/** Өөрийн англи template-ээс үүссэн label, тиймээс `label` болон `labelKey` таарна. */
function label(key, params = {}) {
  return { label: t("en", key, params), labelKey: { key, params } };
}

/** `none`-ыг хасаж, магадлалаар эрэмбэлсэн Top-N choice option. */
export function topChoices(choiceAnswer, n = 3) {
  if (!choiceAnswer?.probabilities) return [];
  return Object.entries(choiceAnswer.probabilities)
    .filter(([k]) => k !== "none")
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, p]) => ({ id, p: r2(p) }));
}

function pickSpan(answer, minConfidence, fallback) {
  if (!answer) return fallback ?? null;
  if (answer.choice === "none") return null;
  if (answer.confidence < minConfidence) return fallback ?? answer.choice;
  return answer.choice;
}

function fillTemplate(tpl, q) {
  return tpl.replace("%s", encodeURIComponent(q));
}

/**
 * @param {object} p
 * @param {object} p.answers   Jev-ийн хариултууд (intent, target, site, complete, is_command, destructive, scroll_amount, text_span?, url_span?, tab_direction)
 * @param {object} p.candidates {text: string[], url: string[]}
 * @param {object} p.snapshot  одоогийн page snapshot (elements, searchBoxId, site, url)
 * @param {number} p.silentMs  transcript хамгийн сүүлд өөрчлөгдсөнөөс хойшхи ms
 * @param {boolean} p.isFinal  speech recognizer энэ utterance-ийг final гэж тэмдэглэсэн
 * @param {object|null} p.context  conversation context (өмнөх хуудас + сүүлийн үйлдлүүд), correction-д хэрэглэнэ
 * @param {object|null} p.pending  "confirm"-ыг хүлээж буй pending destructive action
 * @param {boolean} p.confirmed  хэрэглэгч энэ action-д confirm-ыг аль хэдийн хэлсэн
 * @returns {{decision: string, action?: object, candidates?: Array, reasons: Array, summary: string, summaryKey?: {key: string, params: object}}}
 */
export function evaluatePolicy({ answers, candidates, snapshot, silentMs = 0, isFinal = false, pending = null, context = null, lang = "en" }) {
  const reasons = [];
  const intent = answers.intent;
  const intentName = intent?.choice ?? "none";
  const lastAction = context?.recentActions?.length ? context.recentActions[context.recentActions.length - 1] : null;
  const correction = answers.is_correction?.noul ?? 0;
  // Засвар нь зөвхөн хэллэг дууссаны дараа (эсвэл хэрэглэгч чимээгүй болсны дараа) тооцогдоно:
  // гүйлгэсний дараах "яв" гэх мэт нэг үгтэй хэсэгчилсэн хэллэг нь "гүйлгэлтийг буцаа" гэж
  // уншигдах ёсгүй.
  const finishedPhrase = (answers.complete?.noul ?? 0) >= T.complete || silentMs >= SILENCE_COMPLETE_MS || isFinal;
  const isCorrection = Boolean(lastAction) && correction >= T.correction && finishedPhrase;

  // 0. Pending destructive action-д зориулсан confirm / cancel боловсруулалт.
  if (pending) {
    if (intentName === "confirm" && intent.confidence >= T.intentConfidence) {
      check(reasons, "intent", `confirm (${r2(intent.confidence)})`, T.intentConfidence, true, { key: "note.pending.confirmed" });
      return { decision: "act", action: { ...pending, confirmed: true }, reasons, ...actionSum("summary.confirmed", pending) };
    }
    if (intentName === "cancel" && intent.confidence >= T.intentConfidence) {
      check(reasons, "intent", `cancel (${r2(intent.confidence)})`, T.intentConfidence, true, { key: "note.pending.cancelled" });
      return { decision: "cancel", reasons, ...sum("summary.cancelled") };
    }
  }

  // 1. Өмнөх үйлдлийг засах ("тэр биш", "буруу холбоос, буцаа"). Энгийн "үгүй" бол
  // браузер руу чиглэсэн хариу үйлдэл, шинэ imperative биш, тиймээс энэ нь is_command
  // gate-ээс өмнө ажиллана. Хэрэглэгч сая болсныг үгүйсгээд шинэ target нэрлэхгүй бол
  // буцаана; харин шинэ target нэрлэвэл ("үгүй, нөгөө") доош үргэлжлээд өмнөх
  // target-ыг хаана.
  if (isCorrection) {
    check(reasons, "is_correction", correction, T.correction, true, { key: "note.is_correction", params: { action: actionRef(lastAction) } });
    const confidentIntent = intentName !== "none" && (intent?.confidence ?? 0) >= T.intentConfidence;
    // "нөгөө" нь шинэ element нэрлэнэ; "тэр биш" дангаараа нэрлэхгүй (target нь `none`
    // эсвэл сая үйлдсэн element болж буцаж ирнэ) — сүүлийнх нь энгийн буцаалт.
    const namesNewTarget =
      TARGET_INTENTS.has(intentName) && topChoices(answers.target, 2).some((c) => c.id !== lastAction.targetId && c.p >= T.targetTopProb);
    // Гүйлгэлт эсвэл даралтын дараа хэлсэн итгэлтэй closed-set команд ("буцах", "доош гүйлгэ",
    // "ютуб нээ") бол хэлсэн зүйлээ, өмнөх үйлдлийг буцаах хүсэлт биш: хэвийн боловсруулалт
    // руу үргэлжилнэ. Зөвхөн итгэлгүй / target-гүй засвар л "үүнийг буцаа" гэж үзэгдэнэ.
    const reverse = lastAction.type !== "go_back" && (!confidentIntent || (TARGET_INTENTS.has(intentName) && !namesNewTarget));
    if (reverse) {
      const reversal = reverseAction(lastAction);
      return { decision: "act", action: reversal, reasons, ...actionSum("summary.correction", reversal) };
    }
  }

  // 1b. Хэрэглэгч ер нь browser-тэй ярьж байна уу?
  const isCmd = answers.is_command?.noul ?? 0;
  if (!check(reasons, "is_command", isCmd, T.isCommand, isCmd >= T.isCommand, { key: "note.is_command" })) {
    return { decision: "ignore", reasons, ...sum("summary.notCommand") };
  }

  // 2. Итгэлтэй intent байна уу?
  const conf = intent?.confidence ?? 0;
  const intentOk = intentName !== "none" && conf >= T.intentConfidence;
  check(reasons, "intent", `${intentName} (${r2(conf)})`, T.intentConfidence, intentOk, { key: "note.intent" });
  if (!intentOk) {
    return { decision: "wait", reasons, ...sum(intentName === "none" ? "summary.noIntent" : "summary.intentLow") };
  }

  // 3. Хэрэглэгч командаа дуусгасан уу? (чимээгүй байдал эсвэл final үр дүн ч тооцогдоно)
  const complete = answers.complete?.noul ?? 0;
  const silent = silentMs >= SILENCE_COMPLETE_MS || isFinal;
  const completeOk = complete >= T.complete || silent;
  check(
    reasons,
    "complete",
    complete,
    T.complete,
    completeOk,
    silent
      ? { key: isFinal ? "note.complete.final" : "note.complete.silent", params: { ms: silentMs } }
      : { key: "note.complete.verbObject" },
  );
  if (!completeOk) return { decision: "wait", reasons, ...sum("summary.waitRest") };

  // 3b. Free-text payload-уудыг шууд хуулахын өмнө дууссан байх ёстой.
  if (PAYLOAD_INTENTS.has(intentName)) {
    const payloadOk = isFinal || silentMs >= PAYLOAD_SILENCE_MS;
    check(
      reasons,
      "payload_final",
      isFinal ? "final" : `${silentMs}ms silence`,
      `final or ${PAYLOAD_SILENCE_MS}ms`,
      payloadOk,
      { key: "note.payload_final" },
    );
    if (!payloadOk) {
      return {
        decision: "wait",
        reasons,
        ...sum("summary.waitPayload", {}, { retryInMs: Math.max(50, PAYLOAD_SILENCE_MS - silentMs) }),
      };
    }
  }

  // 4. Тодорхой action-ыг байгуулна (URL, template, текстийг код эзэмшинэ; Jev зөвхөн option сонгосон).
  // Шинэ target нэрлэсэн засварт өмнөх target нь option биш ("нөгөө").
  const excludeTargetId = isCorrection && TARGET_INTENTS.has(intentName) ? lastAction.targetId ?? null : null;
  const built = buildAction({ intentName, answers, candidates, snapshot, reasons, excludeTargetId, lang });
  if (built.decision !== "act") return { ...built, reasons };
  const action = built.action;

  // 5. Destructive юу? Зөвхөн side-effect үүсгэдэг element action л байж чадна.
  const destructive = answers.destructive?.noul ?? 0;
  const canBeDestructive = ["click_element", "press_enter", "select_option"].includes(action.type);
  if (canBeDestructive) {
    const safe = destructive < T.destructive;
    check(reasons, "destructive", destructive, T.destructive, safe, safe ? { key: "note.destructive.safe" } : { key: "note.destructive.confirm" });
    if (!safe) {
      return { decision: "confirm", action, reasons, ...actionSum("summary.needConfirm", action) };
    }
  }

  return { decision: "act", action, reasons, ...actionSum("summary.act", action) };
}

/**
 * `action`-ыг браузер чадах хэмжээнд буцаах үйлдэл: navigation/дарaлт → буцах;
 * бичих → цэвэрлэх; таб → хаах/солих.
 *
 * Label бүр `label.*` key-тэй бөгөөд англи утга нь өмнөх шууд string-тэй ЯГ ижил,
 * тиймээс `describe()` (model-ийн хардаг, хөлдөөсөн) өөрчлөгдөхгүй, харин page
 * уншигчийн хэлээр render хийнэ.
 */
export function reverseAction(action) {
  switch (action?.type) {
    case "type_into_field":
      return {
        type: "type_into_field",
        targetId: action.targetId,
        text: "",
        submit: false,
        label: `clear ${action.label || action.targetId}`,
        ...label("label.clearField", { target: action.label || action.targetId }),
      };
    case "open_new_tab":
      return { type: "close_tab", ...label("label.closeNewTab") };
    case "close_tab":
      return { type: "go_back", ...label("label.backTabClosed") };
    case "switch_tab":
      return { type: "switch_tab", direction: action.direction === "previous" ? "next" : "previous", ...label("label.switchBack") };
    case "scroll_down":
      return { type: "scroll_up", amount: action.amount || "page", ...label("label.scrollBackUp") };
    case "scroll_up":
      return { type: "scroll_down", amount: action.amount || "page", ...label("label.scrollBackDown") };
    default:
      return { type: "go_back", ...label("label.undoAction", { target: actionRef(action) }) };
  }
}

function buildAction({ intentName, answers, candidates, snapshot, reasons, excludeTargetId = null, lang = "en" }) {
  const site = answers.site?.choice ?? "none";
  // Монгол хэл "википедиа"-г mn.wikipedia.org руу илгээдэг; URL бүрийг код эзэмсээр байна.
  const SITE_HOME = sitesFor(lang).home;
  const SITE_SEARCH = sitesFor(lang).search;
  const elements = snapshot?.elements ?? [];

  switch (intentName) {
    case "navigate_url": {
      const urlPick = pickSpan(answers.url_span, T.spanConfidence, candidates.url?.[0]);
      if (urlPick) {
        check(reasons, "url_span", urlPick, T.spanConfidence, true, { key: "note.url_span" });
        return { decision: "act", action: { type: "navigate_url", url: toHttpUrl(urlPick), label: urlPick } };
      }
      if (SITE_HOME[site]) {
        check(reasons, "site", `${site} (${r2(answers.site.confidence)})`, "-", true, { key: "note.site.known" });
        // `site` болон URL нь identifier/data — page тэдгээрийг байгаагаар нь нэрлэнэ.
        return { decision: "act", action: { type: "navigate_url", url: SITE_HOME[site], label: site } };
      }
      check(reasons, "site", site, "known site or spoken domain", false, { key: "note.site.none" });
      return { decision: "wait", ...sum("summary.whereTo") };
    }

    case "search_web": {
      const query = pickSpan(answers.text_span, T.spanConfidence, candidates.text?.[0]);
      if (!query) {
        check(reasons, "text_span", "none", T.spanConfidence, false, { key: "note.text_span.none" });
        return { decision: "wait", ...sum("summary.searchWhat") };
      }
      check(reasons, "text_span", query, T.spanConfidence, true, { key: "note.text_span.copy" });
      if (SITE_SEARCH[site]) {
        return {
          decision: "act",
          action: { type: "navigate_url", url: fillTemplate(SITE_SEARCH[site], query), query, ...label("label.searchSite", { site, query }) },
        };
      }
      if (snapshot?.searchBoxId && snapshot.site !== "blank") {
        return {
          decision: "act",
          action: {
            type: "type_into_field",
            targetId: snapshot.searchBoxId,
            text: query,
            submit: true,
            ...label("label.searchHere", { query }),
          },
        };
      }
      return {
        decision: "act",
        action: {
          type: "navigate_url",
          url: fillTemplate(SITE_SEARCH[DEFAULT_SEARCH_ENGINE], query),
          query,
          ...label("label.search", { query }),
        },
      };
    }

    case "click_element":
    case "select_option":
    case "type_into_field": {
      const target = answers.target;
      let top = topChoices(target, T.candidateCount + 1);
      let chosen = target?.choice;
      let chosenP = target?.probabilities?.[chosen] ?? 0;
      if (excludeTargetId && chosen === excludeTargetId) {
        // "үгүй, нөгөө": сая үйлдсэн element хасагдаж, дараагийнх нь авна.
        top = top.filter((c) => c.id !== excludeTargetId);
        chosen = top[0]?.id ?? "none";
        chosenP = top[0]?.p ?? 0;
        check(reasons, "exclude_target", excludeTargetId, "-", true, { key: "note.exclude_target", params: { target: chosen } });
      }
      top = top.slice(0, T.candidateCount);
      const targetOk =
        chosen && chosen !== "none" && target.confidence >= T.targetConfidence && chosenP >= T.targetTopProb;
      const text = intentName === "click_element" ? null : pickSpan(answers.text_span, T.spanConfidence, candidates.text?.[0]);

      if (intentName !== "click_element" && !text) {
        check(reasons, "text_span", "none", T.spanConfidence, false, { key: "note.text_span.type" });
        return { decision: "wait", ...sum("summary.typeWhat") };
      }

      if (targetOk) {
        // Element-ийн label нь page data (түүний role үг нь model-ийн
        // vocabulary-ийн хэсэг) — байгаагаар нь харуулна, хэзээ ч орчуулахгүй.
        check(reasons, "target", `${chosen} (${r2(target.confidence)})`, T.targetConfidence, true, elementLabel(elements, chosen));
        return { decision: "act", action: { type: intentName, targetId: chosen, text, label: elementLabel(elements, chosen) } };
      }

      // Итгэлтэй targetгүй бичих: page-ийн search box руу fallback хийнэ.
      if (intentName === "type_into_field" && snapshot?.searchBoxId) {
        check(reasons, "target", `${chosen} (${r2(target?.confidence ?? 0)})`, T.targetConfidence, false, { key: "note.target.fallback" });
        return {
          decision: "act",
          action: { type: intentName, targetId: snapshot.searchBoxId, text, ...label("label.searchBox") },
        };
      }

      check(reasons, "target", `${chosen ?? "none"} (${r2(target?.confidence ?? 0)})`, T.targetConfidence, false, { key: "note.target.ambiguous" });
      // Боломжит candidate-уудыг харуулна (ядаж нэг нь боломжтой бол дор хаяж хоёр).
      let viable = top.filter((c) => c.p >= 0.08);
      if (viable.length === 1) viable = top.filter((c) => c.p >= 0.02).slice(0, 2);
      if (viable.length === 0) return { decision: "wait", ...sum("summary.noElement") };
      return {
        decision: "disambiguate",
        candidates: viable.map((c) => ({ ...c, label: elementLabel(elements, c.id) })),
        pendingIntent: { type: intentName, text },
        ...sum("summary.whichOne", { list: viable.map((c, i) => `${i + 1}: ${elementLabel(elements, c.id)}`).join(" | ") }),
      };
    }

    case "scroll_down":
    case "scroll_up": {
      const lvl = Math.round(answers.scroll_amount?.score ?? 1);
      const amount = ["little", "page", "end"][Math.min(2, Math.max(0, lvl))];
      // Level-ийн үг харагддаг тул орчуулагдана; level нь өөрөө тоо бөгөөд
      // gate-ийн мөр түүнийг мэдээлнэ.
      check(reasons, "scroll_amount", answers.scroll_amount?.score ?? 1, "round", true, { key: `scroll.${amount}` });
      return {
        decision: "act",
        action: {
          type: intentName,
          amount,
          ...label("label.scroll", { dir: { key: intentName === "scroll_up" ? "dir.up" : "dir.down" }, amount: { key: `scroll.${amount}` } }),
        },
      };
    }

    case "switch_tab": {
      const dir = answers.tab_direction?.choice && answers.tab_direction.choice !== "none" ? answers.tab_direction.choice : "next";
      return { decision: "act", action: { type: "switch_tab", direction: dir, ...label("label.switchTab", { dir: { key: `dir.${dir}` } }) } };
    }

    case "confirm":
    case "cancel":
      return { decision: "wait", ...sum("summary.nothingPending", { what: intentName }) };

    default: {
      // Тусгай builderгүй intent: өөрийн нэр нь бүхэл label болно.
      const key = `action.${intentName}`;
      return {
        decision: "act",
        action: { type: intentName, ...(has("en", key) ? label(key) : { label: intentName.replace(/_/g, " ") }) },
      };
    }
  }
}

export function elementLabel(elements, id) {
  const el = elements.find((e) => e.id === id);
  return el ? `${el.role} "${el.text || el.placeholder || ""}"` : id;
}

/**
 * Action-ыг нэг англи өгүүлбэр болгон. FROZEN: controller.js үүнийг Jev рүү
 * `pending_confirmation` болгон илгээдэг тул орчуулбал model-ийн унших зүйл
 * өөрчлөгдөнө. Энэ нь page-ийн монголоор render хийдэгтэй ижил parts-ийн англи
 * дүрслэл (`actionLabel` src/public/i18n.js-д) тул хоёулаа хэзээ ч зөрөхгүй.
 */
export function describe(action) {
  return actionLabel(action, "en");
}

export { TARGET_INTENTS };
