// apply-proposal
// Called from Jarvis when Einar approves or rejects a Planner proposal.
//   POST { runId, action: "approve" | "reject", kundeId?, includePoLines?, includeInsights?, note? }
// Only admins (kunder.admin = true) may call it. Customer data is written ONLY here, and only on approve.
//
// "Verify JWT" can stay ON (Jarvis sends the admin's Supabase access token).
// Uses SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (provided automatically).

const ALLOWED_ORIGINS = [
  "https://logichain.no", "https://www.logichain.no", "https://logichain-40w.pages.dev",
];
function cors(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.logichain-40w\.pages\.dev$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function log(level: "info" | "warn" | "error", reqId: string, stage: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, fn: "apply-proposal", requestId: reqId, stage, ...data });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
}

const SB = () => Deno.env.get("SUPABASE_URL")!;
const SR = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = (extra: Record<string, string> = {}) => ({ apikey: SR(), Authorization: `Bearer ${SR()}`, "Content-Type": "application/json", ...extra });

async function rest(path: string, init: RequestInit = {}, ms = 30_000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(`${SB()}/rest/v1/${path}`, { ...init, headers: { ...H(), ...(init.headers as Record<string, string> ?? {}) }, signal: c.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(t); }
}

async function fetchAll(table: string, cols: string, kundeId: string) {
  let out: any[] = [], from = 0;
  for (;;) {
    const page = await rest(`${table}?select=${cols}&kunde_id=eq.${kundeId}&order=id`, { headers: { Range: `${from}-${from + 999}` } });
    out = out.concat(page ?? []);
    if (!page || page.length < 1000) return out;
    from += 1000;
  }
}

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);

async function applyPoLines(kundeId: string, lines: any[]) {
  // suppliers
  const sup = await fetchAll("leverandorer", "id,navn", kundeId);
  const supMap = new Map<string, number>(sup.map((r: any) => [String(r.navn).toLowerCase(), r.id]));
  const newSup = new Map<string, string>();
  for (const l of lines) { const n = String(l.supplier).trim(); if (n && !supMap.has(n.toLowerCase())) newSup.set(n.toLowerCase(), n); }
  if (newSup.size) {
    const ins = await rest("leverandorer?select=id,navn", { method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify([...newSup.values()].map((navn) => ({ kunde_id: kundeId, navn }))) });
    for (const r of ins) supMap.set(String(r.navn).toLowerCase(), r.id);
  }
  // materials
  const mat = await fetchAll("materialer", "id,kode", kundeId);
  const matMap = new Map<string, number>(mat.map((r: any) => [String(r.kode).toLowerCase(), r.id]));
  const newMat = new Map<string, any>();
  for (const l of lines) {
    const k = String(l.material_code).trim();
    if (k && !matMap.has(k.toLowerCase()) && !newMat.has(k.toLowerCase()))
      newMat.set(k.toLowerCase(), { kunde_id: kundeId, kode: k, beskrivelse: str(l.material_description) ?? k, kategori: str(l.category, 120) ?? "–", enhet: str(l.unit, 20) ?? "stk", standardpris: num(l.unit_price_nok) });
  }
  if (newMat.size) {
    const rows = [...newMat.values()];
    for (let i = 0; i < rows.length; i += 500) {
      const ins = await rest("materialer?select=id,kode", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(rows.slice(i, i + 500)) });
      for (const r of ins) matMap.set(String(r.kode).toLowerCase(), r.id);
    }
  }
  // PO lines – new ones are inserted; existing ones (same PO + line for this customer) are updated
  // with any new values from the file (e.g. a delivery date that has come in, a changed promise date).
  // Empty values in the file never wipe existing data.
  const COLS = "id,kunde_id,po,linjenr,leverandor_id,material_id,prosjekt,antall,enhet,enhetspris,verdi,bestillingsdato,love_dato,leveringsdato";
  const existing = await fetchAll("po_linjer", COLS, kundeId);
  const keyOf = (po: unknown, line: unknown) => `${String(po).trim().toUpperCase()}#${num(line, 1)}`;
  const have = new Map<string, any>(existing.map((r: any) => [keyOf(r.po, r.linjenr), r]));
  const incoming = new Map<string, any>();            // de-duplicate: last occurrence in the file wins
  for (const l of lines) if (String(l.po ?? "").trim()) incoming.set(keyOf(l.po, l.line), l);

  const toRow = (l: any) => ({
    kunde_id: kundeId, po: String(l.po).trim(), linjenr: num(l.line, 1),
    leverandor_id: supMap.get(String(l.supplier).trim().toLowerCase()) ?? null,
    material_id: matMap.get(String(l.material_code).trim().toLowerCase()) ?? null,
    prosjekt: str(l.project, 120), antall: num(l.quantity, 1), enhet: str(l.unit, 20) ?? "stk",
    enhetspris: num(l.unit_price_nok), verdi: num(l.line_value_nok),
    bestillingsdato: isoDate(l.order_date), love_dato: isoDate(l.promised_date), leveringsdato: isoDate(l.delivery_date),
  });
  const UPD = ["leverandor_id", "material_id", "prosjekt", "antall", "enhet", "enhetspris", "verdi", "bestillingsdato", "love_dato", "leveringsdato"];
  const inserts: any[] = [], updates: any[] = [];
  let unchanged = 0, deliveredNow = 0;
  for (const [k, l] of incoming) {
    const row = toRow(l), old = have.get(k);
    if (!old) { inserts.push(row); continue; }
    const patch: any = {};
    let changed = false;
    for (const c of UPD) {
      const v = (row as any)[c];
      const src = ({ enhetspris: "unit_price_nok", verdi: "line_value_nok", antall: "quantity", enhet: "unit" } as Record<string, string>)[c];
      if (v == null || (src && (l[src] == null || l[src] === ""))) continue;   // not in the file → keep existing
      const ov = old[c];
      const same = typeof v === "number" ? Number(ov) === v : String(ov ?? "").slice(0, 10) === String(v).slice(0, 10);
      if (!same) { patch[c] = v; changed = true; }
    }
    if (!changed) { unchanged++; continue; }
    if (!old.leveringsdato && patch.leveringsdato) deliveredNow++;
    updates.push({ id: old.id, patch });
  }
  for (let i = 0; i < inserts.length; i += 500) {
    await rest("po_linjer", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(inserts.slice(i, i + 500)) });
  }
  // id is GENERATED ALWAYS, so update row by row (only the changed fields), 10 at a time
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.all(updates.slice(i, i + 10).map((u) =>
      rest(`po_linjer?id=eq.${u.id}&kunde_id=eq.${kundeId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(u.patch) })));
  }
  return { suppliers_added: newSup.size, materials_added: newMat.size, po_lines_added: inserts.length, po_lines_updated: updates.length,
    po_lines_newly_delivered: deliveredNow, po_lines_unchanged: unchanged, po_lines_duplicates_in_file: lines.length - incoming.size };
}

Deno.serve(async (req: Request) => {
  const reqId = crypto.randomUUID();
  const h = cors(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => Response.json(b, { status, headers: h });
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // --- who is calling? must be an admin ---
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);
  const ur = await fetch(`${SB()}/auth/v1/user`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? SR(), Authorization: auth } });
  if (!ur.ok) return json({ error: "Invalid session" }, 401);
  const user = await ur.json();
  const me = (await rest(`kunder?select=id,admin&user_id=eq.${user.id}`))?.[0];
  if (!me?.admin) { log("warn", reqId, "auth", { result: "not_admin", user: user.id }); return json({ error: "Access denied" }, 403); }

  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const runId = Number(body.runId);
  if (!Number.isInteger(runId)) return json({ error: "runId required" }, 400);
  const run = (await rest(`analysis_runs?select=*&id=eq.${runId}`))?.[0];
  if (!run) return json({ error: "Run not found" }, 404);
  if (run.status !== "awaiting_approval") return json({ error: `Run is ${run.status}, not awaiting approval` }, 409);

  // --- reject ---
  if (body.action === "reject") {
    await rest(`analysis_runs?id=eq.${runId}&status=eq.awaiting_approval`, { method: "PATCH",
      body: JSON.stringify({ status: "rejected", decided_by: user.id, decided_at: new Date().toISOString(), apply_result: { note: str(body.note, 1000) }, updated_at: new Date().toISOString() }) });
    log("info", reqId, "rejected", { runId, by: user.id });
    return json({ ok: true, status: "rejected" });
  }
  if (body.action !== "approve") return json({ error: "action must be approve or reject" }, 400);

  // --- approve ---
  const kundeId = String(body.kundeId ?? "");
  const kunde = /^[0-9a-f-]{36}$/i.test(kundeId) ? (await rest(`kunder?select=id,firma,portal&id=eq.${kundeId}`))?.[0] : null;
  if (!kunde || kunde.portal === "admin.html") return json({ error: "Choose a valid customer" }, 400);
  const includePo = body.includePoLines !== false, includeIns = body.includeInsights !== false;
  const p = run.proposal ?? {};

  // claim the run (prevents double-apply)
  const claimed = await rest(`analysis_runs?id=eq.${runId}&status=eq.awaiting_approval&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "applying", kunde_id: kunde.id, decided_by: user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  if (!claimed?.length) return json({ error: "Run was already handled" }, 409);

  const result: Record<string, unknown> = { kunde: kunde.firma, include_po_lines: includePo, include_insights: includeIns };
  try {
    if (includePo && Array.isArray(p.po_lines) && p.po_lines.length) Object.assign(result, await applyPoLines(kunde.id, p.po_lines));
    if (includeIns && p.insights) {
      const i = p.insights;
      await rest("dashboard_insights", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        kunde_id: kunde.id, run_id: runId,
        title: str(i.title, 200) ?? "Procurement analysis", summary: str(i.summary, 4000),
        savings_low: Number.isFinite(Number(i.savings_low_nok)) ? Number(i.savings_low_nok) : null,
        savings_high: Number.isFinite(Number(i.savings_high_nok)) ? Number(i.savings_high_nok) : null,
        findings: Array.isArray(i.findings) ? i.findings.slice(0, 20) : [],
        actions: Array.isArray(i.actions) ? i.actions.slice(0, 20) : [],
        data_quality: Array.isArray(i.data_quality) ? i.data_quality.slice(0, 20) : [],
      }) });
      result.insights_published = true;
    }
    await rest(`analysis_runs?id=eq.${runId}`, { method: "PATCH",
      body: JSON.stringify({ status: "applied", applied_at: new Date().toISOString(), apply_result: result, error: null, updated_at: new Date().toISOString() }) });
    log("info", reqId, "applied", { runId, kunde: kunde.id, ...result });
    return json({ ok: true, status: "applied", result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", reqId, "apply_failed", { runId, error: msg.slice(0, 500) });
    // back to awaiting approval so it can be retried; partial applies are safe to repeat (existing rows are matched and updated, not duplicated)
    await rest(`analysis_runs?id=eq.${runId}`, { method: "PATCH",
      body: JSON.stringify({ status: "awaiting_approval", error: `Apply failed: ${msg}`.slice(0, 1000), apply_result: result, updated_at: new Date().toISOString() }) }).catch(() => {});
    return json({ error: "Apply failed: " + msg.slice(0, 300) }, 500);
  }
});
