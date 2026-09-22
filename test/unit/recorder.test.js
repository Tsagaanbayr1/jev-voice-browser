import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, rms, UtteranceDetector, StreamGate, pcm16, TUNING } from "../../src/public/recorder.js";
import { has, UI_LANGUAGES } from "../../src/public/i18n.js";

const FRAME = TUNING.FRAME;
const MS_PER_FRAME = (FRAME / TUNING.SAMPLE_RATE) * 1000;
const frames = (ms) => Math.ceil(ms / MS_PER_FRAME);

const quiet = () => new Float32Array(FRAME); // дижитал чимээгүй
const loud = (amp = 0.3) => Float32Array.from({ length: FRAME }, (_, i) => Math.sin(i / 4) * amp);

async function bytes(blob) {
  return new DataView(await blob.arrayBuffer());
}

// --- WAV encoding: Duudlaga Flow-ийн macOS app-ын илгээдэгтэй таарах ёстой -----------

test("encodeWav нь 16 kHz mono 16-bit PCM header бичдэг", async () => {
  const wav = encodeWav(new Float32Array(1000));
  const v = await bytes(wav);
  const tag = (off) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));

  assert.equal(tag(0), "RIFF");
  assert.equal(tag(8), "WAVE");
  assert.equal(tag(12), "fmt ");
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 1, "mono");
  assert.equal(v.getUint32(24, true), 16000, "16 kHz");
  assert.equal(v.getUint16(34, true), 16, "16-bit");
  assert.equal(v.getUint32(28, true), 32000, "byte rate = rate * channels * 2");
  assert.equal(tag(36), "data");
  assert.equal(v.getUint32(40, true), 2000, "data size = samples * 2");
  assert.equal(wav.size, 44 + 2000);
  assert.equal(wav.type, "audio/wav");
});

test("sample-ууд signed 16-bit болж хөрвөгдөж, clip хийгддэг", async () => {
  const v = await bytes(encodeWav(Float32Array.from([0, 1, -1, 2, -2])));
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(46, true), 32767, "+1 maps to full scale");
  assert.equal(v.getInt16(48, true), -32768, "-1 maps to full scale");
  assert.equal(v.getInt16(50, true), 32767, "above +1 is clipped, not wrapped");
  assert.equal(v.getInt16(52, true), -32768, "below -1 is clipped, not wrapped");
});

test("rms чимээгүй байдлыг ярианаас ялгадаг", () => {
  assert.equal(rms(quiet()), 0);
  assert.ok(rms(loud()) > 0.1);
});

// --- utterance илрүүлэлт ------------------------------------------------------

test("зөвхөн чимээгүй байдал хэзээ ч utterance үүсгэдэггүй", () => {
  const d = new UtteranceDetector();
  for (let i = 0; i < 100; i++) assert.equal(d.push(quiet()), null);
});

test("ярианы дараах чимээгүй байдал нэг utterance болон таслагддаг", () => {
  const d = new UtteranceDetector();
  for (let i = 0; i < 10; i++) d.push(quiet()); // эхлээд room tone
  let out = null;
  for (let i = 0; i < frames(1200); i++) out = d.push(loud()) ?? out;
  assert.equal(out, null, "still speaking: nothing emitted yet");

  for (let i = 0; i < frames(TUNING.SILENCE_MS) + 2 && !out; i++) out = d.push(quiet());
  assert.ok(out instanceof Float32Array, "utterance emitted once you stop talking");
  const seconds = out.length / TUNING.SAMPLE_RATE;
  assert.ok(seconds > 1.2, `expected >1.2s of audio, got ${seconds.toFixed(2)}s`);
  // Эхний үе тасрахаас сэргийлж pre-roll-ыг өмнө нь залгадаг.
  assert.ok(seconds < 1.2 + (TUNING.PRE_ROLL_MS + TUNING.SILENCE_MS) / 1000 + 0.2);
});

test("богино дуу чимээ хаягдана, command болж илгээгдэхгүй", () => {
  const d = new UtteranceDetector();
  for (let i = 0; i < 5; i++) d.push(quiet());
  let out = null;
  for (let i = 0; i < frames(150); i++) out = d.push(loud()) ?? out; // ханиалга
  for (let i = 0; i < frames(TUNING.SILENCE_MS) + 2; i++) out = d.push(quiet()) ?? out;
  assert.equal(out, null, "under MIN_MS of speech is dropped");
});

test("MAX_MS-ээс урт utterance алдагдахын оронд гаргагдана", () => {
  const d = new UtteranceDetector();
  let out = null;
  for (let i = 0; i < frames(TUNING.MAX_MS) + 10 && !out; i++) out = d.push(loud());
  assert.ok(out instanceof Float32Array);
  assert.ok(out.length / TUNING.SAMPLE_RATE <= TUNING.MAX_MS / 1000 + 0.5);
});

test("noise floor дасан зохицдог тул чанга өрөө байнга trigger хийдэггүй", () => {
  const d = new UtteranceDetector();
  const hum = () => Float32Array.from({ length: FRAME }, () => (Math.random() - 0.5) * 0.02);
  for (let i = 0; i < 200; i++) {
    const out = d.push(hum());
    assert.equal(out, null, "steady background noise is not speech");
  }
  assert.ok(d.floor > 0, "floor tracked upward");
});

test("flush нь mic зогсох үед үргэлжилж буй урт utterance-ыг гаргадаг", () => {
  const d = new UtteranceDetector();
  for (let i = 0; i < frames(900); i++) d.push(loud());
  const out = d.flush();
  assert.ok(out instanceof Float32Array, "audio is not thrown away on stop");
  assert.equal(d.flush(), null, "nothing left afterwards");
});

// --- Streaming rail: юу үнэхээр илгээгддэг, юунд зардал гардаг ----------
//
// Provider нь өөрт нь өгөгдсөн byte-уудыг тооцдог тул эдгээр тест нь аудионы
// адил мөнгөний тухай: stream хийгдсэн чимээгүй байдал бол төлөгдсөн чимээгүй байдал.

/** Gate-д ["loud"|"quiet", frames] алхмуудын script өгч, илгээсэн зүйлийг нь цуглуул. */
function drive(steps) {
  const g = new StreamGate();
  const sent = [];
  const events = [];
  for (const [kind, n] of steps) {
    for (let i = 0; i < n; i++) {
      const step = g.push(kind === "loud" ? loud() : quiet());
      sent.push(...step.send);
      if (step.started) events.push("started");
      if (step.ended) events.push("ended");
    }
  }
  return { sent: sent.length, events, gate: g };
}

test("stream gate нь үнэхээр ярих хүртэл юу ч илгээдэггүй", () => {
  const { sent, events } = drive([["quiet", 200]]);
  assert.equal(sent, 0, "a quiet room must not be streamed — it would be billed");
  assert.deepEqual(events, [], "and no session is opened for it");
});

test("ярих нь session нээж, эхний үетэй хамт pre-roll-ыг илгээдэг", () => {
  const g = new StreamGate();
  for (let i = 0; i < 10; i++) assert.equal(g.push(quiet()).send.length, 0, "the quiet lead-in is not sent");

  let opening = null;
  for (let i = 0; i < frames(400) && !opening; i++) {
    const step = g.push(loud());
    if (step.started) opening = step.send;
  }
  assert.ok(opening, "speech opens a session");
  // Pre-roll нь секундийн багахан хэсэг, бүтэн чимээгүй оршил биш: эхний үеийг
  // хамгаалахын тулд зөвхөн сүүлийн PRE_ROLL_MS room tone хадгалагддаг.
  assert.ok(opening.length > 0 && opening.length <= frames(TUNING.PRE_ROLL_MS) + 2, `pre-roll only, got ${opening.length} frames`);
  assert.equal(g.speaking, true);
});

test("өгүүлбэр доторх завсарлага баригдаад, үргэлжлүүлэхэд дарааллаараа илгээгддэг", () => {
  const g = new StreamGate();
  for (let i = 0; i < 10; i++) g.push(quiet());
  let started = false;
  for (let i = 0; i < frames(600) && !started; i++) started = g.push(loud()).started;
  assert.ok(started, "speech started");

  // Чимээгүй байдлын threshold-оос богино завсарлага: одоохондоо юу ч илгээгдэхгүй.
  let duringPause = 0;
  for (let i = 0; i < frames(TUNING.SILENCE_MS / 2); i++) duringPause += g.push(quiet()).send.length;
  assert.equal(duringPause, 0, "a mid-sentence pause is not streamed while it is still a pause");
  assert.equal(g.speaking, true, "short pause does not end the utterance");

  // Яриа сэргэнэ: баригдсан frame-ууд буцаж ирдэг тул завсарлага аудиод цоорхой болохгүй.
  const resume = g.push(loud());
  assert.equal(resume.ended, false);
  assert.ok(resume.send.length >= frames(TUNING.SILENCE_MS / 2), "held pause frames are released");
  assert.ok(resume.send.at(-1).some((v) => v !== 0), "the resumed frame itself is last");
});

test("utterance-ыг дуусгахад хангалттай урт завсарлага хэзээ ч stream хийгддэггүй", () => {
  const g = new StreamGate();
  for (let i = 0; i < 5; i++) g.push(quiet());
  let started = false;
  for (let i = 0; i < frames(600) && !started; i++) started = g.push(loud()).started;

  let duringTail = 0;
  let ended = false;
  for (let i = 0; i < frames(TUNING.SILENCE_MS) + 2 && !ended; i++) {
    const step = g.push(quiet());
    duringTail += step.send.length;
    ended = step.ended;
  }
  assert.ok(ended, "the utterance ends after SILENCE_MS of quiet");
  assert.equal(duringTail, 0, "the trailing silence is dropped, not billed");
  assert.equal(g.speaking, false);
});

test("завсарлагагүй яриа үргэлжлэхийн оронд MAX_MS дээр таслагддаг", () => {
  const g = new StreamGate();
  let sent = 0;
  let ended = false;
  for (let i = 0; i < frames(TUNING.MAX_MS) + 20 && !ended; i++) {
    const step = g.push(loud());
    sent += step.send.length;
    ended = step.ended;
  }
  assert.ok(ended, "a 15s monologue is cut like the batch recorder cuts it");
  assert.ok(sent >= frames(TUNING.MAX_MS) - 10, `all of it was sent, got ${sent} frames`);
});

test("pcm16 float sample-уудыг signed 16-bit little-endian болгон, clip хийж хөрвүүлдэг", () => {
  const pcm = pcm16(Float32Array.from([0, 1, -1, 2, -2]));
  assert.equal(pcm.length, 5);
  assert.equal(pcm[0], 0);
  assert.equal(pcm[1], 32767, "+1 maps to full scale");
  assert.equal(pcm[2], -32768, "-1 maps to full negative scale");
  assert.equal(pcm[3], 32767, "beyond +1 is clipped, not wrapped");
  assert.equal(pcm[4], -32768, "beyond -1 is clipped, not wrapped");
});

// ---------------------------------------------------------------------------
// Recorder нь өгүүлбэр биш, KEY-гээр ярьдаг: уншигч ямар хэл сонгосныг
// мэдэхгүй. Энэ нь гаргадаг key-ууд нь хоёр багцад үнэхээр байгаа эсэхийг
// шалгадаг тул status мөр дэлгэцэн дээр "stt.rec.listening" болж гарахгүй.
// ---------------------------------------------------------------------------

test("recorder-ийн мэдээлж чадах status бүр resolve хийдэг key", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../src/public/recorder.js", import.meta.url)), "utf8");
  const keys = new Set([...src.matchAll(/status\(\s*"([^"]+)"/g)].map((m) => m[1]));
  const conditional = [...src.matchAll(/status\(this\.running \? "([^"]+)" : "([^"]+)"/g)].flatMap((m) => [m[1], m[2]]);
  const direct = [...src.matchAll(/onStatus\(\{\s*key:\s*"(?:[^"]*"\s*:\s*")?([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.size >= 5, `expected the recorder to report several statuses, found ${keys.size}`);
  for (const key of [...keys, ...conditional, ...direct]) {
    assert.ok(key.startsWith("stt.rec."), `unexpected status key: ${key}`);
    for (const lang of Object.keys(UI_LANGUAGES)) {
      assert.ok(has(lang, key), `${key} is missing from the ${lang} pack`);
    }
  }
});
