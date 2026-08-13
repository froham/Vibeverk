-- P1-fiks 2026-08-13 (personvern-full-argumentasjon-2026-08-13.md, del 3):
-- retention-sweep (Edge Function i denne prosjektet) måler faktisk
-- kandidatalder frå `created_at` i kundeprosjektet sin `leads`-tabell (som
-- manglar ein updated_at-kolonne) -- "12 md. etter siste aktivitet" var
-- difor eit løfte teksten ikkje kunne innfri teknisk. Retta til "etter
-- opprettelse", som matchar det som faktisk vert handheva. Same retting som
-- console-core.js sin COMPLIANCE_STANDARD_SUGGESTIONS/PRIVACY_FORM_
-- RETENTION_SUGGESTION-konstantar (kun brukt for FRAMTIDIGE Standardforslag-
-- klikk) -- denne migrasjonen rettar den ALT SEEDA, live raden.

update compliance_record
set lagringstid = 'Inntil 12 måneder etter opprettelse, med mindre kundeforhold etableres.'
where id = 'kontakt'
  and lagringstid = 'Inntil 12 måneder etter siste aktivitet, med mindre kundeforhold etableres.';

notify pgrst, 'reload schema';
