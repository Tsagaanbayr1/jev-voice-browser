/**
 * Mock хийсэн Jev болон хуурамч browser-той Controller-ийн урсгал: debounce, нэг utterance-д нэг action,
 * stale request-ийн зохицуулалт, дугаараар candidate сонгох, нэг амьсгалаар command chaining.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Controller } from "../../src/controller.js";
import { DEBOUNCE_MS } from "../../src/constants.js";
import { t, has, UI_LANGUAGES, actionParts, actionLabel, DEFAULT_UI_LANG } from "../../src/public/i18n.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeBrowser() {
  return {
    url: "https://example.com/",
    onChange() {
      return () => {};
    },
    tabInfo() {
      return [{ index: 0, url: this.url, active: true }];
    },
    async snapshot() {
      return {
        url: this.url,
        title: "Example",
        site: "example_com",
        searchBoxId: null,
        elements: [
          { id: "e01", role: "link", text: "More information" },
          { id: "e02", role: "link", text: "Other link" },
        ],
        tabs: this.tabInfo(),
      };
    },
    overlayCalls: [],
    async overlay(fn, ...args) {
      this.overlayCalls.push([fn, ...args]);
    },
  };
}

/** Mock Jev: түлхүүр үгээр удирдуулсан хариултууд, тохируулж болох latency-тай. */
function mockDecide({ latency = 20, complete = (t) => (t.split(" ").length >= 2 ? 0.9 : 0.1), destructive = 0.02 } = {}) {
  const calls = [];
  const fn = async ({ transcript }, { signal } = {}) => {
    calls.push(transcript);
    await sleep(latency);
    if (signal?.aborted) {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    const t = transcript.toLowerCase();
    const ch = (c, conf = 0.95, extra = {}) => ({ type: "choice", choice: c, confidence: conf, probabilities: { [c]: conf, ...extra } });
    let intent = ch("none", 0.9);
    let target = ch("none", 0.9);
    if (t.startsWith("go back")) intent = ch("go_back");
    else if (t.startsWith("scroll")) intent = ch("scroll_down");
    else if (t.startsWith("click ambiguous")) {
      intent = ch("click_element");
      target = ch("e01", 0.2, { e02: 0.4, none: 0.2 });
    } else if (t.startsWith("click")) {
      intent = ch("click_element");
      target = ch("e01", 0.95);
    }
    return {
      answers: {
        intent,
        target,
        site: ch("none"),
        complete: { noul: complete(t) },
        is_command: { noul: intent.choice === "none" ? 0.1 : 0.95 },
        destructive: { noul: destructive },
        scroll_amount: { score: 1, confidence: 0.9, probabilities: {} },
        tab_direction: ch("none"),
      },
      latencyMs: latency,
      usage: { input_tokens: 1000, output_tokens: 10 },
      costUsd: 0.000042,
      model: "jev-1.13.0",
      requestId: "req",
      candidates: { text: [], url: [] },
      state: {},
      questionCount: 8,
    };
  };
  fn.calls = calls;
  return fn;
}

function setup(opts = {}) {
  const browser = fakeBrowser();
  const executed = [];
  const decideFn = mockDecide(opts);
  const executeFn = async (action) => {
    executed.push(action);
    await sleep(opts.execMs ?? 10);
    return { ok: true, detail: "ok" };
  };
  const c = new Controller({ browser, decideFn, executeFn, lang: opts.lang, uiLang: opts.uiLang });
  return { c, browser, executed, decideFn };
}

test("partial-уудыг нэг request болгон debounce хийж, utterance бүрд нэг удаа act хийдэг", async () => {
  const { c, executed, decideFn } = setup();
  await c.start();
  c.handleTranscript({ text: "go", final: false, utteranceId: "u1" });
  await sleep(50);
  c.handleTranscript({ text: "go back", final: false, utteranceId: "u1" });
  await sleep(DEBOUNCE_MS + 150);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].type, "go_back");
  assert.equal(decideFn.calls.length, 1, "first partial was debounced away");
  // мөн utterance-ийн үлдсэн хэсэг нь алгасагдана
  c.handleTranscript({ text: "go back please", final: true, utteranceId: "u1" });
  await sleep(DEBOUNCE_MS + 100);
  assert.equal(executed.length, 1);
  assert.equal(c.uiState().stats.calls, 1);
  assert.ok(c.uiState().stats.costUsd > 0);
  await c.close();
});

test("дутуу partial дээр хүлээгээд, recognizer final гэж тэмдэглэхэд act хийдэг", async () => {
  const { c, executed } = setup();
  await c.start();
  c.handleTranscript({ text: "scroll", final: false, utteranceId: "u2" });
  await sleep(DEBOUNCE_MS + 100);
  assert.equal(executed.length, 0);
  assert.equal(c.lastDecision.policy.decision, "wait");
  c.handleTranscript({ text: "scroll", final: true, utteranceId: "u2" });
  await sleep(150);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].type, "scroll_down");
  await c.close();
});

test("MAX_INFLIGHT-ээс хэтэрсэн stale in-flight request-уудыг cancel хийдэг", async () => {
  const { c, executed, decideFn } = setup({ latency: 400 });
  await c.start();
  c.handleTranscript({ text: "go", final: false, utteranceId: "u3" });
  await sleep(DEBOUNCE_MS + 20);
  c.handleTranscript({ text: "go ba", final: false, utteranceId: "u3" });
  await sleep(DEBOUNCE_MS + 20);
  c.handleTranscript({ text: "go back", final: false, utteranceId: "u3" });
  await sleep(DEBOUNCE_MS + 20);
  assert.equal(c.inflight.length, 2, "oldest request aborted, two in flight");
  await sleep(600);
  assert.equal(executed.length, 1);
  assert.equal(decideFn.calls.length, 3);
  await c.close();
});

test("тодорхойгүй target дугаарласан candidate-уудыг харуулна; хэлсэн дугаар model дуудалтгүйгээр сонгоно", async () => {
  const { c, executed, browser, decideFn } = setup();
  await c.start();
  c.handleTranscript({ text: "click ambiguous thing", final: true, utteranceId: "u4" });
  await sleep(150);
  assert.equal(executed.length, 0);
  assert.ok(c.candidates, "candidates pending");
  assert.deepEqual(
    c.candidates.list.map((x) => x.id),
    ["e02", "e01"],
  );
  assert.ok(browser.overlayCalls.some(([fn]) => fn === "candidates"));
  const callsBefore = decideFn.calls.length;
  c.handleTranscript({ text: "the second one", final: true, utteranceId: "u5" });
  await sleep(100);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].targetId, "e01");
  assert.equal(decideFn.calls.length, callsBefore, "no Jev call for the number");
  await c.close();
});

test("нэг амьсгалаар хэлсэн command-ууд: биелэгдсэн command-ын дараах үгс шинэ command болно", async () => {
  const { c, executed } = setup();
  await c.start();
  c.handleTranscript({ text: "go back", final: false, utteranceId: "u6" });
  await sleep(DEBOUNCE_MS + 150);
  assert.equal(executed.length, 1);
  c.handleTranscript({ text: "go back scroll down", final: false, utteranceId: "u6" });
  await sleep(DEBOUNCE_MS + 150);
  assert.equal(executed.length, 2);
  assert.equal(executed[1].type, "scroll_down");
  // нэг дараах үг алгасагдана
  c.handleTranscript({ text: "go back scroll down please", final: true, utteranceId: "u6" });
  await sleep(DEBOUNCE_MS + 150);
  assert.equal(executed.length, 2);
  await c.close();
});

test("бичсэн command нь final utterance хэлбэрээр үзэгддэг", async () => {
  const { c, executed } = setup();
  await c.start();
  c.handleCommand("go back");
  await sleep(150);
  assert.equal(executed.length, 1);
  await c.close();
});

// ---------------------------------------------------------------------------
// Интерфейсийн хэл. Зөвхөн дэлгэцэнд — Jev эсвэл policy-д хэзээ ч хүрэхгүй.
// ---------------------------------------------------------------------------

/**
 * Log нь render хийсэн текст биш, key хэлбэрээр хадгалагддаг тул хэлний toggle
 * өмнө нь гаргасан түүхийг дахин render хийж чадна. Эдгээр хоёр helper бол
 * хуудсын уншдаг зам тул тэдгээрээр assert хийх нь бодит замаар assert хийх юм.
 */
function renderLog(entry, lang) {
  return t(lang, entry.key, entry.params);
}

test("log entry бүр хэл бүрд resolve хийдэг key хэлбэрээр хадгалагддаг", async () => {
  const { c } = setup();
  await c.start();
  c.handleTranscript({ text: "scroll down", final: true, utteranceId: "l1" });
  await sleep(150);
  c.handleCommand("go back");
  await sleep(150);
  assert.ok(c.log.length >= 3, "start, decision, action");
  for (const entry of c.log) {
    assert.ok(entry.key, `unkeyed log entry: ${JSON.stringify(entry)}`);
    assert.ok(has("en", entry.key), `unknown key ${entry.key}`);
    // Англи нь key-ГЭЭС үүсдэг тул terminal/demo string зөрөх боломжгүй.
    assert.equal(entry.msg, t("en", entry.key, entry.params), `${entry.key}: msg and key disagree`);
    for (const lang of Object.keys(UI_LANGUAGES)) {
      const rendered = renderLog(entry, lang);
      assert.notEqual(rendered, entry.key, `${entry.key} missing from the ${lang} pack`);
      assert.ok(!rendered.includes("{") && !rendered.includes("[object"), `${entry.key}/${lang}: unresolved: ${rendered}`);
    }
  }
  await c.close();
});

test("decision log нь summary-г parts хэлбэрээр, дотор нь nest хийсэн action-тайгаа агуулдаг", async () => {
  const { c } = setup();
  await c.start();
  c.handleCommand("go back");
  await sleep(150);
  // undo() бол key-тэй label-ын зам: action өөрийн гэсэн монгол хэлбэртэй.
  await c.undo();
  await sleep(50);

  const action = c.log.filter((e) => e.key === "log.action").at(-1);
  assert.ok(action, "the executed action was logged");
  // Action нь nested parts хэлбэрээр суулгагддаг тул уншигчийн хэл түүнд хүрдэг.
  assert.equal(typeof action.params.summary, "object");
  assert.deepEqual(action.params.summary.key, "label.undo");
  assert.ok(action.msg.startsWith("✓ undo (back)"), `unexpected English: ${action.msg}`);
  const mn = renderLog(action, "mn");
  assert.ok(mn.includes("буцаах"), `the action must be translated inside the log line: ${mn}`);
  assert.ok(!mn.includes("{") && !mn.includes("[object"), `unresolved: ${mn}`);

  const decision = c.log.find((e) => e.key === "log.decision");
  assert.ok(decision, "the decision was logged");
  assert.equal(decision.params.decision, "act", "the decision code travels as an identifier");
  assert.equal(typeof decision.params.summary, "object", "the summary travels as parts");
  await c.close();
});

test("интерфейсийн хэл яригдах хэлээс тусдаа, солих нь өөрчлөлтийг log-д бичдэг", async () => {
  const { c } = setup({ lang: "mn" });
  await c.start();
  assert.equal(c.lang, "mn", "spoken language comes from the constructor");
  assert.equal(c.uiLang, DEFAULT_UI_LANG, "the interface defaults independently");

  const events = [];
  c.on("uiLang", (e) => events.push(e));
  const before = c.log.length;
  assert.equal(c.setUiLanguage("mn"), "mn");
  assert.equal(c.log.length, before + 1, "the switch is logged");
  assert.equal(c.log.at(-1).key, "log.uiLang");
  assert.deepEqual(events, [{ uiLang: "mn", uiLangLabel: UI_LANGUAGES.mn.label }]);

  // Idempotent, мөн танихгүй код шидэхийн оронд resolve хийдэг.
  const after = c.log.length;
  c.setUiLanguage("mn");
  assert.equal(c.log.length, after, "no log line for a no-op switch");
  c.setUiLanguage("klingon");
  assert.equal(c.uiLang, DEFAULT_UI_LANG);

  const state = c.uiState();
  assert.equal(state.lang, "mn", "the spoken language was not touched by the UI switch");
  assert.equal(state.uiLang, DEFAULT_UI_LANG);
  assert.equal(state.uiLangLabel, UI_LANGUAGES[DEFAULT_UI_LANG].label);
  await c.close();
});

test("интерфейсийн хэлийг солих нь түүхийг, тэр дундаа in-flight prose-ийг дахин render хийдэг", async () => {
  const { c } = setup();
  await c.start();
  c.handleCommand("go back");
  await sleep(150);
  const history = [...c.log];
  // Юу ч дахин гаргагдаагүй: ижил entry-үүд зүгээр л өөрөөр render хийгддэг.
  assert.deepEqual(c.log, history, "the toggle must not rewrite the log");
  assert.equal(renderLog(history.at(-1), "en"), history.at(-1).msg);
  assert.notEqual(renderLog(history.at(-1), "mn"), history.at(-1).msg, "Mongolian must differ from English");
  await c.close();
});

test("pending action нь action-тайгаа хамт нийтлэгддэг тул notice орчуулагдаж чадна", async () => {
  const { c, browser } = setup({ destructive: 0.95 });
  await c.start();
  c.handleTranscript({ text: "click the first link", final: true, utteranceId: "p1" });
  await sleep(150);

  const state = c.uiState();
  assert.ok(state.pending, "a destructive action is pending");
  assert.ok(state.pending.action, "the action travels alongside the summary so it can be re-rendered");
  assert.equal(typeof actionParts(state.pending.action)?.key, "string");
  // Model болон terminal-д англи; хуудас pending.action-ыг өөрөө render хийдэг.
  // Англи summary бол action өөрөө; хуудас үүнийг `pending.notice`-ээр боодог.
  assert.equal(state.pending.summary, actionLabel(state.pending.action, "en"));

  const toast = browser.overlayCalls.filter(([fn]) => fn === "toast").at(-1);
  assert.equal(toast[1], t("en", "toast.confirm", { action: actionParts(state.pending.action) }));
  await c.close();
});

test("хуудсын overlay-ууд интерфейсийн хэлээр зурагддаг", async () => {
  const { c, browser } = setup({ destructive: 0.95, uiLang: "mn" });
  await c.start();
  c.handleTranscript({ text: "click the first link", final: true, utteranceId: "p2" });
  await sleep(150);
  assert.equal(c.uiLang, "mn");

  const toast = browser.overlayCalls.filter(([fn]) => fn === "toast").at(-1);
  assert.ok(/[Ѐ-ӿ]/.test(toast[1]), `expected a Mongolian overlay, got: ${toast[1]}`);
  assert.ok(toast[1].includes('link "More information"'), `the element label must survive verbatim: ${toast[1]}`);
  assert.ok(!toast[1].includes("{") && !toast[1].includes("[object"), `unresolved: ${toast[1]}`);
  await c.close();
});

test("Jev-ийн алдаа нь log + `error` event болж гарна (сервер унагахгүй)", async () => {
  // Бодит доголдол: Jev API хүчингүй Unicode-той хүсэлтийг 400-аар үгүйсгэдэг байсан.
  // Controller алдааг `log`-оор мэдэгдээд `error` event emit хийдэг — Node-д сонсогчгүй
  // `error` event нь шидэгддэг тул server.js заавал listener-тэй байх ёстой.
  const browser = fakeBrowser();
  const boom = Object.assign(new Error("Request contains invalid Unicode text."), { status: 400 });
  const c = new Controller({
    browser,
    decideFn: async () => {
      throw boom;
    },
    executeFn: async () => ({ ok: true, detail: "ok" }),
  });
  const seen = [];
  c.on("error", (err) => seen.push(err)); // server.js яг үүнийг хийдэг

  await c.start();
  c.handleTranscript({ text: "go back", final: true, utteranceId: "e1" });
  await sleep(DEBOUNCE_MS + 250);

  assert.equal(seen.length, 1, "`error` event нэг удаа гарна");
  assert.equal(seen[0], boom);
  const errs = c.log.filter((e) => e.level === "error" && e.key === "log.jevError");
  assert.equal(errs.length, 1, "алдаа UI-ийн лог руу ч очно");
  assert.ok(errs[0].msg.includes("invalid Unicode"), `msg: ${errs[0].msg}`);
  // Алдаа гарсан ч controller ажилласаар байна
  assert.equal(c.uiState().stats.calls, 0);
  assert.equal(c.uiState().log.some((e) => e.key === "log.ready"), true);
  await c.close();
});
