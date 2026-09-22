import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STRINGS, t, has, interpolate, makeT, keyCoverage, resolveUiLang, UI_LANGUAGES, DEFAULT_UI_LANG, actionParts, actionLabel } from "../../src/public/i18n.js";
import { questionsForLang, QUESTIONS, MODEL } from "../../src/constants.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// Хоёр хэлэнд зориуд ижил байх утга: төрөл нэр, монгол уншигч латин
// галигаар хүлээдэг техникийн нэр томьёо, англи хэлний жишээ, эсвэл
// зөвхөн placeholder болон цэг таслалаас бүрдсэн template.
const SAME_IN_BOTH = new Set(["stt.provider.duudlaga", "opt.stt.server", "hint.en"]);
const IDENTICAL_OK = /^(hint\.|action\.other$)/;
// Зөвхөн placeholder болон цэг таслалаас бүрдсэн template бүх хэлэнд ижил
// уншигддаг тул тэнд ижил утга байх нь зөв — алдсан орчуулга биш.
const STRUCTURE_ONLY = (tpl) => !/[A-Za-zЀ-ӿ]/.test(tpl.replace(/\{\w+\}/g, ""));

test("key бүр хэл бүрд байдаг", () => {
  const { missingLang } = keyCoverage();
  assert.deepEqual(missingLang, [], "a key present in one pack but not another");
});

test("орчуулга ямар ч placeholder алддаггүй", () => {
  const { paramDrift } = keyCoverage();
  assert.deepEqual(paramDrift, [], "a translation lost or invented a {placeholder}");
});

test("ямар ч хэл англи placeholder хэвээр үлддэггүй", () => {
  // Key нэмээд, дараа нь орчуулна гээд, англи string-ийг монгол гэж
  // гаргах эвдрэлийн горимыг барьдаг.
  const copied = [];
  for (const [key, en] of Object.entries(STRINGS.en)) {
    const mn = STRINGS.mn[key];
    if (mn === undefined || SAME_IN_BOTH.has(key) || IDENTICAL_OK.test(key) || STRUCTURE_ONLY(en)) continue;
    if (mn === en) copied.push(key);
  }
  assert.deepEqual(copied, [], "these keys have an untranslated English value in the mn pack");
});

test("хүснэгт интерфейсийн санал болгодог хэлнүүдийг яг мэддэг", () => {
  assert.deepEqual(Object.keys(STRINGS).sort(), Object.keys(UI_LANGUAGES).sort());
  assert.ok(UI_LANGUAGES[DEFAULT_UI_LANG], "the default language must be one of them");
});

test("танихгүй хэлний код шидэхийн оронд fallback хийдэг", () => {
  assert.equal(resolveUiLang("klingon"), DEFAULT_UI_LANG);
  assert.equal(resolveUiLang(undefined), DEFAULT_UI_LANG);
  assert.equal(resolveUiLang("MN"), "mn", "codes are matched case-insensitively");
  assert.equal(t("klingon", "card.log"), t("en", "card.log"));
});

test("байхгүй key чанга дуугардаг, дуугүй биш", () => {
  assert.equal(t("en", "no.such.key"), "no.such.key");
  assert.equal(has("en", "card.log"), true);
  assert.equal(has("en", "no.such.key"), false);
});

test("interpolation placeholder-уудыг дүүргэж, хэллэгүүдийг nest хийж, хоосон зайг харагдуулна", () => {
  assert.equal(interpolate("a {x} b", { x: 1 }), "a 1 b");
  assert.equal(interpolate("a {x} b", {}), "a {x} b", "an unfilled placeholder stays visible");
  assert.equal(interpolate("{n} tabs", { n: 0 }), "0 tabs", "zero is a value, not an absence");
  // Nested хэллэг stringify хийгдэхийн оронд нэг л хэлээр render хийдэг.
  const nested = interpolate("open {target}", { target: { key: "label.searchBox" } }, "mn");
  assert.equal(nested, `open ${STRINGS.mn["label.searchBox"]}`);
});

test("makeT олон lookup-д нэг хэлийг тогтоодог", () => {
  const mn = makeT("mn");
  assert.equal(mn("card.log"), STRINGS.mn["card.log"]);
  assert.equal(mn("pill.model", { model: MODEL }), STRINGS.mn["pill.model"].replace("{model}", MODEL));
});

// ---------------------------------------------------------------------------
// Action-ын толь бичиг нь model prompt-той хуваалцдаг. Эдгээр нь үүнийг pin хийдэг.
// ---------------------------------------------------------------------------

test("actionParts wrapper-ыг датагаас салгадаг", () => {
  const parts = actionParts({ type: "click_element", targetId: "e03", label: 'link "Docs"' });
  assert.deepEqual(parts, { key: "action.click", params: { target: 'link "Docs"' } });
  // Өөрийн гэсэн wrapper-гүй action нь зөвхөн buildAction хэлсэн үед л key-тэй болдог.
  assert.equal(actionParts({ type: "go_back", label: "undo (back)" }), null);
  assert.equal(actionParts(null), null);
});

test("action аль ч замаар англиар ижил уншигддаг", () => {
  // policy.describe() нь actionParts("en")-ыг render хийдэг; хуудас нь actionLabel()-ийг.
  // Эдгээр зөрвөл model болон уншигчид өөр өөр зүйл хэлэгдэнэ.
  const actions = [
    { type: "navigate_url", url: "https://mn.wikipedia.org/", label: "wikipedia" },
    { type: "click_element", targetId: "e01", label: 'link "Search"' },
    { type: "type_into_field", targetId: "e02", text: "муур", submit: true, label: "search box" },
    { type: "select_option", targetId: "e04", text: "Монгол", label: "combobox" },
    { type: "go_back", label: "undo (back)" },
  ];
  for (const a of actions) {
    const parts = actionParts(a);
    if (parts) assert.equal(actionLabel(a, "en"), t("en", parts.key, parts.params), a.type);
  }
  assert.equal(actionLabel(actions[0], "en"), "open wikipedia");
  assert.equal(actionLabel(actions[1], "en"), 'click link "Search"');
  assert.equal(actionLabel(actions[2], "en"), 'type "муур" into search box + enter');
  assert.equal(actionLabel(actions[4], "en"), "undo (back)", "an unkeyed label is used as-is");

  // Монгол хэл ижил орчуулагдаагүй датаг тойрон дарааллыг өөрчилдөг: element label
  // болон бичсэн текст хэзээ ч орчуулагдахгүй, зөвхөн эргэн тойрны үгс.
  const mn = actionLabel(actions[1], "mn");
  assert.ok(mn.includes('link "Search"'), `target must survive verbatim: ${mn}`);
  assert.ok(/[Ѐ-ӿ]/.test(mn), `expected a translated wrapper: ${mn}`);
});

test("action агуулсан summary нь action-ыг nested parts хэлбэрээр авдаг", () => {
  // Summary template-үүд action-ыг placeholder хэлбэрээр агуулах ёстой, nest нь
  // stringify хийхийн оронд уншигчийн хэлээр render хийх ёстой.
  for (const lang of Object.keys(STRINGS)) {
    assert.ok(STRINGS[lang]["summary.needConfirm"].includes("{action}"), `${lang} lost the action placeholder`);
  }
  const filled = t("mn", "summary.needConfirm", { action: actionParts({ type: "click_element", targetId: "e1", label: 'товч "Устгах"' }) });
  assert.ok(filled.includes('товч "Устгах"'), `the target must survive verbatim: ${filled}`);
  assert.ok(!filled.includes("{") && !filled.includes("[object"), `unresolved: ${filled}`);
});

// ---------------------------------------------------------------------------
// Хатуу хязгаарлалт — конвенц биш, байнгын болгосон.
// ---------------------------------------------------------------------------

test("model prompt хэзээ ч UI-хэлний хамаарал олж авдаггүй", () => {
  // constants.js бол Jev-ээс асуудаг зүйл, орчуулсан асуулт нь gate-ийн
  // зан төлөвийг дуугүй өөрчлөх байсан. Хоёр бие даасан шалгалт:
  //   1. энэ нь хүснэгтэд хүрч чадахгүй, ба
  //   2. англи асуултын багц нь хөлдөөсөн QUESTIONS-тай byte-аараа ижил.
  // questionsForLang("mn") монголыг НЭМЭХ эрхтэй — гэхдээ зөвхөн
  // баримтжуулсан дөрвөн hook-оор (examples, scrollAmountWords, siteAliases, focus
  // note), доорх "— spoken in …" assertion-ууд үүнийг pin хийдэг.
  const src = read("src/constants.js");
  assert.ok(!/\bi18n\b/.test(src), "constants.js must not reference the UI strings table");
  assert.ok(!/public\/i18n/.test(src), "constants.js must not import the UI strings table");

  const q = questionsForLang("en");
  assert.deepEqual(q, QUESTIONS, "the English pack must be returned untouched");
  assert.ok(!/[Ѐ-ӿ]/.test(JSON.stringify(q)), "Mongolian leaked into the English question set");
});

test("questionsForLang зөвхөн нэмдэг, зөвхөн баримтжуулсан hook-ууддаа", () => {
  // Өмнөх тестийн баталгаажуулсан хил хязгаарыг хамгаална: ирээдүйд монголын
  // төлөө `what` / `not_for`-ийг дахин бичиж эхэлбэл дуугүй prompt өөрчлөлт
  // биш, алдагдсан англи асуулт хэлбэрээр илэрнэ.
  const en = questionsForLang("en");
  const mn = questionsForLang("mn");
  for (const key of Object.keys(en)) {
    if (!en[key] || typeof en[key] !== "object") continue;
    const focus = en[key].instructions?.focus;
    if (focus) assert.ok(mn[key].instructions.focus.startsWith(focus), `${key}.instructions.focus was rewritten`);
    if (key === "site") continue; // criteria бол string map, байрандаа өргөтгөгддөг
    for (const [name, crit] of Object.entries(en[key].criteria ?? {})) {
      if (!crit || typeof crit !== "object") continue;
      const mine = mn[key].criteria[name];
      if (crit.what) assert.ok(mine.what.startsWith(crit.what), `${key}.criteria.${name}.what was rewritten`);
      assert.deepEqual(crit.not_for, mine.not_for, `${key}.criteria.${name}.not_for changed`);
      const before = crit.examples ?? [];
      const after = mine.examples ?? [];
      assert.deepEqual(after.slice(0, before.length), before, `${key}.criteria.${name}.examples must be appended to, never replaced`);
    }
  }
});

test("сервер model зам дээр describe()-ийг англи хэвээр үлдээдэг", () => {
  const controller = read("src/controller.js");
  // pendingConfirmation бол UI орчуулга Jev-ийн уншдаг зүйлийг өөрчлөх цорын ганц
  // газар. Энэ нь англи хэлэнд pin хийгдсэн describe() хэвээр үлдэх ёстой.
  assert.match(controller, /pendingConfirmation:\s*this\.pending\s*\?\s*describe\(this\.pending\)/);
  const policy = read("src/policy.js");
  assert.match(policy, /export function describe\(action\)/, "describe() must stay exported for the model path");
});

// ---------------------------------------------------------------------------
// Статик sweep: эх код дээр нэрлэсэн key бүр байх ёстой. Энд алдаа гарвал
// throw хийхгүй — `t` key-ээ буцаадаг — тул дэлгэцэн дээр "log.acted"
// хэлбэрээр гарна. Энэ л чанга дуугардаг-key загварыг найдвартай болгодог.
// ---------------------------------------------------------------------------

test("хуудас болон серверийн гараар нэрлэсэн key бүр хүснэгтэд байдаг", () => {
  const files = ["src/public/index.html", "src/public/recorder.js", "src/controller.js", "src/policy.js", "src/server.js", "src/executor.js"];
  // Зөвхөн хашилттай literal: computed key (`tr(key, params)`, `hint.${lang}`)-д
  // статикаар шалгах зүйл байхгүй, түүний runtime зам өөр газар хамрагдсан.
  const CALL = /(?:^|[^\w.$])(?:tr|t|has|makeT|_log|logEvent|status|sum|label|detail|check)\(([^)]*)\)/g;
  const LITERAL = /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g;
  const ATTR = /data-i18n(?:-title|-placeholder)="([^"]+)"/g;

  const named = new Map(); // key -> хаана
  const add = (key, where) => { if (!named.has(key)) named.set(key, where); };
  for (const rel of files) {
    const text = read(rel);
    for (const call of text.matchAll(CALL)) for (const lit of call[1].matchAll(LITERAL)) add(lit[1], rel);
    for (const attr of text.matchAll(ATTR)) add(attr[1], rel);
  }
  assert.ok(named.size > 40, `expected the sweep to find the real key set, found ${named.size}`);
  const unknown = [...named].filter(([key]) => !has("en", key)).map(([key, where]) => `${key} (${where})`);
  assert.deepEqual(unknown, [], "these keys are named in the source but missing from the table");

  // Мөн тэдгээр бүр монгол хэлэнд байх ёстой, эс бөгөөс уншигч key харна.
  const untranslated = [...named.keys()].filter((key) => !has("mn", key));
  assert.deepEqual(untranslated, [], "named in the source, missing from the mn pack");

  // Хуудас жишээ hint-ээ ЯРИГДАХ хэлээр сонгодог тул хоёулаа байх ёстой.
  for (const lang of Object.keys(UI_LANGUAGES)) assert.ok(has(lang, `hint.${lang}`), `hint.${lang} is missing`);
});
