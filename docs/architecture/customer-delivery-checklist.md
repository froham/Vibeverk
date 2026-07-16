# Customer Delivery Checklist — Product, Content and Quality

**Scope note**: this checklist covers whether a customer's actual site/Workspace is *finished and working correctly* before go-live — content, branding, module configuration, mobile layout, role behavior. It does **not** cover GDPR/legal readiness (DPA signed, privacy notice published, retention agreed) — that is [`docs/compliance/customer-go-live-checklist.md`](../compliance/customer-go-live-checklist.md), a separate document with a separate purpose. **Both** must be completed before a customer is set active in Console; neither substitutes for the other.

See [`docs/architecture/tenant-onboarding-runbook.md`](tenant-onboarding-runbook.md) for the technical onboarding steps (Supabase project, migrations, SMTP, routing) this checklist assumes are already done — step 8 of that runbook ("set opp kundekonfigurasjon") is where most of this checklist's content actually gets filled in.

## 1. Customer content and branding

- [ ] Company name, tagline, logo, contact info (email/phone/address) are correct — not placeholder/default values from `config.js`.
- [ ] Hero section, "Om oss", services, and any other enabled content sections have real, customer-approved text — not seed content.
- [ ] Colors and fonts match the customer's actual brand (set via Console's "Web"/"Workspace" tabs).
- [ ] All links (social media, external references) actually resolve and go where expected.
- [ ] Uploaded images display correctly, including focus points, on both the front-page card and any detail view that reuses the same image (see `docs/decisions/ADR-0012-single-focus-point-position.md` for why an image can need more than one preview).

## 2. Module configuration

- [ ] Only the modules the customer is actually paying for/using are enabled (`config.js`/`superconfig` features, via Console's "Modular" tab).
- [ ] Each enabled module has been opened and clicked through at least once in this customer's own real configuration — not just verified in general.
- [ ] Booking (if enabled): a real test booking was made and appears correctly in Web-admin.
- [ ] Contact form / Tilbud (if enabled): a real test submission was made and appears correctly, with a working reply path.
- [ ] Chat widget (if enabled): a real test conversation was started and answered from the admin panel.
- [ ] CRM (if enabled): a test customer record was created and edited successfully.

## 3. Roles and access

- [ ] At least one real account of each role the customer will actually use (`admin`, `editor`, `member`) has been tested by actually logging in as that role — not just assumed from `docs/architecture/roles-and-tenants.md`'s general description.
- [ ] The customer's own admin can invite/manage users successfully.
- [ ] The customer sees only their own data — no leftover test/demo data, no cross-tenant leakage (see [`docs/security/incident-and-escalation-guide.md`](../security/incident-and-escalation-guide.md) if anything looks wrong here — this is always an escalate-immediately situation).

## 4. Mobile and desktop

- [ ] Public site checked on a real mobile viewport, not just desktop — hero, navigation, forms, chat widget.
- [ ] Workspace checked on mobile for the roles that will realistically use a phone (often `member`).
- [ ] Web-admin checked on the device sizes the customer's own staff will actually use it on.

## 5. Empty states and error handling

- [ ] Empty states checked (no bookings yet, no announcements yet, no CRM customers yet) — do they look intentional, not broken?
- [ ] Form validation checked — what happens with an empty required field, an invalid email, a too-long message?

## 6. Customer review

- [ ] The customer (or their designated contact) has actually seen and approved the live-looking site/Workspace before go-live — not just been told it's ready.
- [ ] Any customer-requested changes from that review have been made and re-checked.

## 7. Launch / deploy

- [ ] `node test.js` and `node test-workspace.js` are both green (only the two documented, pre-existing known failures, no new ones — see `CLAUDE.md`'s Testing section).
- [ ] Routing verified (Console's onboarding checklist step 9) — the customer's actual hostname resolves correctly.
- [ ] Explicit go-live approval obtained before Console's "Set aktiv" is clicked — this makes the customer's site respond to real visitors immediately, per `CLAUDE.md`'s deployment safeguard.

## 8. Post-launch check

- [ ] Site/Workspace re-checked immediately after go-live, from a real (non-cached) browser session.
- [ ] The customer's own admin has successfully logged in for the first time post-launch.
- [ ] A rollback plan is understood (which Git commit was live before, how to revert) in case something is wrong — see [`docs/security/incident-and-escalation-guide.md`](../security/incident-and-escalation-guide.md).

## 9. Handover to customer

- [ ] The customer has been given (or shown where to find) their own admin credentials, not a shared Vibeverk-internal login.
- [ ] The customer understands what they can safely change themselves vs. what requires contacting Vibeverk — a customer-facing equivalent of [`docs/onboarding/safe-changes-guide.md`](../onboarding/safe-changes-guide.md), scoped to what their own role can actually do.
- [ ] Relevant documentation (this checklist, the compliance checklist) is filed/confirmed complete before considering the delivery finished.

---

Mark clearly which items require technical sign-off (level 3, per [`docs/onboarding/new-team-member-onboarding.md`](../onboarding/new-team-member-onboarding.md#rollenivå-kva-som-er-trygt-for-kven)) before the customer is given access — sections 3, 7, and 8 always do; the rest can be completed by level 1/2 staff with level 3 available to answer questions.
