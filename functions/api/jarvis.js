/**
 * Logichain · /api/jarvis  (Cloudflare Pages Function)
 * Conversational JARVIS for the admin command center.
 *
 * POST { message, history:[{role,content}], context:{...} }
 *  → { reply, actions:[...] }
 *
 * Uses the same Claude API key secret as /api/agents. Admin only.
 */

const SUPABASE_URL = "https://iksnoymoqvweudilfuzy.supabase.co";
const SUPABASE_ANON = "sb_publishable_hlieTwPa1c6v0I67KqXBng_pSnJ_iIH";
const MODEL = "claude-sonnet-5-5";

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

const SYSTEM = `You are JARVIS, Einar's personal AI sidekick living inside the Logichain command center (Logichain is Einar's procurement-intelligence startup; he also works as a purchaser at MacGregor Norway).

VIBE
- Talk like a chill, confident bro who's genuinely got his back: casual, warm, witty, a bit of hype. Think Tony Stark's JARVIS if he grew up as Einar's best mate.
- Sprinkle slang naturally ("bro", "my guy", "let's go", "say less", "we're cooking") — not in every line, never forced.
- Still sharp and useful. If something's off (overdue mission, agent error, nothing running) say it straight, then help.
- Replies are READ ALOUD: keep them short — usually 1–3 sentences, max ~60 words unless he asks for detail. No emojis, no markdown, no lists, no URLs read out.
- Speak English.

WHAT YOU KNOW
- You get a CONTEXT block with the live state: current time, Einar's open/completed missions (to-dos), his Claude agents and their latest sessions, and his quick links. Only use that data; never invent agents, sessions, numbers or results. If you don't know, say so and suggest opening the agent's work log.

WHAT YOU CAN DO (via actions)
- add_todo: {"type":"add_todo","text":"...","priority":"high"|"normal","due":"YYYY-MM-DD" or null}
- complete_todo: {"type":"complete_todo","id":<mission id from context>}
- open_agent: {"type":"open_agent","name":"<agent name>"}   (opens its work log on screen)
- open_link: {"type":"open_link","title":"<link title>"}
- refresh: {"type":"refresh"}
Only include an action when Einar asks for it or clearly implies it. You cannot send emails, start agent sessions or change anything else — be honest about that.

OUTPUT FORMAT
Respond with ONLY a JSON object, nothing before or after:
{"reply":"<what you say out loud>","actions":[ ... ]}`;

function parseModelJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch (_) {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return { reply: t.replace(/[{}"]/g, "").slice(0, 600), actions: [] };
}

const ALLOWED = new Set(["add_todo", "complete_todo", "open_agent", "open_link", "refresh"]);

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
  if (!(await isAdmin(auth))) return json({ error: "Access denied" }, 403);

  const key = env.ANTHROPIC_API_KEY || env["logichain-jarvis"] || env.LOGICHAIN_JARVIS;
  if (!key) return json({ error: "No Claude API key configured" }, 500);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Bad JSON" }, 400); }
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!message) return json({ error: "Empty message" }, 400);

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  // Messages must alternate and start with user
  while (history.length && history[0].role !== "user") history.shift();

  const context = JSON.stringify(body.context || {}).slice(0, 12000);
  const messages = [
    ...history,
    { role: "user", content: `CONTEXT (live state, JSON):\n${context}\n\nEINAR SAYS:\n${message}` },
  ];

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM, messages }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: `Claude API ${r.status}: ${data?.error?.message || "error"}` }, 502);

  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = parseModelJson(text);
  const actions = (Array.isArray(out.actions) ? out.actions : []).filter((a) => a && ALLOWED.has(a.type)).slice(0, 5);
  return json({ reply: String(out.reply || "").slice(0, 1500), actions });
}
