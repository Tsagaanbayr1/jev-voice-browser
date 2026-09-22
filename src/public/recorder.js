/**
 * Сервер талын speech-to-text (Duudlaga Flow)-д зориулсан дууны бичлэг.
 *
 * Хөтчийн өөрийнх нь recognizer нь хэсэгчилсэн transcript-уудыг stream-ээр
 * илгээдэг тул апп өгүүлбэрээ дуусгахаас өмнө үйлдэл хийж чадна. Эдгээр API
 * нь batch: нэг utterance орж, нэг transcript гарна. Тиймээс энэ нь
 * тасралтгүй бичиж, та ярихаа ЗОГСООСОН үед шийдэж, яг тэр хэсгийг л илгээдэг.
 *
 * Utterance хэрхэн таслагддаг вэ:
 *   - ~64 ms frame бүрийн RMS энергийг adaptive noise floor-той харьцуулна
 *     (өрөө хэзээ ч чимээгүй биш; тогтмол threshold нь laptop-ийн fan дээр унана).
 *   - Яриа SPEECH_FRAMES чанга frame-ийн дараа эхэлж, SILENCE_MS чимээгүй
 *     frame-ийн дараа дуусна; эхний үе таслагдахгүйн тулд гулсалттай
 *     PRE_ROLL_MS buffer урд нь залгагдана.
 *   - MIN_MS-ээс богино utterance-ууд хаягдана (ханиалга, хаалга), MAX_MS-ээс
 *     урт нь алдагдахгүйн тулд ямар ч байсан илгээгдэнэ.
 *
 * Аудио нь 16 kHz mono 16-bit PCM WAV хэлбэрээр encode хийгддэг — Duudlaga
 * Flow-ийн өөрийнх нь macOS апп бичиж, upload хийдэгтэй ижил формат.
 */

const SAMPLE_RATE = 16000;
const FRAME = 1024; // 16 kHz дээр ~64 ms
const PRE_ROLL_MS = 300;
const SILENCE_MS = 700; // ийм удаан чимээгүй байвал utterance дуусна
const MIN_MS = 350; // үүнээс богино нь чимээ, command биш
const MAX_MS = 15000; // нэг command хэзээ ч ийм урт биш; upload-ыг жижиг байлгана
const SPEECH_FRAMES = 2; // эхлэхэд шаардлагатай дараалсан чанга frame
const FLOOR_ALPHA = 0.995; // noise-floor-ийн smoothing
const TRIGGER = 2.8; // яриа = noise floor-ийн энэ дахин их
const MIN_TRIGGER = 0.006; // ...гэхдээ энэ абсолют RMS-ээс доош хэзээ ч trigger хийхгүй

/** mono float sample-уудаас 16-bit PCM WAV үүсгэнэ. */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));

  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk-ийн хэмжээ
  view.setUint16(20, 1, true); // формат: PCM
  view.setUint16(22, 1, true); // суваг: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // sample тус бүрийн bit
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let off = 44;
  for (const s of samples) {
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function rms(frame) {
  let sum = 0;
  for (const v of frame) sum += v * v;
  return Math.sqrt(sum / frame.length);
}

/**
 * Utterance хаана эхэлж, хаана дуусахыг frame бүрээр шийднэ.
 * Цэвэр бөгөөд синхрон, тиймээс микрофонгүйгээр unit-test хийж болно.
 */
export class UtteranceDetector {
  constructor({ sampleRate = SAMPLE_RATE, frame = FRAME } = {}) {
    this.msPerFrame = (frame / sampleRate) * 1000;
    this.preRollFrames = Math.ceil(PRE_ROLL_MS / this.msPerFrame);
    this.silenceFrames = Math.ceil(SILENCE_MS / this.msPerFrame);
    this.minFrames = Math.ceil(MIN_MS / this.msPerFrame);
    this.maxFrames = Math.ceil(MAX_MS / this.msPerFrame);
    this.reset();
  }

  reset() {
    this.floor = 0.004;
    this.speaking = false;
    this.loudRun = 0;
    this.quietRun = 0;
    this.preRoll = [];
    this.captured = [];
    this.speechStart = 0;
    this.level = 0;
  }

  /**
   * Нэг frame өгнө. null, эсвэл бэлэн болсон utterance-ыг нэг Float32Array-аар буцаана.
   */
  push(frame) {
    const energy = rms(frame);
    this.level = energy;
    const loud = energy > Math.max(this.floor * TRIGGER, MIN_TRIGGER);
    // noise floor-ийг зөвхөн чимээгүй үед хянана, эс бөгөөс дуу хоолойг чинь дагаж өгсөнө.
    if (!loud) this.floor = this.floor * FLOOR_ALPHA + energy * (1 - FLOOR_ALPHA);

    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= SPEECH_FRAMES) {
        this.speaking = true;
        this.captured = [...this.preRoll];
        // pre-roll нь padding, яриа БИШ: түүнийг тооцвол 150 ms-ийн
        // ханиалга minimum-duration шалгалтыг давчихна.
        this.speechStart = this.captured.length;
        this.preRoll = [];
        this.quietRun = 0;
      }
      return null;
    }

    this.captured.push(frame);
    this.quietRun = loud ? 0 : this.quietRun + 1;
    if (this.quietRun >= this.silenceFrames || this.captured.length >= this.maxFrames) {
      return this._finish();
    }
    return null;
  }

  _finish() {
    const frames = this.captured;
    const speechFrames = frames.length - this.speechStart - this.quietRun;
    this.speaking = false;
    this.captured = [];
    this.speechStart = 0;
    this.loudRun = 0;
    this.quietRun = 0;
    if (speechFrames < this.minFrames) return null; // command болоход хэт богино

    const total = frames.reduce((n, f) => n + f.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const f of frames) {
      out.set(f, off);
      off += f.length;
    }
    return out;
  }

  /** Session-ийн төгсгөл: барьж авснаа, хангалттай урт бол, flush хийнэ. */
  flush() {
    return this.speaking ? this._finish() : null;
  }
}

/**
 * Микрофон -> utterance -> POST /api/transcribe -> onTranscript(text).
 * onLevel(level, speaking) нь UI-ийн meter-ийг хөдөлгөнө.
 */
export class ServerSttRecorder {
  constructor({ onTranscript, onLevel = () => {}, onStatus = () => {}, lang = () => "mn" } = {}) {
    this.onTranscript = onTranscript;
    this.onLevel = onLevel;
    // onStatus нь {key, params} хүлээн авна — өгүүлбэр биш, хуваалцсан strings
    // table-ийн key. Recorder нь уншигч ямар хэл сонгосныг мэдэхгүй; key-г
    // page нь render хийдэг, тэгснээр toggle нь амьд status мөрөнд хүрдэг.
    this.onStatus = onStatus;
    this.lang = lang;
    this.detector = new UtteranceDetector();
    this.running = false;
  }

  /** Status-ыг KEY-ээр мэдэгдэнэ, ингэснээр page нь уншигчийн хэлийг хэрэглэнэ. */
  status(key, params) {
    this.onStatus({ key, params });
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // 16 kHz-ийг шууд гуйх нь аудиог өөрсдөө resample хийхээс зайлсхийлгэдэг.
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);

    // ScriptProcessor нь deprecated боловч хаа сайгүй байдаг бөгөөд worklet
    // module-гүйгээр түүхий frame өгдөг; frame тус бүрийн ажил өчүүхэн.
    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.node.onaudioprocess = (ev) => {
      if (!this.running) return;
      const frame = new Float32Array(ev.inputBuffer.getChannelData(0)); // copy: buffer дахин ашиглагддаг
      const utterance = this.detector.push(frame);
      this.onLevel(this.detector.level, this.detector.speaking);
      if (utterance) this._send(utterance);
    };
    source.connect(this.node);
    // Дуугүй gain node руу чиглүүлнэ: ScriptProcessor нь зөвхөн destination-д
    // холбогдсон үед ажилладаг, гэхдээ микрофоныг эргүүлж тоглуулж болохгүй.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute);
    mute.connect(this.ctx.destination);

    this.detector.reset();
    this.running = true;
    this.status("stt.rec.listening");
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    const tail = this.detector.flush();
    if (tail) this._send(tail);
    try {
      this.node?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch { /* аль хэдийн унасан */ }
    this.status("stt.rec.off");
  }

  async _send(samples) {
    const seconds = (samples.length / SAMPLE_RATE).toFixed(1);
    this.status("stt.rec.transcribing", { seconds });
    try {
      const res = await fetch(`/api/transcribe?lang=${encodeURIComponent(this.lang())}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: encodeWav(samples),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      this.status(this.running ? "stt.rec.listening" : "stt.rec.off");
      if (json.text) this.onTranscript(json.text, json);
      return json;
    } catch (err) {
      this.status("stt.rec.error", { message: err.message });
      throw err;
    }
  }
}

export const TUNING = { SAMPLE_RATE, FRAME, PRE_ROLL_MS, SILENCE_MS, MIN_MS, MAX_MS };

/** {"type":"stop"}-ийн дараа provider-ийн terminal frame-ийг хэдий хүлээх вэ. */
const STREAM_FINAL_TIMEOUT_MS = 6000;

/** mono float sample-уудаас 16-bit little-endian PCM — streaming rail-ийн авдаг зүйл. */
export function pcm16(frame) {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const v = Math.max(-1, Math.min(1, frame[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** Хоёр transcript хэсгийг давхар space үүсгэлгүйгээр нийлүүлнэ. */
const joinText = (a, b) => [a, b].map((s) => (s || "").trim()).filter(Boolean).join(" ");

/**
 * UtteranceDetector-той ижил utterance хязгаар, гэхдээ бэлэн болсон нэг blob-ийн
 * оронд аудиог явцдаа өгдөг.
 *
 * Зардалд чухал нэг зүйлээрээ ялгаатай: streaming rail нь илгээсэн byte-ээ
 * тооцдог тул чимээгүй байдлыг хэзээ ч илгээж болохгүй. Тиймээс frame-үүдийг
 * барьж байна — ярианы өмнөх pre-roll, болон завсарлагын эхний чимээгүй
 * frame-үүд — зөвхөн яриа үнэхээр үргэлжилсэн үед чөлөөлөгдөнө. Төгсгөл
 * нь болж хувирсан завсарлага юу ч зарцуулахгүй.
 *
 * Цэвэр бөгөөд синхрон, тиймээс микрофонгүйгээр unit-test хийж болно.
 */
export class StreamGate {
  constructor({ sampleRate = SAMPLE_RATE, frame = FRAME } = {}) {
    this.msPerFrame = (frame / sampleRate) * 1000;
    this.preRollFrames = Math.ceil(PRE_ROLL_MS / this.msPerFrame);
    this.silenceFrames = Math.ceil(SILENCE_MS / this.msPerFrame);
    this.maxFrames = Math.ceil(MAX_MS / this.msPerFrame);
    this.reset();
  }

  reset() {
    this.floor = 0.004;
    this.speaking = false;
    this.loudRun = 0;
    this.quietRun = 0;
    this.preRoll = [];
    this.tail = [];
    this.spoken = 0;
    this.level = 0;
  }

  /**
   * Нэг frame өгнө. { send, started, ended, level } буцаана:
   *   send    provider одоо сонсох ёстой frame-үүд (барьсан аудио, эсвэл pre-roll)
   *   started utterance дөнгөж эхэлсэн → илгээхийн өмнө session нээнэ
   *   ended   utterance дууссан → session-ийг зогсооно
   */
  push(frame) {
    const energy = rms(frame);
    this.level = energy;
    const loud = energy > Math.max(this.floor * TRIGGER, MIN_TRIGGER);
    // noise floor-ийг зөвхөн чимээгүй үед хянана, эс бөгөөс дуу хоолойг чинь дагаж өгсөнө.
    if (!loud) this.floor = this.floor * FLOOR_ALPHA + energy * (1 - FLOOR_ALPHA);

    const idle = { send: [], started: false, ended: false, level: energy };

    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun < SPEECH_FRAMES) return idle;
      // `frame` нь аль хэдийн pre-roll-ийн сүүлийн бичлэг.
      const opening = this.preRoll.slice();
      this.speaking = true;
      this.preRoll = [];
      this.tail = [];
      this.quietRun = 0;
      this.spoken = opening.length;
      return { send: opening, started: true, ended: false, level: energy };
    }

    if (loud) {
      const resume = this.tail.concat(frame);
      this.tail = [];
      this.quietRun = 0;
      this.spoken += resume.length;
      // Хэзээ ч завсарладаггүй яриа ч дуусах ёстой: нэг command 15s урт биш,
      // хязгааргүй session нь provider-ийн өөрийнх нь cap-д тулгарна.
      if (this.spoken >= this.maxFrames) return this._closeUtterance(resume, energy);
      return { send: resume, started: false, ended: false, level: energy };
    }

    this.quietRun += 1;
    this.tail.push(frame);
    if (this.tail.length > this.silenceFrames) this.tail.shift();

    if (this.quietRun < this.silenceFrames && this.spoken < this.maxFrames) return idle;
    // Utterance-ийг дуусгахад хангалттай урт завсарлага: барьсан tail нь
    // чимээгүй тул хаягдана, завсарлага юу ч зарцуулахгүй. Уртын cap-д хүрэх
    // нь завсарлага биш, тиймээс тэр tail нь яриа бөгөөд чөлөөлөгдөнө.
    const flush = this.quietRun >= this.silenceFrames ? [] : this.tail.slice();
    return this._closeUtterance(flush, energy);
  }

  /** Utterance-ийг дуусгаж, `flush`-ийг сүүлийн аудио болгон дараалалд оруулна. */
  _closeUtterance(flush, level) {
    this.reset();
    return { send: flush, started: false, ended: true, level };
  }
}

/**
 * Микрофон -> /ws/stt -> interim болон final transcript-ууд, utterance тус
 * бүрд нэг session.
 *
 * Utterance тус бүрд нэг session, нэг удаан амьдардаг socket биш: provider
 * нь илгээсэн аудиог тооцдог, session-ууд нь хязгаартай, тиймээс ярьж
 * эхлэхэд session нээж, зогсоход нь хаах нь завсардах чимээгүй байдалд юу ч
 * зарцуулахгүй — мөн command бүрийг cap-ийн дотор сайн байлгана.
 */
export class StreamingSttRecorder {
  constructor({ onTranscript, onLevel = () => {}, onStatus = () => {}, lang = () => "mn" } = {}) {
    this.onTranscript = onTranscript;
    this.onLevel = onLevel;
    // onStatus нь {key, params} хүлээн авна — өгүүлбэр биш, хуваалцсан strings
    // table-ийн key. Recorder нь уншигч ямар хэл сонгосныг мэдэхгүй; key-г
    // page нь render хийдэг, тэгснээр toggle нь амьд status мөрөнд хүрдэг.
    this.onStatus = onStatus;
    this.lang = lang;
    this.gate = new StreamGate();
    this.running = false;
    this.session = null;
  }

  /** Status-ыг KEY-ээр мэдэгдэнэ, ингэснээр page нь уншигчийн хэлийг хэрэглэнэ. */
  status(key, params) {
    this.onStatus({ key, params });
  }

  async start() {
    if (this.running) return;
    if (typeof WebSocket !== "function") throw new Error("this browser has no WebSocket support");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);

    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1);
    this.node.onaudioprocess = (ev) => {
      if (!this.running) return;
      const frame = new Float32Array(ev.inputBuffer.getChannelData(0)); // copy: buffer дахин ашиглагддаг
      const step = this.gate.push(frame);
      this.onLevel(step.level, this.gate.speaking);
      // Utterance эхлүүлж буй frame дээр `step.send` нь pre-roll дээр нэмээд
      // энэ frame: бүгд session-д хамаарна.
      if (step.started) this._open(step.send);
      else if (step.send.length) this._send(step.send);
      if (step.ended) this._finish();
    };
    source.connect(this.node);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute);
    mute.connect(this.ctx.destination);

    this.gate.reset();
    this.running = true;
    this.status("stt.rec.listeningStreaming");
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this._finish();
    try {
      this.node?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch { /* аль хэдийн унасан */ }
    this.status("stt.rec.off");
  }

  /**
   * Дөнгөж эхэлсэн utterance-д session нээнэ. Socket холбогдож байх хооронд
   * барьж авсан аудио нь `pending`-д хадгалагдаж, нээгдэхэд flush хийгдэнэ,
   * ингэснээр эхний үе handshake-д алдагдахгүй.
   */
  _open(frames) {
    const s = { id: `s${Date.now()}`, text: "", settled: false, stopping: false, pending: frames.slice(), timer: null };
    this.session = s;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/stt?lang=${encodeURIComponent(this.lang())}`);
    this.ws = ws;
    ws.onopen = () => {
      if (!this.running || this.session !== s) { ws.close(); return; }
      // Эхний аудио frame-ээс өмнө provider-д session амьд гэдгийг хэлнэ.
      ws.send(JSON.stringify({ type: "start" }));
      for (const f of s.pending) ws.send(pcm16(f));
      s.pending = [];
      // Маш богино utterance handshake дуусахаас өмнө дуусч болно.
      if (s.stopping) this._stopNow(s);
    };
    ws.onmessage = (ev) => this._frame(ev);
    ws.onerror = () => {
      // Сервер socket-ийг хаадаг ба доорх onclose нь шалтгааныг мэдэгдэнэ.
      this.status("stt.rec.streamError");
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
    };
  }

  _send(frames) {
    const s = this.session;
    if (!s) return;
    for (const f of frames) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm16(f));
      else s.pending.push(f);
    }
  }

  /** Utterance дууслаа: final frame-ийг гуйж, provider-ийг тогтохыг нь хүлээнэ. */
  _finish() {
    const s = this.session;
    if (!s || s.settled || s.stopping) return;
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      this.session = null;
      this._settle(s);
      return;
    }
    s.stopping = true;
    // Одоо ч холбогдож байна: handshake ирмэгц onopen нь stop илгээнэ.
    if (ws.readyState !== WebSocket.OPEN) return;
    this._stopNow(s);
  }

  _stopNow(s) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "stop" }));
    this.status("stt.rec.finishing");
    // Унасан socket terminal frame-ийг залгиж болно; өнөөг хүртэлх transcript
    // дээр үйлдэл хийх нь ач холбогдолтой хэвээр.
    s.timer = setTimeout(() => this._settle(s), STREAM_FINAL_TIMEOUT_MS);
  }

  _frame(ev) {
    const s = this.session;
    if (!s || s.settled) return;
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return; // rail нь JSON-оор ярьдаг; өөр юу ч биднийх биш
    }
    if (m.type === "error") {
      this.status("stt.rec.error", { message: m.message || m.code || { key: "stt.rec.streamError" } });
      this._settle(s);
      return;
    }
    if (m.type === "interim") {
      // Interim frame нь зөвхөн сүүлийн final-аас хойшхи үгсийг хамардаг тул
      // utterance-ийн текст нь өнөөг хүртэлх final-ууд дээр энэ partial нэмэгдэнэ.
      const text = joinText(s.text, m.text);
      if (text) this.onTranscript(text, { final: false, utteranceId: s.id });
      return;
    }
    if (m.type === "final") {
      // Terminal frame нь session-ийн бүх transcript-ийг агуулна.
      if (m.complete) {
        this._settle(s, m.text || s.text);
        return;
      }
      s.text = joinText(s.text, m.text);
      this.onTranscript(s.text, { final: false, utteranceId: s.id });
    }
  }

  _settle(s, text) {
    if (s.settled) return;
    s.settled = true;
    clearTimeout(s.timer);
    if (this.session === s) this.session = null;
    const ws = this.ws;
    this.ws = null;
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "done"); } catch { /* аль хэдийн хаагдсан */ }
    const final = (text === undefined ? s.text : text || "").trim();
    if (final) this.onTranscript(final, { final: true, utteranceId: s.id });
    this.status(this.running ? "stt.rec.listeningStreaming" : "stt.rec.off");
  }
}
