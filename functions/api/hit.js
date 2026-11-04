/**
 * Logichain · /api/hit  (Cloudflare Pages Function)
 * Cookie-free visit counter for the public pages. POST {p: path, r: referrer}
 * Stores only an anonymous daily code (SHA-256 of IP + browser + date + salt), never the IP itself.
 */
const SUPABASE_URL = "https://iksnoymoqvweudilfuzy.supabase.co";
const SUPABASE_ANON = "sb_publishable_hlieTwPa1c6v0I67KqXBng_pSnJ_iIH";
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|facebookexternalhit|embedly|whatsapp|telegram/i;
const OWN = /(^|\.)logichain\.no$|logichain-40w\.pages\.dev$/i;

const none = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  try {
    const ua = request.headers.get("User-Agent") || "";
    if (!ua || BOT.test(ua)) return none();
    let body = {};
    try { body = JSON.parse((await request.text()).slice(0, 2000) || "{}"); } catch (_) { return none(); }
    const path = String(body.p || "/").replace(/[?#].*$/, "").replace(/\.html$/, "").replace(/\/index$/, "/").slice(0, 120) || "/";
    let ref = null;
    try { const h = new URL(String(body.r || "")).hostname.replace(/^www\./, ""); if (h && !OWN.test(h)) ref = h.slice(0, 120); } catch (_) {}
    const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const visitor = (await sha256hex(`${env.VISIT_SALT || "logichain-visits-v1"}|${ip}|${ua}|${day}`)).slice(0, 32);
    const country = (request.cf && request.cf.country) || null;
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_visit`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_visitor: visitor, p_path: path, p_referrer: ref, p_country: country }),
    });
  } catch (_) { /* counting must never break the site */ }
  return none();
}
