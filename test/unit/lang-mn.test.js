import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextCandidates,
  extractUrlCandidates,
  normalizeSpokenUrl,
  parseCandidatePick,
} from "../../src/spans.js";
import { questionsForLang, sitesFor } from "../../src/constants.js";
import { getLang, packForTranscript } from "../../src/lang.js";

// Монгол хэл үйл үгээр төгсдөг: payload нь үйл үгээс ӨМНӨ, түүнээс өмнө нь
// очих газар ирдэг. Эдгээр нь англи parsing буруу хийдэг тохиолдлууд.

test("mn: payload нь үйл үгээс өмнө ('Алан Туринг хай' = search for Alan Turing)", () => {
  assert.equal(extractTextCandidates("Алан Туринг хай", "mn")[0], "Алан Туринг");
  assert.equal(extractTextCandidates("нисэх тийз хайх", "mn")[0], "нисэх тийз");
});

test("mn: эхэнд нэрлэсэн сайт хасч хаягдана ('википедиа дээр муур хай')", () => {
  const c = extractTextCandidates("википедиа дээр муур хай", "mn");
  assert.equal(c[0], "муур");
  assert.ok(c.includes("википедиа дээр муур"), "looser form kept as a fallback");
});

test("mn: эхэнд нэрлэсэн очих газар хасч хаягдана ('хайлтын талбарт ... гэж бич')", () => {
  assert.equal(extractTextCandidates("хайлтын талбарт сайн байна уу гэж бич", "mn")[0], "сайн байна уу");
});

test("mn: бүтэн transcript нь үргэлж fallback candidate", () => {
  const c = extractTextCandidates("Алан Туринг хай", "mn");
  assert.ok(c.includes("Алан Туринг хай"));
  assert.ok(c.length <= 8);
});

test("mn: хэлсэн domain-ууд, кирилл TLD-ийг оруулаад", () => {
  // \b нь JS regex-д зөвхөн ASCII бөгөөд кирилл үсгийн дараа хэзээ ч ажиллахгүй.
  assert.equal(normalizeSpokenUrl("жишээ цэг ком", "mn"), "жишээ.com");
  assert.deepEqual(extractUrlCandidates("жишээ цэг ком руу яв", "mn"), ["жишээ.com"]);
  assert.deepEqual(extractUrlCandidates("example цэг com руу яв", "mn"), ["example.com"]);
});

test("mn: хэлсэн тоонууд дугаарласан overlay-г сонгоно", () => {
  assert.equal(parseCandidatePick("хоёр", 5, "mn"), 2);
  assert.equal(parseCandidatePick("хоёр дахь", 5, "mn"), 2);
  assert.equal(parseCandidatePick("эхний", 5, "mn"), 1);
  assert.equal(parseCandidatePick("гурав дугаар", 5, "mn"), 3);
  assert.equal(parseCandidatePick("долоо", 5, "mn"), null, "out of range / unknown word");
});

test("selector англи гэж хэлсэн ч кирилл нь монгол гэж parse хийгддэг", () => {
  // Кирилл нь монголыг албаддаг тул буруу тавьсан selector нь тодорхой монголоор
  // ярьж буй хүний extraction-ыг дуугүй эвдэж чадахгүй.
  assert.equal(packForTranscript("Алан Туринг хай", "en").code, "mn");
  assert.equal(extractTextCandidates("Алан Туринг хай")[0], "Алан Туринг");
  // Кириллгүй бол сонгосон хэл л шийднэ: латин текстэд (transliteration, brand
  // name, "enter дар") монгол сонгогдсон хэвээр үлддэг.
  assert.equal(packForTranscript("search for cats", "mn").code, "mn");
  assert.equal(packForTranscript("search for cats", "en").code, "en");
});

test("mn асуултууд монгол жишээнүүдтэй; англи асуултууд хөндөгдөөгүй", () => {
  const mnQ = questionsForLang("mn");
  const enQ = questionsForLang("en");
  assert.ok(mnQ.intent.criteria.go_back.examples.includes("буцах"));
  assert.ok(mnQ.is_command.criteria.true.examples.includes("Алан Туринг хай"));
  assert.ok(mnQ.site.criteria.wikipedia.includes("википедиа"));
  assert.ok(/Монгол/.test(mnQ.intent.instructions.focus), "the spoken language is named in the question");

  assert.deepEqual(enQ.intent.criteria.go_back.examples, ["go back", "undo", "back", "previous page"]);
  assert.ok(!/Монгол/.test(enQ.intent.instructions.focus));
});

test("mn wikipedia-г монгол хэвлэл рүү илгээдэг; URL бүрийг код эзэмсээр байна", () => {
  assert.match(sitesFor("mn").home.wikipedia, /^https:\/\/mn\.wikipedia\.org\//);
  assert.match(sitesFor("mn").search.wikipedia, /^https:\/\/mn\.wikipedia\.org\//);
  assert.match(sitesFor("en").home.wikipedia, /^https:\/\/en\.wikipedia\.org\//);
  // Override-гүй сайтууд хуваалцсан хүснэгт рүү fallback хийдэг.
  assert.equal(sitesFor("mn").home.github, sitesFor("en").home.github);
});

test("танихгүй хэлний код шидэхийн оронд англи руу fallback хийдэг", () => {
  assert.equal(getLang("klingon").code, "en");
  assert.equal(getLang(undefined).code, "en");
  assert.deepEqual(questionsForLang("klingon").intent.criteria.go_back.examples, ["go back", "undo", "back", "previous page"]);
});
