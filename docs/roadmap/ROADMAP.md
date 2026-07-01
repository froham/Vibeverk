# Vibeverk — Roadmap

Roadmap content is planning material. It is not proof of current functionality, architecture, security posture or customer commitments. For verified current state, see [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md). For historical detail behind completed and paused work, see [`docs/archive/roadmap-2026-07-01.md`](../archive/roadmap-2026-07-01.md).

Sist oppdatert: 2026-07-01.

## Current focus

Ingen steg er aktivt under arbeid akkurat no. Steg 6f (motta e-post/inbound) vart designa ferdig 2026-07-01 og er umiddelbart etterpå sett på vent av brukar: *"Vi avventer litt, det blir veldig edgy-CRM-messig."*

## Next

- **Steg 6f — Motta e-post (inbound), viss/når det vert teke opp att.** Design er ferdig (Message-ID-tråding via Resend, automatisk ny Kontakt-lead + CRM-kunde ved manglande treff). Éin uløyst byggbarheitsdetalj før koding: overgang frå blob-basert til normalisert lagring for inbound-skrivne rader. Må gjennom Security Auditor + Privacy Advisor før bygging.
- **Steg 7 — Kundedokumentasjon / Kontrakt / DPA.** Standardkontrakt, databehandlaravtale (DPA), informasjon om localStorage-avgrensingar i demo-fase, brukarrettleiing for admin-panel og arbeidsområde.

## Later

- **Steg 8 — Intern teknisk dokumentasjon.** Store delar av dette vart dekt av dokumentasjonsstyrings-arbeidet 2026-07-01 (denne `docs/`-strukturen, ADR-ar, agent-team). Attståande: onboarding-guide for nye Vibeverk-kundar (kva `config.js`-verdiar som skal endrast per kunde), Supabase-migreringsdokument per modul.
- **Steg 9 — Kvalitetssjekkar.** Full gjennomgang av alle modular, cross-device testing (desktop/mobil/nettbrett), tilgjengelegheit (WCAG), ytingstest (Lighthouse), sikkerheitsgjennomgang.
- **Steg 6d — Realtime.** Bytte polling i Chat med Supabase Realtime; oppdatere Dashboard med live-teljing.

## Ideas / Parking lot

- **Steg 10 — AI-native Chat.** Ein AI-assistent bygd inn i den native chat-løysinga (RAG via pgvector, KB/FAQ/CRM/Booking-kontekst, hybrid AI/operatør-modus). Eksplisitt spekulativ forretningsmodell-utforsking (Basis/Pro/Premium-tier), ikkje eit forplikta steg. Føresetnad: Supabase (steg 6) er på plass, som no er tilfellet.
- Custom design-modul (visuell tema-editor for kunde-sjølvbetjening) — nemnd i tidlegare arkitektnotat, ikkje prioritert.
- PWA-manifest / Service Worker for Workspace — nemnd i tidlegare arkitektnotat, låg prioritet.
