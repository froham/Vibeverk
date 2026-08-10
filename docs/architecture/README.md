# Architecture Documentation

This explains how Vibeverk is actually built today. It must be updated when reality changes — see [`docs/README.md`](../README.md) for how this fits into the overall documentation hierarchy, and [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md) for a concise status summary.

| File | Description |
|---|---|
| [system-overview.md](system-overview.md) | What Vibeverk is, the three delivery surfaces, stack, deployment model and known limitations |
| [module-conventions.md](module-conventions.md) | IIFE module contract: structure, registration, render/mount, storage, cache busting |
| [storage-and-data-flow.md](storage-and-data-flow.md) | localStorage namespace, App.store API, Supabase sync, superconfig, chat data flow |
| [roles-and-tenants.md](roles-and-tenants.md) | Tenant isolation model, user roles, the three admin surfaces and their auth methods |
| [ai-lab.md](ai-lab.md) | Local-only Console AI Lab, source snapshots, provider boundaries and its separation from Læringsmodulen |
| [sidetelling.md](sidetelling.md) | Internal pageview/CTA analytics, server-side daily grouping, privacy boundaries, dashboard semantics and rollout gates |
| [copy-style-guide.md](copy-style-guide.md) | How user-facing text (labels, hints, tooltips, confirm dialogs) should read across all three surfaces — plain language, when to use `field({hint,help})` vs `helpIcon()`, the Tier A/B save-and-destructive-action convention |
| [tenant-onboarding-runbook.md](tenant-onboarding-runbook.md) | Step-by-step procedure for onboarding a new customer through Console's real onboarding flow — new Supabase project, migrations, connection, SMTP, schema/routing verification, first-admin invite, activation |
| [customer-delivery-checklist.md](customer-delivery-checklist.md) | Product/content/quality readiness before a customer goes live — branding, module configuration, roles tested, mobile/desktop, customer review. Separate from `docs/compliance/customer-go-live-checklist.md` (GDPR/legal readiness) — both required, neither substitutes for the other |

Together, `storage-and-data-flow.md` and `roles-and-tenants.md` cover what a "data-and-tenancy" document would — storage patterns, Supabase usage and tenant/role handling are already split across these two well-maintained files by topic (storage mechanics vs. roles/tenancy), and merging them into one new file would lose that separation without adding anything. Treat the pair as jointly authoritative for that scope.
