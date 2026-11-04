/**
 * Logichain · /api/lead  (Cloudflare Pages Function)
 * POST {name, email, company, lang, page, hp}  ← demo sign-up form
 * 1) stores the lead in Supabase (demo_leads, via log_demo_lead)
 * 2) e-mails post@logichain.no through a Power Automate HTTP flow (env LEAD_FLOW_URL, optional)
 */
const SUPABASE_URL = "https://iksnoymoqvweudilfuzy.supabase.co";
const SUPABASE_ANON = "sb_publishable_hlieTwPa1c6v0I67KqXBng_pSnJ_iIH";
const TO = "post@logichain.no";
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch (_) { return json({ error: "Bad request" }, 400); }
  if (b.hp) return json({ ok: true }); // honeypot field filled → bot, pretend success
  const name = clean(b.name, 120), email = clean(b.email, 200).toLowerCase(), company = clean(b.company, 160);
  const lang = b.lang === "en" ? "en" : "no", page = clean(b.page, 120);
  if (name.length < 2 || company.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: lang === "en" ? "Please fill in name, a valid e-mail and company." : "Fyll inn navn, gyldig e-post og bedrift." }, 400);
  let ref = null;
  try { const h = new URL(request.headers.get("Referer") || "").hostname; if (h && !/logichain/.test(h)) ref = h; } catch (_) {}
  const country = (request.cf && request.cf.country) || null;

  let stored = false, emailed = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_demo_lead`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_name: name, p_email: email, p_company: company, p_lang: lang, p_page: page, p_referrer: ref, p_country: country }),
    });
    stored = r.ok;
  } catch (_) {}

  if (env.LEAD_FLOW_URL) {
    try {
      const when = new Date().toLocaleString("nb-NO", { timeZone: "Europe/Oslo" });
      const r = await fetch(env.LEAD_FLOW_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: TO,
          subject: `Ny demo-henvendelse: ${company} (${name})`,
          body: `<p><b>Noen har åpnet Logichain-demoen.</b></p><table cellpadding="4">
<tr><td>Navn</td><td><b>${esc(name)}</b></td></tr><tr><td>Bedrift</td><td><b>${esc(company)}</b></td></tr>
<tr><td>E-post</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
<tr><td>Språk</td><td>${lang}</td></tr><tr><td>Tid</td><td>${esc(when)}</td></tr>${country ? `<tr><td>Land</td><td>${esc(country)}</td></tr>` : ""}${ref ? `<tr><td>Kom fra</td><td>${esc(ref)}</td></tr>` : ""}</table>
<p>Se alle i Jarvis: <a href="https://logichain.no/admin.html">logichain.no/admin</a></p>`,
          name, email, company,
        }),
      });
      emailed = r.ok;
    } catch (_) {}
  }
  if (!stored && !emailed) return json({ error: lang === "en" ? "Something went wrong – please try again." : "Noe gikk galt – prøv igjen." }, 502);
  return json({ ok: true });
}
