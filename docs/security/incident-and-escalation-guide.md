# Hendingar og eskalering

> Ein praktisk guide for kva du gjer når noko går gale — feil, tryggleiksbekymringar, eller uklare situasjonar. Sjå [`docs/onboarding/safe-changes-guide.md`](../onboarding/safe-changes-guide.md) for kva som er trygt å gjere i vanleg drift; dette dokumentet gjeld når noko UVENTA har skjedd.
>
> **Merk (ærleg status)**: dette dokumentet var ikkje tidlegare skrive fordi tidlegare hendingar i praksis alle vart handterte direkte, same økt, av den som oppdaga dei — ikkje fordi ei eskaleringsrutine alt fanst og fungerte. Dette er difor ei FYRSTE, føreslegen rutine, ikkje ei stadfesta, testa prosedyre. Juster han etter kva som faktisk fungerer i praksis.

## Skilje mellom typar problem

| Type | Døme |
|---|---|
| Vanleg feil / manglande innhald | Ein tekst manglar, eit bilete vises ikkje |
| Funksjonsfeil | Ein knapp gjer ikkje det han skal |
| Produksjonsfeil | Noko som fungerte i går, fungerer ikkje i dag, for ekte kundar |
| Tilgangsfeil | Nokon ser/kan gjere noko dei ikkje skal (eller motsett — mistar tilgang dei skal ha) |
| **Potensiell tryggleiksfeil** | Data synleg for nokon som ikkje skal sjå det, ei rolle-sperre som ikkje held |
| Feil kundedata | Feil informasjon lagra på feil kunde |
| Mistanke om datalekkasje | Nokon utanfor har fått tilgang til data dei aldri skulle hatt |
| Problem med deploy | Ei utrulling feila, eller såg ut til å lykkast men verkar ikkje rett |
| Problem med tredjepartsteneste | Supabase, Vercel, Resend eller Google Fonts svarer ikkje/feiler |

## Prosedyre

1. **Ikkje gjer fleire endringar før du forstår situasjonen.** Fleire samtidige endringar gjer det vanskelegare å finne rotårsaka.
2. **Noter kva som skjedde**: tidspunkt, kva rolle/brukar var involvert, skjermbilete om relevant.
3. **Vurder omfang**: påverkar dette éin kunde, eller fleire? (Sidan kvar kunde har sin eigen, separate database, skal éin kunde sitt problem normalt ALDRI påverke ein annan — om det likevel ser slik ut, er det sjølv eit alvorleg funn, sjå under.)
4. **Vurder om kundedata, tilgangar eller tryggleik kan vere påverka.** Er du usikker — behandle det som om dei ER det, til det motsette er stadfesta.
5. **Eskaler straks** dersom problemet gjeld tilgang, kundedata, sletting, deploy eller tryggleik — ikkje prøv å fikse dette sjølv utan teknisk ansvarleg involvert.
6. **Finn siste fungerande Git-commit** dersom tilbakeføring kan vere naudsynt (`git log`, sjå kva som endra seg sist før problemet oppstod).
7. **Dokumenter årsak, tiltak og læring etterpå** — legg det inn i `docs/project/CHANGELOG.md` om det er ei reell, fiksa hending (same disiplin som all anna meiningsfull endring, sjå `CLAUDE.md`).

## Kategoriar — kven gjer kva

| Kategori | Kven kan handtere |
|---|---|
| Kan løysast av nivå 1 | Manglande/feil tekst, bilete, kontaktinfo — reint innhald, ingen datarisiko |
| Må vurderast av nivå 2 | Ein modul oppfører seg feil, men verkar avgrensa til éin kunde/éi side |
| **Må eskalerast til teknisk ansvarleg** | Alt som gjeld roller, tilgang, database, deploy, eller uventa åtferd på tvers av kundar |
| **Må stoppast og handterast som kritisk** | Mistanke om datalekkasje, tilgang på tvers av kundar, eller at nokon utanfor har fått tilgang til noko dei ikkje skal |

## Kjende, allereie handterte praktiske fallgruver (verdt å kjenne til)

- **GitHub Pages kan ha forsinka utrulling** — ei endring kan vere pusha, men ikkje synleg live enno. Sjekk `Last-Modified`-headeren på den faktiske sida FØR du konkluderer med at noko er gale. UVERIFISERT nøyaktig kvifor dette skjer i praksis (sjå `docs/project/CURRENT_STATE.md` "Known limitations").
- **Rask tilbakerulling ved DNS-relaterte problem**: repoet sin `CNAME`-fil er bevisst halden urørt, spesifikt for å gjere ein rask GitHub Pages-rollback mogleg om Vercel-oppsettet nokon gong skulle svikte — sjå `docs/decisions/ADR-0007-multi-tenant-hosting-architecture.md`.
- **"Success" i Supabase Dashboard SQL Editor tyder berre at SQL-en ikkje hadde syntaksfeil** — det stadfestar IKKJE at ein spesifikk migrasjon faktisk køyrde eller trefte rett prosjekt. Verifiser alltid med ei konkret, målretta spørring etterpå (`CLAUDE.md` sine Supabase-reglar har fleire konkrete døme på dette).

## Etter hendinga

- Skriv ei kort, ærleg oppsummering: kva skjedde, kvifor, kva vart gjort, kva bør endrast for å hindre at det skjer igjen.
- Vurder om denne guiden sjølv bør oppdaterast med det du lærte — han er eksplisitt meint å vekse etter kvart som ekte hendingar viser kva som faktisk trengst, ikkje ferdig frå dag éin.
