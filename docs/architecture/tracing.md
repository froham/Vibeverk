# Request-tracing (W3C Trace Context)

## Hva dette er

Hver request/sideinnlasting får én `traceparent`-header (standard W3C Trace
Context-format: `00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`),
generert i `middleware.js` (server-side) eller `core.js` (klient-side), og
sendt videre gjennom hele kjeden:

```
middleware.js (genererer/gjenbruker traceparent)
  → api/*.js (les/forward, evt. eigen fallback-generering)
  → fetch()-kall til Supabase PostgREST/RPC (control plane og tenant-prosjekt)

core.js (genererer traceparent ved sideinnlasting)
  → supabase-js-klienten (App.supabase), via global.headers.traceparent
  → console/console-core.js sine to createClient()-kall gjenbruker App.traceId
  → workspace/workspace-core.js gjenbruker App.supabase direkte (same klient)
```

## Hvorfor

Supabase støtter nå W3C Trace Context native i sine egne request-logger.
Ved å sende `traceparent` konsekvent kan en enkelt sideinnlasting/feil
korreleres på tvers av Vercel sine funksjonslogger og Supabase sine egne
logger, uten å bygge noen egen logg-aggregering eller dashboard — Supabase sin
egen loggvisning blir join-bar av seg selv.

## Hva det IKKE er

- Ingen persistens noe sted (ikke cookie, ikke localStorage, ikke lagret i
  noen tabell) — ren in-flight header-plumbing, forkastet så snart requesten
  er ferdig behandlet. Utløser derfor ikke cookie-samtykke (ePrivacy gjelder
  lagring/tilgang på enheten, ikke HTTP-headere) og legger ikke til noen ny
  personopplysning (IDen er en tilfeldig streng, ikke avledet fra IP/e-post).
- Ikke per-spørring-oppløsning — én id per sideinnlasting/request, ikke per
  enkelt Supabase-kall inni samme side.
- Ingen ny logg-viewer, ingen Sentry/OpenTelemetry-integrasjon.
- `supabase/functions/*` (Edge Functions) og `supabase-control/`s `broker`
  Edge Function er IKKE instrumentert ennå (kun kallsiden i
  `console-core.js` sender headeren — broker-funksjonen selv leser/forwarder
  den ikke). Revisit ved konkret behov.

## Kildefiler

- `api/_lib/trace.js` — `generateTraceparent()` / `getOrCreateTraceparent(request)`,
  brukt av `middleware.js` og `api/*.js`.
- `core.js` — egen klient-side `_generateTraceparent()` (samme format), siden
  `/config.js` lastes via `<script>`-tag og responsheadere derfor ikke er
  lesbare fra JS. Eksponert som `App.traceId`.
