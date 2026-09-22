/**
 * Монгол хэлний benchmark case-үүдийн жагсаалт, integration test
 * (`jev-mn.test.js`) болон тайлангийн runner (`scripts/benchmark-mn.js`) хамтран ашиглана.
 *
 * Транскрипт бүр монгол бөгөөд capture хийсэн хуудасны fixture-тэй хамт
 * БОДИТ Jev API руу явна. `snapshot` нь test/fixtures/ доторх файлыг заана.
 *
 * ЯАГААД БАЙГАА ВЭ: Jev зөвхөн англи жишээтэй ч монголыг сайн ойлгодог, гэвч
 * jev-1.13.0 дээр хоёр gate чимээгүй унаж байв — "буцах" (go back) нь
 * intent=none авч, "Алан Туринг хай" (search for Alan Turing) нь is_command
 * 0.22 авсан нь 0.5 gate-ээс доогуур байлаа. Хоёулаа act хийхийн оронд ignore болж байв.
 */
export const CASES = [
  // navigation: монгол сайтын нэр, болон хэлэх domain ("цэг" = dot)
  { name: "википедиа руу яв", transcript: "википедиа руу яв", snapshot: "example", intent: "navigate_url", decision: "act", url: "wikipedia.org" },
  { name: "ютуб нээ", transcript: "ютуб нээ", snapshot: "hn", intent: "navigate_url", decision: "act", url: "youtube.com" },
  { name: "жишээ цэг ком руу яв", transcript: "жишээ цэг ком руу яв", snapshot: "hn", intent: "navigate_url", decision: "act" },

  // search: payload нь үйл үгнээс ӨМНӨ ирдэг
  { name: "Алан Туринг хай", transcript: "Алан Туринг хай", snapshot: "wikipedia-main", intent: "search_web", decision: "act", text: "Алан Туринг" },
  { name: "ютуб дээр хөгжим хай", transcript: "ютуб дээр хөгжим хай", snapshot: "hn", intent: "search_web", decision: "act", text: "хөгжим" },

  // typing: очих газар ЭХЭНД ирдэг
  { name: "хайлтын талбарт бич", transcript: "хайлтын талбарт сайн байна уу гэж бич", snapshot: "wikipedia-main", intent: "type_into_field", text: "сайн байна уу", decision: "act" },

  // page control — өмнө нь ignore болж байсан хоёр
  { name: "доош гүйлгэ", transcript: "доош гүйлгэ", snapshot: "wikipedia-article", intent: "scroll_down", decision: "act" },
  { name: "жаахан доош гүйлгэ", transcript: "жаахан доош гүйлгэ", snapshot: "wikipedia-article", intent: "scroll_down", decision: "act", amount: "little" },
  { name: "дээш гүйлгэ", transcript: "дээш гүйлгэ", snapshot: "hn", intent: "scroll_up", decision: "act" },
  { name: "буцах", transcript: "буцах", snapshot: "wikipedia-article", intent: "go_back", decision: "act" },
  { name: "хуудсыг дахин ачаал", transcript: "хуудсыг дахин ачаал", snapshot: "hn", intent: "reload", decision: "act" },
  { name: "шинэ таб нээ", transcript: "шинэ таб нээ", snapshot: "hn", intent: "open_new_tab", decision: "act" },

  // харагдах текстээр дарах
  { name: "нэмэлт мэдээлэл дээр дар", transcript: "нэмэлт мэдээлэл холбоос дээр дар", snapshot: "example", intent: "click_element", decisionIn: ["act", "disambiguate"] },

  // chit-chat монгол дээр ч ignore хэвээр байх ёстой
  { name: "chit-chat алгасагдана", transcript: "өнөөдөр цаг агаар сайхан байна", snapshot: "hn", decision: "ignore" },
  { name: "chit-chat алгасагдана 2", transcript: "би өдрийн хоол идмээр байна", snapshot: "hn", decision: "ignore" },

  // дутуу тушаал хүлээх ёстой, тасарсан payload дээр act хийхгүй
  { name: "дутуу тушаал хүлээнэ", transcript: "Алан", snapshot: "wikipedia-main", final: false, decisionIn: ["wait", "ignore"] },
];
