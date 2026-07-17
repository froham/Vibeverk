# Kundeleveranse-sjekkliste — produkt, innhald og kvalitet

**Om denne sjekklista**: ho dekkjer om ein kunde sitt faktiske nettstad/Workspace er *ferdig og fungerer korrekt* før lansering — innhald, merkevare, modulkonfigurasjon, mobillayout, rolleåtferd. Ho dekkjer **ikkje** GDPR/juridisk beredskap (DPA signert, personvernerklæring publisert, lagringstid avtalt) — det er [`docs/compliance/customer-go-live-checklist.md`](../compliance/customer-go-live-checklist.md), eit eige dokument med eit eige formål. **Begge** må vere fullførte før ein kunde vert sett aktiv i Console; ingen av dei erstattar den andre.

Sjå [`docs/architecture/tenant-onboarding-runbook.md`](tenant-onboarding-runbook.md) for dei tekniske onboarding-stega (Supabase-prosjekt, migreringar, SMTP, ruting) denne sjekklista føreset alt er gjort — steg 8 i den runboken ("set opp kundekonfigurasjon") er der mesteparten av innhaldet i denne sjekklista faktisk vert fylt ut.

## 1. Kundeinnhald og merkevare

- [ ] Firmanamn, tagline, logo, kontaktinfo (e-post/telefon/adresse) er korrekte — ikkje plasshaldar-/standardverdiar frå `config.js`.
- [ ] Hero-seksjon, "Om oss", tenester, og andre aktiverte innhaldsseksjonar har ekte, kunde-godkjent tekst — ikkje seed-innhald.
- [ ] Fargar og fontar matchar kunden sin faktiske merkevare (sett via Console sine "Web"/"Workspace"-faner).
- [ ] Alle lenker (sosiale medium, eksterne referansar) løyser faktisk opp og går dit dei skal.
- [ ] Opplasta bilete vises korrekt, inkludert fokuspunkt, både på framsidekortet og i eventuell detaljvisning som gjenbrukar same bilete (sjå `docs/decisions/ADR-0012-single-focus-point-position.md` for kvifor eit bilete kan trenge meir enn éin førehandsvisning).

## 2. Modulkonfigurasjon

- [ ] Berre modulane kunden faktisk betalar for/brukar er aktiverte (`config.js`/`superconfig`-funksjonar, via Console sin "Modular"-fane).
- [ ] Kvar aktiverte modul er opna og klikka gjennom minst éin gong i denne kunden sin eigen, faktiske konfigurasjon — ikkje berre stadfesta generelt.
- [ ] Booking (om aktivert): ei ekte testbooking vart gjort og vises korrekt i Web-admin.
- [ ] Kontaktskjema / Tilbod (om aktivert): ei ekte testinnsending vart gjort og vises korrekt, med ein fungerande svarveg.
- [ ] Chat-widget (om aktivert): ein ekte testsamtale vart starta og svart på frå admin-panelet.
- [ ] CRM (om aktivert): ein testkunde vart oppretta og redigert utan feil.

## 3. Roller og tilgang

- [ ] Minst éin ekte konto for kvar rolle kunden faktisk skal bruke (`admin`, `editor`, `member`) er testa ved faktisk å logge inn som den rolla — ikkje berre anteke ut frå `docs/architecture/roles-and-tenants.md` si generelle skildring.
- [ ] Kunden sin eigen admin kan invitere/administrere brukarar utan feil.
- [ ] Kunden ser berre sine eigne data — ingen attverande test-/demo-data, ingen kryss-tenant-lekkasje (sjå [`docs/security/incident-and-escalation-guide.md`](../security/incident-and-escalation-guide.md) om noko ser feil ut her — dette skal ALLTID eskalerast umiddelbart).

## 4. Mobil og desktop

- [ ] Det offentlege nettstaden er sjekka på ein ekte mobilviewport, ikkje berre desktop — hero, navigasjon, skjema, chat-widget.
- [ ] Workspace er sjekka på mobil for dei rollene som realistisk vil bruke ein telefon (ofte `member`).
- [ ] Web-admin er sjekka på dei skjermstorleikane kunden sine eigne tilsette faktisk vil bruke det på.

## 5. Tomme tilstandar og feilhandtering

- [ ] Tomme tilstandar er sjekka (ingen bookingar enno, ingen kunngjeringar enno, ingen CRM-kundar enno) — ser dei tilsikta ut, ikkje øydelagde?
- [ ] Skjemavalidering er sjekka — kva skjer med eit tomt påkravd felt, ein ugyldig e-post, ei for lang melding?

## 6. Kundegjennomgang

- [ ] Kunden (eller deira utpeikte kontakt) har faktisk sett og godkjent det live-liknande nettstaden/Workspace før lansering — ikkje berre fått beskjed om at det er klart.
- [ ] Eventuelle kunde-etterspurde endringar frå den gjennomgangen er gjort og re-sjekka.

## 7. Lansering / publisering

- [ ] `node test.js` og `node test-workspace.js` er begge grøne (berre dei to dokumenterte, kjende feila, ingen nye — sjå `CLAUDE.md` sin Testing-seksjon).
- [ ] Ruting er stadfesta (Console sin onboarding-sjekkliste steg 9) — kunden sitt faktiske vertsnamn løyser opp korrekt.
- [ ] Eksplisitt lanseringsgodkjenning er innhenta før Console sin «Set aktiv» vert trykt — dette gjer at kunden sin nettstad svarar på ekte besøkjande umiddelbart, per `CLAUDE.md` sin deployment-safeguard.

## 8. Sjekk etter lansering

- [ ] Nettstad/Workspace er re-sjekka umiddelbart etter lansering, frå ei ekte (ikkje-mellomlagra) nettlesarøkt.
- [ ] Kunden sin eigen admin har logga inn for fyrste gong etter lansering utan feil.
- [ ] Ein rollback-plan er forstått (kva Git-commit var live før, korleis reversere) i tilfelle noko er gale — sjå [`docs/security/incident-and-escalation-guide.md`](../security/incident-and-escalation-guide.md).

## 9. Overlevering til kunde

- [ ] Kunden har fått (eller fått vist kvar dei finn) sine eigne admin-påloggingsopplysningar, ikkje ei delt Vibeverk-intern innlogging.
- [ ] Kunden forstår kva dei trygt kan endre sjølv vs. kva som krev å kontakte Vibeverk — ein kundevend variant av [`docs/onboarding/safe-changes-guide.md`](../onboarding/safe-changes-guide.md), avgrensa til kva deira eiga rolle faktisk kan gjere.
- [ ] Relevant dokumentasjon (denne sjekklista, compliance-sjekklista) er arkivert/stadfesta fullført før leveransen vert rekna som ferdig.

---

Marker tydeleg kva punkt som krev teknisk godkjenning (nivå 3, per [`docs/onboarding/new-team-member-onboarding.md`](../onboarding/new-team-member-onboarding.md#rollenivå-kva-som-er-trygt-for-kven)) før kunden får tilgang — punkt 3, 7 og 8 gjer det alltid; resten kan fullførast av nivå 1/2-tilsette med nivå 3 tilgjengeleg for å svare på spørsmål.
