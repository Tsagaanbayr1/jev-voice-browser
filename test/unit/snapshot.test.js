import { test } from "node:test";
import assert from "node:assert/strict";
import { compactElements, detectSite, findSearchBox, approxTokens } from "../../src/snapshot.js";
import { buildRequest, encodeElement } from "../../src/jev.js";
import { MAX_ELEMENTS, MAX_STATE_CHARS } from "../../src/constants.js";

const raw = (i, over = {}) => ({
  id: `e${String(i).padStart(2, "0")}`,
  tag: "a",
  role: "link",
  text: `Link number ${i}`,
  placeholder: "",
  href: `example.com/${i}`,
  type: "",
  inputName: "",
  inViewport: i % 2 === 0,
  top: i * 20,
  left: 0,
  ...over,
});

test("compactElements: viewport-visible first, then by position", () => {
  const els = [raw(1, { inViewport: false, top: 10 }), raw(2, { inViewport: true, top: 500 }), raw(3, { inViewport: true, top: 100 })];
  const out = compactElements(els);
  assert.deepEqual(
    out.map((e) => e.id),
    ["e03", "e02", "e01"],
  );
  assert.equal(out[2].below_fold, true);
  assert.equal(out[0].below_fold, undefined);
});

test("compactElements: dedupes identical (role, text, href) and drops nameless non-inputs", () => {
  const els = [raw(1), raw(2, { text: "Link number 1", href: "example.com/1" }), raw(3, { text: "", href: "" }), raw(4, { role: "textbox", tag: "input", text: "", placeholder: "" })];
  const out = compactElements(els);
  assert.deepEqual(
    out.map((e) => e.id),
    ["e02", "e04"], // эхлээд viewport доторх (тэгш id), байрлалаараа; e01 нь e02-той давхцана (эхэлж харагдсан); e03 нэргүй холбоос хасагдана
  );
});

test("compactElements: truncates long text and caps count", () => {
  const els = Array.from({ length: 400 }, (_, i) => raw(i + 1, { text: "x".repeat(300) + i }));
  const out = compactElements(els);
  assert.ok(out.length <= MAX_ELEMENTS);
  assert.ok(out.every((e) => e.text.length <= 60));
});

test("compactElements: таслах цэг суррогат хосыг (emoji) дундуур нь хуваахгүй", () => {
  // `truncate(s, n)` нь n-1 тэмдэгт авдаг тул хосын өндөр хагас нь n-2 индекс дээр
  // тулбол хуваагдана: text 60 → 58, href 50 → 48, placeholder 40 → 38. Хуваагдсан
  // хагас нь хүчингүй Unicode бөгөөд Jev API бүх хүсэлтийг 400-аар үгүйсгэдэг.
  const lone = (s) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const prev = s.charCodeAt(i - 1);
      const next = s.charCodeAt(i + 1);
      if (c >= 0xd800 && c <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff)) return i;
      if (c >= 0xdc00 && c <= 0xdfff && !(prev >= 0xd800 && prev <= 0xdbff)) return i;
    }
    return -1;
  };

  // Гурвуулаа яг таслах цэг дээрээ emoji-той нэг element.
  const withEmoji = (prefix, tail = "😀 төгсгөл") => "b".repeat(prefix) + tail;
  const [el] = compactElements([
    raw(1, { text: withEmoji(58), href: withEmoji(48), placeholder: withEmoji(38) }),
  ]);
  for (const field of ["text", "placeholder", "href"]) {
    assert.ok(el[field], `${field} байх ёстой`);
    assert.equal(lone(el[field]), -1, `${field}: ${JSON.stringify(el[field])}`);
  }

  // Бүх зэргэлдээ таслалтууд дээр ч ганц бие суррогат гарахгүй.
  for (let prefix = 36; prefix <= 62; prefix++) {
    const [e] = compactElements([raw(1, { text: withEmoji(prefix), href: withEmoji(prefix), placeholder: withEmoji(prefix) })]);
    for (const field of ["text", "placeholder", "href"]) {
      if (e[field]) assert.equal(lone(e[field]), -1, `${field} @ ${prefix}: ${JSON.stringify(e[field])}`);
    }
  }
});

test("compactElements: state size guard keeps the serialized list under budget", () => {
  const els = Array.from({ length: 250 }, (_, i) => raw(i + 1, { text: `Unique headline ${i} ` + "lorem ipsum dolor ".repeat(3), href: `site${i}.example.com/path/${i}` }));
  const out = compactElements(els, { maxChars: 3000 });
  assert.ok(JSON.stringify(out).length <= 3000, "shrunk to fit");
  assert.ok(out.length >= 5);
});

test("buildRequest: full state stays far below the 32k-token limit even with the max element list", () => {
  const els = Array.from({ length: 400 }, (_, i) => raw(i + 1, { text: `Some fairly long link label number ${i} about a topic`, href: `news.example.com/story/${i}` }));
  const snapshot = { url: "https://news.example.com/", title: "News", site: "generic", elements: compactElements(els) };
  const { state, questions } = buildRequest({ transcript: "click the first story", snapshot });
  assert.ok(JSON.stringify(state).length <= MAX_STATE_CHARS);
  assert.ok(approxTokens(state) < 8000, `state ~${approxTokens(state)} tokens`);
  assert.ok(Object.keys(questions.target.criteria).length <= MAX_ELEMENTS + 1);
  assert.equal(questions.target.criteria.none !== undefined, true);
  assert.equal(state.elements.length, snapshot.elements.length);
  assert.ok(state.elements[0].startsWith("e02 link"), state.elements[0]);
});

test("buildRequest: text_span / url_span only present when there are candidates; options are verbatim", () => {
  const snapshot = { url: "about:blank", title: "", site: "blank", elements: [] };
  const a = buildRequest({ transcript: "scroll down", snapshot });
  assert.equal(a.questions.url_span, undefined);
  const b = buildRequest({ transcript: "type hello world into the search box", snapshot });
  assert.ok("hello world" in b.questions.text_span.criteria);
  assert.ok("none" in b.questions.text_span.criteria);
  const c = buildRequest({ transcript: "open example dot com", snapshot });
  assert.ok("example.com" in c.questions.url_span.criteria);
});

test("buildRequest: state-д ганц бие суррогат хэзээ ч үлдэхгүй (хүчингүй Unicode → API 400)", () => {
  const lone = (s) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const prev = s.charCodeAt(i - 1);
      const next = s.charCodeAt(i + 1);
      if (c >= 0xd800 && c <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff)) return i;
      if (c >= 0xdc00 && c <= 0xdfff && !(prev >= 0xd800 && prev <= 0xdbff)) return i;
    }
    return -1;
  };
  const walk = (v, path = "", out = []) => {
    if (typeof v === "string") {
      if (lone(v) !== -1) out.push(path);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        // criteria-гийн KEY-ууд ч модел руу явдаг (text_span / url_span нь candidate-уудыг key болгодог)
        if (lone(k) !== -1) out.push(`${path}.${k} (key)`);
        walk(x, `${path}.${k}`, out);
      }
    }
    return out;
  };

  // Яг таслах цэг дээр emoji: title 120 → 119, url 200 → 198, transcript 400 (clipEnd).
  const snapshot = {
    url: "https://example.com/" + "b".repeat(180) + "😀 tail",
    title: "a".repeat(119) + "😀 tail",
    site: "example_com",
    elements: compactElements([raw(1, { text: "b".repeat(58) + "😀 tail" })]),
  };
  const clean = buildRequest({ transcript: "go to wikipedia", snapshot });
  assert.deepEqual(walk(clean.state), [], "page title / url / element label");
  assert.equal(lone(clean.state.page.title), -1, clean.state.page.title.slice(-30));

  // clipEnd: сүүлийн 400 тэмдэгт рүү тайрахдаа хосыг хуваахгүй
  const cut = buildRequest({ transcript: "x".repeat(400) + "😀" + "y".repeat(399), snapshot });
  assert.deepEqual(walk(cut.state), [], "transcript таслалт");

  // Recognizer-ээс шууд ирсэн ганц бие суррогат нь U+FFFD болно (API үүнийг хүлээн авдаг)
  const dirty = buildRequest({ transcript: "hello\uD83Dworld", snapshot });
  assert.equal(dirty.state.transcript, "hello�world");
  assert.deepEqual(walk(dirty.state), []);
  // text_span / url_span-ийн CRITERIA KEY-ууд нь transcript-ээс гаргаж авсан candidate-ууд
  assert.deepEqual(walk(dirty.questions), [], "questions-ийн key/value-д ч үлдэхгүй");
  const dirty2 = buildRequest({ transcript: "type \uD83D into the box", snapshot });
  assert.deepEqual(walk(dirty2.state), []);
  assert.deepEqual(walk(dirty2.questions), []);
  assert.ok(Object.keys(dirty2.questions.text_span.criteria).every((k) => lone(k) === -1));

  // context-ийн тайрагддаг талбарууд
  const ctx = buildRequest({
    transcript: "go back",
    snapshot,
    context: {
      previousPage: { url: "u".repeat(199) + "😀 tail", title: "t".repeat(119) + "😀" },
      recentActions: [{ said: "s".repeat(119) + "😀", type: "click_element", targetLabel: "l".repeat(79) + "😀", text: "x".repeat(79) + "😀", url: "z".repeat(199) + "😀", ok: true }],
    },
  });
  assert.deepEqual(walk(ctx.state), [], "context таслалтууд");
});

test("encodeElement: compact line with host only when it differs from the page", () => {
  assert.equal(encodeElement({ id: "e09", role: "link", text: "GitHub", href: "github.com/x" }, "duckduckgo.com"), 'e09 link "GitHub" → github.com');
  assert.equal(encodeElement({ id: "e03", role: "link", text: "new", href: "news.ycombinator.com/newest" }, "news.ycombinator.com"), 'e03 link "new"');
  assert.equal(encodeElement({ id: "e02", role: "textbox", text: "", placeholder: "Search Wikipedia" }), "e02 textbox (placeholder: Search Wikipedia)");
});

test("detectSite", () => {
  assert.equal(detectSite("https://en.wikipedia.org/wiki/Main_Page"), "wikipedia");
  assert.equal(detectSite("https://news.ycombinator.com/newest"), "hacker_news");
  assert.equal(detectSite("https://www.google.com/search?q=x"), "google");
  assert.equal(detectSite("https://example.com/"), "example_com");
  assert.equal(detectSite("https://foo.bar.baz/"), "generic");
  assert.equal(detectSite("about:blank"), "blank");
});

test("findSearchBox prefers role=searchbox / search-ish names", () => {
  const els = [
    raw(1, { role: "textbox", tag: "input", inputName: "username", text: "", placeholder: "Username" }),
    raw(2, { role: "textbox", tag: "input", inputName: "search", text: "", placeholder: "Search Wikipedia" }),
    raw(3, { role: "link" }),
  ];
  assert.equal(findSearchBox(els), "e02");
  assert.equal(findSearchBox([raw(3)]), null);
});
