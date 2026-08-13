-- P0-fiks 2026-08-13 (personvern-full-argumentasjon-2026-08-13.md del 1.3):
-- "tba"-modellen frå 2026-08-12 ("Vibeverk AS ikkje stifta, difor ingen
-- signert DPA") var FEIL for tre av fire leverandørar -- stadfesta ved å
-- hente kvar leverandør sin eigen, publiserte DPA-side direkte 2026-08-13.
-- Supabase/Resend/Plausible sine DPA-ar trer i kraft AUTOMATISK ved bruk av
-- tenesta, heilt uavhengig av om Vibeverk AS er stifta som eige rettssubjekt
-- (supabase.com/legal/dpa, resend.com/legal/dpa, plausible.io/dpa, alle
-- stadfesta "no separate signing/signature required"). Vercel er derimot
-- eit REELT gap, av ein heilt annan grunn: vercel.com/legal/dpa gjeld
-- stadfesta KUN Enterprise/Pro-plan, og Vibeverk sin konto er stadfesta
-- Hobby (data-map-vibeverk.md, 2026-07-16) -- ny status "blocked" for
-- nettopp dette tilfellet.
--
-- Sjå tilsvarande retting i console/console-core.js sin VIBEVERK_VENDORS-
-- konstant (JS-bootstrap-fallback) -- denne migrasjonen rettar den FAKTISKE
-- kjelda (vendor_registry), sidan Bolk 5 (0.139.0) gjorde databasen til den
-- levande kjelda for den kundevendte teksten, ikkje JS-konstanten.

alter table vendor_registry drop constraint vendor_registry_dpa_status_check;
alter table vendor_registry add constraint vendor_registry_dpa_status_check
  check (dpa_status in ('confirmed','likely_confirmed','unconfirmed','tba','blocked'));

update vendor_registry set
  dpa_status = 'confirmed',
  dpa_note = 'DPA trer i kraft automatisk ved aksept av Supabase sine Vilkår for tenesta (supabase.com/legal/dpa, stadfesta 2026-08-13), uavhengig av om Vibeverk AS er stifta.'
where id = 'supabase';

update vendor_registry set
  dpa_status = 'blocked',
  dpa_note = 'Vercel sin DPA gjeld stadfesta KUN Pro/Enterprise-plan (vercel.com/legal/dpa, stadfesta 2026-08-13) -- Vibeverk sin konto er på Hobby-planen, difor INGEN DPA i kraft i dag, uavhengig av selskapsform. Krev planoppgradering (forretningsavgjerd) for å løysast.'
where id = 'vercel';

update vendor_registry set
  dpa_status = 'confirmed',
  dpa_note = 'DPA trer i kraft automatisk ved aksept av Resend sine Vilkår for tenesta (resend.com/legal/dpa, stadfesta 2026-08-13). Konkret overføringsmekanisme (SCC/DPF) ikkje sjølvstendig verifisert utover at DPA-en finst.'
where id = 'resend';

update vendor_registry set
  dpa_status = 'confirmed',
  dpa_note = 'DPA trer i kraft automatisk ved bruk av tenesta, gjeld alle kundar (plausible.io/dpa, stadfesta 2026-08-13).'
where id = 'plausible';

notify pgrst, 'reload schema';
