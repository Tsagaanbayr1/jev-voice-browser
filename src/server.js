/**
 * Node server: control page-ийг serve хийж, WebSocket <-> Controller-ийг холбож, API key-г эзэмшинэ.
 *
 *   node src/server.js [--port 8787] [--host 127.0.0.1] [--headless] [--cdp ws://127.0.0.1:9222/devtools/browser/...] [--start-url https://...] [--lang mn] [--ui-lang mn]
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
// Node-ийн global биш, `ws` WebSocket: streaming rail нь Authorization header-тэй
// нээгддэг бөгөөд зөвхөн энэ client л handshake дээр түүнийг тавьж чадна.
import { WebSocket, WebSocketServer } from "ws";
import { BrowserManager } from "./browser.js";
import { Controller } from "./controller.js";
import { hasApiKey } from "./jev.js";
import { MODEL, questionsForLang, T } from "./constants.js";
import { DEFAULT_LANG, LANGUAGES, isSupportedLang, getLang } from "./lang.js";
import { transcribe, sttStatus, streamingStatus, streamSocketUrl, apiKey } from "./stt.js";
import { resolveUiLang, UI_LANGUAGES } from "./public/i18n.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const out = {
    port: Number(process.env.PORT) || 8787,
    // Default-аар зөвхөн loopback-д bind хийнэ: энэ port-д хүрч чадах хүн бүр browser-ийг
    // удирдаж, API credit-ийг чинь зарцуулж чадна. LAN хэрэгтэй бол --host 0.0.0.0-ыг санаатайгаар ашигла.
    host: process.env.HOST || "127.0.0.1",
    headless: false,
    cdp: null,
    startUrl: "https://example.com/",
    // Ярих хэл; control page үүнийг шууд сольж чадна.
    lang: isSupportedLang(process.env.VOICE_LANG) ? process.env.VOICE_LANG : DEFAULT_LANG,
    // Interface хэл — зөвхөн дэлгэцэнд, Jev-д хэзээ ч явуулахгүй. Хуудас ч гэсэн
    // шууд сольж чадна; энэ бол зөвхөн эхлэх утга.
    uiLang: resolveUiLang(process.env.VOICE_UI_LANG),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--headless") out.headless = true;
    else if (a === "--cdp") out.cdp = argv[++i];
    else if (a === "--start-url") out.startUrl = argv[++i];
    else if (a === "--lang") out.lang = argv[++i];
    else if (a === "--ui-lang") out.uiLang = resolveUiLang(argv[++i]);
  }
  return out;
}

export async function startServer(opts = {}) {
  if (!hasApiKey()) {
    console.error("Missing TYPESAFE_API_KEY (or JEV_API_KEY). Use ./run.sh or export it first.");
    process.exit(1);
  }
  const browser = new BrowserManager();
  await browser.launch({ headless: opts.headless, cdp: opts.cdp, startUrl: opts.startUrl });
  const controller = new Controller({ browser, lang: opts.lang, uiLang: opts.uiLang });
  await controller.start();

  const app = express();
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/api/state", (_req, res) => res.json(controller.uiState()));
  app.get("/api/questions", (req, res) => {
    const lang = isSupportedLang(req.query.lang) ? req.query.lang : controller.lang;
    res.json({ model: MODEL, thresholds: T, lang, questions: questionsForLang(lang) });
  });
  // Server талын speech-to-text: browser нэг WAV utterance илгээж, бид transcript
  // буцаана. API key нь server-ээс хэзээ ч гарахгүй, аудио хаана ч хадгалагдахгүй.
  app.post("/api/transcribe", express.raw({ type: ["audio/wav", "application/octet-stream"], limit: "8mb" }), async (req, res) => {
    const lang = isSupportedLang(req.query.lang) ? req.query.lang : controller.lang;
    try {
      const r = await transcribe(req.body, { lang });
      // Silence болон transcript ижил аргаар логлогдоно; "(silence)" тэмдэглэл нь
      // өөрөө key тул аль ч interface хэл дээр зөв уншигдана.
      controller.logEvent(r.text ? "info" : "warn", "log.stt.in", {
        provider: r.provider,
        ms: r.latencyMs,
        text: r.text || { key: "log.stt.silence" },
      });
      res.json(r);
    } catch (err) {
      controller.logEvent("error", "log.stt.failed", { message: err.message });
      res.status(502).json({ error: err.message });
    }
  });
  app.get("/api/stt", (_req, res) => res.json(sttStatus()));
  app.get("/api/stt/stream", (_req, res) => res.json(streamingStatus()));

  app.get("/api/languages", (_req, res) =>
    res.json(
      Object.values(LANGUAGES).map((l) => ({ code: l.code, label: l.label, speechLang: l.speechLang })),
    ),
  );

  const server = http.createServer(app);
  // Нэг port-ыг хоёр socket хуваалцана: "/ws" нь control page-ийг удирдаж, "/ws/stt"
  // нь микрофоны аудиог speech provider руу зөөнө. Тэдгээрийг upgrade дээр route
  // хийнэ, учир нь `server`-т bind хийсэн WebSocketServer хоёр path дээр ч хариулж,
  // аудио socket нь хуудасны control frame-уудыг хүлээж авах ёсгүй.
  const wss = new WebSocketServer({ noServer: true });
  const sttWss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === "/ws/stt") {
      sttWss.handleUpgrade(req, socket, head, (ws, r) => sttWss.emit("connection", ws, r));
    } else if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    } else {
      socket.destroy();
    }
  });

  const broadcast = (type, payload) => {
    const msg = JSON.stringify({ type, payload });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };

  controller.on("transcript", (p) => broadcast("transcript", p));
  controller.on("decision", (p) => broadcast("decision", p));
  controller.on("action", (p) => broadcast("action", { ...p, ui: controller.uiState() }));
  controller.on("snapshot", () => broadcast("snapshot", controller.uiState().snapshot));
  controller.on("log", (p) => broadcast("log", p));
  controller.on("candidates", (p) => broadcast("candidates", p));
  controller.on("pending", (p) => broadcast("pending", p));
  controller.on("tabs", (p) => broadcast("tabs", p));
  controller.on("lang", (p) => broadcast("lang", p));
  controller.on("uiLang", (p) => broadcast("uiLang", p));
  // Controller нь Jev-ийн алдааг `log`-оор аль хэдийн мэдэгддэг (тэр нь UI руу ч очно),
  // харин Node-д сонсогчгүй `error` event нь шидэгддэг — тиймээс энэ listener нь нэг
  // муу хүсэлт (жишээ нь хүчингүй Unicode) бүхэл серверийг унагахаас сэргийлнэ.
  controller.on("error", (err) => console.error(`[jev] ${err?.message || err}`));

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello", payload: controller.uiState() }));
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "transcript":
          controller.handleTranscript({ text: msg.text, final: Boolean(msg.final), utteranceId: msg.utteranceId });
          break;
        case "command":
          controller.handleCommand(msg.text);
          break;
        case "undo":
          controller.undo();
          break;
        case "snapshot":
          controller.refreshSnapshot();
          break;
        case "lang":
          controller.setLanguage(msg.lang);
          break;
        // Зөвхөн дэлгэцэнд: энэ нь Jev, recognizer эсвэл policy руу хэзээ ч хүрэхгүй.
        // Хуудас үүнийг илгээгээд, server-т байгаа prose дахин render хийгдэхийн тулд state-ээ дахин уншина.
        case "uiLang":
          controller.setUiLanguage(msg.uiLang);
          break;
        case "state":
          ws.send(JSON.stringify({ type: "hello", payload: controller.uiState() }));
          break;
        default:
          break;
      }
    });
  });

  // Микрофоны аудио орж, interim болон final transcript гарна. Хуудас энэ socket-той
  // ярьдаг тул API key түүнд хэзээ ч хүрэхгүй: server provider-ийн socket-ыг нээж,
  // handshake дээр key-г танилцуулж, frame-уудыг хоёр тийш нь дамжуулна.
  //
  // Browser өөрийн WebSocket дээр Authorization header тавьж чаддаггүй нь
  // энэ hop яагаад байгаагийн бүх шалтгаан.
  sttWss.on("connection", (ws, req) => {
    const key = apiKey();
    if (!key) {
      ws.send(JSON.stringify({ type: "error", code: "not_configured", message: "No STT key configured on the server." }));
      ws.close(1011, "no key");
      return;
    }
    let lang = controller.lang;
    try {
      const asked = new URL(req.url, "http://localhost").searchParams.get("lang");
      if (isSupportedLang(asked)) lang = asked;
    } catch { /* controller-ийн хэлийг хэвээр үлдээнэ */ }

    const upstream = new WebSocket(streamSocketUrl(lang), {
      headers: { Authorization: `Bearer ${key}` },
    });

    const relay = (msg) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(msg));
    };

    // Provider-ийн handshake дуусахаас өмнө аудио ирж болно — socket нээгдэнгүүт
    // хуудас ярьж эхэлдэг. Эхний үеийг CONNECTING socket руу хаяхын оронд
    // тэдгээр frame-ийг барьж байна.
    const pending = [];

    upstream.on("open", () => {
      for (const [data, isBinary] of pending) upstream.send(data, { binary: isBinary });
      pending.length = 0;
      controller.logEvent("info", "log.stream.open", { lang });
    });
    // Provider зөвхөн text frame ярьдаг (interim / final / error JSON) тул
    // тэдгээрийг хөндөлгүй дамжуулна — хэрхэн render хийх нь хуудсанд хамаарна.
    upstream.on("message", (data, isBinary) => {
      if (ws.readyState === 1) ws.send(data, { binary: isBinary });
    });
    // Handshake дээрх татгалзалт (буруу key, rate эсвэл concurrency limit, spend cap)
    // хэзээ ч socket болдоггүй: provider оронд нь HTTP status-аар хариулна.
    // Жинхэнэ шалтгааныг хуудас харуулахын тулд тэр body-г уншина.
    upstream.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        let message = `HTTP ${res.statusCode}`;
        try {
          const parsed = JSON.parse(body);
          message = parsed.message || parsed.error || message;
        } catch {
          if (body.trim()) message = `${message}: ${body.trim().slice(0, 200)}`;
        }
        controller.logEvent("error", "log.stream.refused", { message });
        relay({ type: "error", code: String(res.statusCode), message });
        if (ws.readyState === 1) ws.close(1011, "upstream refused");
      });
    });
    upstream.on("error", (err) => {
      controller.logEvent("error", "log.stream.failed", { message: err.message });
      relay({ type: "error", code: "stream_failed", message: err.message });
    });
    upstream.on("close", () => {
      if (ws.readyState === 1) ws.close(1000, "upstream closed");
    });

    // Аудио frame-уудыг шууд дамжуулна: provider нь raw 16 kHz mono
    // 16-bit PCM авч, төлбөр тооцох хугацааг тэр byte-үүдээс гаргана.
    ws.on("message", (data, isBinary) => {
      if (upstream.readyState === 1) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push([data, isBinary]);
    });
    ws.on("close", () => {
      if (upstream.readyState === 1) upstream.close();
    });
    ws.on("error", () => {
      if (upstream.readyState === 1) upstream.close();
    });
  });

  const host = opts.host || "127.0.0.1";
  await new Promise((resolve) => server.listen(opts.port, host, resolve));
  const url = `http://localhost:${opts.port}`;
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn(`WARNING: listening on ${host} — anyone who can reach this port can control the browser and spend API credits.`);
  }
  console.log(`\nvoice-browser ready → open ${url} in Chrome (mic needs Chrome/Edge)`);
  const stt = sttStatus();
  console.log(`speech-to-text: ${stt.detail}`);
  console.log(stt.streaming
    ? `speech-to-text streaming: ${stt.streamUrl} (interim text as you speak)`
    : "speech-to-text streaming: unavailable (batch only)");
  console.log(
    `model ${MODEL} · controlled window: ${opts.cdp ? "attached via CDP" : opts.headless ? "headless" : "headed Chromium"} · speech: ${getLang(controller.lang).label} (${getLang(controller.lang).speechLang}) · interface: ${UI_LANGUAGES[controller.uiLang].label}\n`,
  );

  const shutdown = async () => {
    await controller.close();
    await browser.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { app, server, controller, browser, url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
