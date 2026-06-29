# Data Map Template — Vibeverk Customer Deployment

> **TEMPLATE — MUST BE COMPLETED BEFORE USE**
> This template requires customer-specific information to be accurate. Every field marked [MUST BE CONFIRMED] requires verification with the actual customer before the document can be used for compliance purposes. This document is a starting point, not legal approval. Qualified legal review is required before use in a DPA, privacy notice or regulatory submission.

---

## 1. Customer identity

| Field | Value |
|---|---|
| Company name | [MUST BE CONFIRMED] |
| Organisation number | [MUST BE CONFIRMED] |
| Registered address | [MUST BE CONFIRMED] |
| Primary contact (name, email) | [MUST BE CONFIRMED] |
| Data Protection Officer (DPO), if any | [MUST BE CONFIRMED — most SMBs do not require a DPO] |
| Supabase project ID | [MUST BE CONFIRMED — check config.js supabase.url] |
| Supabase data region | [MUST BE CONFIRMED — check Supabase Dashboard → Project Settings → Infrastructure] |

---

## 2. Vibeverk role

Vibeverk is likely acting as a **data processor** when operating the platform on behalf of the customer (the customer determines the purposes and means of processing). However, this must be confirmed per feature. For its own internal operations (e.g., access to the Vibeverk Console, platform monitoring), Vibeverk may be acting as a **data controller**.

The customer (the business deploying Vibeverk) is likely the **data controller** for data collected from their website visitors and employees.

> Role assessment must be confirmed with qualified legal advice and cannot be assumed from this template alone.

---

## 3. Data categories by feature

Complete only the rows for features that are enabled in this customer's deployment (`config.js → features`).

### Chat (module-chat.js)

| Field | Detail |
|---|---|
| Data collected | Visitor name, visitor email, visitor_id (random browser-generated string), chat messages, page URL at time of chat, referrer URL, browser name, OS, screen resolution, language |
| Who collects it | Vibeverk platform, on behalf of the customer |
| Where stored | Supabase (chat_conversations, chat_messages tables); visitor_id also in visitor's browser localStorage |
| Accessible by | Customer owner/admin via intranet; Vibeverk operator via Console |
| Retention | [MUST BE CONFIRMED — no automatic deletion is currently implemented] |
| Legal basis | [MUST BE CONFIRMED — likely legitimate interest or contract performance; confirm with legal] |
| Notes | Data is collected without the visitor being logged in. visitor_id is not a verified identity. Includes browser metadata. |

### CRM (module-crm.js)

| Field | Detail |
|---|---|
| Data collected | Customer/lead contact details (name, email, phone as entered), notes, lead source, interaction history |
| Who collects it | Customer's staff via admin panel or imported from chat |
| Where stored | Supabase (CRM-related table; verify table name in migration.sql) |
| Accessible by | Customer owner/admin |
| Retention | [MUST BE CONFIRMED] |
| Legal basis | [MUST BE CONFIRMED] |

### User accounts (users table)

| Field | Detail |
|---|---|
| Data collected | Name, email, role (owner/admin/editor/member), account creation date |
| Who collects it | Customer owner registers employees; Supabase Auth stores credentials |
| Where stored | Supabase (users table, Supabase Auth) |
| Accessible by | Owner can see all; admin can see non-owner users; members see own account |
| Retention | [MUST BE CONFIRMED — consider what happens when an employee leaves] |
| Legal basis | [MUST BE CONFIRMED — likely contract performance (employment/service agreement)] |

### Notes (intranet/module-notes.js)

| Field | Detail |
|---|---|
| Data collected | Free-text notes created by individual workspace users |
| Who collects it | Individual employees |
| Where stored | Supabase (notes table). RLS: private per user (user_id = auth.uid()) |
| Accessible by | Only the user who created the note |
| Retention | [MUST BE CONFIRMED] |
| Legal basis | [MUST BE CONFIRMED] |

### Tasks (intranet/module-tasks.js)

| Field | Detail |
|---|---|
| Data collected | Task title, description, status, due date, assigned user (UUID) |
| Who collects it | Customer owner/admin |
| Where stored | Supabase (tasks table) |
| Accessible by | All authenticated workspace users can read; owner/admin write and assign |
| Retention | [MUST BE CONFIRMED] |
| Legal basis | [MUST BE CONFIRMED] |

### Announcements (intranet/module-announcements.js)

| Field | Detail |
|---|---|
| Data collected | Announcement title, content, author ID, images, attachments |
| Who collects it | Customer owner/admin |
| Where stored | Supabase (announcements table; attachments stored as JSON or Supabase Storage — confirm) |
| Accessible by | All authenticated workspace users |
| Retention | [MUST BE CONFIRMED] |
| Legal basis | [MUST BE CONFIRMED] |

### Knowledge base (intranet/module-kb.js)

| Field | Detail |
|---|---|
| Data collected | Article title, content, author, tags, category, published flag |
| Who collects it | Customer owner/admin |
| Where stored | Supabase (kb_articles table) |
| Accessible by | All authenticated workspace users; published articles may be visible publicly (confirm) |
| Retention | [MUST BE CONFIRMED] |
| Legal basis | [MUST BE CONFIRMED] |

### Analytics — Plausible (if enabled)

| Field | Detail |
|---|---|
| Data collected | Page views, referrer, browser/OS (aggregated, no cookies per Plausible's design) |
| Who collects it | Plausible Analytics (third party) |
| Where stored | Plausible's servers |
| Legal basis | [MUST BE CONFIRMED — Plausible is designed to be cookieless/consent-free, but confirm with legal for Norwegian requirements] |

### Live chat SaaS — Tidio (if enabled)

| Field | Detail |
|---|---|
| Data collected | Visitor interactions, may set cookies, may collect visitor IP and device data |
| Who collects it | Tidio (third party) |
| Where stored | Tidio's servers |
| Legal basis | [MUST BE CONFIRMED — likely requires explicit consent for cookies] |

---

## 4. Third-party processors

| Processor | Role | Data shared | Transfer outside EEA? | DPA in place? |
|---|---|---|---|---|
| Supabase Inc. | Database hosting (PostgreSQL) | All personal data stored in the platform | [MUST BE CONFIRMED — depends on project region] | [MUST BE CONFIRMED] |
| Google LLC | Font delivery (Google Fonts) | Visitor IP address (incidental, font request) | Yes — USA | [MUST BE CONFIRMED — likely under Google's standard terms] |
| Tidio (if enabled) | Live chat SaaS | Visitor interaction data, may include PII | [MUST BE CONFIRMED] | [MUST BE CONFIRMED] |
| Plausible Analytics (if enabled) | Web analytics | Aggregated page view data | [MUST BE CONFIRMED — Plausible is EU-based as of knowledge cutoff] | [MUST BE CONFIRMED] |
| GitHub Pages | Static file hosting | No personal data in served files (only HTML/JS/CSS) | USA (Microsoft/GitHub) | [MUST BE CONFIRMED] |

---

## 5. Access summary

| Role | What they can access |
|---|---|
| Website visitor (unauthenticated) | Public website content only. Chat: own conversation via visitor_id. No other data. |
| Customer web admin (password) | All web admin module content. Chat admin view. CRM. Site settings. |
| Customer workspace member | Own notes. All announcements, KB, tasks (read). Own task status updates. |
| Customer workspace admin | All workspace content. User management (except owner). Settings. |
| Customer workspace owner | Full access to all workspace content and settings. |
| Vibeverk operator (Console) | Superconfig, productMode, feature flags for the customer's deployment. |

---

## 6. Deletion and data subject rights

| Data type | Deletion method | Automated? |
|---|---|---|
| Chat conversations and messages | Manual deletion in admin panel, or direct SQL in Supabase Dashboard | No |
| CRM records | Manual deletion in admin panel | No |
| User accounts | Delete via user management UI or directly in Supabase Auth | No |
| Notes | User can delete own notes; admin/owner SQL | No |
| Tasks | Admin/owner via task management UI | No |
| localStorage (visitor browser) | Visitor can clear browser data; no server-side mechanism | No |

> Automated retention and deletion policies are not currently implemented. [MUST BE CONFIRMED what retention periods apply and whether automated deletion is required.]

---

## 7. Open questions (must be confirmed before use)

- [ ] In which region is this customer's Supabase project hosted?
- [ ] Is a DPA signed between Vibeverk and Supabase for this project?
- [ ] Is Tidio enabled? If yes, what is Tidio's GDPR/DPA status?
- [ ] Is Plausible enabled? Has consent/notice been assessed for Norwegian requirements?
- [ ] What retention periods apply to chat data, CRM data, and user accounts?
- [ ] Has a data processor agreement (DPA) between Vibeverk and the customer been drafted and signed?
- [ ] Does the customer's use of the platform involve employee personal data? If so, is the employee handbook / HR policy updated?
- [ ] Are any of the website visitors likely to be minors? If so, additional requirements apply.
- [ ] Is any profiling or automated decision-making occurring? (Chat visitor classification, AI features if enabled.)
