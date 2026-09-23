/**
 * Юникод-аюулгүй таслалт (`src/text.js`).
 *
 * Эдгээр нь бодит доголдлын regression тест: emoji нь суррогат хос тул `slice`-ээр
 * тайрахдаа дундуур нь хуваагдаж, үлдсэн хагас нь хүчингүй Unicode болж, Jev API бүх
 * хүсэлтийг `400 Request contains invalid Unicode text.`-ээр үгүйсгэдэг байсан.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clip, clipEnd, stripLoneSurrogates, sanitizeDeep } from "../../src/text.js";

/** Ганц бие суррогатын байрлалууд (хостойгоо холбогдоогүй нь). */
function loneSurrogates(s) {
  const at = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const prev = s.charCodeAt(i - 1);
    const next = s.charCodeAt(i + 1);
    if (c >= 0xd800 && c <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff)) at.push(i);
    else if (c >= 0xdc00 && c <= 0xdfff && !(prev >= 0xd800 && prev <= 0xdbff)) at.push(i);
  }
  return at;
}

const EMOJI = "\u{1F600}"; // 😀 — 2 UTF-16 код нэгж
const PAIR = `ab${EMOJI}cd`; // a b 😀 c d → индекс 2,3 нь хос

test("clip/clipEnd: суррогатгүй мөр дээр `slice`-тэй ЯГ ижил (модель руу явдаг зам хөдлөхгүй)", () => {
  const samples = [
    "",
    "hello",
    "Link number 1",
    "Муур хай",
    "a".repeat(500),
    "e01 link \"More information\" → iana.org",
    "хайлтын талбарт сайн байна уу гэж бич",
  ];
  for (const s of samples) {
    for (let n = 0; n <= s.length + 3; n++) {
      assert.equal(clip(s, n), s.slice(0, n), `clip(${JSON.stringify(s.slice(0, 12))}…, ${n})`);
      assert.equal(clipEnd(s, n), n === 0 ? "" : s.slice(Math.max(0, s.length - n)), `clipEnd(…, ${n})`);
    }
  }
});

test("clip: богино мөрийг хөндөхгүй, хязгаарыг мөрдүүлнэ", () => {
  assert.equal(clip("hello", 10), "hello");
  assert.equal(clip("hello", 5), "hello");
  assert.equal(clip("hello", 3), "hel");
  assert.equal(clip("hello", 0), "");
  assert.equal(clip("hello", -1), "");
  assert.equal(clip(null, 4), "", "null → хоосон мөр");
  assert.equal(clip(undefined, 4), "");
  assert.equal(clip(0, 4), "0");
});

test("clip: суррогат хосыг дундуур нь хуваахгүй", () => {
  assert.equal(clip(PAIR, 3), "ab", "хосын өндөр хагас дээр тасрах ёстой");
  assert.equal(clip(PAIR, 4), `ab${EMOJI}`, "хос бүтэн багтвал үлдэнэ");
  assert.equal(loneSurrogates(clip(PAIR, 3)).length, 0);
  for (let n = 0; n <= PAIR.length + 2; n++) {
    assert.equal(loneSurrogates(clip(PAIR, n)).length, 0, `clip(…, ${n})`);
  }
});

test("clipEnd: суррогат хосыг дундуур нь хуваахгүй", () => {
  assert.equal(clipEnd("hello", 3), "llo");
  assert.equal(clipEnd(PAIR, 3), "cd", "хосын бага хагас дээр тасрах ёстой");
  assert.equal(clipEnd(PAIR, 4), `${EMOJI}cd`);
  for (let n = 0; n <= PAIR.length + 2; n++) {
    assert.equal(loneSurrogates(clipEnd(PAIR, n)).length, 0, `clipEnd(…, ${n})`);
  }
});

test("stripLoneSurrogates: ганц биеийг U+FFFD болгож, хосуудыг хөндөхгүй", () => {
  const clean = "энгийн кирилл текст 😀";
  assert.equal(stripLoneSurrogates(clean), clean, "цэвэр мөр яг тэр мөр хэвээр (identity)");
  assert.equal(stripLoneSurrogates("\uD83D"), "�", "ганц бие өндөр");
  assert.equal(stripLoneSurrogates("\uDE00"), "�", "ганц бие бага");
  assert.equal(stripLoneSurrogates("a\uD83Db"), "a�b");
  assert.equal(stripLoneSurrogates(`a${EMOJI}b`), `a${EMOJI}b`, "хос хэвээр");
  assert.equal(stripLoneSurrogates(`\uD83D😀`), `�${EMOJI}`, "ганц бие + хос");
});

test("sanitizeDeep: бүх мөрийг газар дээр нь цэвэрлэж, prototype-ийг хадгална", () => {
  const state = {
    transcript: "a\uD83D",
    page: { url: "https://x/", title: `ok ${EMOJI}`, n: 3 },
    elements: [`e01 link "\uD83D"`, null, 42],
    open_tabs: 2,
  };
  const out = sanitizeDeep(state);
  assert.equal(out, state, "газар дээр нь (шинэ object биш)");
  assert.equal(out.transcript, "a�");
  assert.equal(out.elements[0], 'e01 link "�"');
  assert.equal(out.elements[1], null);
  assert.equal(out.elements[2], 42);
  assert.equal(out.page.title, `ok ${EMOJI}`);
  assert.equal(out.open_tabs, 2);

  class Box {
    constructor() {
      this.text = "x\uDE00";
    }
    hi() {
      return "hi";
    }
  }
  const box = sanitizeDeep(new Box());
  assert.equal(box.text, "x�");
  assert.equal(box.hi(), "hi", "prototype хадгалагдсан");
});
