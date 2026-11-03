# Logichain · Supabase-oppsett (ca. 15 min)

Slik kobler du på **ekte innlogging** (e-post + passord via Supabase):

## 1. Opprett prosjekt
1. Gå til [supabase.com](https://supabase.com) → **Sign in** (github-konto fungerer)
2. **New project** → navn `logichain`, velg region (f.eks. eu-central-1), sett et database-passord → **Create**

## 2. Kjør SQL-skjemaet
1. Åpne **SQL Editor** i venstremenyen → **New query**
2. Lim inn innholdet i `supabase/setup.sql` → **Run**
   (oppretter `kunder`-tabell, rad-sikkerhet og auto-profil ved nye brukere)

## 3. Opprett kundekontoer
1. **Authentication** → **Users** → **Add user** → e-post + passord → huk av **Auto Confirm**
   (gjenta per kunde — passordet deler du med kunden)
2. En profilrad i `kunder` opprettes automatisk (med tilfeldig dataseed)
3. Vil du styre firmanavn/seed: **SQL Editor** →  
   `update kunder set firma='Kundens Navn AS', seed=4211 where epost='kunde@firma.no';`

## 4. Kjør resten av SQL-skriptene (i denne rekkefølgen)
1. `supabase/data-schema.sql` – tabeller for leverandører, materialer og PO-linjer
2. `supabase/tilgang-fix.sql` – kunder kan kun lese; innleveringer + fillager
3. `supabase/admin-tilgang.sql` – admin-flagg og skrivetilgang for Logichain
4. `supabase/fix-2026-11.sql` – portal-kolonne, admin-lesing av innleveringer, opprydding av duplikater og unike indekser

Alle skriptene kan trygt kjøres flere ganger.

## 5. Gi kunden egen portal (valgfritt)
Kunder uten portal havner i demo-dashboardet. Slik sender du en kunde til sitt eget dashboard:

```sql
update kunder set portal = 'macgregor-dashboard.html' where epost = 'kunde@firma.no';
```

## 6. Nøkler og URL-er
- Project URL og **publishable/anon**-nøkkelen ligger allerede i HTML-filene (`const SUPABASE={...}`).
- **Authentication → URL Configuration**: sett *Site URL* til `https://logichain.no` og legg til
  `https://logichain.no/**`, `https://www.logichain.no/**` og `https://*.logichain-40w.pages.dev/**` under *Redirect URLs*.

## 7. Last inn ekte data
1. Logg inn som admin og åpne `last-opp.html`
2. Velg CSV (malen kan lastes ned i kundeportalen) → valider → **Importér**
3. Eksisterende PO-linjer hoppes over automatisk; huk av «Erstatt» for å laste alt på nytt

## Sikkerhet – hvorfor dette er trygt
- **anon/publishable-nøkkelen** er offentlig by design; uten innlogging gir den ingen data
- Passord håndteres 100 % av Supabase (aldri lagret i koden)
- **RLS** sørger for at hver kunde kun leser sine egne rader, og bare admin kan skrive
- Kunder kan sende inn filer (innleveringer), men ikke endre dashboard-data
