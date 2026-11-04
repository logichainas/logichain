/**
 * Logichain · /api/agents  (Cloudflare Pages Function)
 *
 *   GET  /api/agents                    → agents + recent sessions
 *   GET  /api/agents?session=<id>       → work log (events) + output files for one session
 *   GET  /api/agents?download=<fileId>  → download an output file (proxied)
 *   POST /api/agents  {agent_id, task, title?} → start a new session for that agent ("brief")
 *   POST /api/agents  {session_id, action:"confirm", ids:[], result:"allow"|"deny"} → answer tool approvals
 *   POST /api/agents  {session_id, action:"message", text} → send a follow-up message to the agent
 *   POST /api/agents  {action:"create_agent", name, description, system, model} → create a new agent
 *
 * The Claude API key lives only here, as a Cloudflare secret
 * (ANTHROPIC_API_KEY or "logichain-jarvis"). Never in the browser.
 * Caller must send its Supabase login (Bearer token) and be admin.
 */

const SUPABASE_URL = "https://iksnoymoqvweudilfuzy.supabase.co";
const SUPABASE_ANON = "sb_publishable_hlieTwPa1c6v0I67KqXBng_pSnJ_iIH";
const API = "https://api.anthropic.com/v1";
const DEFAULT_ENVIRONMENT = "env_01JRRjqD3KBCcjH2iiwkYbdR";
const FILES_VERSION = "2026-10-21";

const filesHeaders = (key) => ({
  Authorization: `Bearer ${key}`,
  "anthropic-version": FILES_VERSION,
  "anthropic-beta": "managed-agents-2026-04-01",
});

async function sessionFiles(sessionId, key) {
  const r = await fetch(`${API}/files?scope_id=${encodeURIComponent(sessionId)}&limit=100`, { headers: filesHeaders(key) });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.data || [])
    .filter((f) => f.downloadable !== false)
    .map((f) => ({ id: f.id, filename: f.filename, size: f.size_bytes ?? null, mime: f.mime_type ?? null, created_at: f.created_at ?? null }));
}

const keyFrom = (env) => env.ANTHROPIC_API_KEY || env["logichain-jarvis"] || env.LOGICHAIN_JARVIS;

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
      id: e.id || null,
      ask: e.evaluated_permission === "ask",
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

  const key = keyFrom(env);
  if (!key) return json({ configured: false });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const downloadId = url.searchParams.get("download");

  // ---- download an output file ----
  if (downloadId) {
    if (!/^file_[A-Za-z0-9_-]{3,100}$/.test(downloadId)) return json({ error: "Bad file id" }, 400);
    const [meta, content] = await Promise.all([
      fetch(`${API}/files/${downloadId}`, { headers: filesHeaders(key) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch(`${API}/files/${downloadId}/content`, { headers: filesHeaders(key) }),
    ]);
    if (!content.ok) return json({ error: `Download failed (${content.status})` }, 502);
    const name = String(meta.filename || downloadId).replace(/[^\w.\- ]+/g, "_");
    return new Response(content.body, {
      headers: {
        "Content-Type": meta.mime_type || content.headers.get("Content-Type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    // ---- one session's work log ----
    if (sessionId) {
      if (!/^[A-Za-z0-9_-]{3,100}$/.test(sessionId)) return json({ error: "Bad session id" }, 400);
      const [session, events, files] = await Promise.all([
        claude(`/sessions/${sessionId}`, key),
        claude(`/sessions/${sessionId}/events?limit=200&order=desc`, key),
        sessionFiles(sessionId, key),
      ]);
      const raw = events.data || [];
      const log = raw.map(slimEvent).filter(Boolean).reverse();
      // Is the session paused waiting for a tool approval? (latest status event, newest first)
      const lastStatus = raw.find((e) => String(e.type || "").startsWith("session.status_"));
      const stop = lastStatus && lastStatus.type === "session.status_idle" ? lastStatus.stop_reason || null : null;
      const pendingIds = stop && stop.type === "requires_action" ? stop.event_ids || [] : [];
      const pending = pendingIds.map((id) => {
        const ev = raw.find((e) => e.id === id) || {};
        return { id, name: ev.name || ev.tool_name || "tool", server: ev.mcp_server_name || null, text: inputSummary(ev.input) };
      });
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
        files,
        stop_reason: stop ? stop.type || null : null,
        pending,
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
        environment_id: s.environment_id || pick(s.environment, "id") || null,
        created_at: s.created_at || null,
        updated_at: s.updated_at || null,
      };
    });
    return json({ configured: true, fetched_at: new Date().toISOString(), agents: agentList, sessions: sessionList });
  } catch (e) {
    return json({ configured: true, error: String(e.message || e) }, 502);
  }
}

// ---- brief an agent: start a new session with the task as the first message ----
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
  if (!(await isAdmin(auth))) return json({ error: "Access denied" }, 403);
  const key = keyFrom(env);
  if (!key) return json({ error: "No Claude API key configured" }, 500);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Bad JSON" }, 400); }

  // ---- create a new agent ----
  if (body.action === "create_agent") {
    const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];
    const name = String(body.name || "").trim().slice(0, 80);
    const system = String(body.system || "").trim();
    const model = MODELS.includes(body.model) ? body.model : MODELS[0];
    if (name.length < 2) return json({ error: "Give the agent a name" }, 400);
    if (system.length < 30) return json({ error: "Write the agent's instructions (at least a few sentences)" }, 400);
    if (system.length > 30000) return json({ error: "Instructions are too long" }, 400);
    const hdr = { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "managed-agents-2026-04-01", "content-type": "application/json" };
    try {
      const list = await claude("/agents?limit=100", key);
      if ((list.data || []).some((a) => !a.archived_at && String(a.name || "").toLowerCase() === name.toLowerCase()))
        return json({ error: `An agent called "${name}" already exists` }, 409);
    } catch (_) { /* listing is only a duplicate guard */ }
    const r = await fetch(`${API}/agents`, {
      method: "POST", headers: hdr,
      body: JSON.stringify({
        name, model, system,
        description: String(body.description || "").trim().slice(0, 500) || undefined,
        tools: [{ type: "agent_toolset_20260401" }],
        metadata: { owner: "logichain", created_from: "jarvis" },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: `Could not create the agent: ${r.status} ${j?.error?.message || ""}`.trim() }, 502);
    return json({ ok: true, agent: { id: j.id, name: j.name || name, model } });
  }

  // ---- act on an existing session: approve/deny tools, or send a follow-up message ----
  if (body.session_id) {
    const sid = String(body.session_id);
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(sid)) return json({ error: "Bad session id" }, 400);
    let events;
    if (body.action === "confirm") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => /^[A-Za-z0-9_-]{3,100}$/.test(x)).slice(0, 20);
      if (!ids.length) return json({ error: "Nothing to approve" }, 400);
      const result = body.result === "deny" ? "deny" : "allow";
      events = ids.map((id) => ({
        type: "user.tool_confirmation", tool_use_id: id, result,
        ...(result === "deny" && body.deny_message ? { deny_message: String(body.deny_message).slice(0, 2000) } : {}),
      }));
    } else if (body.action === "message") {
      const text = String(body.text || "").trim();
      if (text.length < 2) return json({ error: "Write a message" }, 400);
      events = [{ type: "user.message", content: [{ type: "text", text: text.slice(0, 20000) }] }];
    } else return json({ error: "Unknown action" }, 400);
    const r = await fetch(`${API}/sessions/${sid}/events`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "managed-agents-2026-04-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ events }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: `Agent did not accept it: ${r.status} ${j?.error?.message || ""}`.trim() }, 502);
    return json({ ok: true });
  }

  const agentId = String(body.agent_id || "");
  const task = String(body.task || "").trim();
  if (!/^agent_[A-Za-z0-9_-]{3,100}$/.test(agentId)) return json({ error: "Choose an agent" }, 400);
  if (task.length < 10) return json({ error: "Describe the task (at least a sentence)" }, 400);
  if (task.length > 20000) return json({ error: "Task is too long" }, 400);
  const title = String(body.title || task.split("\n")[0]).trim().slice(0, 120);

  try {
    // Reuse the environment from this agent's latest session, otherwise the default one
    let environmentId = DEFAULT_ENVIRONMENT;
    try {
      const last = await claude(`/sessions?agent_id=${encodeURIComponent(agentId)}&limit=1`, key);
      const s = (last.data || [])[0];
      environmentId = s?.environment_id || pick(s?.environment, "id") || DEFAULT_ENVIRONMENT;
    } catch (_) { /* keep default */ }

    const text = [
      task,
      "",
      "Deliverables: save any report or data you produce as files in /mnt/session/outputs/ (Excel .xlsx for tables/reports, Markdown .md for written reports) so they can be downloaded from the Logichain command center. Finish with a short summary of what you did and where the files are.",
    ].join("\n");

    const r = await fetch(`${API}/sessions`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "managed-agents-2026-04-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agent: agentId,
        environment_id: environmentId,
        title,
        metadata: { source: "jarvis-brief" },
        initial_events: [{ type: "user.message", content: [{ type: "text", text }] }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: `Could not start the agent: ${r.status} ${j?.error?.message || ""}`.trim() }, 502);
    return json({ ok: true, session: { id: j.id, status: j.status, title: j.title || title, agent_id: agentId } });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
