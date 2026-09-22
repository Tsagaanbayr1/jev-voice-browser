/**
 * Language pack-ууд: яригдаж буй хэлнээс хамаарах бүх зүйл.
 *
 * Энд хоёр тусдаа concern байна:
 *
 *  1. КОДЫН ЭЗЭМШИЛДЭХ parsing — candidate text span-ууд, хэлэгдэх domain
 *     ("цэг ком"), дугаартай overlay-д зориулсан тооны үгс. Jev эдгээрийг хэзээ
 *     ч үүсгэдэггүй; код тэдгээрийг extract хийж, Jev зөвхөн нэгийг сонгодог
 *     тул тэдгээр нь хэл тус бүрийн байх ёстой.
 *  2. Jev-ийн асуултуудад зориулсан EXAMPLE-УУД. Асуултын үг англи хэвээр
 *     үлддэг (Jev үүнийг сайн уншдаг), гэхдээ intent бүр яригддаг хэлээр
 *     example авдаг. Хэмжсэн: зөвхөн англи example-тай үед Jev монгол
 *     командуудыг сайн уншсан ч "буцах"-ыг none гэж оноож, монгол хайлтыг
 *     is_command 0.22 гэж үнэлсэн — 0.5 gate-ээс доогуур тул үл тоомсорлогдсон.
 *
 * ҮГИЙН ДАРААЛАЛ: англи хэл payload-ыг үйл үгийн дараа тавьдаг ("search for
 * cats"), монгол хэл түүнийг өмнө тавьдаг ("муур хай" = cats search). Тиймээс
 * `textVerbsLeading` (payload дагаж) ба `textVerbsTrailing` (payload өмнө нь)
 * хоёулаа байна.
 */

// ---------------------------------------------------------------------------
// Англи
// ---------------------------------------------------------------------------

const en = {
  code: "en",
  label: "English",
  speechLang: "en-US",

  fillerRe: /\b(please|thanks|thank you|now|okay|ok|um|uh|and then)\b/gi,

  textVerbsLeading: [
    /\b(?:search|look)\s+(?:for|up)\s+/i,
    /\bsearch\s+(?:on\s+)?(?:google|duckduckgo|wikipedia|youtube|github|amazon|reddit|twitter|x|hacker news|the web)\s+for\s+/i,
    /\bsearch\s+/i,
    /\bgoogle\s+/i,
    /\bfind\s+/i,
    /\btype\s+(?:in\s+)?/i,
    /\benter\s+/i,
    /\bwrite\s+/i,
    /\bput\s+/i,
    /\bfill\s+(?:in\s+)?/i,
  ],
  textVerbsTrailing: [],

  trailingDestRe:
    /\s+(?:in|into|on|inside|to)\s+(?:the\s+)?(?:[\w-]+\s+){0,4}?(?:box|field|input|bar|form|textarea|search|wikipedia|youtube|google|duckduckgo|github|amazon|reddit|twitter|x|web)\b.*$/i,
  // Англи хэл destination-ыг payload-ийн дараа хэлдэг тул урдаас нь
  // авах зүйл байхгүй.
  leadingDestRe: null,
  leadingSiteRe:
    /^(?:on\s+|in\s+)?(?:google|duckduckgo|wikipedia|youtube|github|amazon|reddit|twitter|x|hacker news|the web)\s+(?:for\s+)?/i,

  // Хэлэгдэх domain-ууд: "example dot com" -> "example.com"
  urlReplacements: [
    [/\s+dot\s+/g, "."],
    [/\s+slash\s+/g, "/"],
  ],

  numberWords: {
    one: 1, first: 1, 1: 1, "1st": 1,
    two: 2, second: 2, 2: 2, "2nd": 2,
    three: 3, third: 3, 3: 3, "3rd": 3,
    four: 4, fourth: 4, 4: 4, "4th": 4,
    five: 5, fifth: 5, 5: 5, "5th": 5,
  },
  // Зөвхөн бүхэл utterance болж итгэгдэнэ ("to" ганцаараа "two" гэсэн утгатай).
  numberHomophones: { won: 1, to: 2, too: 2, for: 4 },
  pickStopwords: [
    "the", "number", "option", "pick", "choose", "select", "click", "take",
    "that", "please", "link", "item", "result", "go", "with", "on", "yes", "this", "um", "uh",
  ],

  // Хэл тус бүрийн destination-ууд. constants.js-ийн default-ууд дээр нэгтгэгдэнэ.
  siteHome: {},
  siteSearch: {},

  intentExamples: {},
  isCommandExamples: { true: [], false: [] },
  completeExamples: { true: [], false: [] },
  siteAliases: {},
  // Гурван scroll-ийн зайны level-ийн үгс, дарааллаараа (бага / нэг дэлгэц / бүх зам).
  scrollAmountWords: [],
};

// ---------------------------------------------------------------------------
// Монгол (Кирилл)
// ---------------------------------------------------------------------------

const mn = {
  code: "mn",
  label: "Монгол",
  speechLang: "mn-MN",

  // "за" болон "тэгээд" нь ярианы холбоос, "okay" болон "and then" шиг.
  fillerRe: /(?:^|\s)(?:за|тэгээд|нээрээ|ээ|өө|уучлаарай|гуйя|баярлалаа)(?=\s|$)/gi,

  // Монгол хэл үйл үгээр төгсдөг тул ихэнх payload үйл үгийн ӨМНӨ ордог.
  textVerbsLeading: [/\bхайлт\s+хий(?:х)?\s+/i],
  textVerbsTrailing: [
    // "... хай / хайх / хайж ол" нь "хайх ..." гэсэн утгатай
    /\s*(?:гэж\s+)?(?:хай(?:x|х|ж\s+ол(?:оорой|ооч)?|на|аарай|гаарай)?|хайлт\s+хий(?:х|нэ)?)\s*$/i,
    // "... бич / бичих / оруул" нь "бичих ..." гэсэн утгатай
    /\s*(?:гэж\s+)?(?:бич(?:ээрэй|ээч|нэ|их)?|оруул(?:аарай|ах|на)?|бөглө(?:х|нө)?)\s*$/i,
  ],

  // Монгол хэл destination-оо түрүүлж хэлдэг: "хайлтын талбарт сайн байна уу гэж бич"
  // = "into the search box, type hello". Payload-ын өмнө тэр толгойг нь хасна.
  leadingDestRe:
    /^(?:[\u0400-\u04FFa-z0-9-]+\s+){0,3}?(?:талбарт|талбар\s+руу|талбарруу|нүдэнд|хэсэгт|мөрөнд|цонхонд|хайлтад|хайлтын\s+мөрөнд)\s+/i,
  trailingDestRe:
    /\s+(?:[\wа-яөүё-]+\s+){0,3}?(?:талбар|талбарт|талбарруу|хэсэгт|нүдэнд|нүдэн|мөрөнд|цонхонд|хайлтад)\b.*$/i,
  // "википедиа дээр муур хай" -> "муур хай"
  leadingSiteRe:
    /^(?:гүүгл|гугл|google|ютуб|ютюб|youtube|википедиа|википеди|wikipedia|гитхаб|github|амазон|amazon|реддит|reddit|твиттер|twitter|дакдакгоу|duckduckgo|интернет|вэб)\s+(?:дээр(?:ээс)?|-с|аас|ээс|оос)?\s*/i,

  // Хэлэгдэх domain-ууд: "жишээ цэг ком" -> "жишээ.com"; recognizer-ууд TLD-г
  // ихэвчлэн кириллээр бичдэг тул түгээмэлүүдийг нь ASCII руу буцааж map хийнэ.
  urlReplacements: [
    [/\s+цэг\s+/g, "."],
    [/\s+тэмдэг\s+/g, "."],
    [/\s+ташуу\s+зураас\s+/g, "/"],
    [/\s+слаш\s+/g, "/"],
    // NB: \b нь JS-д зөвхөн ASCII бөгөөд кирилл үсгийн дараа хэзээ ч ажиллахгүй
    // тул эдгээр нь оронд нь тодорхой "төгсгөл эсвэл үсэг биш" lookahead ашиглана.
    [/\.ком(?![\u0400-\u04FF\w])/g, ".com"],
    [/\.орг(?![\u0400-\u04FF\w])/g, ".org"],
    [/\.нэт(?![\u0400-\u04FF\w])/g, ".net"],
    [/\.мн(?![\u0400-\u04FF\w])/g, ".mn"],
  ],

  numberWords: {
    нэг: 1, эхний: 1, нэгдүгээр: 1, нэгдэх: 1, 1: 1,
    хоёр: 2, хоёрдугаар: 2, хоёрдахь: 2, хоёрдох: 2, 2: 2,
    гурав: 3, гуравдугаар: 3, гуравдахь: 3, гурван: 3, 3: 3,
    дөрөв: 4, дөрөвдүгээр: 4, дөрөвдэх: 4, дөрвөн: 4, 4: 4,
    тав: 5, тавдугаар: 5, тавдахь: 5, таван: 5, 5: 5,
  },
  numberHomophones: {},
  pickStopwords: [
    "дахь", "дэх", "дугаар", "дүгээр", "нь", "тэр", "энэ", "үүнийг", "дээр",
    "дар", "дараарай", "сонго", "сонгоорой", "тоо", "хувилбар", "холбоос", "тийм", "за",
  ],

  // Монгол Wikipedia, ба монгол хэл дээрх Google.
  siteHome: {
    wikipedia: "https://mn.wikipedia.org/wiki/Нүүр_хуудас",
  },
  siteSearch: {
    wikipedia: "https://mn.wikipedia.org/w/index.php?search=%s",
    google: "https://www.google.com/search?q=%s&hl=mn",
  },

  // Jev-ийн хардаг example-ууд, монголоор. Эдгээр нь сул тохиолдлуудыг өргөдөг.
  intentExamples: {
    navigate_url: ["википедиа руу яв", "ютуб нээ", "гүүгл рүү оч", "жишээ цэг ком руу яв"],
    search_web: ["Алан Туринг хай", "муурны тухай хайлт хий", "ютуб дээр хөгжим хай", "нисэх тийз хай"],
    click_element: ["эхний холбоос дээр дар", "нэвтрэх товч дээр дар", "хоёр дахь холбоосыг нээ", "сэтгэгдэл таб дээр дар"],
    type_into_field: ["хайлтын талбарт сайн байна уу гэж бич", "и-мэйлээ оруул", "нэрээ бич"],
    select_option: ["жагсаалтаас монгол хэлийг сонго", "том хэмжээг сонго"],
    press_enter: ["enter дар", "илгээ", "оруулах товч дар"],
    scroll_down: ["доош гүйлгэ", "доошоо гүйлгээрэй", "жаахан доош гүйлгэ", "хуудасны төгсгөл рүү оч"],
    scroll_up: ["дээш гүйлгэ", "дээшээ гүйлгээрэй", "хамгийн дээш оч"],
    go_back: ["буцах", "буцаад яв", "өмнөх хуудас руу буц", "болих буцъя"],
    go_forward: ["урагшаа", "дараагийн хуудас руу"],
    reload: ["хуудсыг дахин ачаал", "сэргээ", "шинэчил"],
    open_new_tab: ["шинэ таб нээ", "шинэ цонх нээ"],
    close_tab: ["энэ табыг хаа", "табыг хаа"],
    switch_tab: ["дараагийн таб руу шилж", "нөгөө таб руу оч"],
    confirm: ["тийм", "батлаж байна", "зөвшөөрч байна", "үргэлжлүүл"],
    cancel: ["болих", "хэрэггүй", "үгүй", "зогсоо"],
    none: ["өнөөдөр цаг агаар сайхан байна", "за тэгээд", "чи юу гэж хэлсэн бэ", "би өдрийн хоол идмээр байна"],
  },
  isCommandExamples: {
    true: ["доош гүйлгэ", "ютуб руу яв", "нэвтрэх дээр дар", "Алан Туринг хай", "буцах"],
    false: ["өнөөдөр цаг агаар сайхан байна", "би өдрийн хоол идмээр байна", "энэ бол үзүүлбэр", "чи юу гэсэн бэ"],
  },
  completeExamples: {
    true: ["доош гүйлгэ", "буцах", "википедиа руу яв", "Алан Туринг хай", "эхний холбоос дээр дар"],
    false: ["... руу яв", "хай", "дээр дар", "бич"],
  },
  // Score-ийн level-үүд англиар тодорхойлогдсон; эдгээргүйгээр "жаахан доош
  // гүйлгэ" (scroll down a BIT) бүтэн хуудас гүйлгэсэн.
  scrollAmountWords: [
    "жаахан, бага зэрэг, багахан, хэсэг зэрэг",
    "нэг дэлгэц, нэг хуудас, хэмжээ заагаагүй",
    "хамгийн доош, хамгийн дээш, төгсгөл хүртэл, эхэнд нь, адагт нь",
  ],
  // Хэлэгдэх монгол нэрс таарахын тулд site-ийн асуултын criteria-д хавсаргагдана.
  siteAliases: {
    google: "гүүгл, гугл",
    youtube: "ютуб, ютюб",
    wikipedia: "википедиа, википеди",
    github: "гитхаб",
    amazon: "амазон",
    reddit: "реддит",
    twitter_x: "твиттер",
    duckduckgo: "дакдакгоу",
    the_web: "интернэт, вэб дээр",
  },
};

export const LANGUAGES = { en, mn };
export const DEFAULT_LANG = "en";

const CYRILLIC_RE = /[Ѐ-ӿ]/;

/** Кодоор language pack, англи руу fallback хийнэ. */
export function getLang(code) {
  return LANGUAGES[String(code || "").toLowerCase()] ?? LANGUAGES[DEFAULT_LANG];
}

/**
 * Transcript-ыг PARSE хийх pack. UI нь англи хэлээр тохируулагдсан ч кирилл
 * текстийг монгол хэлээр parse хийдэг тул буруу тохируулсан selector нь монголоор
 * тодорхой ярьж буй хүний span extraction-ыг чимээгүй эвдэж чадахгүй.
 */
export function packForTranscript(text, code = DEFAULT_LANG) {
  if (CYRILLIC_RE.test(String(text || ""))) return LANGUAGES.mn;
  return getLang(code);
}

export function isSupportedLang(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, String(code || "").toLowerCase());
}
