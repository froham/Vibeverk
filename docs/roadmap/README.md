# Roadmap

> **IMPORTANT:** This is planning material. It must never be treated as proof of current functionality, technical architecture, or product commitments. Completed items reflect what was planned to be done; verify current behavior by reading the code. Items marked as future plans are not committed timelines.

The source of truth for the roadmap is [VIBEVERK-ROADMAP.MD](../../VIBEVERK-ROADMAP.MD) in the repository root.

---

## Current focus

Based on VIBEVERK-ROADMAP.MD and active development context:

- **Steg 5b — module-users.js invite flow:** User administration UI for the owner role, including employee invitation via Supabase Edge Function. This is the next immediate development item.
- **Dark mode in workspace settings:** Planned UI addition to `intranet/module-settings.js`.
- **Cleaning up `#admin` superadmin duplication:** Some console-level features have been duplicated in the web admin panel; these are being consolidated.

---

## Next

From the roadmap:

- **Supabase Realtime for chat (Steg 6d):** Replace the current polling-based chat update mechanism with Supabase Realtime subscriptions. This will make the chat admin panel update in real time without polling intervals.
- **Web admin → Supabase Auth:** Migrate the web admin from a static shared password to individual Supabase Auth accounts. This is listed as a future step and is not scheduled.

---

## Later

From the roadmap:

- **AI-native chat (Steg 10):** Supabase Edge Function + Claude API integration for automated chat responses. Requires pgvector for RAG (Retrieval-Augmented Generation) against the knowledge base and FAQ. Estimated 3–5 days of work after Supabase Realtime is in place.
- **Full i18n (t() function):** Internationalisation infrastructure for English support. Estimated 1–2 days. Deferred until the codebase is stable on Supabase.
- **WCAG/accessibility audit (Steg 9):** Full accessibility review across all modules.
- **Lighthouse performance audit (Steg 9):** Performance testing and optimisation.
- **Customer documentation and DPA (Steg 7):** Standard contract templates and data processor agreement for Vibeverk customers.

---

## Ideas / Parking lot

From the roadmap:

- **Role expansion:** Full editor / Web editor / Workspace editor role variants with more granular permission boundaries.
- **User invitation OTP flow from workspace:** Allow workspace owners to invite users directly from the intranet, with OTP-based onboarding.
- **pgvector embeddings for KB search:** Semantic search over knowledge base articles using Supabase's built-in pgvector support.
- **Hybrid AI/human chat:** AI responds first, human admin can take over. Marked in roadmap as planned after Steg 10.

---

All items in Next, Later and Ideas are plans only — not committed timelines.
