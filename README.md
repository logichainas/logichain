# Logichain

**Turn purchasing data into decisions.**

Logichain er en procurement intelligence-plattform som samler innkjøpsdata fra alle
leverandører i ett interaktivt dashboard — spend-analyse, leverandørytelse,
leveringspresisjon og identifisert sparepotensial, med full dokumentasjon bak hvert tall.

## 🌐 Nettside og hosting

Siden hostes på **Cloudflare Pages** (prosjekt `logichain`), koblet til dette repoet:

- Push til `main` → publiseres automatisk på **https://logichain.no**
- Push til en annen gren → egen forhåndsvisning på `https://<gren>.logichain-40w.pages.dev`
- Ingen build-steg: Cloudflare serverer filene i rotmappen direkte

| Fil | Hva |
|---|---|
| `index.html` / `index-en.html` | Nettside (norsk / engelsk) med innlogging |
| `logichain-dashboard-demo.html` / `-en.html` | Interaktivt dashboard med demodata |
| `macgregor-dashboard.html` | Kundeportal for MacGregor (ekte data fra Supabase) |
| `last-opp.html` | Admin: importer CSV med PO-linjer til Supabase |
| `supabase/` | SQL-skript og oppsettsguide for database og innlogging |
| `cloudflare/octopart-worker.js` | Worker som henter markedspriser fra Nexar/Octopart |

## 📦 Moduler i dashboardet

1. **Executive Overview** — hele innkjøpsfunksjonen på én skjerm
2. **Spend Intelligence** — spend per leverandør/kategori/måned, top 10, konsentrasjon, pris- og volumutvikling, tail spend, single-source-risiko
3. **Leverandører** — rating A–D, OTD, avvik og historikk per leverandør
4. **PO Performance** — alle innkjøpsordre søkbare ned til linjenivå
5. **Marked (Octopart)** — markedspriser, lager og leveringstid fra distributører
6. **Sparingspotensial** — identifisert potensial med «view evidence»-dokumentasjon
7. **Tiltak** — prioriterte handlinger med estimert verdi

## 🛠️ Teknologi

Ren HTML/CSS/JavaScript uten build-prosess. Eksterne avhengigheter:
**Supabase** (innlogging og database, lastes fra CDN) og en **Cloudflare Worker** for Octopart-data.

> Tallene i demoen er generert demodata og illustrerer produktet — ikke ekte
> kundedata. Estimert sparing er identifisert potensial, ikke garanti.

---

© 2026 Logichain
