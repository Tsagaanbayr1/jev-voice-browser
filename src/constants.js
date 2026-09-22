/**
 * Jev-ийн харж буй бүх зүйл болон policy-гийн хэрэглэдэг бүх threshold-ийг нэг дор хянадаг газар.
 *
 * Jev (TypeSafe "System One") текст үүсгэдэггүй. Request бүр одоогийн `state`-ийг
 * (transcript + page snapshot) болон бие даан, зэрэгцэн хариулагддаг typed асуултуудын
 * fan-out-ийн хамт дагуулна. Control flow-г код эзэмшинэ.
 *
 * Энд хэрэглэсэн дүрмүүд (docs.typesafe.ai-с):
 *  - question id-ууд модельд илгээгддэггүй, тиймээс `instructions` бүр бүрэн асуулт байна
 *  - state-ийг backtick-тай path-аар (`transcript`, `page.site`, `elements`) заана
 *  - Choice option-ууд ижил contrastive хэлбэр {what, not_for, examples} хэрэглэнэ
 *  - үргэлж `none` option оруулна; Jev-ээс хэзээ ч тоолох, үүсгэхийг бүү хүс
 */

import { getLang } from "./lang.js";

export const MODEL = "jev-1.13.0"; // pinned: alias-ууд release бүрт шилждэг, доорх threshold-ууд энэ хувилбар дээр тааруулагдсан

export const PRICE_PER_M_INPUT_TOKENS_USD = 0.042; // output token үнэгүй

// ---------------------------------------------------------------------------
// Perception-ийн хязгаарууд (state-ийн хэмжээ нарийвчлал + latency-д хор хөнөөлтэй; бага байлга)
// ---------------------------------------------------------------------------
export const MAX_ELEMENTS = 100; // Jev-д илгээх element-ийн хатуу дээд хязгаар (255 бол Choice-ийн хязгаар; latency token-той хамт өсдөг)
export const MAX_ELEMENT_TEXT = 60; // element label бүрийн тэмдэгтийн тоо
export const MAX_STATE_CHARS = 24_000; // ~6k token; 32k-token state-ийн хязгаараас хамаагүй доогуур
export const MAX_TRANSCRIPT_CHARS = 400;

// ---------------------------------------------------------------------------
// Хугацаа
// ---------------------------------------------------------------------------
export const DEBOUNCE_MS = 200; // debounce: сүүлийн transcript update-ийн дараа Jev-ээс асуухаас өмнө энэ хугацааг хүлээ
export const MAX_INFLIGHT = 2; // зэрэг явахыг зөвшөөрөх Jev request-ийн тоо; хуучин нь AbortSignal-аар цуцлагдана
export const SILENCE_COMPLETE_MS = 900; // энэ хугацаанд шинэ үг гараагүй => командыг дууссан гэж үз
// Чөлөөт текст (query эсвэл бичих текст) дагуулдаг intent-уудыг өгүүлбэрийн дунд гүйцэтгэж
// болохгүй — "search for alan" дууссан мэт сонсогддог ч payload нь өсөж байж болно. Тэдгээр нь
// recognizer-ийн эцсийн үр дүн эсвэл энэ хэмжээний чимээгүй байдлыг хүлээнэ.
export const PAYLOAD_SILENCE_MS = 600;
export const PAYLOAD_INTENTS = new Set(["search_web", "type_into_field", "select_option"]);
export const HIGHLIGHT_MS = 600; // удирдаж буй хуудсан дээрх element-ийн flash
export const CANDIDATE_TTL_MS = 8000; // дугаартай overlay-ууд энэ хугацаагаар үлдэнэ

// ---------------------------------------------------------------------------
// Гүйцэтгэлийн policy threshold-ууд (UI-д харагддаг "яагаад act / wait болсон" гэсэн тоонууд)
// ---------------------------------------------------------------------------
export const T = {
  intentConfidence: 0.55, // ер нь act хийхэд шаардлагатай `intent` Choice confidence
  complete: 0.6, // `complete` Noul: хэрэглэгч командаа дуусгасан (SILENCE_COMPLETE_MS-ийн дараа тойрч гарна)
  isCommand: 0.5, // `is_command` Noul: хэрэглэгч ер нь браузер руу хандаж байгаа эсэх
  destructive: 0.5, // `destructive` Noul үүнээс дээш => confirmation шаардна ...
  destructiveIntentConfidence: 0.9, // ... харин intent confidence энэ хэмжээнд өндөр БА хэрэглэгч аль хэдийн "confirm" гэсэн бол эс тохиолдоно
  targetConfidence: 0.45, // `target` Choice үүнээс доош => дарахын оронд дугаартай candidate overlay-уудыг харуул
  targetTopProb: 0.35, // мөн ялсан element дор хаяж ийм probability-тай байх ёстой
  spanConfidence: 0.35, // `text_span` / `url_span`-ийн сонголт үүнээс доош бол heuristic candidate руу шилжинэ
  candidateCount: 3, // target тодорхойгүй үед хэдэн candidate overlay хийх
};

export const TARGET_INTENTS = new Set(["click_element", "type_into_field", "select_option"]);

// ---------------------------------------------------------------------------
// Сайтууд (URL-ийг код эзэмшинэ; Jev зөвхөн нэрийг сонгоно)
// ---------------------------------------------------------------------------
export const SITE_HOME = {
  google: "https://www.google.com/",
  duckduckgo: "https://duckduckgo.com/",
  youtube: "https://www.youtube.com/",
  wikipedia: "https://en.wikipedia.org/wiki/Main_Page",
  github: "https://github.com/",
  amazon: "https://www.amazon.com/",
  reddit: "https://www.reddit.com/",
  twitter_x: "https://x.com/",
  hacker_news: "https://news.ycombinator.com/",
  example_com: "https://example.com/",
};

// Хайлтын URL template-ууд; `%s` нь URL-encode хийсэн query-гээр солигдоно.
export const SITE_SEARCH = {
  google: "https://www.google.com/search?q=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
  the_web: "https://duckduckgo.com/?q=%s",
  youtube: "https://www.youtube.com/results?search_query=%s",
  wikipedia: "https://en.wikipedia.org/w/index.php?search=%s",
  github: "https://github.com/search?q=%s&type=repositories",
  amazon: "https://www.amazon.com/s?k=%s",
  reddit: "https://www.reddit.com/search/?q=%s",
  twitter_x: "https://x.com/search?q=%s",
  hacker_news: "https://hn.algolia.com/?q=%s",
};

export const DEFAULT_SEARCH_ENGINE = "duckduckgo";

/**
 * Яригдсан хэлний destination-ууд: дээрх default-ууд, language pack-аар дарж
 * бичигдэнэ (Монгол хэл "википедиа"-г mn.wikipedia.org руу илгээнэ).
 */
export function sitesFor(lang) {
  const pack = getLang(lang);
  return {
    home: { ...SITE_HOME, ...pack.siteHome },
    search: { ...SITE_SEARCH, ...pack.siteSearch },
  };
}

// ---------------------------------------------------------------------------
// Асуултууд. Бүгд transcript update бүрт НЭГ request-ээр асуугдана (speculative fan-out).
// ---------------------------------------------------------------------------

export const INTENT_CRITERIA = {
  navigate_url: {
    what: "Open a specific website or URL by name (go to / open / visit / take me to <site>)",
    not_for: "Searching for a topic; clicking something already on the page",
    examples: ["go to wikipedia", "open youtube", "take me to github.com", "visit example dot com"],
  },
  search_web: {
    what: "Search for a topic or phrase (search for / look up / google / find <query>), on the web or on a named site",
    not_for: "Typing into a specific named field without searching; opening a site's homepage",
    examples: ["search for alan turing", "look up typesafe jev", "google cheap flights", "search wikipedia for cats"],
  },
  click_element: {
    what: "Click / press / open / select / choose a link, button, tab, result or item that is on the current page",
    not_for: "Opening a website by name; typing text",
    examples: ["click the first result", "click sign in", "open the second link", "press the more information link"],
  },
  type_into_field: {
    what: "Type or enter specific text into an input box, search box or text field on the page",
    not_for: "Running a search on a search engine (that is search_web); pressing enter alone",
    examples: ["type hello world into the search box", "enter my email", "write good morning in the comment box"],
  },
  select_option: {
    what: "Choose an option from a dropdown / select menu",
    not_for: "Clicking a link or button",
    examples: ["select english from the language dropdown", "choose the large size"],
  },
  press_enter: {
    what: "Press the Enter / Return key, or submit what was typed",
    not_for: "Typing text; clicking a named button",
    examples: ["press enter", "hit enter", "submit"],
  },
  scroll_down: {
    what: "Scroll / move down the page",
    not_for: "Scrolling up; navigating",
    examples: ["scroll down", "scroll down a bit", "go to the bottom", "page down"],
  },
  scroll_up: {
    what: "Scroll / move up the page",
    not_for: "Scrolling down",
    examples: ["scroll up", "back to the top", "page up"],
  },
  go_back: {
    what: "Go back to the previous page in history (back / go back / undo that / previous page)",
    not_for: "Scrolling up; closing a tab",
    examples: ["go back", "undo", "back", "previous page"],
  },
  go_forward: {
    what: "Go forward in history",
    not_for: "Scrolling down",
    examples: ["go forward", "forward"],
  },
  reload: {
    what: "Reload / refresh the current page",
    not_for: "Navigating elsewhere",
    examples: ["reload", "refresh the page"],
  },
  open_new_tab: {
    what: "Open a new empty tab",
    not_for: "Opening a website by name in the current tab",
    examples: ["open a new tab", "new tab"],
  },
  close_tab: {
    what: "Close the current tab",
    not_for: "Going back",
    examples: ["close this tab", "close tab"],
  },
  switch_tab: {
    what: "Switch to another / the next / the previous tab",
    not_for: "Opening or closing tabs",
    examples: ["next tab", "switch tab", "go to the other tab"],
  },
  confirm: {
    what: "Approve a pending action the browser asked to confirm (yes / confirm / do it / go ahead)",
    not_for: "New commands",
    examples: ["confirm", "yes do it", "go ahead"],
  },
  cancel: {
    what: "Cancel / never mind / stop the pending action",
    not_for: "Going back in history",
    examples: ["cancel", "never mind", "stop"],
  },
  none: {
    what: "Not a browser command, or nothing recognizable yet (fragment, chit-chat, silence, filler)",
    not_for: "Anything that clearly matches another option",
    examples: ["um", "okay so", "what do you think", "the weather is nice"],
  },
};

export const SITE_CRITERIA = {
  google: "Google (google, google it)",
  duckduckgo: "DuckDuckGo",
  the_web: "A general web search with no site named (search the web, look it up online)",
  youtube: "YouTube (videos)",
  wikipedia: "Wikipedia (the encyclopedia)",
  github: "GitHub (code, repositories)",
  amazon: "Amazon (shopping)",
  reddit: "Reddit",
  twitter_x: "Twitter / X",
  hacker_news: "Hacker News (news.ycombinator.com, hn)",
  example_com: "example.com / example dot com",
  other_named_site: "Some other website named explicitly in `transcript` (a domain or brand not listed above)",
  none: "No website or search engine is mentioned in `transcript`",
};

export const QUESTIONS = {
  intent: {
    instructions: {
      question: "Which browser action does the user ask for in `transcript`?",
      focus:
        "Judge the words said so far. If the sentence is unfinished, pick the action the words already commit to; if no action is recognizable pick none. `page` and `elements` describe what is currently on screen.",
    },
    criteria: INTENT_CRITERIA,
  },

  target: {
    instructions: {
      question:
        "Which element in `elements` is the one the user refers to in `transcript` (the thing to click, type into or select)? Each line of `elements` starts with the element id (e.g. e07), then its role and visible text; the options are those ids.",
      focus:
        "Match by the element's visible text, role and position words like first/second/top (lines are in visual order, top of page first). Pick none if the command does not refer to any element on this page, or if the referenced element is not in the list.",
    },
    // criteria нь request бүрт element-ийн жагсаалт + none-оос бүтээгдэнэ
  },

  site: {
    instructions: {
      question: "Which website or search engine does the user name in `transcript`?",
      focus: "Only what is explicitly said. Pick none if no site is named.",
    },
    criteria: SITE_CRITERIA,
  },

  complete: {
    instructions: {
      question:
        "Has the user finished saying the command in `transcript`, so it can be executed now without waiting for more words?",
      focus:
        "Speech arrives word by word. A command is complete when its verb and any required object are present (a site for go to, a query for search for, an element for click, text for type).",
    },
    criteria: {
      true: {
        what: "Complete, actionable command",
        examples: ["scroll down", "go back", "go to wikipedia", "search for alan turing", "click the first result"],
      },
      false: {
        what: "Cut off before the required object; more words are clearly coming",
        examples: ["go to", "search for", "click the", "type", "open the"],
      },
    },
  },

  is_command: {
    instructions: {
      question:
        "Is `transcript` an instruction addressed to a web browser (navigate, search, click, type, scroll, tabs, confirm/cancel)?",
      focus: "Chit-chat, narration, talking to another person, or a stray fragment is not a command.",
    },
    criteria: {
      true: { what: "An imperative aimed at the browser", examples: ["scroll down", "go to youtube", "click sign in"] },
      false: {
        what: "Not directed at the browser",
        examples: ["I think we should get lunch", "um so yeah", "this is the demo", "what did you say"],
      },
    },
  },

  destructive: {
    instructions: {
      question:
        "Would carrying out the action in `transcript` on this `page` submit a form, place an order, pay, delete, send a message, post publicly, log out, or otherwise do something hard to undo?",
      focus: "Navigating, scrolling, reading, clicking links and typing into a box are NOT destructive.",
    },
    criteria: {
      true: {
        what: "Irreversible side effect",
        examples: ["click buy now", "delete this repository", "send the message", "post the comment", "click checkout"],
      },
      false: {
        what: "Reversible / read-only",
        examples: ["scroll down", "go to wikipedia", "click the first result", "type hello in the search box"],
      },
    },
  },

  scroll_amount: {
    instructions: {
      question: "How far does the user want to scroll according to `transcript`?",
      focus: "Only relevant when scrolling; default is one screen when nothing is specified.",
    },
    criteria: [
      { what: "A little: a few lines (a bit, slightly, a little)" },
      { what: "One screen / one page, or no amount specified" },
      { what: "All the way to the end: the very top or the very bottom" },
    ],
  },

  text_span: {
    instructions: {
      question:
        "Which option is exactly the text the user wants typed or searched, as spoken in `transcript`? Options are verbatim candidate spans.",
      focus:
        "Choose the span that contains the payload text only, without the command words (type, search for, into the search box). Pick none if nothing should be typed.",
    },
  },

  url_span: {
    instructions: {
      question: "Which option is the web address (domain) the user wants to open, as spoken in `transcript`?",
      focus: "Pick none if no address is mentioned.",
    },
  },

  tab_direction: {
    instructions: {
      question: "When switching tabs, which tab does `transcript` refer to?",
    },
    criteria: {
      next: "The next tab / the other tab / switch tab with no direction",
      previous: "The previous tab / the tab before / last tab",
      first: "The first tab",
      none: "Not about switching tabs",
    },
  },
};

// ---------------------------------------------------------------------------
// Хэл тус бүрийн асуултууд
// ---------------------------------------------------------------------------

/**
 * QUESTIONS дээр яригдсан хэлний example-ууд нэмэгдсэн хувилбар.
 *
 * Асуултын үг English хэвээр үлдэнэ — Jev English instruction-уудыг уншиж, Монгол
 * `transcript`-ийг зөв шүүдэг — гэхдээ EXAMPLE-ууд яригдсан хэлийг заавал агуулах
 * ёстой. jev-1.13.0 дээр зөвхөн English example-тай хэмжихэд: "буцах" (go back)
 * нь intent=none авсан, "Алан Туринг хай" (search for Alan Turing) нь is_command
 * 0.22 авч, 0.5 gate-аас доогуур байсан тул хоёулаа үл тоомсорлогдсон.
 */
export function questionsForLang(lang) {
  const pack = getLang(lang);
  const q = structuredClone(QUESTIONS);
  if (pack.code === "en") return q;

  const add = (target, extra) => {
    if (!extra?.length) return;
    target.examples = [...(target.examples ?? []), ...extra];
  };

  for (const [intent, examples] of Object.entries(pack.intentExamples)) {
    if (q.intent.criteria[intent]) add(q.intent.criteria[intent], examples);
  }
  add(q.is_command.criteria.true, pack.isCommandExamples?.true);
  add(q.is_command.criteria.false, pack.isCommandExamples?.false);
  add(q.complete.criteria.true, pack.completeExamples?.true);
  add(q.complete.criteria.false, pack.completeExamples?.false);

  (pack.scrollAmountWords ?? []).forEach((words, i) => {
    if (q.scroll_amount.criteria[i]) {
      q.scroll_amount.criteria[i].what = `${q.scroll_amount.criteria[i].what} — ${pack.label}: ${words}`;
    }
  });

  for (const [site, alias] of Object.entries(pack.siteAliases ?? {})) {
    if (typeof q.site.criteria[site] === "string") {
      q.site.criteria[site] = `${q.site.criteria[site]} — spoken in ${pack.label}: ${alias}`;
    }
  }

  // Хэлийг чанга хэлж өг, ингэснээр тэр хэл дээрх богино imperative нь chit-chat
  // эсвэл дутуу fragment гэж андуурагдахгүй.
  const note = ` \`transcript\` is speech in ${pack.label} (${pack.code}) or English; judge either language the same way.`;
  for (const key of ["intent", "is_command", "complete", "site", "destructive", "target", "text_span", "url_span", "scroll_amount"]) {
    const ins = q[key]?.instructions;
    if (ins && typeof ins === "object") ins.focus = `${ins.focus ?? ""}${note}`;
  }
  return q;
}
