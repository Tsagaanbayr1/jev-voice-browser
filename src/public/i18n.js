/**
 * Хоёр хэлний UI текстийн мөрүүд — англи (en) ба монгол (mn).
 *
 * ЭНЭ ЮУГ ХИЙДЭГГҮЙ ВЭ: энэ нь src/lang.js биш. Тэр файл нь ЯРИГДАХ хэлнээс
 * хамаарах бүхнийг (parsing pack, Jev-ийн жишээнүүд) хадгалах ба нэг
 * хэсэг нь модель руу илгээгддэг. Харин энэ файл ХАРАГДАХ бүхнийг хадгална.
 * Хоёрыг зориуд тусгаарласан: монгол интерфэйс + англи танигч бол
 * дэмжигддэг хослол, эсрэгээр нь ч мөн адил.
 *
 * ЯАГААД src/public/ ДОТОР БАЙХ ВЭ: удирдлагын хуудас үүнийг шууд
 * импортолдог (`/i18n.js`), сервер ч мөн адил файлыг харьцангуй замаар
 * импортолдог тул мөр бүрийн яг нэг хуулбар байх ба build шат байхгүй.
 * Тиймээс энэ модуль хамааралгүй, орчингүй байх ёстой — `node:` импортгүй,
 * `window`-гүй, `document`-гүй, top-level side effect-гүй. Энэ бол энгийн
 * өгөгдөл ба цэвэр функцууд, үүний ачаар `node --test` үүнийг импортолдог.
 *
 * ГАНЦ ДҮРЭМ: харьцуулагддаг, модель руу илгээгддэг, тестээр тааруулагддаг
 * эсвэл CSS класс болдог утга нь IDENTIFIER бөгөөд хэзээ ч энэ хүснэгтээр
 * дамжуулж болохгүй. Decision code (`act`/`wait`/…), gate нэр (`is_command`/…),
 * log level (`info`/`act`/…), element role (`link`/`searchbox`/…) болон action
 * type бүгд identifier. Тэднийг орчуулсан текстийн хажууд, monospace-оор,
 * байгаагаар нь харуулна — хэзээ ч оронд нь биш.
 *
 * ДУТУУ KEY ЗОРИУД ЧАНГААР ГАРАХ ЁСТОЙ: `t` key-гээ өөрөө буцаадаг тул дутуу
 * мөр дэлгэцэн дээр хоосон мөр биш, "log.acted" болж харагдана.
 * test/unit/i18n.test.js дахь unit тест ийм зүйл хэзээ ч гарахгүйг батална.
 */

/** Интерфэйсийг харуулж болох хэлнүүд. */
export const UI_LANGUAGES = {
  en: { code: "en", label: "English", htmlLang: "en" },
  mn: { code: "mn", label: "Монгол", htmlLang: "mn" },
};

export const DEFAULT_UI_LANG = "en";

/**
 * `{name}` нь `params`-аас дүүргэгдэнэ. Утга нь өөрөө `{key, params}` хос
 * болсон param эхлээд яг энэ хүснэгтээр хөрвүүлэгддэг тул хоёр тал нь
 * орчуулгаа алдалгүйгээр хэллэгийг дотроо багцалж болно ("нээх" +
 * "энэ сайтаас хайх: cats").
 */
export const STRINGS = {
  // ---------------------------------------------------------------- en
  en: {
    "app.title": "voice-browser · Jev control room",
    "app.tagline": "— Jev decides, Playwright acts",

    "status.ws.connecting": "connecting…",
    "status.ws.connected": "connected",
    "status.ws.disconnected": "disconnected — retrying",

    // Толгойн pill-үүд. renderStats() бүхэлд нь хөрвүүлдэг тул амьд тоо ба
    // тэдгээрийн шошго үргэлж нэг template-ээс гарна.
    "pill.model": "model {model}",
    "pill.latency": "last {last} ms · p50 {p50} ms",
    "pill.latencyTitle": "average: last spoken word → decision / → action finished (incl. page load)",
    "pill.stats": "calls {calls} · actions {actions}",
    "pill.cost": "cost ${cost}",
    "pill.timing": "word→decide {decide} ms · →done {done} ms",

    "card.mic": "microphone",
    "card.log": "action log",
    "card.decision": "jev decision",
    "card.intent": "intent",
    "card.nouls": "yes/no signals",
    "card.scroll": "scroll amount",
    "card.target": "target element",
    "card.site": "site",
    "card.spans": "text to type / search (verbatim candidates)",
    "card.page": "controlled page",
    "card.elements": "elements sent to Jev",

    "mic.placeholder": "Say something like “go to wikipedia”…",
    "mic.off": "off",
    "mic.listening": "listening",
    "mic.error": "error: {message}",
    "mic.errorMic": "mic error: {message}",
    "mic.noSpeechApi": "Web Speech API not available. Use Chrome or Edge, or type commands below.",

    "btn.startMic": "Start mic",
    "btn.stopMic": "Stop mic",
    "btn.undo": "Undo / back",
    "btn.rescan": "Re-scan page",
    "btn.run": "Run",

    "sel.lang": "Spoken language (sets the speech recognizer and the examples Jev sees)",
    "sel.micsrc": "Where speech-to-text happens",
    "sel.uilang": "Interface language — display only, does not change what you speak",
    "opt.stt.auto": "STT: auto",
    "opt.stt.browser": "STT: browser (streams)",
    "opt.stt.server": "STT: Duudlaga Flow",
    "cmd.placeholder": "…or type a command and press Enter (no-mic fallback)",

    "note.micHelp":
      "Mic needs Chrome/Edge (Web Speech API). Partial transcripts stream to the server as you speak; each update = one Jev request (stale ones are cancelled).",

    "verdict.waiting": "waiting for speech…",
    "gates.title": "Policy gates (value vs threshold):",
    "th.gate": "gate",
    "th.value": "value",
    "th.threshold": "threshold",
    "th.note": "note",

    "kv.url": "url",
    "kv.title": "title",
    "kv.site": "site",
    "kv.searchbox": "search box",

    "conf.intent": "confidence {p}",
    "conf.target": "confidence {p}",
    "spans.none": "no text/url candidates in transcript",
    "labels.none": "none",
    "scroll.little": "a little",
    "scroll.page": "one page",
    "scroll.end": "to the end",
    "tabs.one": "{n} tab",
    "tabs.other": "{n} tabs",
    "dec.meta": "{ms} ms · {n} questions · {tokens} tokens · ${cost} · {trigger}",
    "dec.silent": " (silent {ms}ms)",
    "pending.notice": "⚠ pending: {action} — say “confirm” or “cancel”",

    // ХЭЛЭХ жишээнүүд тул эдгээр нь интерфэйсийн хэлийг биш, ярих хэлийг
    // дагана. LANG_HINTS тэдгээрийг currentLang-аар зориуд key-ддэг.
    "hint.en": "Try: “go to wikipedia” · “search for alan turing” · “click the first result”",
    "hint.mn": "Жишээ: “википедиа руу яв” · “Алан Туринг хай” · “эхний холбоос дээр дар”",

    "lang.unsupported":
      "<b>{tag} is not supported by this browser’s speech recognizer.</b> Switch the selector to English, or type commands in the box below — typed {what} still works, because only dictation is missing.",
    "lang.unsupported.mn": "Mongolian",
    "lang.unsupported.text": "text",

    "stt.checking": "checking…",
    "stt.line": "speech-to-text: <b>{provider}</b> · {detail}{how}",
    "stt.lineBrowser": "speech-to-text: <b>{provider}</b> · {detail}",
    "stt.how.streaming": " — transcribes as you speak",
    "stt.how.batch": " — decides when you stop speaking",
    "stt.provider.browser": "browser",
    // Зөвхөн сервер талд юу ч тохируулаагүй үед харагдана. Тохируулсан үед
    // detail нь endpoint URL — өгөгдөл, байгаагаар нь харуулна.
    "stt.unavailable": "no server-side STT configured (using the browser recognizer)",

    // Recorder-ийн төлөв (src/public/recorder.js нь {key, params} ялгаруулдаг).
    "stt.rec.off": "off",
    "stt.rec.listening": "listening",
    "stt.rec.listeningStreaming": "listening (streaming)",
    "stt.rec.transcribing": "transcribing {seconds}s…",
    "stt.rec.error": "stt error: {message}",
    "stt.rec.streamError": "stt stream error",
    "stt.rec.finishing": "finishing…",

    // Action-ийг ороох хэллэгүүд. {target} нь хуудасны өгөгдөл эсвэл
    // identifier тул байгаагаар нь харагдана; зөвхөн эргэн тойрны үг орчуулагдана.
    "action.open": "open {target}",
    "action.click": "click {target}",
    "action.type": 'type "{text}" into {target}',
    "action.typeEnter": 'type "{text}" into {target} + enter',
    "action.select": 'select "{text}" in {target}',
    "action.reload": "reload",
    "action.go_forward": "go forward",
    "action.open_new_tab": "open new tab",
    "action.close_tab": "close tab",
    "action.press_enter": "press enter",
    "action.other": "{target}",

    "label.search": "search: {query}",
    "label.searchSite": "search {site}: {query}",
    "label.searchHere": "search this site: {query}",
    "label.searchBox": "search box",
    "label.switchTab": "switch tab ({dir})",
    "label.scroll": "{dir} ({amount})",
    "label.undo": "undo (back)",
    // Буцаах үйлдлүүд (policy.reverseAction). Англи утгууд нь upstream-ийн шууд
    // string-тэй ЯГ ижил байх ёстой: `describe()` (model-ийн хардаг) эдгээрийг уншдаг.
    "label.clearField": "clear {target}",
    "label.closeNewTab": "close the new tab",
    "label.backTabClosed": "back (tab already closed)",
    "label.switchBack": "switch back",
    "label.scrollBackUp": "scroll back up",
    "label.scrollBackDown": "scroll back down",
    "label.undoAction": "undo {target}",
    "dir.up": "scroll up",
    "dir.down": "scroll down",
    "dir.next": "next",
    "dir.previous": "previous",
    "dir.first": "first",

    // Бодлогын хураангуйнууд. `{action}` бол "@action" sentinel: хуудас үүнийг
    // интерфэйсийн хэлээр хөрвүүлсэн action-оор сольдог (action объект нь
    // байгаа тул үүнийг хийж чадна).
    "summary.act": "{action}",
    "summary.needConfirm": "say “confirm” to {action}",
    "summary.confirmed": "confirmed: {action}",
    "summary.cancelled": "cancelled pending action",
    "summary.notCommand": "not a browser command",
    "summary.noIntent": "no recognizable command yet",
    "summary.intentLow": "intent not confident yet",
    "summary.waitRest": "waiting for the rest of the command",
    "summary.waitPayload": "waiting for the end of the phrase (free text)",
    "summary.whereTo": "where to? (no site or domain recognised)",
    "summary.searchWhat": "search for what?",
    "summary.typeWhat": "type what?",
    "summary.noElement": "no matching element on this page",
    "summary.whichOne": "which one? {list}",
    "summary.nothingPending": "nothing pending to {what}",
    "summary.correction": "correction → {action}",

    // Gate-ийн тэмдэглэл (бодлогын хүснэгтийн `note` багана).
    "note.pending.confirmed": "pending action confirmed",
    "note.pending.cancelled": "pending action cancelled",
    "note.is_correction": "rejects previous action: {action}",
    "note.exclude_target": "previous target excluded → {target}",
    "note.is_command": "user is addressing the browser",
    "note.intent": "confident, non-none intent",
    "note.complete.final": "recognizer marked utterance final",
    "note.complete.silent": "silent for {ms}ms",
    "note.complete.verbObject": "command has verb + object",
    "note.payload_final": "free text (query / typed text) must be finished before it is copied",
    "note.destructive.safe": "reversible action",
    "note.destructive.confirm": "needs spoken confirmation",
    "note.url_span": "domain spoken verbatim",
    "note.site.known": "known site",
    "note.site.none": "no destination yet",
    "note.text_span.none": "no query text yet",
    "note.text_span.copy": "query copied verbatim",
    "note.text_span.type": "no text to type yet",
    "note.target.fallback": "falling back to search box",
    "note.target.ambiguous": "ambiguous target",

    "log.ready": "ready — model {model}, {n} elements on {url}",
    "log.continuing": 'continuing utterance → new command "{text}"',
    "log.candidate": "picked candidate {n} ({label}) by number — no model call",
    "log.cancelled": 'cancelled stale request for "{text}"',
    "log.jevError": "Jev error: {message}",
    "log.decision": '{ms}ms · "{text}" → {decision}: {summary}',
    "log.action": "{mark} {summary} — decided {decided} after last word, executed in {ms}ms {detail}",
    "log.actionError": "action failed: {summary} — {message}",
    "log.language": "language → {label} ({code})",
    "log.uiLang": "interface language → {label}",
    "log.stt.in": "stt({provider}) {ms}ms: {text}",
    "log.stt.silence": "(silence)",
    "log.stt.failed": "stt failed: {message}",
    "log.stream.open": "stt stream open ({lang})",
    "log.stream.refused": "stt stream refused: {message}",
    "log.stream.failed": "stt stream failed: {message}",

    "toast.confirm": "Say “confirm” to {action}",
    "toast.cancelled": "cancelled",
    "toast.whichOne": "Which one? Say the number.",

    // Executor удирдаж буй хуудсан дээр буулгадаг toast-ууд. `{label}` ирэх
    // үедээ аль хэдийн action label болсон байдаг тул дахин орчуулахгүй, хөрвүүлнэ.
    "toast.navigate": "→ {label}",
    "toast.enter": "⏎ enter",
    "toast.back": "← back",
    "toast.forward": "→ forward",
    "toast.reload": "↻ reload",
    "toast.newTab": "new tab",
    "toast.switchedTab": "switched tab",

    // Action яагаад амжилтгүй болсон тухай. Энэ бол текст; executor-ийн амжилттай
    // detail-үүд (хуудасны URL, "scrollY=420", "tabs=2") нь өгөгдөл, байгаагаар нь харагдана.
    "detail.noOption": "no matching option",
    "detail.onlyOneTab": "only one tab",
    "detail.unknownAction": "unknown action {type}",
  },

  // ---------------------------------------------------------------- mn
  mn: {
    "app.title": "voice-browser · Jev удирдлагын өрөө",
    "app.tagline": "— Jev шийднэ, Playwright гүйцэтгэнэ",

    "status.ws.connecting": "холбогдож байна…",
    "status.ws.connected": "холбогдсон",
    "status.ws.disconnected": "холболт тасарсан — дахин оролдож байна",

    "pill.model": "модель {model}",
    "pill.latency": "сүүлд {last} мс · p50 {p50} мс",
    "pill.latencyTitle": "дундаж: сүүлийн үг → шийдвэр / → үйлдэл дууссан (хуудас ачаалсныг оролцуулан)",
    "pill.stats": "дуудлага {calls} · үйлдэл {actions}",
    "pill.cost": "зарцуулалт ${cost}",
    "pill.timing": "үг→шийдвэр {decide} мс · →дуусах {done} мс",

    "card.mic": "микрофон",
    "card.log": "үйлдлийн лог",
    "card.decision": "Jev-ийн шийдвэр",
    "card.intent": "зорилго",
    "card.nouls": "тийм/үгүй дохио",
    "card.scroll": "гүйлгэх хэмжээ",
    "card.target": "зорилтот элемент",
    "card.site": "сайт",
    "card.spans": "бичих / хайх текст (яг хуулбар хувилбарууд)",
    "card.page": "удирдаж буй хуудас",
    "card.elements": "Jev-д илгээсэн элементүүд",

    "mic.placeholder": "“википедиа руу яв” гэх мэтээр хэлээрэй…",
    "mic.off": "унтраалттай",
    "mic.listening": "сонсож байна",
    "mic.error": "алдаа: {message}",
    "mic.errorMic": "микрофоны алдаа: {message}",
    "mic.noSpeechApi":
      "Web Speech API боломжгүй байна. Chrome эсвэл Edge ашиглана уу, эсвэл доорх хэсэгт тушаал бичнэ үү.",

    "btn.startMic": "Микрофон асаах",
    "btn.stopMic": "Микрофон унтраах",
    "btn.undo": "Буцаах",
    "btn.rescan": "Хуудсыг дахин унших",
    "btn.run": "Ажиллуулах",

    "sel.lang": "Ярих хэл (танигчийн хэл болон Jev-д өгөх жишээг тогтооно)",
    "sel.micsrc": "Яриа текстоо хаана хөрвүүлэх вэ",
    "sel.uilang": "Интерфэйсийн хэл — зөвхөн харагдах байдал, ярих хэлээ өөрчлөхгүй",
    "opt.stt.auto": "STT: авто",
    "opt.stt.browser": "STT: хөтөч (тасралтгүй)",
    "opt.stt.server": "STT: Duudlaga Flow",
    "cmd.placeholder": "…эсвэл тушаалаа бичээд Enter дарна уу (микрофонгүй хувилбар)",

    "note.micHelp":
      "Микрофон Chrome/Edge шаардана (Web Speech API). Ярьж байх хооронд хэсэгчилсэн текст сервер рүү тасралтгүй очно; шинэчлэлт бүр = нэг Jev хүсэлт (хуучирсан нь цуцлагдана).",

    "verdict.waiting": "яриаг хүлээж байна…",
    "gates.title": "Бодлогын шалгуурууд (утга ба босго):",
    "th.gate": "шалгуур",
    "th.value": "утга",
    "th.threshold": "босго",
    "th.note": "тайлбар",

    "kv.url": "хаяг",
    "kv.title": "гарчиг",
    "kv.site": "сайт",
    "kv.searchbox": "хайлтын талбар",

    "conf.intent": "итгэл {p}",
    "conf.target": "итгэл {p}",
    "spans.none": "хэлсэн үгэнд текст эсвэл хаягийн хувилбар олдсонгүй",
    "labels.none": "байхгүй",
    "scroll.little": "жаахан",
    "scroll.page": "нэг хуудас",
    "scroll.end": "төгсгөл хүртэл",
    "tabs.one": "{n} таб",
    "tabs.other": "{n} таб",
    "dec.meta": "{ms} мс · {n} асуулт · {tokens} токен · ${cost} · {trigger}",
    "dec.silent": " (чимээгүй {ms}мс)",
    "pending.notice": "⚠ хүлээгдэж буй: {action} — “батлах” эсвэл “болих” гэж хэлнэ үү",

    "hint.en": "Try: “go to wikipedia” · “search for alan turing” · “click the first result”",
    "hint.mn": "Жишээ: “википедиа руу яв” · “Алан Туринг хай” · “эхний холбоос дээр дар”",

    "lang.unsupported":
      "<b>Энэ хөтчийн яриа танигч {tag} хэлийг дэмжихгүй байна.</b> Сонголтыг English болгох эсвэл доорх хэсэгт тушаалаа бичнэ үү — {what} бичсэн ч ажиллана, зөвхөн дуугаар хэлэх хэсэг л байхгүй.",
    "lang.unsupported.mn": "монгол",
    "lang.unsupported.text": "текст",

    "stt.checking": "шалгаж байна…",
    "stt.line": "яриа → текст: <b>{provider}</b> · {detail}{how}",
    "stt.lineBrowser": "яриа → текст: <b>{provider}</b> · {detail}",
    "stt.how.streaming": " — ярьж байх хооронд хөрвүүлнэ",
    "stt.how.batch": " — яриаг зогсоосны дараа шийднэ",
    "stt.provider.browser": "хөтөч",
    "stt.unavailable": "серверийн STT тохируулагдаагүй (хөтчийн танигчийг ашиглана)",

    "stt.rec.off": "унтраалттай",
    "stt.rec.listening": "сонсож байна",
    "stt.rec.listeningStreaming": "сонсож байна (тасралтгүй)",
    "stt.rec.transcribing": "{seconds}с хөрвүүлж байна…",
    "stt.rec.error": "STT алдаа: {message}",
    "stt.rec.streamError": "STT урсгалын алдаа",
    "stt.rec.finishing": "дуусгаж байна…",

    "action.open": "{target} нээх",
    "action.click": "{target} дээр дарах",
    "action.type": '{target} талбарт "{text}" бичих',
    "action.typeEnter": '{target} талбарт "{text}" бичээд enter дарах',
    "action.select": '{target} дотроос "{text}" сонгох',
    "action.reload": "хуудсыг дахин ачаалах",
    "action.go_forward": "урагшаа явах",
    "action.open_new_tab": "шинэ таб нээх",
    "action.close_tab": "табыг хаах",
    "action.press_enter": "enter дарах",
    "action.other": "{target}",

    "label.search": "хайлт: {query}",
    "label.searchSite": "{site}-с хайх: {query}",
    "label.searchHere": "энэ сайтаас хайх: {query}",
    "label.searchBox": "хайлтын талбар",
    "label.switchTab": "таб солих ({dir})",
    "label.scroll": "{dir} ({amount})",
    "label.undo": "буцаах",
    "label.clearField": "{target}-г цэвэрлэх",
    "label.closeNewTab": "шинэ табыг хаах",
    "label.backTabClosed": "буцах (таб аль хэдийн хаагдсан)",
    "label.switchBack": "буцаж шилжих",
    "label.scrollBackUp": "буцаж дээш гүйлгэх",
    "label.scrollBackDown": "буцаж доош гүйлгэх",
    "label.undoAction": "{target}-г буцаах",
    "dir.up": "дээш гүйлгэх",
    "dir.down": "доош гүйлгэх",
    "dir.next": "дараагийн",
    "dir.previous": "өмнөх",
    "dir.first": "эхний",

    "summary.act": "{action}",
    "summary.needConfirm": "{action} — батлахын тулд “батлах” гэж хэлнэ үү",
    "summary.confirmed": "батлагдсан: {action}",
    "summary.cancelled": "хүлээгдэж буй үйлдэл цуцлагдсан",
    "summary.notCommand": "хөтөч рүү чиглэсэн тушаал биш",
    "summary.noIntent": "танигдах тушаал хараахан байхгүй",
    "summary.intentLow": "зорилго хараахан тодорхойгүй",
    "summary.waitRest": "тушаалын үлдсэн хэсгийг хүлээж байна",
    "summary.waitPayload": "хэллэгийн төгсгөлийг хүлээж байна (чөлөөт текст)",
    "summary.whereTo": "хаашаа явах вэ? (сайт эсвэл хаяг танигдсангүй)",
    "summary.searchWhat": "юу хайх вэ?",
    "summary.typeWhat": "юу бичих вэ?",
    "summary.noElement": "энэ хуудсанд тохирох элемент олдсонгүй",
    "summary.whichOne": "аль нь вэ? {list}",
    "summary.nothingPending": "{what} хийх хүлээгдэж буй зүйл байхгүй",
    "summary.correction": "засвар → {action}",

    "note.pending.confirmed": "хүлээгдэж буй үйлдэл батлагдсан",
    "note.pending.cancelled": "хүлээгдэж буй үйлдэл цуцлагдсан",
    "note.is_correction": "өмнөх үйлдлийг үгүйсгэж байна: {action}",
    "note.exclude_target": "өмнөх target хасагдсан → {target}",
    "note.is_command": "хэрэглэгч хөтөч рүү хандаж байна",
    "note.intent": "тодорхой, байхгүй биш зорилго",
    "note.complete.final": "танигч үг хэллэгийг бүрэн гэж тэмдэглэсэн",
    "note.complete.silent": "{ms}мс чимээгүй байсан",
    "note.complete.verbObject": "тушаалд үйл үг ба объект хоёулаа байна",
    "note.payload_final": "чөлөөт текстийг хуулахаас өмнө дуусгасан байх ёстой",
    "note.destructive.safe": "буцаах боломжтой үйлдэл",
    "note.destructive.confirm": "дуугаар батлах шаардлагатай",
    "note.url_span": "хаягийг шууд хэлсэн",
    "note.site.known": "танигдсан сайт",
    "note.site.none": "хүрэх газар хараахан тодорхойгүй",
    "note.text_span.none": "хайх текст хараахан байхгүй",
    "note.text_span.copy": "хайлтын текстийг шууд хуулсан",
    "note.text_span.type": "бичих текст хараахан байхгүй",
    "note.target.fallback": "хайлтын талбар руу шилжиж байна",
    "note.target.ambiguous": "зорилтот элемент тодорхойгүй",

    "log.ready": "бэлэн — модель {model}, {url} дээр {n} элемент",
    "log.continuing": 'үргэлжилсэн үг → шинэ тушаал "{text}"',
    "log.candidate": "{n}-р хувилбарыг ({label}) дугаараар сонголоо — модель дуудаагүй",
    "log.cancelled": '"{text}"-ийн хуучирсан хүсэлтийг цуцаллаа',
    "log.jevError": "Jev алдаа: {message}",
    "log.decision": '{ms}мс · "{text}" → {decision}: {summary}',
    "log.action": "{mark} {summary} — сүүлийн үгнээс {decided} дараа шийдэж, {ms}мс-д гүйцэтгэлээ {detail}",
    "log.actionError": "үйлдэл амжилтгүй: {summary} — {message}",
    "log.language": "хэл → {label} ({code})",
    "log.uiLang": "интерфэйсийн хэл → {label}",
    "log.stt.in": "STT({provider}) {ms}мс: {text}",
    "log.stt.silence": "(чимээгүй)",
    "log.stt.failed": "STT амжилтгүй: {message}",
    "log.stream.open": "STT урсгал нээгдэв ({lang})",
    "log.stream.refused": "STT урсгалаас татгалзав: {message}",
    "log.stream.failed": "STT урсгал амжилтгүй: {message}",

    "toast.confirm": "{action} — “батлах” гэж хэлнэ үү",
    "toast.cancelled": "цуцлагдсан",
    "toast.whichOne": "Аль нь вэ? Дугаарыг хэлнэ үү.",

    "toast.navigate": "→ {label}",
    "toast.enter": "⏎ оруулах",
    "toast.back": "← ухраах",
    "toast.forward": "→ урагшлах",
    "toast.reload": "↻ дахин ачаалах",
    "toast.newTab": "шинэ таб",
    "toast.switchedTab": "таб солигдлоо",

    "detail.noOption": "тохирох сонголт олдсонгүй",
    "detail.onlyOneTab": "зөвхөн нэг таб байна",
    "detail.unknownAction": "үл мэдэгдэх үйлдэл {type}",
  },
};

export function isUiLang(code) {
  return Object.prototype.hasOwnProperty.call(UI_LANGUAGES, String(code || "").toLowerCase());
}

/** Хэзээ ч throw хийхгүй, хэзээ ч undefined буцаахгүй. */
export function resolveUiLang(code, fallback = DEFAULT_UI_LANG) {
  const c = String(code || "").toLowerCase();
  return isUiLang(c) ? c : fallback;
}

/** Энэ key жишиг (англи) багцад мэдэгддэг үү? */
export function has(lang, key) {
  return Object.prototype.hasOwnProperty.call(STRINGS[resolveUiLang(lang)] ?? {}, key);
}

/**
 * `{name}`-г `params`-аас дүүргэнэ. undefined param байрандаа үлддэг тул
 * дутуу утга чимээгүй хоосон болохын оронд харагдана. Өөрөө `{key, params}`
 * хос болсон param эхлээд хүснэгтээр хөрвүүлэгдэнэ.
 */
export function interpolate(template, params, lang = DEFAULT_UI_LANG) {
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => {
    const v = params?.[name];
    if (v == null) return whole;
    if (typeof v === "object") {
      // Дотроо багцсан хэллэг (action label, гүйлгэх чиглэл): "[object Object]"
      // хэвлэхийн оронд мөн адил хэлээр хөрвүүлнэ.
      return v.key ? t(lang, v.key, v.params) : whole;
    }
    return String(v);
  });
}

/** Нэг lookup, эсвэл байхгүй үед key өөрөө — дутуу key чанга байх ёстой. */
export function t(lang, key, params) {
  const code = resolveUiLang(lang);
  const tpl = STRINGS[code]?.[key] ?? STRINGS[DEFAULT_UI_LANG][key];
  return tpl == null ? String(key) : interpolate(tpl, params, code);
}

/** Curried хэлбэр, нэг хэлээр олон key хөрвүүлдэг call site-д зориулав. */
export function makeT(lang = DEFAULT_UI_LANG) {
  return (key, params) => t(lang, key, params);
}

/**
 * Action-ийг орчуулагдах хэллэг ба өгөгдөл гэж хоёр хуваана.
 *
 * Action хэрхэн уншигдахын нэг эх сурвалж нь энэ бөгөөд дараах хоёул үүгээр дамжина:
 *   - policy.describe(action)      — АНГЛИ, модель руу
 *                                    pending_confirmation болж илгээгддэг. Хөлдөөсөн.
 *   - удирдлагын хуудсын log/toast/verdict — UI хэлээр хөрвүүлэгдэнэ.
 * Хоёулаа эндээс гардаг тул модель хардаг англи ба уншигчийн хардаг монгол
 * нь action-ийг хэзээ ч өөрөөр дүрслэж чадахгүй.
 *
 * Action-ий өөрийн `label` нь бүхэл өгүүлбэр болсон үед null буцаана (тэр нь
 * buildAction-аас key-тэй эсэхээс үл хамааран аль хэдийн ирсэн байдаг).
 */
export function actionParts(action) {
  if (!action) return null;
  const target = action.labelKey ?? action.label ?? null;
  switch (action.type) {
    case "navigate_url":
      return { key: "action.open", params: { target: target ?? action.url } };
    case "click_element":
      return { key: "action.click", params: { target: target ?? action.targetId } };
    case "type_into_field":
      return {
        key: action.submit ? "action.typeEnter" : "action.type",
        params: { text: action.text, target: target ?? action.targetId },
      };
    case "select_option":
      return { key: "action.select", params: { text: action.text, target: target ?? action.targetId } };
    default:
      return action.labelKey ?? null;
  }
}

/** Уншигчид зориулж хөрвүүлсэн action. Англи label руу буцна. */
export function actionLabel(action, lang = DEFAULT_UI_LANG) {
  if (!action) return "";
  const parts = actionParts(action);
  if (parts && has(DEFAULT_UI_LANG, parts.key)) return t(lang, parts.key, parts.params);
  return action.label || String(action.type || "").replace(/_/g, " ");
}

/**
 * Action-ийг өөр хэллэгт ("… {action}-ийн дараа") суулгах placeholder утга
 * болгон. key-тэй хэлбэргүй action ч объект биш утга болох ёстой тул
 * pass-through-д ороодог.
 */
export function actionRef(action) {
  return actionParts(action) ?? { key: "action.other", params: { target: action?.label ?? String(action?.type ?? "").replace(/_/g, " ") } };
}

/**
 * Key-ийн багц ба placeholder-ийн lint, ингэснээр `npm test` дутуу орчуулга
 * дээр унах ба хэрэглэгч дэлгэцэн дээр "log.acted"-тай таарахгүй. Цэвэр
 * өгөгдөл оруулж, цэвэр өгөгдөл гаргана — assertion-ууд тестэд байна.
 */
export function keyCoverage() {
  const langs = Object.keys(STRINGS);
  const keysOf = (l) => new Set(Object.keys(STRINGS[l]));
  const union = new Set(langs.flatMap((l) => [...keysOf(l)]));
  const missingLang = [];
  const extraLang = [];
  for (const key of union) {
    for (const l of langs) {
      if (!keysOf(l).has(key)) missingLang.push({ lang: l, key });
      if (key === undefined) extraLang.push({ lang: l, key });
    }
  }
  // {placeholder}-ийг хаясан орчуулга мэдээллийг чимээгүй алддаг тул key
  // бүрийн placeholder-ийн багцыг хэлнүүдээр харьцуулна.
  const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  const paramDrift = [];
  for (const key of union) {
    const base = STRINGS[DEFAULT_UI_LANG][key];
    if (base == null) continue;
    for (const l of langs) {
      const other = STRINGS[l]?.[key];
      if (other == null) continue;
      const want = placeholders(base);
      const got = placeholders(other);
      const same = want.size === got.size && [...want].every((p) => got.has(p));
      if (!same) paramDrift.push({ key, lang: l, want: [...want].sort(), got: [...got].sort() });
    }
  }
  return { missingLang, extraLang, paramDrift };
}
