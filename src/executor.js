/**
 * Playwright-аар удирдаж буй browser дээр policy action-ыг гүйцэтгэнэ.
 * Page дээр overlay feedback (highlight + toast) харуулна.
 *
 * TOAST-УУД RENDER ХИЙГДДЭГ, ХАДГАЛАГДДАГГҮЙ. Тэдгээр нь page дээр нэг удаа
 * буудаг ба хэдхэн секундын дараа арилдаг тул action log-оос ялгаатай нь дараа
 * нь дахин render хийх зүйл байхгүй: тэдгээр нь controller дамжуулсан interface
 * хэлээр энд, яг одоо форматлагдана. `detail` өөр — тэрээр controller руу буцаж,
 * log руу орж, toast-оос урт насалдаг тул prose detail нь англи дүрслэлийнхээ
 * хажууд KEY (`detailKey`) болж гарна, яг л log шиг.
 */
import { HIGHLIGHT_MS } from "./constants.js";
import { t as tr, actionLabel, DEFAULT_UI_LANG } from "./public/i18n.js";

const NAV_TIMEOUT = 15000;

/** Prose detail: log/terminal-д англи, page-д key-тэй. */
function detail(key, params = {}) {
  return { detail: tr("en", key, params), detailKey: { key, params } };
}

function locatorFor(page, id) {
  return page.locator(`[data-vb-id="${id}"]`).first();
}

async function settle(page, ms = 2500) {
  await Promise.race([page.waitForLoadState("domcontentloaded").catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  await page.waitForTimeout(120);
}

/** Click-ийн дараа гарч болох шинэ tab-ыг хүлээнэ (target=_blank). */
async function maybeNewTab(browser, before) {
  await new Promise((r) => setTimeout(r, 400));
  const fresh = browser.pages.find((p) => !before.includes(p));
  if (fresh) await browser.setActive(fresh);
}

/**
 * @param {object} action  policy.evaluatePolicy-оос
 * @param {import('./browser.js').BrowserManager} browser
 * @param {{uiLang?: string}} [opts]  page-ийн toast-уудад зориулсан interface хэл
 * @returns {Promise<{ok: boolean, detail?: string, detailKey?: {key: string, params: object}}>}
 */
export async function execute(action, browser, { uiLang = DEFAULT_UI_LANG } = {}) {
  const page = await browser.ensurePage();
  // Label нь page дээр хүнд харагддаг тул interface хэлийг дагана. `describe()`
  // ч мөн адил англи өгөх байсан — энэ бол ижил table — гэхдээ энэ нь display
  // зам, model-ийн зам биш.
  const label = actionLabel(action, uiLang);
  const say = (key, params) => tr(uiLang, key, params);

  switch (action.type) {
    case "navigate_url": {
      await browser.overlay("toast", say("toast.navigate", { label }));
      const host = new URL(action.url).hostname.replace(/^www\./, "");
      try {
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      } catch (e) {
        // Түр зуурын network алдаа эсвэл load-ыг хэзээ ч өдөөдөггүй site: нэг удаа дахин
        // оролдоод, URL ядаж зөв host руу шилжсэн бол хүлээн зөвшөөрнө.
        await new Promise((r) => setTimeout(r, 500));
        await page.goto(action.url, { waitUntil: "commit", timeout: NAV_TIMEOUT }).catch(() => {});
        if (!page.url().includes(host)) throw e;
      }
      await settle(page, 800);
      return { ok: true, detail: page.url() };
    }

    case "click_element": {
      const before = [...browser.pages];
      await browser.overlay("clearCandidates");
      await browser.overlay("highlight", action.targetId, HIGHLIGHT_MS);
      await browser.overlay("toast", label);
      const loc = locatorFor(page, action.targetId);
      await new Promise((r) => setTimeout(r, 180)); // хүн highlight-ийг харж амжина
      try {
        await loc.click({ timeout: 4000 });
      } catch {
        await loc.evaluate((el) => el.click());
      }
      await settle(page);
      await maybeNewTab(browser, before);
      return { ok: true, detail: browser.page.url() };
    }

    case "type_into_field": {
      await browser.overlay("clearCandidates");
      await browser.overlay("highlight", action.targetId, HIGHLIGHT_MS + 400);
      await browser.overlay("toast", label);
      const loc = locatorFor(page, action.targetId);
      await loc.click({ timeout: 4000 }).catch(() => loc.focus());
      await loc.fill("").catch(() => {});
      await loc.pressSequentially(action.text, { delay: 18 }).catch(async () => loc.fill(action.text));
      if (action.submit) {
        await page.keyboard.press("Enter");
        await settle(page);
      }
      return { ok: true, detail: page.url() };
    }

    case "select_option": {
      await browser.overlay("highlight", action.targetId, HIGHLIGHT_MS);
      await browser.overlay("toast", label);
      const loc = locatorFor(page, action.targetId);
      // Option-ыг код дотор (case-insensitive, substring) label-ээр тааруулна.
      const picked = await loc.evaluate((sel, wanted) => {
        const w = wanted.toLowerCase();
        const opts = Array.from(sel.options || []);
        const hit = opts.find((o) => o.label.toLowerCase() === w) || opts.find((o) => o.label.toLowerCase().includes(w));
        if (!hit) return null;
        sel.value = hit.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return hit.label;
      }, action.text);
      return picked ? { ok: true, detail: picked } : { ok: false, ...detail("detail.noOption") };
    }

    case "press_enter":
      await browser.overlay("toast", say("toast.enter"));
      await page.keyboard.press("Enter");
      await settle(page);
      return { ok: true, detail: page.url() };

    case "scroll_down":
    case "scroll_up": {
      const dir = action.type === "scroll_down" ? 1 : -1;
      await browser.overlay("toast", label);
      await page.evaluate(
        ([dir, amount]) => {
          const vh = window.innerHeight;
          if (amount === "end") {
            window.scrollTo({ top: dir > 0 ? document.documentElement.scrollHeight : 0, behavior: "smooth" });
          } else {
            const px = amount === "little" ? vh * 0.35 : vh * 0.85;
            window.scrollBy({ top: dir * px, behavior: "smooth" });
          }
        },
        [dir, action.amount || "page"],
      );
      await page.waitForTimeout(350);
      return { ok: true, detail: `scrollY=${await page.evaluate(() => Math.round(window.scrollY))}` };
    }

    case "go_back":
      await browser.overlay("toast", say("toast.back"));
      await page.goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
      await settle(page, 800);
      return { ok: true, detail: page.url() };

    case "go_forward":
      await browser.overlay("toast", say("toast.forward"));
      await page.goForward({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
      await settle(page, 800);
      return { ok: true, detail: page.url() };

    case "reload":
      await browser.overlay("toast", say("toast.reload"));
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }).catch(() => {});
      return { ok: true, detail: page.url() };

    case "open_new_tab": {
      const p = await browser.context.newPage();
      await browser.setActive(p);
      await browser.overlay("toast", say("toast.newTab"));
      return { ok: true, detail: `tabs=${browser.pages.length}` };
    }

    case "close_tab": {
      await page.close();
      if (browser.pages.length === 0) await browser.context.newPage();
      await browser.setActive(browser.page);
      return { ok: true, detail: `tabs=${browser.pages.length}` };
    }

    case "switch_tab": {
      const pages = browser.pages;
      if (pages.length < 2) return { ok: false, ...detail("detail.onlyOneTab") };
      const i = pages.indexOf(browser.page);
      let next;
      if (action.direction === "previous") next = pages[(i - 1 + pages.length) % pages.length];
      else if (action.direction === "first") next = pages[0];
      else next = pages[(i + 1) % pages.length];
      await browser.setActive(next);
      await browser.overlay("toast", say("toast.switchedTab"));
      return { ok: true, detail: next.url() };
    }

    default:
      return { ok: false, ...detail("detail.unknownAction", { type: action.type }) };
  }
}
