/**
 * Logichain · /api/agents  (Cloudflare Pages Function)
 *
 *   GET /api/agents                 → agents + recent sessions
 *   GET /api/agents?session=<id>    → work log (events) for one session
 *
 * The Claude API key lives only here, as a Cloudflare secret
 * (ANTHROPIC_API_KEY or "logichain-jarvis"). Never in the browser.
 * Caller must send its Supabase login (Bearer token) and be admin.
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
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${body?.error?.message || ""}`.trim());
  return body;
}

const pick = (v, ...keys) => {
  for (const k of keys) if (v && v[k] != null) return v[k];
  return null;
};

const clip = (s, n) => {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

function blocksText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b?.type === "text" ? b.text : b?.type ? `[${b.type}]` : ""))
    .filter(Boolean)
    .join("\n");
}

function inputSummary(input) {
  if (input == null) return "";
  if (typeof input === "string") return clip(input, 400);
  const keys = ["command", "query", "url", "path", "file_path", "pattern", "description", "prompt", "to", "subject"];
  for (const k of keys) if (input[k]) return `${k}: ${clip(input[k], 400)}`;
  return clip(JSON.stringify(input), 400);
}

// Turn raw session events into a compact, readable work log
function slimEvent(e) {
  const t = e.type || "";
  const time = e.processed_at || e.created_at || null;
  if (t === "user.message" || t === "system.message")
    return { kind: t === "user.message" ? "user" : "system", time, text: clip(blocksText(e.content), 4000) };
  if (t === "agent.message") return { kind: "agent", time, text: clip(blocksText(e.content), 6000) };
  if (t === "agent.thinking") return { kind: "thinking", time, text: clip(blocksText(e.content) || e.thinking || "", 1500) };
  if (t === "agent.tool_use" || t === "agent.mcp_tool_use" || t === "agent.custom_tool_use")
    return {
      kind: "tool",
      time,
      name: e.name || e.tool_name || pick(e.tool, "name") || "tool",
      server: e.mcp_server_name || e.server_name || null,
      text: inputSummary(e.input),
    };
  if (t === "agent.tool_result" || t === "agent.mcp_tool_result" || t === "user.tool_result" || t === "user.custom_tool_result")
    return { kind: "result", time, error: !!e.is_error, text: clip(blocksText(e.content) || e.output || "", 800) };
  if (t.startsWith("session.status_")) return { kind: "status", time, text: t.replace("session.status_", "") };
  if (t === "session.error" || t === "workflow_run.error")
    return { kind: "error", time, text: clip(pick(e.error, "message") || e.message || JSON.stringify(e.error || ""), 600) };
  if (t === "agent.thread_message_sent" || t === "agent.thread_message_received")
    return { kind: "thread", time, text: clip(blocksText(e.content) || "", 1200) };
  return null; // spans, usage etc. are left out
}

export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
  if (!(await isAdmin(auth))) return json({ error: "Access denied" }, 403);

  const key = env.ANTHROPIC_API_KEY || env["logichain-jarvis"] || env.LOGICHAIN_JARVIS;
  if (!key) return json({ configured: false });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");

  try {
    // ---- one session's work log ----
    if (sessionId) {
      if (!/^[A-Za-z0-9_-]{3,100}$/.test(sessionId)) return json({ error: "Bad session id" }, 400);
      const [session, events] = await Promise.all([
        claude(`/sessions/${sessionId}`, key),
        claude(`/sessions/${sessionId}/events?limit=200&order=desc`, key),
      ]);
      const log = (events.data || []).map(slimEvent).filter(Boolean).reverse();
      return json({
        configured: true,
        session: {
          id: session.id,
          status: session.status,
          title: session.title || null,
          created_at: session.created_at || null,
          updated_at: session.updated_at || null,
        },
        log,
        truncated: !!events.next_page,
      });
    }

    // ---- overview ----
    const [agents, sessions] = await Promise.all([
      claude("/agents?limit=50", key),
      claude("/sessions?limit=60", key),
    ]);
    const agentList = (agents.data || []).map((a) => ({
      id: a.id,
      name: a.name || a.id,
      description: clip(a.description || "", 300),
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
        status: s.status || "unknown",
        title: s.title || null,
        agent_id: agentId,
        agent_name: names[agentId] || pick(s.agent, "name") || agentId,
        created_at: s.created_at || null,
        updated_at: s.updated_at || null,
      };
    });
    return json({ configured: true, fetched_at: new Date().toISOString(), agents: agentList, sessions: sessionList });
  } catch (e) {
    return json({ configured: true, error: String(e.message || e) }, 502);
  }
}
