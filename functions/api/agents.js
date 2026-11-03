/**
 * Logichain · /api/agents  (Cloudflare Pages Function)
 * Henter Claude Managed Agents (agenter + økter) for admin-dashboardet.
 *
 * API-nøkkelen ligger KUN her på serveren, aldri i nettleseren:
 *   Cloudflare → Workers & Pages → logichain → Settings → Variables and Secrets
 *   → Add → Type: Secret, Name: ANTHROPIC_API_KEY, Value: sk-ant-...
 *   (lag nøkkelen i Claude Console → API keys). Deploy på nytt etterpå.
 *
 * Tilgang: kalleren må sende sin Supabase-innlogging (Bearer-token),
 * og brukeren må være admin (public.is_admin() i Supabase).
 */

const SUPABASE_URL = "https://iksnoymoqvweudilfuzy.supabase.co";
const SUPABASE_ANON = "sb_publishable_hlieTwPa1c6v0I67KqXBng_pSnJ_iIH";
const API = "https://api.anthropic.com/v1";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function isAdmin(authHeader) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, Authorization: authHeader, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

async function claude(path, key) {
  const r = await fetch(`${API}${path}`, {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "managed-agents-2026-04-01",
    },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body?.error?.message || ""}`.trim());
  return body;
}

const pick = (v, ...keys) => {
  for (const k of keys) if (v && v[k] != null) return v[k];
  return null;
};

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Ikke innlogget" }, 401);
  if (!(await isAdmin(auth))) return json({ error: "Ingen tilgang" }, 403);

  const key = env.ANTHROPIC_API_KEY || env["logichain-jarvis"] || env.LOGICHAIN_JARVIS;
  if (!key) return json({ configured: false });

  try {
    const [agents, sessions] = await Promise.all([
      claude("/agents?limit=50", key),
      claude("/sessions?limit=40", key),
    ]);
    const agentList = (agents.data || []).map((a) => ({
      id: a.id,
      name: a.name || a.id,
      description: a.description || "",
      model: typeof a.model === "string" ? a.model : pick(a.model, "id", "name"),
      version: a.version ?? null,
      created_at: a.created_at || null,
      updated_at: a.updated_at || null,
      archived: !!a.archived_at,
    }));
    const names = Object.fromEntries(agentList.map((a) => [a.id, a.name]));
    const sessionList = (sessions.data || []).map((s) => {
      const agentId = typeof s.agent === "string" ? s.agent : pick(s.agent, "id") || s.agent_id || null;
      return {
        id: s.id,
        status: s.status || "ukjent",
        title: s.title || null,
        agent_id: agentId,
        agent_name: names[agentId] || pick(s.agent, "name") || agentId,
        created_at: s.created_at || null,
        updated_at: s.updated_at || null,
        usage: s.usage || null,
      };
    });
    return json({ configured: true, fetched_at: new Date().toISOString(), agents: agentList, sessions: sessionList });
  } catch (e) {
    return json({ configured: true, error: String(e.message || e) }, 502);
  }
}
