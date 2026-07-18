# Customer Go-Live Compliance Checklist

> **Starting point only.** This checklist does not constitute legal compliance. Every item must be verified for the specific customer deployment and jurisdiction. Qualified legal review is required before any customer goes live.

Mark each item as required (R) or recommended (Anbefalt/A) based on the column. Complete all required items before go-live.

---

## Data processor agreement

- [ ] **(R) Data processor agreement (DPA) between Vibeverk (processor) and the customer (controller) has been drafted, reviewed and signed by both parties.**
  - A DPA is required under GDPR Article 28 whenever a processor handles personal data on behalf of a controller.
  - The DPA must specify: subject matter, duration, nature and purpose of processing, type of personal data, categories of data subjects, obligations and rights of the controller.

---

## Privacy documentation for website visitors

- [ ] **(R) A privacy notice (personvernerklæring) is published on the customer's website.**
  - Must cover: who is the controller, what data is collected (including chat visitor metadata), legal basis for each processing activity, data subject rights, contact information, and information about third parties.
  - If Tidio or Plausible is enabled, these must be included.

- [ ] **(R) If Tidio is enabled: a cookie notice and/or consent mechanism is in place.**
  - Tidio may set cookies. Norwegian/EEA rules (ePrivacy Directive) require consent for non-essential cookies. Verify Tidio's cookie behaviour and obtain legal guidance on consent requirements.
  - **Note (2026-07-16 Privacy Advisor pass):** no Tidio integration exists in the codebase today (verified by full-repo search) — this item only applies if Tidio has actually been built in for this customer. Don't check this box based on this template alone.

- [ ] **(R) If Plausible is enabled: assess whether cookie notice or consent is required.**
  - Plausible is designed to be cookieless. However, verify that no cookies are set and confirm with legal whether the analytics method requires notice or consent under Norwegian rules.

---

## Data storage and infrastructure

- [ ] **(R) Customer has been informed that data is stored in Supabase, including the data region (country/region) of their Supabase project.**
  - If the project is hosted outside the EEA, this constitutes an international transfer and appropriate safeguards (e.g., Standard Contractual Clauses) must be in place.
  - Check the Supabase project region in Supabase Dashboard → Project Settings → Infrastructure.

- [ ] **(R) DPA with Supabase Inc. is in place or the customer is relying on Supabase's standard data processing terms.**
  - Confirm whether Supabase's published DPA terms are adequate or whether a custom DPA is needed.

---

## Retention and deletion

- [ ] **(R) Retention periods for each data category have been agreed with the customer and documented.**
  - Covers: chat messages, CRM records, user accounts, notes, tasks, announcements, KB articles, inbound email metadata (see "Inbound email" section below — has its own, distinct retention question).
  - Note: automated deletion is not currently implemented in the platform — manual processes must be defined.

- [ ] **(R) The customer understands how to delete data (user accounts, chat records, CRM entries) and has a process for handling data subject access and deletion requests.**
  - **Updated 2026-07-18**: the "Slett alle data for en person (GDPR §17)" tool (Web-admin → Henvendelser) is now the single, complete deletion path — it matches on both a person's primary and alternate email addresses, frees any uploaded document attachments from Storage, and removes their `inbound_emails` rows, not just leads/bookings/CRM records. Confirm this is the tool staff are trained to use for any deletion request.

---

## Inbound email (if `features.crm.crmFull` / inbound email is enabled)

- [ ] **(R) Customer understands that inbound email automatically creates a CRM profile from an unrecognized sender.**
  - When someone emails the customer's dedicated inbound address and there's no existing CRM match, a new, unverified CRM customer profile is created automatically — without any human review, and without the sender ever having interacted with the site directly.
  - **Open legal question, not resolvable by this checklist**: whether "legitimate interest" is a sufficient legal basis for this automatic profile creation from a wholly unknown/unverified sender. See `docs/compliance/draft-inbound-email-legal-basis-memo.md` for the full analysis — this must be resolved with qualified legal counsel before a real `crmFull` customer relies on this feature in production, not deferred indefinitely.
  - Technical mitigations already built: these profiles are visibly flagged "not verified" in the CRM UI until a real human interaction occurs (a phone note, a filled-in note/phone field, or an explicit "Verifiser"-click), and a bulk-identify/bulk-delete action exists specifically for cleaning up unverified profiles that turn out to be spam or misdirected mail.
- [ ] **(R) Customer has agreed a retention policy for `inbound_emails` rows, distinct from CRM record retention.**
  - This table logs metadata (sender address/name, subject, message threading headers, SPF/DKIM/DMARC results) for essentially every email that reaches the inbound address — including rejected/spoofed mail and mail from senders who never become a real customer. This is closer to a security log purpose than a customer-relationship purpose, and may warrant a shorter, separate retention period. No email body text is stored in this table itself (only in the CRM communication record, for successfully matched/created profiles).
- [ ] **(A) Resend's own privacy policy / DPA has been checked for inbound email specifically**, not just outbound sending — inbound processing means Resend now handles content from third parties who never had any prior relationship with the customer, a materially different category of data subject than outbound recipients. See the updated `docs/compliance/draft-privacy-policy-thirdparty-section.md`.

---

## CRM document attachments (private Storage bucket, built 2026-07-18)

- [ ] **(R) Customer understands who can view uploaded CRM documents.**
  - Any authenticated Workspace user (admin, editor, **and member**) can open a document once it's attached to a customer record — this was a deliberate, confirmed product decision (member should be able to view documents even though only admin/editor can upload or delete them), not an oversight. If the customer expects document access to be admin/editor-only, this must be flagged before go-live.
- [ ] **(A) Customer is aware that documents uploaded before 2026-07-18 (if any) remain in the older, public Storage bucket** with permanently-valid public URLs, rather than the newer private bucket with short-lived signed URLs — these were deliberately not migrated. Not relevant for a brand-new customer with no pre-existing documents.

---

## Employee and user data

- [ ] **(R) Customer has been informed that employee data (name, email, role, activity records) is stored in Supabase.**
  - Employees (workspace users) have rights as data subjects under GDPR. The customer must have a legal basis for processing employee data in this system.
  - The customer's internal HR policy or employment agreements should reference use of this system.

---

## Chat visitor data

- [ ] **(R) Customer has been informed that chat collects visitor metadata including: visitor name and email (if provided), browser type, OS, screen resolution, page URL and referrer URL at time of chat.**
  - This must be reflected in the privacy notice.

- [ ] **(A) Customer has considered whether to display a data collection notice in the chat widget before visitors submit personal information.**

---

## Third-party integrations

- [ ] **(R) All enabled third-party integrations (Resend, Plausible, Google Fonts) are listed in the privacy notice.**
  - Google Fonts sends font requests to Google's CDN and may log visitor IP addresses. This may require disclosure even if Fonts is not considered a "tracking" service.
  - **Updated 2026-07-18**: "Tidio" removed from this list — no Tidio integration exists in the codebase (confirmed by the 2026-07-16 Privacy Advisor pass, see the note under "Privacy documentation for website visitors" above). **Resend added** — it was previously missing from this list despite being a real, always-active third party for outbound email, and now also inbound email if that feature is enabled.

- [ ] **(A) Customer has reviewed what data each third-party integration receives and confirmed this is acceptable for their use case.**

---

## Technical readiness

- [ ] **(R) Test accounts, demo data, and seed data have been removed from the Supabase database before go-live.**
  - Check: users table (no Vibeverk test accounts), chat_conversations (no test conversations), store table (no test config values that should not be in production).

- [ ] **(R) Supabase project access is limited to necessary personnel.**
  - Remove any Vibeverk developer accounts that are not needed for ongoing support.
  - The customer owner should be the primary owner of the Supabase project.

- [ ] **(A) Feature flags in config.js (and superconfig) are configured to enable only the features the customer will actually use.**
  - Disabling unused modules reduces the data collection surface and simplifies the privacy notice.

---

## Customer awareness

- [ ] **(A) Customer has been informed about localStorage usage in the browser.**
  - The platform stores a visitor_id and other working data in the visitor's browser localStorage. This is disclosed in the privacy notice.
  - localStorage does not require consent in the same way as cookies, but disclosure is good practice.

- [ ] **(A) Customer has been briefed on the web admin password model.**
  - The web admin password (/#admin) is a shared static password, not individual accounts. The customer should understand the security implications and manage the password accordingly.

---

## Verification

> This checklist was completed by: [NAME] on [DATE]
>
> Legal review completed by: [NAME / FIRM] on [DATE]
>
> Customer representative confirmed: [NAME] on [DATE]

> **This checklist is a starting point. Qualified legal review is required before any customer go-live. Neither Vibeverk nor this checklist can guarantee regulatory compliance without independent legal assessment.**
