# Sunnvask (showcase-tenant) — kva er likt, kva er ulikt/ope

> Følgjer opp `data-map-vibeverk.md`. Skriv IKKJE eit fullt separat datakart her — det ville berre duplisert `data-map-template.md` sin generelle struktur, sidan Sunnvask køyrer NØYAKTIG same kodebase/skjema. Dette dokumentet listar berre det som er ulikt eller genuint ope for denne konkrete tenanten, verifisert mot `docs/architecture/tenant-onboarding-runbook.md` og `docs/project/CHANGELOG.md` (0.34.1–0.34.7).

## Kva er likt

Sunnvask er onboarda gjennom det same Console-flyten (`tenant-onboarding-runbook.md`), på **nøyaktig same applikasjonskode og databaseskjema** som Vibeverk-tenanten — same tabellar (`chat_conversations`, `crm_customers`, `leads`, `bookings`, `users`, osv.), same RLS-policyar, same anon-tilgangsmodell (skriv-berre via RPC, ingen direkte `SELECT`), same `middleware.js`/edge-rutingsmekanisme. Alt i `data-map-vibeverk.md` sine seksjonar 3 ("Datakategoriar per funksjon"), 5 ("edge-/ruting-mekanismen") og 6 ("Tilgangsoppsummering") gjeld difor identisk for Sunnvask, med eitt unntak: **kva funksjonar som faktisk er PÅSLÅTT** kan vere ulikt (sjå under).

## Kva er ulikt eller genuint ope

- **Eige, dedikert Supabase-prosjekt** — ikkje delt med `vibeverk-staging` eller Vibeverk-tenanten sitt prosjekt (eksplisitt runbook-krav: "A demo/showcase tenant ... should get its own dedicated Supabase project"). Prosjekt-ref/region for dette prosjektet er **[ÅPENT — ikkje lese av dette passet]**.
- **"Ikkje enno fullt branda/aktivert"** (per oppgåveramma til dette passet) — det er difor **ope** om tenanten sin status i `vibeverk-control` sitt `tenants`-register er `'provisioning'` eller `'active'` i dag, og om steg 10/11 i runbooken (invitere admin, "Set aktiv") faktisk er fullført. Dette avgjer om `sunnvask.vibeverk.no` i praksis svarer for verkelege besøkjande no, eller berre er tilgjengeleg via den mellombelse `SITE_LOCK_PASSWORD`-sperra.
- **Kva funksjonar er PÅSLÅTT** for Sunnvask (chat, CRM, booking, tilbod, analyse) er ikkje stadfesta av dette passet — det krev å lese Sunnvask sin eigen `enabled_modules`/superconfig via Console, ikkje repoets `config.js` (som berre representerer Vibeverk-tenanten/lokal dev, sjå `data-map-vibeverk.md` punkt 3a).
- **Om det finst reelle/verkelege personopplysningar i Sunnvask sitt prosjekt enno** er **[ÅPENT]** — sidan dette er ein showcase/demo-installasjon kan det finnast testdata (testsamtalar, testleads) som IKKJE representerer verkelege sluttbrukarar, men dette er ikkje stadfesta av eit kode-lesande pass og bør sjekkast direkte (`customer-go-live-checklist.md` sitt punkt om "Test accounts, demo data ... removed before go-live" gjeld difor direkte her, FØR Sunnvask nokon gong blir peika til å sjå ut som eit ekte, produksjonsklart kundeeksempel for potensielle kundar).
- **Retningslinje, ikkje eit funn**: sidan Sunnvask er eit internt showcase-eksempel (ikkje ein betalande kunde), er det sannsynleg at det ikkje finst ei ekte DPA-relasjon i det heile for denne tenanten (det er ingen ekstern "kunde" å inngå avtale med) — men dette bør stadfestast eksplisitt, ikkje anteke, særleg dersom Sunnvask nokon gong viser fram ekte tredjepartsbesøkjande sine data (t.d. om nokon utanfor Vibeverk prøver chatten på `sunnvask.vibeverk.no` og trur dei snakkar med eit ekte firma).

## Anbefalt handling før Sunnvask blir vist fram eksternt (t.d. i sal/marknadsføring)

- Stadfest og fjern eventuell testdata frå Sunnvask sitt Supabase-prosjekt (leads, chat-samtalar, CRM-oppføringar) FØR nokon utanfor Vibeverk får sjå/bruke sida, jf. `customer-go-live-checklist.md`.
- Vurder om ei tydeleg "dette er eit demo/showcase-eksempel, ikkje eit ekte firma" bør synast for ein besøkjande som eventuelt startar ein ekte chat-samtale eller sender eit ekte kontaktskjema mot Sunnvask, sidan dei elles trur dei kommuniserer med ei verkeleg bedrift.
- Bestem om Sunnvask i det heile treng ei eiga, minimal personvernerklæring (sjølv som demo), gitt at plattforma teknisk sett samlar inn og lagrar akkurat dei same datatypane som for ein ekte kunde dersom nokon faktisk brukar chat/kontaktskjema-funksjonane der.

---

*Utarbeidd av Privacy and Compliance Advisor (Claude), 2026-07-16. Ikkje juridisk godkjenning.*
