# Trygge endringar — kva kan du gjere sjølv?

> For alle som jobbar med Vibeverk utan å skrive kode sjølv. Sjå [`new-team-member-onboarding.md`](new-team-member-onboarding.md) først om du er ny. Denne guiden seier kva som er trygt å gjere, kva som må testast, kva som treng godkjenning, og kva som ALLTID må eskalerast til teknisk ansvarleg.

## Slik les du tabellen

- **Synleg i grensesnittet** ≠ **teknisk trygt**. Ein knapp kan vere skjult for deg utan at handlinga faktisk er blokkert i databasen om nokon andre finn ein annan veg inn — sjå `docs/architecture/roles-and-tenants.md` for kvar dette gjeld.
- "Kan gjerast av nivå 1/2?" viser til rollenivåa i [`new-team-member-onboarding.md`](new-team-member-onboarding.md#rollenivå-kva-som-er-trygt-for-kven).

## Sjekkliste for vanlege endringstypar

| Type endring | Kan gjerast av nivå 1/2? | Kva må testast? | Må godkjennast av nivå 3? | Risiko | Kva dokument påverkast |
|---|---|---|---|---|---|
| Endre tekst (nettside, admin, Workspace) | Ja | At teksten faktisk viser rett, ingen tomme felt | Nei | Låg | — |
| Endre bilete | Ja | At biletet lastar, fokuspunkt ser rett ut på mobil/desktop | Nei | Låg | — |
| Endre kontaktinformasjon | Ja | At skjema/lenker faktisk peikar rett | Nei | Låg | — |
| Endre fargar/skrifttype innanfor Console sine felt | Ja (nivå 2, via Console om superadmin) | Visuell sjekk på mobil og desktop | Nei | Låg | — |
| Aktivere ein alt-eksisterande modul | Ja (nivå 2, via Console) | At modulen faktisk fungerer for den nye kunden, at ho ikkje forstyrrar andre modular | Ja, om det er ein ny kunde sin fyrste aktivering | Medium | `docs/architecture/customer-delivery-checklist.md` |
| Justere modulinnstillingar (t.d. booking-tider, CRM-felt) | Ja (nivå 2) | At innstillinga faktisk endrar åtferda som venta | Nei, med mindre det gjeld fleire kundar samstundes | Låg–medium | — |
| Opprette/redigere kundedata (leads, CRM, booking) | Ja | Ingen spesiell test utover vanleg bruk | Nei | Låg | — |
| Administrere brukarar (invitere/fjerne) | Berre `admin`-rolle, aldri nivå 1 | At den nye brukaren faktisk kan logge inn med rett rolle | Nei for éin kunde sin eigen `admin`, JA om det er ein Vibeverk-operatør som gjer det via Console | Medium | — |
| **Endre roller eller tilgangar** | **ALDRI nivå 1/2 sjølv** | Full re-testing av alle rolle-avhengige flytar | **JA, alltid** | **Høg** | `docs/architecture/roles-and-tenants.md` |
| **Endre modul-logikk (kode)** | **ALDRI utan kode-kunnskap** | `node test.js`/`node test-workspace.js`/`node test-api.js` + manuell test | **JA, alltid** | **Høg** | `docs/project/CHANGELOG.md`, evt. modul-dokumentasjon |
| **Endre database eller lagringsstruktur** | **ALDRI** | Direkte mot `vibeverk-staging` FØR produksjon | **JA, alltid** | **Kritisk** | `docs/architecture/storage-and-data-flow.md` |
| **Endre Supabase-policyar/RLS** | **ALDRI** | Direkte SQL-verifisering (`pg_policies`), ALDRI berre stole på ei "Success"-melding | **JA, alltid** | **Kritisk** | `docs/security/security-baseline.md` |
| **Endre miljøvariablar** | **ALDRI** | Stadfest verdien faktisk landa rett (t.d. via ein test-kalling) | **JA, alltid** | **Høg** | — |
| **Deploy til produksjon** | **ALDRI** | Testpakkane må vere grøne FØRST | **JA, alltid — ingen unntak** (`CLAUDE.md` sin deployment-safeguard) | **Høg** | — |
| **Slette kundedata** | **ALDRI utan eksplisitt kunde-/eigar-godkjenning** | Stadfest kva som faktisk blir sletta, om det er reversibelt | **JA, alltid** | **Kritisk** | — |
| **Leggje til tredjepartsintegrasjon** | **ALDRI** | Personvern-/tryggleiksgjennomgang FØR bygging | **JA, alltid** | **Høg** | `docs/compliance/` |

## Alltid eskaler desse, uansett rolle

- Roller og tilgangsstyring
- Kundedata på tvers av kundar (om nokon ser noko dei ikkje skal)
- Sletting av data
- Database eller Supabase-endringar
- Filopplasting og vedlegg som oppfører seg uventa
- API-nøklar og integrasjonar
- Alt som verkar som ein tryggleiksfeil — **ikkje vent, ikkje prøv å fikse det sjølv først**, sjå [`docs/security/incident-and-escalation-guide.md`](../security/incident-and-escalation-guide.md)

## Tre spørsmål å stille deg sjølv før du gjer noko

1. **Er dette synleg berre i grensesnittet, eller er det noko som faktisk endrar data/tilgang for andre?** Er du usikker — spør, ikkje anta.
2. **Kan eg forklare kva som skjer om dette går gale?** Om svaret er nei, er det truleg ikkje ei trygg endring å gjere åleine.
3. **Påverkar dette meir enn éin kunde?** Alt som gjeld delt kode (ikkje berre éin kunde sin konfigurasjon) skal alltid gjennom nivå 3.
