/**
 * Оркестратор: transcript шинэчлэлт -> (debounce, хуучирсныг цуцлах) -> нэг Jev request ->
 * policy -> Playwright action -> шинэ snapshot. UI / demo / test-д зориулж event гаргана.
 *
 * ХЭЛ НЬ ХОЁР ТЭНХЛЭГТЭЙ, тэдгээр нь бие даасан:
 *   - `lang`   — ЮУ ЯРИГДАЖ байна. Recognizer болон Jev-д өгөх жишээнүүдийг тогтооно.
 *   - `uiLang` — ЮУ ХАРАГДАЖ байна. Зөвхөн дэлгэцэнд; model-д хэзээ ч хүрэхгүй.
 * Монголоор ярьж байхдаа English debug label-уудыг унших нь дэмжигддэг тохиргоо,
 * тиймээс энэ хоёр нь тусдаа талбар, тусдаа setter-тай. Тэдгээр нь мөргөлдөж болох
 * цорын ганц газар бол доорх `pendingConfirmation` бөгөөд энэ нь `describe()` —
 * English, хөлдөөсөн — хэвээр үлддэг, учир нь энэ нь уншигчид биш, Jev-д өгөх input.
 */
import { EventEmitter } from "node:events";
import { DEBOUNCE_MS, SILENCE_COMPLETE_MS, CANDIDATE_TTL_MS, MAX_INFLIGHT, MAX_CONTEXT_ACTIONS, MODEL, T } from "./constants.js";
import { decide, isAbortError } from "./jev.js";
import { evaluatePolicy, describe } from "./policy.js";
import { execute } from "./executor.js";
import { parseCandidatePick, cleanTranscript } from "./spans.js";
import { DEFAULT_LANG, getLang, isSupportedLang } from "./lang.js";
import { approxTokens } from "./snapshot.js";
import { t as tr, resolveUiLang, DEFAULT_UI_LANG, UI_LANGUAGES, actionLabel, actionRef } from "./public/i18n.js";

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export class Controller extends EventEmitter {
  /**
   * @param {{browser: import('./browser.js').BrowserManager, decideFn?: Function, executeFn?: Function}} opts
   *   decideFn / executeFn нь test-д зориулж inject хийгддэг (default: бодит Jev + Playwright).
   */
  constructor({ browser, decideFn = decide, executeFn = execute, lang = DEFAULT_LANG, uiLang = DEFAULT_UI_LANG }) {
    super();
    this.browser = browser;
    this.lang = isSupportedLang(lang) ? lang : DEFAULT_LANG;
    this.uiLang = resolveUiLang(uiLang);
    this._decide = decideFn;
    this._execute = executeFn;
    this.snapshot = null;
    this.snapshotAt = 0;
    this.utterance = null; // { id, physicalId, prefix, gen, text, final, startedAt, updatedAt, actedOn, actedText }
    this.consumed = null; // { id: physical utterance-ийн id, prefix: гүйцэтгэсэн text (жижиг үсгээр), gen }
    this.pending = null; // "confirm" хүлээж буй destructive action
    this.candidates = null; // { list: [{n,id,label}], intent: {type,text}, at }
    this.lastDecision = null;
    this.debounceTimer = null;
    this.silenceTimer = null;
    this.inflight = []; // [{ac, text, at}] Jev-г хүлээж байгаа request-үүд
    this.busy = false;
    this.log = [];
    this.stats = { calls: 0, inputTokens: 0, costUsd: 0, latencies: [], actions: 0, model: MODEL, commandToActionMs: [], decisionMs: [] };
    this.history = [];
    // Хүсэлт бүрт Jev рүү илгээх conversation context (jev.encodeContext-ыг үз):
    // сүүлийн navigation-аас өмнөх хуудас болон сүүлд гүйцэтгэсэн цөөн үйлдэл.
    this.context = { previousPage: null, recentActions: [] };
    browser.onChange(() => this.emit("tabs", browser.tabInfo()));
  }

  async start() {
    await this.refreshSnapshot();
    this._log("info", "log.ready", { model: MODEL, n: this.snapshot.elements.length, url: this.snapshot.url });
  }

  /**
   * Лог бичлэгийг KEY-ээр нэмнэ. Бичлэг нь render хийгдээгүй — `key` + `params` —
   * хэвээр, `msg` нь түүний English render бөгөөд scripts/demo.js болон терминал
   * үүнийг уншдаг тул үлдээдэг. Key-г хадгалах нь toggle-ийн дараа control page
   * бүх түүхийг шинэ хэлээр дахин render хийх боломж: emit хийх мөчид юу ч хөлдөхгүй.
   */
  _log(level, key, params = {}, extra = {}) {
    const entry = { t: Date.now(), level, key, params, msg: tr("en", key, params), ...extra };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.emit("log", entry);
  }

  /**
   * Хамтрагчийн эзэмшлийн event-ийг логлоно (STT rail-ийн
   * open/refused/failed шилжилтийг server логолдог). `_log`-той ижил хэлбэртэй тул
   * хуудас дахин render хийдэг түүхэд орж, бусадтай адил орчуулагдана.
   */
  logEvent(level, key, params = {}) {
    this._log(level, key, params);
  }

  async refreshSnapshot() {
    this.snapshot = await this.browser.snapshot();
    this.snapshotAt = Date.now();
    this.emit("snapshot", this.snapshot);
    return this.snapshot;
  }

  /** Typed command-ийн fallback: final utterance шиг ажиллана. */
  handleCommand(text) {
    return this.handleTranscript({ text, final: true, utteranceId: `typed-${Date.now()}` });
  }

  /**
   * Микрофоноос (эсвэл demo replay-ээс) ирэх partial transcript бүр дээр дуудагдана.
   * @param {{text: string, final?: boolean, utteranceId: string|number}} msg
   */
  handleTranscript({ text, final = false, utteranceId }) {
    let clean = cleanTranscript(text);
    const now = Date.now();

    // Нэг utterance-д нэг action — гэхдээ хэрэглэгч нэг амьсгалаар үргэлжлүүлэн ярьвал
    // ("go to wikipedia ... search for alan turing"), аль хэдийн гүйцэтгэсэн командын
    // дараах үгс шинэ виртуал utterance болно (id "<physical>+<n>"). Хоёр үгээс цөөн
    // шинэ үг ("please") алгасагдана.
    const consumed = this.consumed;
    let virtualId = utteranceId;
    if (consumed && consumed.id === utteranceId) {
      if (!clean.toLowerCase().startsWith(consumed.prefix)) return; // recognizer гүйцэтгэсэн үгсийг өөрчилсөн; алгас
      clean = clean.slice(consumed.prefix.length).trim();
      if (clean.split(/\s+/).filter(Boolean).length < 2) return;
      virtualId = `${utteranceId}+${consumed.gen}`;
    }

    if (!this.utterance || this.utterance.id !== virtualId) {
      this.utterance = {
        id: virtualId,
        physicalId: utteranceId,
        prefix: consumed && consumed.id === utteranceId ? consumed.prefix : "",
        gen: consumed && consumed.id === utteranceId ? consumed.gen : 0,
        text: clean,
        final,
        startedAt: now,
        updatedAt: now,
        actedOn: false,
        actedText: null,
      };
      if (virtualId !== utteranceId) this._log("debug", "log.continuing", { text: clean });
    } else {
      if (clean === this.utterance.text && final === this.utterance.final) return;
      this.utterance.text = clean;
      this.utterance.final = final || this.utterance.final;
      this.utterance.updatedAt = now;
    }
    this.emit("transcript", { text: clean, final, utteranceId: virtualId, actedOn: this.utterance.actedOn });
    if (!clean || this.utterance.actedOn) return;

    // Deterministic shortcut: дугаартай candidate overlay + хэлсэн тоо => Jev хэрэггүй.
    if (this.candidates && now - this.candidates.at < CANDIDATE_TTL_MS) {
      const n = parseCandidatePick(clean, this.candidates.list.length, this.lang);
      if (n) {
        const c = this.candidates.list[n - 1];
        this._consume(this.utterance, clean);
        this._log("info", "log.candidate", { n, label: c.label });
        const action = { ...this.candidates.intent, targetId: c.id, label: c.label };
        this.candidates = null;
        this._runAction(action, { via: "candidate-pick" });
        return;
      }
    }

    clearTimeout(this.debounceTimer);
    clearTimeout(this.silenceTimer);
    this.debounceTimer = setTimeout(() => this.decideNow("debounce"), final ? 0 : DEBOUNCE_MS);
  }

  /** Энэ utterance-ийн `text`-ийг гүйцэтгэсэн гэж тэмдэглэж, нэг амьсгалаар хэлсэн дараагийн үгс шинэ команд эхлүүлэх болно. */
  _consume(utt, text) {
    utt.actedOn = true;
    utt.actedText = text;
    this.consumed = {
      id: utt.physicalId,
      prefix: `${utt.prefix} ${text}`.trim().toLowerCase(),
      gen: (utt.gen || 0) + 1,
    };
  }

  /** Одоогийн utterance-ийн талаар Jev-ээс асууна. Бүх in-flight request-ийг цуцална. */
  async decideNow(trigger = "manual") {
    const utt = this.utterance;
    if (!utt || !utt.text || utt.actedOn) return;
    if (this.busy) {
      // Action гүйцэтгэж байна; дууссаны дараа дахин үнэлнэ.
      this.silenceTimer = setTimeout(() => this.decideNow("after-action"), 150);
      return;
    }
    // MAX_INFLIGHT хүртэл давхардсан request зөвшөөрнө (өмнөх partial-ийн request
    // одоо ч хэрэгтэй байж болно — үгс аль хэдийн action-д шийдэгдсэн бол түүгээр ажиллана).
    // Түүнээс хуучин нь stale бөгөөд AbortSignal-аар цуцлагдана.
    while (this.inflight.length >= MAX_INFLIGHT) {
      const old = this.inflight.shift();
      old.ac.abort();
    }
    const ac = new AbortController();
    const req = { ac, text: utt.text, at: Date.now() };
    this.inflight.push(req);

    if (Date.now() - this.snapshotAt > 1500) await this.refreshSnapshot();

    const textAtRequest = utt.text;
    let result;
    try {
      result = await this._decide(
        {
          transcript: textAtRequest,
          snapshot: this.snapshot,
          pendingConfirmation: this.pending ? describe(this.pending) : null,
          tabs: this.browser.tabInfo(),
          lang: this.lang,
          context: this.context,
        },
        { signal: ac.signal },
      );
    } catch (err) {
      this.inflight = this.inflight.filter((r) => r !== req);
      if (isAbortError(err) || ac.signal.aborted) {
        this._log("debug", "log.cancelled", { text: textAtRequest });
        return;
      }
      this._log("error", "log.jevError", { message: err.message || err });
      this.emit("error", err);
      return;
    }
    this.inflight = this.inflight.filter((r) => r !== req);
    if (ac.signal.aborted || this.utterance !== utt || utt.actedOn) return;

    this.stats.calls += 1;
    this.stats.inputTokens += result.usage?.input_tokens ?? 0;
    this.stats.costUsd += result.costUsd;
    this.stats.latencies.push(result.latencyMs);
    if (this.stats.latencies.length > 200) this.stats.latencies.shift();
    if (result.model && result.model !== this.stats.model) this.stats.model = result.model;

    // Энэ request in-flight байх хооронд илүү үг ирсэн бол түүний transcript нь
    // бодит transcript-ийн prefix: closed-set intent дээр ажиллаж болно (үгс аль хэдийн
    // "буцах"-ыг шийдсэн), гэхдээ final/silent гэж хэзээ ч үзэхгүй — free-text payload тайрагдна.
    const stale = utt.text !== textAtRequest;
    const silentMs = stale ? 0 : Date.now() - utt.updatedAt;
    const policy = evaluatePolicy({
      answers: result.answers,
      candidates: result.candidates,
      snapshot: this.snapshot,
      silentMs,
      isFinal: utt.final && !stale,
      pending: this.pending,
      lang: this.lang,
      context: this.context,
    });

    const decision = {
      transcript: textAtRequest,
      trigger,
      decisionLagMs: Math.max(0, Date.now() - utt.updatedAt), // хэлсэн сүүлийн үг -> decision бэлэн
      answers: result.answers,
      candidates: result.candidates,
      latencyMs: result.latencyMs,
      usage: result.usage,
      costUsd: result.costUsd,
      model: result.model,
      requestId: result.requestId,
      questionCount: result.questionCount,
      stateTokens: approxTokens(result.state),
      policy,
      silentMs,
      thresholds: T,
      at: Date.now(),
    };
    this.lastDecision = decision;
    this.emit("decision", decision);
    this._log(policy.decision === "act" ? "act" : "info", "log.decision", {
      ms: result.latencyMs,
      text: textAtRequest,
      // `decision` бол identifier, хэвээрээ үлдэнэ; харин summary нь KEYED хэлбэрээр явж,
      // хуудас түүнийг — дотор нь байгаа action-тай хамт — өөрийн хэлээр render хийнэ.
      decision: policy.decision,
      summary: policy.summaryKey ?? policy.summary,
    });

    switch (policy.decision) {
      case "act":
        this._consume(utt, textAtRequest);
        if (policy.action.confirmed) this.pending = null;
        this.candidates = null;
        await this._runAction(policy.action, { decision, utterance: utt });
        break;
      case "confirm":
        this._consume(utt, textAtRequest);
        this.pending = policy.action;
        // Хуудасны overlay бол render хийгдсэн artifact, state биш: нэг л удаа буудаг
        // тул энд, яг одоо, одоогийн interface хэлээр render хийгдэнэ.
        await this.browser.overlay("toast", tr(this.uiLang, "toast.confirm", { action: actionLabel(policy.action, this.uiLang) }), 6000);
        this.emit("pending", { action: policy.action, summary: policy.summary });
        break;
      case "cancel":
        this._consume(utt, textAtRequest);
        this.pending = null;
        await this.browser.overlay("toast", tr(this.uiLang, "toast.cancelled"));
        this.emit("pending", null);
        break;
      case "disambiguate": {
        const list = policy.candidates.map((c, i) => ({ n: i + 1, id: c.id, label: c.label, p: c.p }));
        this.candidates = { list, intent: policy.pendingIntent, at: Date.now() };
        await this.browser.overlay("candidates", list, CANDIDATE_TTL_MS);
        await this.browser.overlay("toast", tr(this.uiLang, "toast.whichOne"), 3000);
        this.emit("candidates", list);
        this._scheduleSilenceRetry(utt);
        break;
      }
      case "wait":
        this._scheduleSilenceRetry(utt, policy.retryInMs);
        break;
      default:
        break;
    }
  }

  /** Хэрэглэгч ярихаа боливол `complete`-ыг тойрохын тулд silentMs-тай дахин үнэлнэ. */
  _scheduleSilenceRetry(utt, retryInMs = null) {
    clearTimeout(this.silenceTimer);
    const waitFor = retryInMs ?? Math.max(50, SILENCE_COMPLETE_MS - (Date.now() - utt.updatedAt));
    this.silenceTimer = setTimeout(() => {
      if (this.utterance === utt && !utt.actedOn) this.decideNow("silence");
    }, waitFor);
  }

  async _runAction(action, meta = {}) {
    this.busy = true;
    const t0 = Date.now();
    const utt = meta.utterance || this.utterance;
    const pageBefore = this.snapshot ? { url: this.snapshot.url, title: this.snapshot.title, site: this.snapshot.site } : null;
    try {
      const res = await this._execute(action, this.browser, { uiLang: this.uiLang });
      const took = Date.now() - t0;
      const sinceLastWord = utt ? Date.now() - utt.updatedAt : null;
      const sinceUtteranceStart = utt ? Date.now() - utt.startedAt : null;
      this.stats.actions += 1;
      if (sinceLastWord != null) this.stats.commandToActionMs.push(sinceLastWord);
      if (meta.decision?.decisionLagMs != null) this.stats.decisionMs.push(meta.decision.decisionLagMs);
      this.history.push({ action, at: Date.now(), url: res.detail });
      this._recordContext({ action, ok: res.ok, detail: res.detail, said: meta.decision?.transcript || utt?.actedText || "", pageBefore });
      const decisionMs = meta.decision?.decisionLagMs ?? null;
      const entry = {
        action,
        ok: res.ok,
        detail: res.detail,
        executeMs: took,
        decisionMs, // сүүлийн үг -> decision
        sinceLastWordMs: sinceLastWord, // сүүлийн үг -> action дууссан (page load багтана)
        sinceUtteranceStartMs: sinceUtteranceStart,
        via: meta.via || "jev",
      };
      this._log(res.ok ? "act" : "warn", "log.action", {
        mark: res.ok ? "✓" : "✗",
        summary: actionRef(action),
        decided: `${decisionMs ?? "?"}ms`,
        ms: took,
        // `detail` нь executor-ийн өөрийн алдааны prose, key-тэй; харин page URL эсвэл
        // "scrollY=420" бол data, энгийн string хэлбэрээр явна.
        detail: res.detailKey ?? res.detail ?? "",
      });
      this.emit("action", entry);
    } catch (err) {
      this._log("error", "log.actionError", { summary: actionRef(action), message: err.message || err });
      this.emit("action", { action, ok: false, detail: String(err.message || err) });
    } finally {
      this.busy = false;
      await this.refreshSnapshot().catch(() => {});
    }
  }

  /**
   * Сая юу хийснийг санаж, дараагийн Jev request "үр дүн рүү буц", "нөгөө", "тэр биш"
   * гэхийг шийдвэрлэх боломжтой болгоно. Гүйцэтгэсэн үйлдэл бүрийн дараа дуудагдана;
   * page snapshot-ыг дуудагч тэр даруй шинэчилдэг тул `outcome` нь үйлдлийн дараах URL-аас гарна.
   */
  _recordContext({ action, ok, detail, said, pageBefore }) {
    const after = this.browser.currentUrl?.() ?? null;
    const navigated = pageBefore && after && after !== pageBefore.url;
    if (navigated) this.context.previousPage = pageBefore;
    let outcome = ok ? "done" : "failed";
    if (ok && navigated) outcome = `navigated to ${after.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80)}`;
    else if (ok && typeof detail === "string" && detail && !detail.startsWith("http")) outcome = detail.slice(0, 80);
    this.context.recentActions.push({
      type: action.type,
      targetId: action.targetId ?? null,
      targetLabel: action.label ?? null,
      text: action.text ?? null,
      url: action.url ?? null,
      said,
      ok,
      outcome,
      at: Date.now(),
    });
    if (this.context.recentActions.length > MAX_CONTEXT_ACTIONS) this.context.recentActions.shift();
  }

  /** "Undo" = history-д буцах. */
  async undo() {
    await this._runAction({ type: "go_back", label: tr("en", "label.undo"), labelKey: { key: "label.undo" } }, { via: "undo" });
  }

  /** Ярих хэлийг солино (control page-ийн selector). */
  setLanguage(code) {
    if (!isSupportedLang(code) || code === this.lang) return this.lang;
    this.lang = code;
    this._log("info", "log.language", { label: getLang(code).label, code });
    this.emit("lang", { lang: this.lang, label: getLang(this.lang).label });
    return this.lang;
  }

  /**
   * Interface хэлийг солино. Зөвхөн дэлгэцэнд: эндээс Jev, recognizer эсвэл policy
   * руу юу ч хүрэхгүй. `uiLang` event гаргаж, server түүнийг broadcast хийж,
   * хуудас түүхээ дахин render хийх боломжтой болно.
   */
  setUiLanguage(code) {
    const next = resolveUiLang(code);
    if (next === this.uiLang) return this.uiLang;
    this.uiLang = next;
    this._log("info", "log.uiLang", { label: UI_LANGUAGES[next].label });
    this.emit("uiLang", { uiLang: this.uiLang, uiLangLabel: UI_LANGUAGES[this.uiLang].label });
    return this.uiLang;
  }

  uiState() {
    const lat = this.stats.latencies;
    const sorted = [...lat].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    return {
      model: this.stats.model,
      lang: this.lang,
      langLabel: getLang(this.lang).label,
      speechLang: getLang(this.lang).speechLang,
      uiLang: this.uiLang,
      uiLangLabel: UI_LANGUAGES[this.uiLang].label,
      thresholds: T,
      stats: {
        calls: this.stats.calls,
        actions: this.stats.actions,
        inputTokens: this.stats.inputTokens,
        costUsd: this.stats.costUsd,
        lastLatencyMs: lat[lat.length - 1] ?? null,
        p50LatencyMs: p50,
        avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
        avgCommandToActionMs: avg(this.stats.commandToActionMs),
        avgDecisionMs: avg(this.stats.decisionMs),
      },
      snapshot: this.snapshot && {
        url: this.snapshot.url,
        title: this.snapshot.title,
        site: this.snapshot.site,
        searchBoxId: this.snapshot.searchBoxId,
        elements: this.snapshot.elements,
        tabs: this.snapshot.tabs,
      },
      lastDecision: this.lastDecision,
      // `action` нь English `summary`-ийн хажууд явж, хуудас "⚠ pending: …"-г өөрийн
      // хэлээр, дотор нь action-ыг оруулж, орчуулж render хийх боломжтой болно.
      context: this.context,
      pending: this.pending ? { action: this.pending, summary: describe(this.pending) } : null,
      candidates: this.candidates?.list ?? null,
      log: this.log.slice(-60),
    };
  }

  async close() {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.silenceTimer);
    for (const r of this.inflight) r.ac.abort();
    this.inflight = [];
  }
}
