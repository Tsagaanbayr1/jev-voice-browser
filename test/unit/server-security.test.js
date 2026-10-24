/**
 * Who can drive the controlled browser. The control socket can navigate, click
 * and type in a real browser profile, and the page shows what that browser sees,
 * so:
 *   - another website must not open the control socket (cross-site WebSocket hijacking),
 *   - a DNS-rebound hostname must not reach the server at all,
 *   - a page the browser visits must not be able to run script in the control page.
 *
 * Runs the real server headless on a random port with a throwaway profile. No
 * transcript is sent, so Jev is never called and the API key is never used.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { chromium } from "playwright";

process.env.TYPESAFE_API_KEY ||= "test-key-not-used";

// Headless runs on the full Chromium build (the one the app uses headed) rather
// than Playwright's separate headless-shell download, which may not be installed.
const launchPersistent = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = (dir, options) => launchPersistent(dir, { channel: "chromium", ...options });
const { startServer } = await import("../../src/server.js");

let srv;
let port;
let profileDir;

before(async () => {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-sec-profile-"));
  srv = await startServer({
    port: 0,
    host: "127.0.0.1",
    headless: true,
    startUrl: "about:blank",
    lang: "en",
    uiLang: "en",
    profileDir,
  });
  port = srv.server.address().port;
});

after(async () => {
  await srv?.controller.close();
  await srv?.browser.close();
  srv?.server.close();
  srv?.server.closeAllConnections?.();
  fs.rmSync(profileDir, { recursive: true, force: true });
});

/** Opens a socket and resolves with the first message, or rejects with the HTTP status it got instead. */
function openSocket(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, { headers: { Host: `localhost:${port}`, ...headers } });
    ws.on("message", (data) => {
      ws.close();
      resolve(JSON.parse(data.toString()));
    });
    ws.on("unexpected-response", (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.on("error", reject);
  });
}

function get(pathname, host) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: pathname, headers: { Host: host } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      })
      .on("error", reject);
  });
}

test("the control page's own origin can open the control socket", async () => {
  const hello = await openSocket("/ws", { Origin: `http://localhost:${port}` });
  assert.equal(hello.type, "hello");
});

test("a local script (no Origin header) can open the control socket", async () => {
  const hello = await openSocket("/ws");
  assert.equal(hello.type, "hello");
});

test("another website cannot open the control socket", async () => {
  await assert.rejects(openSocket("/ws", { Origin: "https://evil.example" }), (err) => err.status === 403 || /ECONNRESET|socket hang up/.test(err.message));
});

test("another website cannot open the speech socket", async () => {
  await assert.rejects(openSocket("/ws/stt", { Origin: "https://evil.example" }), (err) => err.status === 403 || /ECONNRESET|socket hang up/.test(err.message));
});

test("a DNS-rebound hostname is refused, over HTTP and WebSocket", async () => {
  assert.equal(await get("/api/state", `rebind.evil.example:${port}`), 403);
  await assert.rejects(
    openSocket("/ws", { Host: `rebind.evil.example:${port}`, Origin: `http://rebind.evil.example:${port}` }),
    (err) => err.status === 403 || /ECONNRESET|socket hang up/.test(err.message),
  );
});

test("loopback names still reach the server", async () => {
  assert.equal(await get("/api/state", `localhost:${port}`), 200);
  assert.equal(await get("/api/state", `127.0.0.1:${port}`), 200);
});

test("a visited page cannot run script in the control page", async () => {
  // The page controls every attribute the snapshot reads, including role and data-vb-id.
  await srv.browser.page.setContent(
    // Page-set ids first, so they are taken before the collector's counter reaches them.
    `<button data-vb-id="e01">One</button><button data-vb-id="e01">Two</button>` +
      `<button role="&lt;img src=x onerror=window.__pwnedRole=1&gt;">Go</button>` +
      `<a href="https://example.com/" data-vb-id="&lt;img src=y onerror=window.__pwnedId=1&gt;">Link</a>`,
    { waitUntil: "domcontentloaded" },
  );
  await srv.controller.refreshSnapshot();

  const viewer = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const page = await viewer.newPage();
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => document.querySelectorAll("#elements .el").length >= 4);
    await page.waitForTimeout(500); // let a failed <img> fire onerror, if one was created
    const pwned = await page.evaluate(() => ({ role: window.__pwnedRole ?? null, id: window.__pwnedId ?? null }));
    assert.deepEqual(pwned, { role: null, id: null });
    const text = await page.locator("#elements").innerText();
    assert.match(text, /<img src=x onerror=window.__pwnedRole=1>/, "the hostile role is shown as text");
    const ids = await page.locator("#elements .id").allInnerTexts();
    assert.ok(ids.every((id) => /^e\d+$/.test(id)), `element ids come from the collector: ${ids}`);
    assert.equal(new Set(ids).size, ids.length, `element ids are unique even when the page sets them: ${ids}`);
  } finally {
    await viewer.close();
  }
});
