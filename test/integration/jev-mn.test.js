/**
 * БОДИТ Jev API руу чиглэсэн монгол хэлний integration test.
 *
 * jev-decisions.test.js-тэй ижил хэлбэртэй, гэхдээ транскрипт бүр монгол бөгөөд
 * хүсэлт нь `lang: "mn"` дамжуулдаг тул question pack монгол жишээг агуулна.
 *
 * ЯАГААД БАЙГАА ВЭ: Jev зөвхөн англи жишээтэй ч монголыг сайн ойлгодог, гэвч
 * jev-1.13.0 дээр хоёр gate чимээгүй унаж байв — "буцах" (go back) нь
 * intent=none авч, "Алан Туринг хай" (search for Alan Turing) нь is_command
 * 0.22 авсан нь 0.5 gate-ээс доогуур байлаа. Хоёулаа act хийхийн оронд ignore
 * болж байв. Энэ тест засварыг pin хийж, жишээнүүдийн regression-ыг барих болно.
 *
 * TYPESAFE_API_KEY (эсвэл JEV_API_KEY) шаардана; үгүй бол skip.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, hasApiKey } from "../../src/jev.js";
import { evaluatePolicy } from "../../src/policy.js";
import { MODEL } from "../../src/constants.js";
import { CASES } from "./mn-cases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", `${name}.json`), "utf8"));

const LANG = "mn";

const results = [];

before(() => {
  if (!hasApiKey()) console.log("SKIP: no TYPESAFE_API_KEY / JEV_API_KEY set");
});

for (const c of CASES) {
  test(`jev mn: ${c.name} — "${c.transcript}"`, { skip: !hasApiKey() }, async () => {
    const snapshot = typeof c.snapshot === "string" ? fixture(c.snapshot) : c.snapshot;
    const r = await decide({ transcript: c.transcript, snapshot, lang: LANG });
    const policy = evaluatePolicy({
      answers: r.answers,
      candidates: r.candidates,
      snapshot,
      isFinal: c.final !== false,
      lang: LANG,
    });
    const a = r.answers;
    const failures = [];
    if (c.intent && a.intent.choice !== c.intent) failures.push(`intent ${a.intent.choice} != ${c.intent} (conf ${a.intent.confidence.toFixed(2)})`);
    if (c.decision && policy.decision !== c.decision) failures.push(`decision ${policy.decision} != ${c.decision} (${policy.summary})`);
    if (c.decisionIn && !c.decisionIn.includes(policy.decision)) failures.push(`decision ${policy.decision} not in ${c.decisionIn} (${policy.summary})`);
    if (c.text && policy.action?.text !== c.text && policy.action?.query !== c.text) failures.push(`text ${JSON.stringify(policy.action?.text ?? policy.action?.query)} != ${JSON.stringify(c.text)}`);
    if (c.url && !(policy.action?.url || "").includes(c.url)) failures.push(`url ${policy.action?.url} !~ ${c.url}`);
    if (c.amount && policy.action?.amount !== c.amount) failures.push(`amount ${policy.action?.amount} != ${c.amount}`);

    results.push({ name: c.name, ok: failures.length === 0, latency: r.latencyMs, tokens: r.usage.input_tokens, failures });
    console.log(
      `  ${failures.length ? "✗" : "✓"} ${c.name.padEnd(28)} ${String(r.latencyMs).padStart(4)}ms ${String(r.usage.input_tokens).padStart(5)}tok  intent=${a.intent.choice}(${a.intent.confidence.toFixed(2)}) cmd=${a.is_command.noul.toFixed(2)} complete=${a.complete.noul.toFixed(2)} → ${policy.decision}${failures.length ? "\n      " + failures.join("; ") : ""}`,
    );
    assert.deepEqual(failures, [], failures.join("; "));
  });
}

test("монгол хэлний pass rate тайлан", { skip: !hasApiKey() }, () => {
  const passed = results.filter((r) => r.ok).length;
  const lat = results.map((r) => r.latency).sort((a, b) => a - b);
  const avg = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length);
  const tokens = results.reduce((a, r) => a + r.tokens, 0);
  const rate = passed / results.length;
  console.log(
    `\n  ${MODEL} (mn): ${passed}/${results.length} cases passed (${(rate * 100).toFixed(1)}%) · latency avg ${avg} ms, p50 ${lat[Math.floor(lat.length / 2)]} ms · ${tokens} input tokens ($${((tokens / 1e6) * 0.042).toFixed(5)})\n`,
  );
  assert.ok(rate >= 0.85, `pass rate ${(rate * 100).toFixed(1)}% is below 85%`);
});
