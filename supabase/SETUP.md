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

## 4. Lim inn nøklene i nettsiden
1. **Settings** (tannhjul) → **API** → kopier **Project URL** og **anon public**-nøkkelen
2. Åpne `index.html`, `index-en.html`, `logichain-dashboard-demo.html` og `logichain-dashboard-demo-en.html`
   og finn denne linjen (øverst i scriptet i hver fil):

```js
const SUPABASE={url:"",anonKey:""};
```

3. Lim inn: `const SUPABASE={url:"https://xxxx.supabase.co",anonKey:"eyJhbG..."};`

**Tips:** bruk Find & Replace i editor — søk etter `SUPABASE={url:""` i alle fire filene.

## 5. Push og test
1. Commit + push (eller be Logichain-assistenten gjøre det)
2. Gå til nettsiden → **Logg inn** med en kundekonto du opprettet i steg 3
3. Du lander nå på kundens dashboard — med firmanavn i toppbaren og kundens egne tall

## Sikkerhet – hvorfor dette er trygt
- **anon-nøkkelen** er offentlig by design; den gir ikke tilgang til data uten innlogging
- Passord håndteres 100 % av Supabase (aldri lagret i koden)
- **RLS** sørger for at hver bruker kun kan lese sin egen kunderad
- Vil du hemmeligholde demo-lenker per kunde kan du fortsatt bruke `?kunde=`-parametren

## Fallback
Før nøklene er limt inn, fungerer den gamle demo-innloggingen
(`demo@norskindustri.no` / `demo1234`) som før — ingenting ødelegges underveis.
