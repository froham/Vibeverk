# Architecture Documentation

This explains how Vibeverk is actually built today. It must be updated when reality changes — see [`docs/README.md`](../README.md) for how this fits into the overall documentation hierarchy, and [`docs/project/CURRENT_STATE.md`](../project/CURRENT_STATE.md) for a concise status summary.

| File | Description |
|---|---|
| [system-overview.md](system-overview.md) | What Vibeverk is, the three delivery surfaces, stack, deployment model and known limitations |
| [module-conventions.md](module-conventions.md) | IIFE module contract: structure, registration, render/mount, storage, cache busting |
| [storage-and-data-flow.md](storage-and-data-flow.md) | localStorage namespace, App.store API, Supabase sync, superconfig, chat data flow |
| [roles-and-tenants.md](roles-and-tenants.md) | Tenant isolation model, user roles, the three admin surfaces and their auth methods |

Together, `storage-and-data-flow.md` and `roles-and-tenants.md` cover what a "data-and-tenancy" document would — storage patterns, Supabase usage and tenant/role handling are already split across these two well-maintained files by topic (storage mechanics vs. roles/tenancy), and merging them into one new file would lose that separation without adding anything. Treat the pair as jointly authoritative for that scope.
