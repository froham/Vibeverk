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
  - Covers: chat messages, CRM records, user accounts, notes, tasks, announcements, KB articles.
  - Note: automated deletion is not currently implemented in the platform — manual processes must be defined.

- [ ] **(R) The customer understands how to delete data (user accounts, chat records, CRM entries) and has a process for handling data subject access and deletion requests.**

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

- [ ] **(R) All enabled third-party integrations (Tidio, Plausible, Google Fonts) are listed in the privacy notice.**
  - Google Fonts sends font requests to Google's CDN and may log visitor IP addresses. This may require disclosure even if Fonts is not considered a "tracking" service.

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
