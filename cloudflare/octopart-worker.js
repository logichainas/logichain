/**
 * Logichain – Octopart-proxy (Cloudflare Worker)
 * ================================================
 * SIKKER PROXY mot Nexar/Octopart API – holder hemmeligheten borte fra nettleseren.
 *
 * SETT OPP (ca. 15 min):
 * 1. Registrer deg på https://portal.nexar.com (gratis eval-app)
 *    -> kopier Client ID og Client Secret
 * 2. Lag en Worker på https://dash.cloudflare.com (gratis plan holder):
 *    - Lim inn denne filen som Worker-kode, eller bruk `wrangler deploy`
 *    - Settings -> Variables -> legg inn:
 *        NEXAR_CLIENT_ID     = <din client id>
 *        NEXAR_CLIENT_SECRET = <din client secret>
 * 3. I logichain-dashboard-demo.html, endre:
 *        const OCTO = { endpoint: "https://DIN-WORKER.workers.dev/octopart" };
 *    (i dag står den til "" som betyr: bruk mock-data)
 * 4. Test: POST {"q":"Bosch 2.0060H"} til Worker-URL-en
 *
 * MERK: GraphQL-spørringen under er et skjelett – sjekk oppdatert schema i
 * Nexar-IDE-en: https://api.nexar.com/graphql/ (felt kan avvike litt).
 */

const TOKEN_URL = "https://identity.nexar.com/connect/token";
const GRAPHQL_URL = "https://api.nexar.com/graphql";

const QUERY = `query PartSearch($q: String!) {
  supSearchMpn(q: $q, limit: 8, currency: "NOK") {
    hits {
      part {
        mpn
        manufacturer { name }
        shortDescription
        bestDatasheet { url }
        offers {
          distributor { name }
          sku
          stock { level }
          leadTimes { displayValue }
          prices { quantity price currency convertedPrice convertedCurrency }
        }
      }
    }
  }
}`;

let cachedToken = null; // tokenet varer 24 timer – cache det i Worker-minnet

async function getToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.NEXAR_CLIENT_ID,
      client_secret: env.NEXAR_CLIENT_SECRET,
      scope: "supply.domain",
    }),
  });
  if (!res.ok) throw new Error("Nexar-token feilet: " + res.status);
  const j = await res.json();
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 86400) * 1000 };
  return cachedToken.value;
}

// Kun Logichain sine egne sider får bruke proxyen (ellers kan hvem som helst bruke opp Nexar-kvoten)
const ALLOWED_ORIGINS = [
  "https://logichain.no",
  "https://www.logichain.no",
  "https://logichain-40w.pages.dev",
];
function allowedOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // forhåndsvisninger fra Cloudflare Pages: https://<gren>.logichain-40w.pages.dev
  if (/^https:\/\/[a-z0-9-]+\.logichain-40w\.pages\.dev$/.test(origin)) return origin;
  return null;
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}
// Laveste stykkpris for antall 1 (eller minste antall), helst omregnet til NOK
function unitPriceNOK(prices) {
  if (!prices || !prices.length) return null;
  const sorted = [...prices].sort((a, b) => (a.quantity || 0) - (b.quantity || 0));
  const p = sorted[0];
  if (p.convertedPrice != null && p.convertedCurrency === "NOK") return p.convertedPrice;
  if (p.currency === "NOK") return p.price;
  return null;
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request.headers.get("Origin"));
    if (!origin) return new Response("Forbidden", { status: 403 });
    const CORS = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
    if (request.method !== "POST") return new Response("POST only", { status: 405 });

    const url = new URL(request.url);
    if (url.pathname !== "/octopart") return new Response("Not found", { status: 404 });

    let q;
    try { q = String((await request.json()).q || "").trim().slice(0, 100); }
    catch { return new Response(JSON.stringify({ error: "Ugyldig JSON" }), { status: 400, headers: CORS }); }
    if (!q) return new Response(JSON.stringify({ error: "Mangler søkestreng" }), { status: 400, headers: CORS });

    try {
      const token = await getToken(env);
      const res = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { q } }),
      });
      const data = await res.json();

      // Normaliser til en enkel form dashboardet kan vise direkte:
      const parts = (data?.data?.supSearchMpn?.hits || []).map(h => {
        const p = h.part;
        return {
          mpn: p.mpn,
          manufacturer: p.manufacturer?.name || "",
          description: p.shortDescription || "",
          datasheet: p.bestDatasheet?.url || "",
          offers: (p.offers || []).map(o => ({
            distributor: o.distributor?.name || "",
            sku: o.sku || "",
            stock: o.stock?.level || 0,
            leadTime: o.leadTimes?.[0]?.displayValue || "",
            unitPrice: unitPriceNOK(o.prices),
            currency: "NOK",
          })),
        };
      });

      return new Response(JSON.stringify({ query: q, parts }), { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
    }
  },
};
