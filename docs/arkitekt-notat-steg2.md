# Arkitektnotat — Steg 2 (diskusjon)

Dato: 2026-06-30  
Kontekst: Vibeverk single-tenant SPA, vanilla JS, GitHub Pages, Supabase backend.

---

## 1. E-postmalar — korleis dei faktisk fungerer (og kva som manglar)

### Nåverande tilstand
E-postmalar i admin er eit **UI-lag over `mailto:`-lenker**. Når admin klikkar "Svar med mal" opnast standard e-postklient (Outlook/Mail) med emne og tekst fylt inn. Ingen e-post sendast direkte frå systemet.

Malar er lagra i `localStorage` under nøkkelen `{storageKey}:crm-settings`. Plasshalderar (`{namn}`, `{epost}`, `{referanse}`) substitueras klientsida i `core.js`.

### UX-problem
- Ny fane opnar e-postklient, men brukar kan missa den (mobil)
- Ingen kopi av svar lagrast i Vibeverk — historikk er berre det som finst i e-postklienten
- Mal-teksten er flat tekst; formatering (feit/kursiv) kan ikkje presenterast i `mailto:`
- Ingen kvittering til kunden frå systemet sjølv

### Vegen framover (to nivå)
**Nivå 1 — ingen infrastruktur:** Behald `mailto:` men vis ein in-app-kopi av det som vart sendt ("Svar kopiert til historikk"). Admin konfirmerar at svar er sendt etter at e-postklienten er opna.

**Nivå 2 — direkte sending:** Krev ein Supabase Edge Function som kallar eit e-postAPI (Resend, Postmark, SendGrid). Sjå seksjon 2.

---

## 2. E-postkobling — implementeringsveg

### Forholdet til Supabase Auth
Supabase Auth sender transaksjonelle e-postar (invitasjonar, OTP) via SMTP-innstillingar i Supabase Dashboard. Dette er ikkje det same som "svare på kundehenvendingar".

### Foreslått arkitektur (Resend + Edge Function)
```
Admin klikkar "Send" → Supabase Edge Function (manage-email/index.ts)
  → Resend API (eller annan leverandør)
  → E-post til kunden
  → Logg svar i chat_messages-tabellen (sender = "operator")
```

SQL-tabellen `chat_messages` har allereie riktige felt. Ein ny rad med `sender = 'operator'` og `metadata = {sent_via: 'email'}` vil visa i chat-historikken automatisk.

### Config som trengst
```js
// I config.js (encrypted i Console, ikkje i repo)
email: {
  provider: "resend",  // eller "postmark", "mailgun"
  apiKey:   "",        // hentast frå Supabase secrets
  fromName: "Vibeverk",
  fromAddr: "post@vibeverk.no"
}
```

### Viktige omsyn
- API-nøklar MÅ lagrast i Supabase secrets (ikkje i `config.js`/localStorage)
- GDPR: e-postinnhald med persondata lagrast i `chat_messages` → TTL/sletting følgjer same reglar
- Anon-brukaren skal aldri kunne kalla edge-funksjonen direkte

---

## 3. Analyse-side — design

### Nåverande problem
- Analyse-sida brukar `max-width: 720px` som resten av admin, men statistikk-innhald passar betre med full breidde
- Farge- og fontvariablar arver ikkje rett i nokre kort (sjå `--color-muted` i admin-lys-tema)
- Diagrammar (Chart.js / Plausible embed) trenger meir plass

### Anbefalt fix
1. Legg til ein CSS-klasse `admin-fullwidth` på `<section>` for Analyse-fana
2. I `core.js`, i `buildAdminSection()`: sjekk om aktiv fane har `fullwidth: true` og utvid container
3. Juster kort-grid til `repeat(auto-fill, minmax(200px, 1fr))` med 6-kol maks

### Ikkje tilpassa mobil enno
Analyse-sida har responsiv CSS for ≥768px, men ≤480px kollapsar ikkje riktig. Prioriter desktop (analyse er sjeldan på mobil).

---

## 4. Custom design-modul (ny stor funksjon)

### Konsept
Ein visuell "Tema-editor" i admin der kunde sjølv kan:
- Velja primær-/sekundærfarge (color picker)
- Velja skriftparklasse frå eit kuratert sett (t.d. "Moderne sans", "Klassisk serif", "Teknisk mono")
- Lasta opp logo (SVG/PNG)
- Justere hjørne-radius (rund / standard / skarp)
- Førehandsvisa endringar live

### Teknisk implementering
Alle verdiar skriv til `superconfig` via Konsollen (ikkje direkte eksponert i vanleg admin). `applyTheme()` i `core.js` les superconfig-verdiar og set CSS-variablar.

### Krav for å gjera dette trygt
- Fargekontrast-validator (WCAG AA) mot kvar kombinasjon
- Sanitering: berre `#RRGGBB`-format godkjent (ikkje `javascript:` i color-input)
- Logo-opplasting: berre SVG/PNG, max 200KB, ingen script-innhald i SVG (SVG-sanitering)

### Prioritet
Medium. Kan leverast som eit Console-panel sidan det ikkje er direkte i kundeadmin. Estimat: 2–3 dagar inkl. testing.

---

## 5. Workspace som PWA / Chrome App

### PWA-alternativet (enklast)
Legg til `intranet/manifest.json`:
```json
{
  "name": "Workspace",
  "short_name": "WS",
  "start_url": "/intranet/",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#005cff",
  "icons": [{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" }]
}
```
+ `<link rel="manifest" href="manifest.json">` i `intranet/index.html`
+ Ein Service Worker for offline-caching av shell (app-shell-mønster)

**Fordel:** Brukaren kan "Installer app" i Chrome/Edge. Ingen App Store. Fungerer på mobil og desktop.  
**Ulempe:** Supabase Realtime krev aktiv internettilkopling. Offline-modus viser berre sist casha data.

### Chrome-app-alternativet (utdatert)
Chrome Apps (Manifest V2) er avvikla av Google. Bruk PWA i staden.

### Viktige tekniske avklaringar
- Service Worker må ikkje cache autentiseringstoken
- `start_url` må matchast mot Supabase Auth callback-URL (ellers brakk OTP-retur)
- `display: standalone` endrar ikkje routing — hash-routing (`#/modul`) fungerer som normalt

### Prioritet
Medium-lav. PWA-manifest + Service Worker kan leggjast til som eit separat PR utan å påverka eksisterande kode.

---

## Oppsummering og anbefalt prioritet

| # | Funksjon | Kompleksitet | Prioritet |
|---|----------|-------------|-----------|
| 1 | E-postmalar (nivå 1, in-app kopi) | Lav | Høg |
| 2 | E-postkobling (Edge Function + Resend) | Høg | Medium |
| 3 | Analyse full-breidde + fargefiks | Lav | Høg |
| 4 | Custom design-modul | Medium | Medium |
| 5 | PWA-manifest | Lav | Medium-lav |
| 6 | Service Worker offline | Høg | Lav |
