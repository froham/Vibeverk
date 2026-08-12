# Architecture Documentation

This explains how Vibeverk is actually built today. It must be updated when reality changes — see [`docs/README.md`](../README.md) for how this fits into the overall documentation hierarchy, and [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md) for a concise status summary.

| File | Description |
|---|---|
| [system-overview.md](system-overview.md) | What Vibeverk is, the three delivery surfaces, stack, deployment model and known limitations |
| [module-conventions.md](module-conventions.md) | IIFE module contract: structure, registration, render/mount, storage, cache busting |
| [storage-and-data-flow.md](storage-and-data-flow.md) | localStorage namespace, App.store API, Supabase sync, superconfig, chat data flow |
| [roles-and-tenants.md](roles-and-tenants.md) | Tenant isolation model, user roles, the three admin surfaces and their auth methods |
| [ai-lab.md](ai-lab.md) | Local-only Console AI Lab, source snapshots, provider boundaries and its separation from Læringsmodulen |
| [customer-analysis.md](customer-analysis.md) | Internal Console website analysis: control-plane data, DNS-pinned crawl, robots handling, optional AI and human review |
| [sidetelling.md](sidetelling.md) | Internal pageview/CTA analytics, server-side daily grouping, privacy boundaries, dashboard semantics and rollout gates |
| [page-builder.md](page-builder.md) | Console "Sider" (a.k.a. "Sidebygger" in commit history) — the 9 controlled section types, the `blocks` composable data model, and its security patterns. Not to be confused with the `features.sidebygger` paid site-wide design-template flag (see `system-overview.md`/`CURRENT_STATE.md`) — same name, different feature |
| [copy-style-guide.md](copy-style-guide.md) | How user-facing text (labels, hints, tooltips, confirm dialogs) should read across all three surfaces — plain language, when to use `field({hint,help})` vs `helpIcon()`, the Tier A/B save-and-destructive-action convention |
| [tenant-onboarding-runbook.md](tenant-onboarding-runbook.md) | Step-by-step procedure for onboarding a new customer through Console's real onboarding flow — new Supabase project, migrations, connection, SMTP, schema/routing verification, first-admin invite, activation |
| [customer-delivery-checklist.md](customer-delivery-checklist.md) | Product/content/quality readiness before a customer goes live — branding, module configuration, roles tested, mobile/desktop, customer review. Separate from `docs/compliance/customer-go-live-checklist.md` (GDPR/legal readiness) — both required, neither substitutes for the other |

Together, `storage-and-data-flow.md` and `roles-and-tenants.md` cover what a "data-and-tenancy" document would — storage patterns, Supabase usage and tenant/role handling are already split across these two well-maintained files by topic (storage mechanics vs. roles/tenancy), and merging them into one new file would lose that separation without adding anything. Treat the pair as jointly authoritative for that scope.
