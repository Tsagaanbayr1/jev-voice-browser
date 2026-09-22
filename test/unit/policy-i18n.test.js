/**
 * Policy үр дүнгийн key-тэй хагас: хуудсанд өгөгдөх `summaryKey` / `noteKey` бүр
 * ХОЁР хэлэнд resolve хийх ёстой, мөн өөрөө гэж хэлдэг англи нь key-гээс
 * үнэхээр render хийгдэх англитай тэнцэх ёстой. Энэ л "key-тэй болгосон ч
 * монголоо мартсан" эсвэл "string-ийг зассан, key-г биш" гэдгийг хэрэглэгчид
 * хүрэхээс сэргийлдэг — browser хэрэггүйгээр.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, describe } from "../../src/policy.js";
import { T, PAYLOAD_SILENCE_MS } from "../../src/constants.js";
import { t, has, actionLabel, STRINGS, UI_LANGUAGES } from "../../src/public/i18n.js";

const choice = (c, conf = 0.95, extra = {}) => ({ type: "choice", choice: c, confidence: conf, probabilities: { [c]: conf, none: 1 - conf, ...extra } });
const snapshot = {
  url: "https://en.wikipedia.org/wiki/Main_Page",
  title: "Wikipedia",
  site: "wikipedia",
  searchBoxId: "e02",
  elements: [
    { id: "e01", role: "link", text: "Main page" },
    { id: "e02", role: "searchbox", text: "", placeholder: "Search Wikipedia" },
    { id: "e04", role: "button", text: "Log in" },
  ],
};
const candidates = { text: [], url: [] };
const base = (over = {}) => ({
  intent: choice("scroll_down"),
  target: choice("none"),
  site: choice("none"),
  complete: { type: "noul", noul: 0.9 },
  is_command: { type: "noul", noul: 0.95 },
  destructive: { type: "noul", noul: 0.05 },
  scroll_amount: { type: "score", score: 1, confidence: 0.9, probabilities: { 0: 0.05, 1: 0.9, 2: 0.05 } },
  tab_direction: choice("none"),
  ...over,
});

/** Decision код бүрд нэг fixture, ингэснээр доорх sweep бүх branch-ийг хамарна. */
const CASES = [
  ["act", { answers: base() }],
  ["act (navigate to a site)", { answers: base({ intent: choice("navigate_url"), site: choice("wikipedia") }) }],
  ["act (navigate to a spoken domain)", { answers: base({ intent: choice("navigate_url"), url_span: choice("example.com", 0.9) }) }],
  ["act (search on a known site)", { answers: base({ intent: choice("search_web"), site: choice("wikipedia"), text_span: choice("муур", 0.9) }) }],
  ["act (search with no site: falls back to the default engine)", { answers: base({ intent: choice("search_web"), text_span: choice("муур", 0.9) }) }],
  ["act (type into a confident target)", { answers: base({ intent: choice("type_into_field"), target: choice("e02", 0.9, { e02: 0.9, none: 0.05 }), text_span: choice("муур", 0.9) }) }],
  ["act (click a confident target)", { answers: base({ intent: choice("click_element"), target: choice("e01", 0.9, { e01: 0.9, none: 0.05 }) }) }],
  ["act (select an option)", { answers: base({ intent: choice("select_option"), target: choice("e04", 0.9, { e04: 0.9, none: 0.05 }), text_span: choice("Монгол", 0.9) }) }],
  ["act (switch tab)", { answers: base({ intent: choice("switch_tab"), tab_direction: choice("previous") }) }],
  ["act (an intent with no dedicated builder)", { answers: base({ intent: choice("reload") }) }],
  ["act (confirming a pending action)", { answers: base({ intent: choice("confirm") }), pending: { type: "click_element", targetId: "e04", label: 'button "Log in"' } }],
  ["cancel", { answers: base({ intent: choice("cancel") }), pending: { type: "click_element", targetId: "e04", label: 'button "Log in"' } }],
  ["ignore", { answers: base({ is_command: { type: "noul", noul: 0.1 } }) }],
  ["wait (no intent)", { answers: base({ intent: choice("none") }) }],
  ["wait (intent too weak)", { answers: base({ intent: choice("scroll_down", 0.2) }) }],
  ["wait (not complete)", { answers: base({ complete: { type: "noul", noul: 0.1 } }) }],
  ["wait (free text not finished)", { answers: base({ intent: choice("search_web"), text_span: choice("муур", 0.9) }) }],
  ["wait (nothing to confirm)", { answers: base({ intent: choice("confirm") }) }],
  ["wait (no destination)", { answers: base({ intent: choice("navigate_url") }) }],
  ["wait (no query text)", { answers: base({ intent: choice("search_web") }) }],
  ["wait (no text to type)", { answers: base({ intent: choice("type_into_field"), target: choice("e02", 0.9, { e02: 0.9 }) }) }],
  ["wait (no plausible element)", { answers: base({ intent: choice("click_element") }) }],
  ["confirm", { answers: base({ intent: choice("click_element"), target: choice("e01", 0.9, { e01: 0.9, none: 0.05 }), destructive: { type: "noul", noul: 0.95 } }) }],
];

function evaluate(over) {
  return evaluatePolicy({ candidates, snapshot, silentMs: 0, isFinal: false, pending: null, ...over });
}

test("policy үр дүн бүр хоёр хэлэнд resolve хийдэг key агуулдаг", () => {
  const seen = new Set();
  for (const [label, over] of CASES) {
    const r = evaluate(over);
    seen.add(r.decision);
    assert.ok(r.summaryKey, `${label}: no summaryKey (decision ${r.decision})`);
    // Key-г аль ч хэлээр render хийхэд бүтэн өгүүлбэр гарах ёстой —
    // дотор нь nest хийгдсэн action-ыг оруулаад. Юу ч resolve хийгдэлгүй үлдэхгүй.
    for (const lang of Object.keys(UI_LANGUAGES)) {
      const rendered = t(lang, r.summaryKey.key, r.summaryKey.params);
      assert.notEqual(rendered, r.summaryKey.key, `${label}: ${r.summaryKey.key} is missing from the ${lang} pack`);
      assert.ok(!rendered.includes("{") && !rendered.includes("[object"), `${label}/${lang}: unresolved: ${rendered}`);
    }
    // Англи string болон key нь ижил зүйл хэлэх ёстой.
    assert.equal(t("en", r.summaryKey.key, r.summaryKey.params), r.summary, `${label}: summary and summaryKey disagree`);
  }
  // Хөдөлгүүрийн буцааж чадах decision код бүр дээрх fixture-үүдэд хамрагдсан.
  assert.deepEqual([...seen].sort(), ["act", "cancel", "confirm", "ignore", "wait"]);
});

test("gate note бүр хоёр хэлэнд resolve хийдэг key агуулдаг", () => {
  for (const [label, over] of CASES) {
    for (const reason of evaluate(over).reasons) {
      const keyed = reason.noteKey;
      if (!keyed) {
        // Энгийн string note бол хуудсын дата (element label): шалгах зүйл байхгүй.
        assert.equal(typeof reason.note, "string");
        continue;
      }
      assert.ok(has("en", keyed.key), `${label}/${reason.name}: unknown key ${keyed.key}`);
      assert.equal(t("en", keyed.key, keyed.params), reason.note, `${label}/${reason.name}: note and noteKey disagree`);
      for (const lang of Object.keys(UI_LANGUAGES)) {
        assert.notEqual(t(lang, keyed.key, keyed.params), keyed.key, `${label}/${reason.name}: missing from the ${lang} pack`);
      }
    }
  }
});

test("summary доторх action render хийгддэг, stringify биш", () => {
  // Summary нь action-ыг урьдчилан render хийсэн англи хэлбэрээр биш, NESTED
  // parts хэлбэрээр агуулдаг — энэ л нэг payload хоёр хэлээр зөв уншигдахыг болгодог.
  const r = evaluate({ answers: base({ intent: choice("navigate_url"), site: choice("wikipedia") }) });
  assert.equal(r.decision, "act");
  assert.equal(r.summary, "open wikipedia", "the English summary is unchanged");
  assert.equal(typeof r.summaryKey.params.action, "object", "the action must stay structured");

  const en = t("en", r.summaryKey.key, r.summaryKey.params);
  const mn = t("mn", r.summaryKey.key, r.summaryKey.params);
  assert.equal(en, "open wikipedia");
  assert.equal(mn, `wikipedia ${STRINGS.mn["action.open"].replace("{target}", "").trim()}`);
  assert.ok(!/[Ѐ-ӿ]/.test(en), "no Mongolian may reach the English rendering");

  // "say confirm to <action>" нь action-ыг өгүүлбэр дотор, орчуулагдсан хэвээр үлдээдэг.
  const c = evaluate({
    answers: base({ intent: choice("click_element"), target: choice("e01", 0.9, { e01: 0.9, none: 0.05 }), destructive: { type: "noul", noul: 0.95 } }),
  });
  assert.equal(c.decision, "confirm");
  assert.equal(c.summary, 'say “confirm” to click link "Main page"');
  const cMn = t("mn", c.summaryKey.key, c.summaryKey.params);
  assert.ok(cMn.includes('link "Main page"'), `the target must survive verbatim: ${cMn}`);
  assert.ok(/[Ѐ-ӿ]/.test(cMn), `expected a translated sentence: ${cMn}`);
});

test("describe() интерфейсийн хэл ямар ч байсан зөвхөн англи", () => {
  // describe() нь model-д pending_confirmation хэлбэрээр хүрдэг. Ямар ч замаар
  // UI хэл авч чадахгүй байх ёстой.
  const action = { type: "click_element", targetId: "e04", label: 'button "Log in"' };
  assert.equal(describe(action), 'click button "Log in"');
  assert.equal(describe(action), actionLabel(action, "en"));
  assert.ok(!/[Ѐ-ӿ]/.test(describe(action)), "Mongolian reached the model-facing describe()");
  // Мөн buildAction-ын тогтоодог label-ууд ч англи.
  for (const [label, over] of CASES) {
    const r = evaluate(over);
    if (!r.action) continue;
    assert.ok(!/[Ѐ-ӿ]/.test(describe(r.action)), `${label}: describe() is not English: ${describe(r.action)}`);
  }
});

test("орчуулсан wrapper доторх датад хэзээ ч хүрдэггүй", () => {
  // Query бол хэрэглэгчийн өөрийн үгс бөгөөд хэл бүрд үгчлэн үлдэх ёстой.
  const r = evaluate({
    answers: base({ intent: choice("search_web"), site: choice("google"), text_span: choice("Алан Туринг", 0.9) }),
    isFinal: true, // free-text payload-ууд хэллэг дууссаны дараа л act хийдэг
  });
  // "open " бол navigate_url-ын урьд өмнө байсан англи wrapper, доторх label нь
  // юу ч гэсэн — describe() яг үүнийг гаргасаар байх ёстой.
  assert.equal(r.summary, "open search google: Алан Туринг");
  for (const [lang, pack] of Object.entries(STRINGS)) {
    const rendered = actionLabel(r.action, lang);
    assert.ok(rendered.includes("Алан Туринг"), `${lang}: the query was altered: ${rendered}`);
    if (lang !== "en") assert.ok(/[Ѐ-ӿ]/.test(rendered), `${lang}: expected a translated wrapper: ${rendered}`);
    assert.ok(pack, "the pack exists");
  }
});

test("free-text wait хэр удаан хүлээхийг key-тэйгээр мэдээлдэг", () => {
  const r = evaluate({ answers: base({ intent: choice("search_web"), text_span: choice("муур", 0.9) }), silentMs: 0, isFinal: false });
  assert.equal(r.decision, "wait");
  assert.equal(r.retryInMs, PAYLOAD_SILENCE_MS);
  assert.equal(t("en", r.summaryKey.key, r.summaryKey.params), r.summary);
});
