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
  supSearchMpn(q: $q, limit: 8) {
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
          prices { quantity price }
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
    if (request.method !== "POST") return new Response("POST only", { status: 405 });

    const url = new URL(request.url);
    if (url.pathname !== "/octopart") return new Response("Not found", { status: 404 });

    let q;
    try { q = ((await request.json()).q || "").trim(); }
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
            unitPrice: o.prices?.length ? o.prices[0].price : null,
          })),
        };
      });

      return new Response(JSON.stringify({ query: q, parts }), { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
    }
  },
};
