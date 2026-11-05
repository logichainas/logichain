// Logichain · CEO daily market scan
// Called by pg_cron (see supabase/ceo-daily-scan.sql) at 21:00 and 22:00 UTC. Runs once a day at 23:00 Oslo time:
// starts a session for the CEO agent that scans the last 24 hours for news and market moves that matter to Logichain.
// Spend cap: the CEO agent has $3 IN TOTAL across all his sessions (Einar's rule); a run only gets what is left. Guarded by a shared secret stored in the database and by a one-run-per-day lock.
const API = "https://api.anthropic.com/v1";
const RESEARCH_ENV = Deno.env.get("RESEARCH_ENVIRONMENT_ID") ?? "env_01YVZKu1ucYiQhpoYXwuGNDH"; // open internet
const headers = (k: string) => ({
  "x-api-key": k,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
  "content-type": "application/json",
});
const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ fn: "ceo-daily-scan", event, ...data }));

function osloParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), label: `${p.day}.${p.month}.${p.year}` };
}

function prompt(label: string) {
  return `DAGLIG MARKEDSBRIEF – ${label}

Du er CEO-agenten for Logichain. Søk på nettet etter nyheter og endringer i markedet fra de siste 24 timene som kan påvirke Logichain eller kundene våre. Fokuser på det som faktisk har betydning – ikke lag liste for listens skyld.

OM LOGICHAIN: Norsk oppstartsselskap (Arendal) som selger innkjøpsanalyse og leverandøroppfølging som abonnement: dashboard med spend, leveringspresisjon (OTD), leverandørrating og sparepotensial, bygget på kundens ERP-eksport. Målkunder: innkjøpsavdelinger i industri, maritim/offshore og handel, 50–500 ansatte, i Norge (start Agder og Vestlandet). Felles mål: flere betalende kunder.

SE ETTER:
- Hendelser i forsyningskjeden: frakt, havner, leveringstider, tollsatser, sanksjoner, råvare- og stålpriser, energipriser.
- Valuta: store bevegelser i NOK mot EUR og USD (påvirker innkjøpskostnader og interessen for prisanalyse).
- Norsk industri, maritim og offshore: store kontrakter, investeringer, oppkjøp, nedbemanninger, nye fabrikker – særlig i Agder og på Vestlandet. Det er mulige kunder eller signaler om behov.
- Innkjøp og regelverk: endringer i åpenhetsloven, EU-krav til leverandørkjeden (CSRD/CSDDD), offentlige anbud (Doffin) som gjelder innkjøpsanalyse.
- Konkurrenter og verktøy for spendanalyse/leverandøroppfølging: lanseringer, priser, oppkjøp.
- Arrangementer de neste fire ukene der innkjøpere møtes (NIMA, næringsforeninger, klynger som Eyde og GCE NODE).

REGLER: Bruk bare kilder du faktisk har lest, og oppgi lenke. Ikke finn opp tall. Ikke send noe eksternt. Kunden MacGregor skal ikke nevnes. Bruk lite budsjett: maks rundt 10 søk.

LEVER (norsk, kort – maks én skjermside):
- Hvis ingenting viktig: skriv bare «Ingen viktige endringer siste døgn» og én setning om hva du sjekket.
- Ellers maks 5 punkter, sortert etter betydning. Hvert punkt: hva skjedde (1 setning) · hvorfor det betyr noe for Logichain (1 setning) · anbefalt handling (1 setning, f.eks. «kontakt X», «skriv LinkedIn-innlegg om Y», «ingen handling nå») · kilde.
- Avslutt med «Dagens ene ting:» – den ene handlingen Einar bør gjøre i morgen, hvis noen.
Lagre også briefen som /mnt/session/outputs/markedsbrief-${label.split(".").reverse().join("-")}.md.`;
}

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !key || !apiKey) return Response.json({ error: "missing configuration" }, { status: 500 });
  const sb = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  // 1) shared secret (lives only in the database, sent by pg_cron)
  const secret = req.headers.get("x-cron-secret") || "";
  const ok = secret.length >= 32 && await fetch(`${url}/rest/v1/rpc/check_app_secret`, {
    method: "POST", headers: sb, body: JSON.stringify({ p_name: "ceo_cron", p_value: secret }),
  }).then((r) => r.json()).catch(() => false);
  if (ok !== true) { log("denied"); return Response.json({ error: "unauthorized" }, { status: 401 }); }

  // 2) only at 23:00 Oslo time (cron fires at 21 and 22 UTC so it works in both summer and winter time)
  let body: { force?: boolean } = {};
  try { body = await req.json(); } catch (_) { /* empty body */ }
  const now = osloParts(new Date());
  if (now.hour !== 23 && !body.force) { log("skip_hour", { hour: now.hour }); return Response.json({ skipped: "not 23:00 in Oslo" }); }

  // 3) one run per day
  const lock = await fetch(`${url}/rest/v1/ceo_daily_runs?on_conflict=day`, {
    method: "POST", headers: { ...sb, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ day: now.day }),
  });
  const locked = await lock.json().catch(() => []);
  if (!lock.ok) { log("lock_failed", { status: lock.status }); return Response.json({ error: "lock failed" }, { status: 500 }); }
  if (!Array.isArray(locked) || !locked.length) { log("already_ran", { day: now.day }); return Response.json({ skipped: "already ran today" }); }

  // 4) find the CEO agent
  const agents = await fetch(`${API}/agents?limit=50`, { headers: headers(apiKey) }).then((r) => r.json()).catch(() => ({}));
  const ceo = (agents.data || []).find((a: { name?: string; archived_at?: string }) => /ceo/i.test(a.name || "") && !a.archived_at);
  if (!ceo) { log("no_ceo_agent"); return Response.json({ error: "CEO agent not found" }, { status: 404 }); }

  // 5) lifetime budget: $3 in total for the CEO agent, across every session (running sessions count with their full cap)
  const list = await fetch(`${API}/sessions?agent_id=${encodeURIComponent(ceo.id)}&limit=100`, { headers: headers(apiKey) })
    .then((r) => r.json()).catch(() => ({ data: null }));
  if (!Array.isArray(list.data)) { log("budget_check_failed"); await fetch(`${url}/rest/v1/ceo_daily_runs?day=eq.${now.day}`, { method: "DELETE", headers: sb }); return Response.json({ error: "could not check budget" }, { status: 502 }); }
  const cents = (v: unknown) => { const n = Number(v && typeof v === "object" ? (v as { amount?: unknown }).amount : v); return Number.isFinite(n) ? n : 0; };
  const full = await Promise.all(list.data.map((x: { id: string }) =>
    fetch(`${API}/sessions/${x.id}`, { headers: headers(apiKey) }).then((r) => r.json()).catch(() => x)));
  const committed = full.reduce((sum: number, x: { status?: string; usage?: { list_cost?: unknown; total_list_cost?: unknown }; budget?: { max_list_cost?: unknown } }) => {
    const spent = cents(x.usage && (x.usage.list_cost ?? x.usage.total_list_cost));
    const cap = cents(x.budget && x.budget.max_list_cost);
    return sum + (x.status === "running" ? Math.max(spent, cap) : spent);
  }, 0);
  const left = 300 - committed;
  if (left < 10) { log("budget_used", { committed }); return Response.json({ skipped: "CEO total budget of $3 is used" }); }

  // 6) start the session with whatever is left of the $3 (max $3)
  const r = await fetch(`${API}/sessions`, {
    method: "POST", headers: headers(apiKey),
    body: JSON.stringify({
      agent: ceo.id,
      environment_id: RESEARCH_ENV,
      title: `Markedsbrief ${now.label}`,
      metadata: { source: "ceo-daily-scan", day: now.day },
      budget: { type: "limit", max_list_cost: { amount: String(Math.min(300, Math.floor(left))), currency: "USD" } },
      initial_events: [{ type: "user.message", content: [{ type: "text", text: prompt(now.label) }] }],
    }),
  });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) {
    log("session_failed", { status: r.status, error: s?.error?.message });
    await fetch(`${url}/rest/v1/ceo_daily_runs?day=eq.${now.day}`, { method: "DELETE", headers: sb }); // allow a retry
    return Response.json({ error: "could not start session" }, { status: 502 });
  }
  await fetch(`${url}/rest/v1/ceo_daily_runs?day=eq.${now.day}`, { method: "PATCH", headers: sb, body: JSON.stringify({ session_id: s.id }) });
  log("started", { day: now.day, session: s.id });
  return Response.json({ ok: true, session: s.id });
});
