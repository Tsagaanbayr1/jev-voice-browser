/**
 * Who may talk to this server. It drives a real, signed-in browser profile and
 * spends API credits, so it only answers to this machine:
 *
 *  - Host: a loopback name, an IP literal, or a name listed in ALLOWED_HOSTS.
 *    Anything else is a DNS-rebinding attempt (a website whose hostname was
 *    re-pointed at 127.0.0.1 to read and drive this server as same-origin).
 *    An IP literal cannot be rebound, so `--host 0.0.0.0` + a LAN IP still works.
 *  - Origin: browsers always send it on WebSocket handshakes and cross-site
 *    requests. It must be this server's own origin; requests without it come
 *    from local scripts and tools, not from web pages.
 */
import net from "node:net";

/** Hostname from a Host header (lowercase, IPv6 in brackets), or null if it is not one. */
export function hostnameOf(hostHeader) {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `ALLOWED_HOSTS=mymac.local,box.lan` → Set of extra hostnames. */
export function parseAllowedHosts(value = "") {
  return new Set(
    String(value)
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedHost(hostHeader, extra = new Set()) {
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (net.isIP(name.replace(/^\[|\]$/g, ""))) return true;
  return extra.has(name);
}

export function isAllowedOrigin(origin, hostHeader) {
  if (origin === undefined) return true;
  try {
    const o = new URL(origin);
    return (o.protocol === "http:" || o.protocol === "https:") && o.host === String(hostHeader).toLowerCase();
  } catch {
    return false;
  }
}
