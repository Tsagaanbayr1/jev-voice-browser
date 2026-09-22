import { test } from "node:test";
import assert from "node:assert/strict";
import { readTranscript, activeProvider, sttStatus, streamingStatus, PROVIDERS, batchEndpoint, streamEndpoint, streamSocketUrl } from "../../src/stt.js";

/** `fn`-ийг түр орчинд ажиллуулж, тэнд байсан зүйлийг сэргээнэ. */
function withEnv(vars, fn) {
  const keys = ["DUUDLAGA_API_URL", "DUUDLAGA_API_KEY", "DUUDLAGA_STREAM_URL", "STT_PROVIDER"];
  // DUUDLAGA_API_KEY дангаараа хангалттай; URL нь default-той.
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// Private API нь хэд хэдэн хэлбэрийн аль нэгээр хариулж болно; нэгийг таамаглаад
// хоосон transcript-тай дуугүй бүтэлгүйтэхийн оронд бүгдийг нь хүлээн ав.
test("transcript нь түгээмэл response хэлбэр бүрээс уншигддаг", () => {
  const json = (o) => readTranscript("application/json", JSON.stringify(o));
  assert.equal(json({ text: "сайн байна уу" }), "сайн байна уу");
  assert.equal(json({ transcription: "сайн байна уу" }), "сайн байна уу");
  assert.equal(json({ transcript: "hello" }), "hello");
  assert.equal(json({ result: "hello" }), "hello");
  assert.equal(json({ data: { text: "nested" } }), "nested");
  assert.equal(json({ results: [{ text: "two" }, { text: "parts" }] }), "two parts");
});

test("plain-text response body-г байгаагаар нь ашигладаг", () => {
  assert.equal(readTranscript("text/plain", "  доош гүйлгэ\n"), "доош гүйлгэ");
  assert.equal(readTranscript(null, "буцах"), "буцах");
});

test("эвдэрхий эсвэл танигдаагүй JSON body throw хийдэггүй", () => {
  assert.equal(readTranscript("application/json", "{not json"), "{not json");
  assert.equal(readTranscript("application/json", JSON.stringify({ unexpected: 1 })), "");
});

test("provider сонголт configuration-ыг дагадаг", () => {
  withEnv({}, () => {
    assert.equal(activeProvider(), null, "nothing configured");
    assert.equal(sttStatus().available, false);
  });
  withEnv({ DUUDLAGA_API_KEY: "k" }, () => {
    assert.equal(activeProvider().name, "duudlaga", "the key alone is enough");
    assert.equal(sttStatus().provider, "duudlaga");
    assert.match(sttStatus().detail, /api\.duudlaga\.dev/, "falls back to the default endpoint");
  });
  withEnv({ DUUDLAGA_API_KEY: "k", DUUDLAGA_API_URL: "https://staging.example/stt" }, () => {
    assert.match(sttStatus().detail, /staging\.example/, "the URL can still be overridden");
  });
});

test("key-гүй URL нь configure хийгдээгүй", () => {
  withEnv({ DUUDLAGA_API_URL: "https://x" }, () => assert.equal(activeProvider(), null));
});

// Desktop rail нь Clerk session болон subscription-ыг authenticate хийдэг тул
// `dk_` key тэнд үргэлж 401 гэж хариулдаг. Түүнийг нэрлэсэн override-ыг дагах ёсгүй.
test("desktop rail-ыг нэрлэсэн override нь rail-ыг биш, host-ыг үлдээдэг", () => {
  withEnv({ DUUDLAGA_API_KEY: "k", DUUDLAGA_API_URL: "https://api.duudlaga.dev/transcribe" }, () => {
    assert.equal(batchEndpoint(), "https://api.duudlaga.dev/v1/stt/transcriptions");
    assert.equal(streamEndpoint(), "https://api.duudlaga.dev/v1/stt/stream");
  });
});

test("бидний танихгүй base path rail-ын өмнө үлддэг", () => {
  withEnv({ DUUDLAGA_API_KEY: "k", DUUDLAGA_API_URL: "https://staging.example/duudlaga" }, () => {
    assert.equal(batchEndpoint(), "https://staging.example/duudlaga/v1/stt/transcriptions");
    assert.equal(streamEndpoint(), "https://staging.example/duudlaga/v1/stt/stream");
  });
});

test("socket URL нь rail-ын уншдаг хэлийг агуулдаг", () => {
  withEnv({ DUUDLAGA_API_KEY: "k" }, () => {
    assert.equal(streamSocketUrl("mn"), "wss://api.duudlaga.dev/v1/stt/stream?languages=mn-MN");
    assert.equal(streamSocketUrl("en"), "wss://api.duudlaga.dev/v1/stt/stream?languages=en-US");
  });
});

test("streaming нь key configure хийгдсэн үед яг санал бологддог", () => {
  withEnv({}, () => {
    assert.equal(sttStatus().streaming, false);
    assert.equal(sttStatus().streamUrl, null);
    assert.equal(streamingStatus().available, false);
  });
  withEnv({ DUUDLAGA_API_KEY: "k" }, () => {
    const s = sttStatus();
    assert.equal(s.streaming, true);
    assert.equal(s.streamUrl, "https://api.duudlaga.dev/v1/stt/stream");
    assert.equal(streamingStatus().url, s.streamUrl, "both routes agree on one endpoint");
  });
});

test("танихгүй STT_PROVIDER дуугүй fallback хийхийн оронд чанга бүтэлгүйтдэг", () => {
  withEnv({ STT_PROVIDER: "whisper", DUUDLAGA_API_KEY: "k" }, () => {
    assert.throws(() => activeProvider(), /Unknown STT_PROVIDER/);
  });
});

test("Duudlaga Flow бол цорын ганц server-side provider", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.name), ["duudlaga"]);
});

test("provider бүр серверийн найрдаг field-үүдийг зарладаг", () => {
  for (const p of PROVIDERS) {
    assert.equal(typeof p.name, "string");
    assert.equal(typeof p.configured, "function");
    assert.equal(typeof p.transcribe, "function");
    assert.equal(typeof p.describe, "function");
  }
});
