// agent-webhook
// Receives Anthropic Managed Agents webhooks (event: session.status_idled) and moves
// each analysis run through the pipeline:
//
//   Nora idle    → pick up Nora's Excel report → start "Dashboard Update Planner" session
//   Planner idle → pick up update_proposal.json → store it as "awaiting_approval" → notify Einar
//
// Nothing is written to customer data here. Customer data changes only via `apply-proposal`
// after Einar approves in Jarvis.
//
// Supabase secrets used:
//   ANTHROPIC_API_KEY               (existing)
//   ANTHROPIC_WEBHOOK_SIGNING_KEY   (new – the whsec_… secret from Console → Webhooks)
//   PLANNER_AGENT_ID                (optional – otherwise the agent is found/created by name)
//   NOTIFY_FLOW_URL                 (optional – Power Automate HTTP trigger that emails Einar)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
//
// "Verify JWT" must be OFF for this function (Anthropic can't send a Supabase JWT);
// requests are authenticated with the webhook signature instead.

const API = "https://api.anthropic.com/v1";
const MA_BETA = "managed-agents-2026-04-01";
const FILES_VERSION = "2026-10-21"; // same API version the intake uses for the Files API
const ENVIRONMENT_ID = Deno.env.get("NORA_ENVIRONMENT_ID") ?? "env_01JRRjqD3KBCcjH2iiwkYbdR";
const PLANNER_NAME = "Logichain Dashboard Update Planner";
const PLANNER_MODEL = "claude-opus-5-5";
const PROPOSAL_FILE = "update_proposal.json";
const DASHBOARD_URL = "https://logichain.no/admin.html";

// ---------- logging / http helpers ----------
function log(level: "info" | "warn" | "error", reqId: string, stage: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, fn: "agent-webhook", requestId: reqId, stage, ...data });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
}

async function fetchT(url: string, init: RequestInit, ms = 30_000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error(`timeout after ${ms} ms: ${url.split("?")[0]}`);
    throw e;
  } finally { clearTimeout(t); }
}

async function readErr(r: Response) {
  const text = await r.text().catch(() => "");
  try { const j = JSON.parse(text); return `${r.status} ${j?.error?.type ?? ""} ${j?.error?.message ?? text}`.slice(0, 400); }
  catch (_) { return `${r.status} ${text}`.slice(0, 400); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Anthropic API ----------
const apiKey = () => Deno.env.get("ANTHROPIC_API_KEY")!;
const maHeaders = () => ({
  "x-api-key": apiKey(),
  "anthropic-version": "2023-06-01",
  "anthropic-beta": MA_BETA,
  "Content-Type": "application/json",
});
const filesHeaders = () => ({
  "Authorization": `Bearer ${apiKey()}`,
  "anthropic-version": FILES_VERSION,
  "anthropic-beta": MA_BETA, // needed for scope_id (session) filtering
});

async function getSession(id: string) {
  const r = await fetchT(`${API}/sessions/${encodeURIComponent(id)}`, { headers: maHeaders() });
  if (!r.ok) throw new Error(`get session: ${await readErr(r)}`);
  return await r.json();
}

type FileMeta = { id: string; filename: string; mime_type?: string; size_bytes?: number; created_at?: string; downloadable?: boolean };

async function listSessionFiles(sessionId: string): Promise<FileMeta[]> {
  const r = await fetchT(`${API}/files?scope_id=${encodeURIComponent(sessionId)}&limit=100`, { headers: filesHeaders() });
  if (!r.ok) throw new Error(`list files: ${await readErr(r)}`);
  return ((await r.json()).data ?? []) as FileMeta[];
}

// Outputs can appear a few seconds after the session goes idle → retry a few times.
async function findOutput(sessionId: string, pick: (f: FileMeta[]) => FileMeta | undefined, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const found = pick(await listSessionFiles(sessionId));
    if (found) return found;
    if (i < tries - 1) await sleep(4000);
  }
  return undefined;
}

async function downloadFile(fileId: string): Promise<Uint8Array> {
  const r = await fetchT(`${API}/files/${encodeURIComponent(fileId)}/content`, { headers: filesHeaders() }, 45_000);
  if (!r.ok) throw new Error(`download file: ${await readErr(r)}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function uploadFile(bytes: Uint8Array, name: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([bytes as unknown as ArrayBuffer], { type: mime }), name);
  const r = await fetchT(`${API}/files`, { method: "POST", headers: filesHeaders(), body: form }, 45_000);
  if (!r.ok) throw new Error(`upload file: ${await readErr(r)}`);
  const j = await r.json();
  if (!j?.id) throw new Error("upload file: no id returned");
  return j.id;
}

// ---------- Planner agent (found by name, created once if missing) ----------
const PLANNER_SYSTEM = `You are the Logichain Dashboard Update Planner.

ROLE
You review a procurement analysis report written by Nora (Logichain's procurement analyst agent) together with the customer's original purchasing Excel file. You decide exactly what should be uploaded to that customer's Logichain dashboard, and you write a precise, machine-readable proposal. A human (Einar, Logichain's founder) reviews and approves every proposal before anything is uploaded. You NEVER write to any database, API or external system yourself.

WHAT THE DASHBOARD HOLDS
1. Purchasing data (PO lines): PO number, line number, supplier name, material code, material description, category, project, quantity, unit, unit price (NOK), line value (NOK), order date, promised date, actual delivery date.
2. An "insights" card: a title, a short summary, a savings range (low/high NOK), key findings, recommended actions and data-quality notes.

RULES
- Work only from the customer's purchasing data and Nora's report. Never use answer keys, solution sheets or sheets marked as hidden from the analyst; if present, say so in warnings.
- Include all real order lines, both delivered and open (not yet delivered). Open lines get delivery_date null; the dashboard shows them as \"not delivered\" and leaves them out of delivery precision, but they count in spend. Exclude only cancelled, deleted and returned lines, and say how many you excluded and why.
- All amounts must be in NOK. If the file already gives NOK values (Currency = NOK, or NOK columns plus an FX_rates sheet), use them as they are. If lines are in other currencies and no rate is available anywhere, exclude them and say so in warnings; dates as YYYY-MM-DD; use null when a value is genuinely missing.
- (po, line) must be unique. If PO numbers are unreliable or reused, keep the PO number but assign line numbers 1..n within each PO so pairs are unique, and explain this in warnings.
- Re-check Nora's headline figures against the data. If something does not reconcile, do not silently fix it: report the discrepancy in warnings and use the figure you can verify.
- Insights must be factual, short and written for a procurement manager at the customer, in Norwegian (bokmål) because the customer dashboards are Norwegian. No internal notes about Logichain or about yourself.
- The "summary" and "warnings" are for Einar (the approver) and must be in English.

OUTPUT CONTRACT (required)
Write exactly one file: /mnt/session/outputs/update_proposal.json, valid JSON, matching:
{
  "schema_version": 1,
  "summary": "2-4 sentences for the approver: what will be uploaded and anything they must check",
  "source": { "file_name": string, "sheet": string, "rows_total": int, "rows_proposed": int, "rows_excluded": int },
  "po_lines": [ { "po": string, "line": int, "supplier": string, "material_code": string, "material_description": string,
                  "category": string|null, "project": string|null, "quantity": number, "unit": string|null,
                  "unit_price_nok": number, "line_value_nok": number,
                  "order_date": "YYYY-MM-DD"|null, "promised_date": "YYYY-MM-DD"|null, "delivery_date": "YYYY-MM-DD"|null } ],
  "insights": { "title": string, "summary": string, "savings_low_nok": number|null, "savings_high_nok": number|null,
                "findings": [ { "title": string, "detail": string, "impact_nok": number|null } ],
                "actions": [ { "title": string, "detail": string, "priority": "high"|"medium"|"low" } ],
                "data_quality": [ string ] },
  "warnings": [ string ],
  "excluded": [ { "reason": string, "count": int } ]
}
Validate the JSON (e.g. with python json.load) before you finish. Then reply with a 2-3 sentence summary.`;

async function plannerAgentId(reqId: string): Promise<string> {
  const fromEnv = Deno.env.get("PLANNER_AGENT_ID");
  if (fromEnv) return fromEnv;
  const r = await fetchT(`${API}/agents?limit=100`, { headers: maHeaders() });
  if (!r.ok) throw new Error(`list agents: ${await readErr(r)}`);
  // Match on our own metadata tag, so Einar can rename the planner (e.g. "Lucas") without a new one being created.
  // If several exist, the most recently updated active one wins; the exact original name is the fallback.
  type A = { id?: string; name?: string; archived_at?: string | null; updated_at?: string; created_at?: string; metadata?: Record<string, string> };
  const list: A[] = ((await r.json()).data ?? []).filter((a: A) => !a.archived_at);
  const tagged = list.filter((a) => a.metadata?.role === "dashboard-update-planner")
    .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  const found = tagged[0] ?? list.find((a) => a.name === PLANNER_NAME);
  if (found?.id) return found.id;
  const c = await fetchT(`${API}/agents`, {
    method: "POST",
    headers: maHeaders(),
    body: JSON.stringify({
      name: PLANNER_NAME,
      model: PLANNER_MODEL,
      description: "Reviews Nora's procurement report and proposes exactly what to upload to the customer dashboard. Human approval required.",
      system: PLANNER_SYSTEM,
      tools: [{ type: "agent_toolset_20260401" }],
      metadata: { owner: "logichain", role: "dashboard-update-planner" },
    }),
  });
  if (!c.ok) throw new Error(`create planner agent: ${await readErr(c)}`);
  const agent = await c.json();
  log("info", reqId, "planner_agent_created", { agentId: agent.id });
  return agent.id;
}

// ---------- Supabase (service role, PostgREST) ----------
const sbUrl = () => Deno.env.get("SUPABASE_URL")!;
const sbKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sbHeaders = (extra: Record<string, string> = {}) => ({
  apikey: sbKey(), Authorization: `Bearer ${sbKey()}`, "Content-Type": "application/json", ...extra,
});

type Run = Record<string, any>;

async function findRun(col: "nora_session_id" | "planner_session_id", sessionId: string): Promise<Run | null> {
  const r = await fetchT(`${sbUrl()}/rest/v1/analysis_runs?${col}=eq.${encodeURIComponent(sessionId)}&select=*`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`find run: ${await readErr(r)}`);
  return (await r.json())[0] ?? null;
}

async function createRun(row: Run): Promise<Run> {
  const r = await fetchT(`${sbUrl()}/rest/v1/analysis_runs`, {
    method: "POST", headers: sbHeaders({ Prefer: "return=representation" }), body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`create run: ${await readErr(r)}`);
  return (await r.json())[0];
}

// Conditional update: only applies if the run is still in `fromStatus` (prevents double work on duplicate webhooks)
async function updateRun(id: number, fromStatus: string | null, patch: Run): Promise<boolean> {
  const cond = fromStatus ? `&status=eq.${fromStatus}` : "";
  const r = await fetchT(`${sbUrl()}/rest/v1/analysis_runs?id=eq.${id}${cond}`, {
    method: "PATCH", headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`update run: ${await readErr(r)}`);
  return ((await r.json()) as unknown[]).length > 0;
}

// ---------- webhook signature (Standard Webhooks: webhook-id / -timestamp / -signature) ----------
function b64ToBytes(b64: string) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
function bytesToB64(bytes: Uint8Array) { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }

async function verifySignature(req: Request, body: string): Promise<{ ok: boolean; reason?: string }> {
  const secret = Deno.env.get("ANTHROPIC_WEBHOOK_SIGNING_KEY");
  if (!secret) return { ok: false, reason: "signing key not configured" };
  const id = req.headers.get("webhook-id"), ts = req.headers.get("webhook-timestamp"), sig = req.headers.get("webhook-signature");
  if (!id || !ts || !sig) return { ok: false, reason: "missing webhook headers" };
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: "stale timestamp" };
  const key = await crypto.subtle.importKey("raw", b64ToBytes(secret.replace(/^whsec_/, "")) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = bytesToB64(mac);
  const ok = sig.split(" ").some((part) => { const [, v] = part.split(","); return v === expected; });
  return ok ? { ok } : { ok: false, reason: "signature mismatch" };
}

// ---------- proposal validation ----------
function validateProposal(p: any): { ok: true; summary: string; counts: Record<string, number> } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "proposal is not an object" };
  if (!Array.isArray(p.po_lines)) return { ok: false, error: "po_lines missing" };
  if (!p.insights || typeof p.insights !== "object") return { ok: false, error: "insights missing" };
  const seen = new Set<string>();
  let bad = 0, dup = 0;
  for (const l of p.po_lines) {
    if (!l || typeof l.po !== "string" || !l.po.trim() || !Number.isFinite(Number(l.line)) || typeof l.supplier !== "string" ||
        typeof l.material_code !== "string" || !Number.isFinite(Number(l.line_value_nok))) { bad++; continue; }
    const k = `${l.po.trim().toUpperCase()}#${Number(l.line)}`;
    if (seen.has(k)) dup++; else seen.add(k);
  }
  if (bad) return { ok: false, error: `${bad} po_lines are missing required fields` };
  if (dup) return { ok: false, error: `${dup} duplicate (po, line) pairs` };
  return {
    ok: true,
    summary: String(p.summary ?? "").slice(0, 2000),
    counts: { po_lines: p.po_lines.length, findings: (p.insights.findings ?? []).length, actions: (p.insights.actions ?? []).length, warnings: (p.warnings ?? []).length },
  };
}

// ---------- notify Einar (optional Power Automate HTTP trigger) ----------
async function notify(reqId: string, run: Run, summary: string, counts: Record<string, number>) {
  const url = Deno.env.get("NOTIFY_FLOW_URL");
  if (!url) { log("info", reqId, "notify", { result: "skipped_no_flow_url" }); return; }
  try {
    const r = await fetchT(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: `Logichain: approval needed – ${run.file_name ?? "analysis"} (run #${run.id})`,
        runId: run.id, fileName: run.file_name, sender: run.sender, summary,
        poLines: counts.po_lines, findings: counts.findings, warnings: counts.warnings,
        approveUrl: `${DASHBOARD_URL}#approvals`,
      }),
    }, 15_000);
    log(r.ok ? "info" : "warn", reqId, "notify", { status: r.status });
  } catch (e) { log("warn", reqId, "notify", { error: e instanceof Error ? e.message : String(e) }); }
}

// ---------- pipeline steps ----------
async function onNoraIdle(reqId: string, session: any) {
  let run = await findRun("nora_session_id", session.id);
  if (!run) {
    // Sessions created before the pipeline existed: register them now
    run = await createRun({
      status: "analysing", nora_session_id: session.id,
      file_name: session.metadata?.file_name ?? null, sender: session.metadata?.sender ?? null,
      source_file_id: session.metadata?.file_id ?? null,
    });
  }
  if (run.status !== "analysing") { log("info", reqId, "nora_idle_ignored", { runId: run.id, status: run.status }); return; }

  const report = await findOutput(session.id, (files) =>
    files.filter((f) => /\.xlsx$/i.test(f.filename) && f.filename !== "data.xlsx" && f.id !== run!.source_file_id)
      .sort((a, b) => (/report/i.test(b.filename) ? 1 : 0) - (/report/i.test(a.filename) ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at)))[0]);
  if (!report) {
    // Nora may have stopped to ask something; keep the run open so the next idle re-checks.
    await updateRun(run.id, "analysing", { error: "Nora went idle without an Excel report in /mnt/session/outputs (waiting for next idle)." });
    log("warn", reqId, "nora_no_report", { runId: run.id });
    return;
  }

  // Claim the run so duplicate webhooks don't start two planners
  if (!(await updateRun(run.id, "analysing", { status: "report_ready", nora_report_file_id: report.id, nora_report_name: report.filename, error: null }))) {
    log("info", reqId, "nora_idle_race", { runId: run.id }); return;
  }

  try {
    // Re-upload the report as a regular file so it can be mounted into the Planner session
    const reportBytes = await downloadFile(report.id);
    const reportFileId = await uploadFile(reportBytes, report.filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const resources: Record<string, unknown>[] = [{ type: "file", file_id: reportFileId, mount_path: "/nora_report.xlsx" }];
    if (run.source_file_id) resources.push({ type: "file", file_id: run.source_file_id, mount_path: "/customer_data.xlsx" });

    const agentId = await plannerAgentId(reqId);
    const prompt = [
      `Run #${run.id}. Nora has finished analysing a customer purchasing file${run.file_name ? ` (${run.file_name})` : ""}${run.sender ? ` sent by ${run.sender}` : ""}.`,
      "",
      "Files in your workspace (read-only):",
      "  /mnt/session/uploads/nora_report.xlsx  – Nora's analysis report",
      run.source_file_id ? "  /mnt/session/uploads/customer_data.xlsx – the customer's original purchasing file" : "  (the original customer file is not available for this run – say so in warnings)",
      "",
      "Follow your instructions and write /mnt/session/outputs/update_proposal.json. Do not upload or write anything anywhere else.",
    ].join("\n");

    const r = await fetchT(`${API}/sessions`, {
      method: "POST", headers: maHeaders(),
      body: JSON.stringify({
        agent: agentId,
        environment_id: ENVIRONMENT_ID,
        title: `Dashboard update plan – run #${run.id}${run.file_name ? " – " + run.file_name : ""}`.slice(0, 500),
        metadata: { source: "logichain-planner", run_id: String(run.id), nora_session_id: session.id },
        resources,
        initial_events: [{ type: "user.message", content: [{ type: "text", text: prompt }] }],
      }),
    });
    if (!r.ok) throw new Error(`create planner session: ${await readErr(r)}`);
    const planner = await r.json();
    await updateRun(run.id, "report_ready", { status: "planning", planner_session_id: planner.id });
    log("info", reqId, "planner_started", { runId: run.id, plannerSessionId: planner.id, status: planner.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateRun(run.id, "report_ready", { status: "failed", error: `Starting planner failed: ${msg}`.slice(0, 1000) });
    throw e;
  }
}

async function onPlannerIdle(reqId: string, session: any) {
  const run = await findRun("planner_session_id", session.id);
  if (!run) { log("warn", reqId, "planner_run_missing", { sessionId: session.id }); return; }
  if (run.status !== "planning") { log("info", reqId, "planner_idle_ignored", { runId: run.id, status: run.status }); return; }

  const file = await findOutput(session.id, (files) => files.find((f) => f.filename === PROPOSAL_FILE) ?? files.find((f) => /\.json$/i.test(f.filename)));
  if (!file) {
    await updateRun(run.id, "planning", { error: "Planner went idle without update_proposal.json (waiting for next idle)." });
    log("warn", reqId, "planner_no_proposal", { runId: run.id }); return;
  }
  let proposal: any;
  try { proposal = JSON.parse(new TextDecoder().decode(await downloadFile(file.id))); }
  catch (e) {
    await updateRun(run.id, "planning", { status: "failed", error: `Proposal is not valid JSON: ${e instanceof Error ? e.message : e}`.slice(0, 1000) });
    return;
  }
  const v = validateProposal(proposal);
  if (!v.ok) { await updateRun(run.id, "planning", { status: "failed", proposal, error: `Proposal rejected by validation: ${v.error}` }); return; }

  if (!(await updateRun(run.id, "planning", { status: "awaiting_approval", proposal, proposal_summary: v.summary, error: null }))) return;
  log("info", reqId, "awaiting_approval", { runId: run.id, ...v.counts });
  await notify(reqId, run, v.summary, v.counts);
}

// ---------- handler ----------
Deno.serve(async (req: Request) => {
  const reqId = crypto.randomUUID();
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!Deno.env.get("ANTHROPIC_API_KEY") || !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    log("error", reqId, "config", { result: "missing env" });
    return new Response("Server configuration missing", { status: 500 });
  }

  const body = await req.text();
  const sig = await verifySignature(req, body);
  if (!sig.ok) { log("warn", reqId, "signature", { result: sig.reason }); return new Response("invalid signature", { status: 400 }); }

  let evt: any;
  try { evt = JSON.parse(body); } catch (_) { return new Response("bad json", { status: 400 }); }
  const type = evt?.data?.type, sessionId = evt?.data?.id;
  log("info", reqId, "event", { eventId: evt?.id, type, sessionId });
  if (type !== "session.status_idled" || typeof sessionId !== "string") return new Response(null, { status: 204 });

  try {
    // Never trust the payload beyond the ID: fetch the session from the API
    const session = await getSession(sessionId);
    const source = session?.metadata?.source;
    if (source === "nora-email-intake") await onNoraIdle(reqId, session);
    else if (source === "logichain-planner") await onPlannerIdle(reqId, session);
    else log("info", reqId, "ignored_session", { sessionId, source: source ?? null });
    return new Response(null, { status: 204 });
  } catch (e) {
    log("error", reqId, "processing", { sessionId, error: e instanceof Error ? e.message.slice(0, 500) : String(e) });
    // 500 → Anthropic retries (max 3). Steps are idempotent thanks to the status checks.
    return new Response("processing error", { status: 500 });
  }
});
