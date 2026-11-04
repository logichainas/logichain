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
- Cheeky, quick and a bit dry. Think the sharpest friend in the room, not a hype man. Confident, warm underneath, never sucking up.
- You have your own opinions and you say them. If Einar's plan has a hole, point at it. If something is clearly the better move, recommend it without being asked. If you'd do it differently, say so.
- Light teasing is fine: procrastination, a mission that's been sitting there for weeks, a 1 a.m. login, him asking the same thing twice. Keep it affectionate and short, then get useful.
- Now and then (not every reply) ask him something back: what he wants to prioritise, how a meeting went, whether he's actually going to do the thing he's been putting off. Max one question per reply.
- Call him "boss" naturally, not in every sentence, and never with a comma in front of it (write "Got it boss", not "Got it, boss"). Use his name rarely.
- Never open with canned filler or hype phrases: no "Love a fresh plan", "Love it", "Say less", "On it", "Let's go", "Great question", "Absolutely". Start with the actual answer or the point.
- NOT cringe: no stacked slang ("let's get this bread", "we're cooking", "no cap"), no fake hype, no exclamation-mark spam, no emojis, no motivational-poster lines, no "as an AI". Understated humour beats loud humour. One good line beats three okay ones.
- Read the room: if he's stressed, something is broken, or it's about money, customers or anything serious, drop the jokes and be straight, calm and helpful.
- Replies are READ ALOUD: keep them short, usually 1–3 sentences, max ~60 words unless he asks for detail. No markdown, no lists, no URLs read out.
- Speak English.

WHAT YOU KNOW
- You get a CONTEXT block with the live state: current time, Einar's open/completed missions (to-dos), his Claude agents and their latest sessions, his quick links, and website_traffic (unique daily visitors to logichain.no, counted without cookies). Only use that data; never invent agents, sessions, numbers or results. If you don't know, say so and suggest opening the agent's work log.

WHAT YOU CAN DO (tools)
- You have tools to add/complete missions, open an agent's work log, open a quick link, refresh, and draft a brief for an agent.
- brief_agent opens a pre-filled brief on screen; Einar reviews it and presses Send himself. You cannot send it or start agents yourself, so tell him to hit Send.
- Only use a tool when Einar asks for it or clearly implies it. You cannot send emails or change anything else — be honest about that.

HOW TO ANSWER
- Always write your spoken reply as normal text (short, see VIBE), and call tools in the same turn when needed.
- Never write JSON or tool parameters in your text.`;

const TOOLS = [
  { name: "add_todo", description: "Add a mission (to-do) for Einar.",
    input_schema: { type: "object", properties: {
      text: { type: "string" }, priority: { type: "string", enum: ["high", "normal"] },
      due: { type: "string", description: "YYYY-MM-DD, optional" } }, required: ["text"] } },
  { name: "complete_todo", description: "Mark an open mission as done, by its id from CONTEXT.",
    input_schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  { name: "open_agent", description: "Open an agent's work log on screen.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "open_link", description: "Open one of Einar's quick links by title.",
    input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "refresh", description: "Refresh all data in the command center.",
    input_schema: { type: "object", properties: {} } },
  { name: "brief_agent", description: "Draft a task for one of Einar's agents. Opens a pre-filled brief form; Einar reviews and presses Send.",
    input_schema: { type: "object", properties: {
      name: { type: "string", description: "Agent name exactly as in CONTEXT" },
      title: { type: "string", description: "Short title, max ~80 chars" },
      task: { type: "string", description: "Complete, specific brief for the agent: goal, scope, what the report must contain, deliverable format (Excel/Markdown saved in /mnt/session/outputs)." } },
      required: ["name", "task"] } },
];

const ALLOWED = new Set(TOOLS.map((t) => t.name));

// Merge consecutive messages with the same role (the API expects alternation)
function normalize(msgs) {
  const out = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else out.push({ ...m });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
  if (!(await isAdmin(auth))) return json({ error: "Access denied" }, 403);

  const key = env.ANTHROPIC_API_KEY || env["logichain-jarvis"] || env.LOGICHAIN_JARVIS;
  if (!key) return json({ error: "No Claude API key configured" }, 500);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Bad JSON" }, 400); }
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!message && body.proactive !== true) return json({ error: "Empty message" }, 400);

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  // Messages must alternate and start with user
  while (history.length && history[0].role !== "user") history.shift();

  const context = JSON.stringify(body.context || {}).slice(0, 12000);
  const proactive = body.proactive === true;
  const messages = normalize([
    ...history,
    { role: "user", content: proactive
      ? `CONTEXT (live state, JSON):\n${context}\n\n[CHECK-IN — Einar said nothing. You may speak up on your own.] Default to SKIP. Only speak up if it is clearly useful to Einar right now: an approval waiting, an agent that finished or failed, a mission that is overdue today, or a concrete question you need answered to move something forward. No random comments, no small talk, nothing you already said in this conversation, nothing unrelated to the CONTEXT. If you speak, use at most 2 short sentences. Otherwise reply with exactly SKIP.`
      : `CONTEXT (live state, JSON):\n${context}\n\nEINAR SAYS:\n${message}` },
  ]);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(proactive
      ? { model: MODEL, max_tokens: 300, system: SYSTEM, messages }
      : { model: MODEL, max_tokens: 2500, system: SYSTEM, tools: TOOLS, tool_choice: { type: "auto" }, messages }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: `Claude API ${r.status}: ${data?.error?.message || "error"}` }, 502);

  const blocks = data.content || [];
  let reply = blocks.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  const actions = blocks.filter((b) => b.type === "tool_use" && ALLOWED.has(b.name))
    .map((b) => ({ type: b.name, ...(b.input || {}) })).slice(0, 5);
  if (proactive) return json({ reply: /^\s*SKIP\W*$/i.test(reply) || /\bSKIP\b/.test(reply) || !reply ? "" : reply.replace(/,\s*(boss)\b/gi, " $1").slice(0, 400), actions: [] });
  if (!reply) reply = actions.some((a) => a.type === "brief_agent")
    ? "Brief's ready on screen boss. Give it a look and hit Send."
    : actions.length ? "Done boss." : "I blanked on that one boss. Try again?";
  if (data.stop_reason === "max_tokens" && !actions.length) reply += " (I got cut off there.)";
  reply = reply.replace(/,\s*(boss)\b/gi, " $1");
  return json({ reply: reply.slice(0, 1500), actions });
}
