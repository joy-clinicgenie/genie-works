# Genie Works V1 — Staff standard operating procedure

**Version:** Genie Works V1  
**Who this is for:** Clinic Genie agency staff who use Genie Works day to day (admin, manager, specialist, reviewer, and read-only).  
**What this covers:** The platform as it works now. Screens that are visible but not yet connected say so, so you do not treat an empty panel as a zero result.

Genie Works is the internal operations platform for Clinic Genie. The launch menu has nine modules: Dashboard (Agency Overview), Clients, Website analytics, SEO performance, Blog, Leads and forms, Reports, Settings, and Admin. Staff use those modules to keep clinic records, follow up enquiries that arrive from clinic websites, prepare website analytics and reports, and draft and publish blog articles on native websites. Tasks, approvals, Google Ads, issues, HCSA wording and the timeline still open from a client or from their own address. They are not separate items in the launch menu, and they were not removed.

Enquiry messages stay in the clinic website’s own records. Genie Works reads them when an enquiry source is connected. It does not keep a second copy of the person’s name, telephone, email or message as its own enquiry system. If the source is not connected, the enquiry page says none are available. That is not a count of zero enquiries. All demonstration clinics in a training database are fictional. A record marked **Demonstration data** is for practice. It is not a live clinic result.

A few results are not yet verified. Website analytics on screen come from stored figures. A live provider sync has not been confirmed. Clinic email is not sent from Genie Works, so **Sent** is not proof that a mailbox received it. No clinic website has been shown reading the blog or SEO settings from this platform. A report can be a **draft** or a **saved** version. **Saved** is not Approved or Final. The proposed Draft, In review, Approved and Final workflow is not on the screen. Clinic owner, content approver, security reviewer and release approver are not named in the current records.

Dates and deadlines in Genie Works use the Singapore day. A due date is the deadline. A follow-up date is a separate date, used when work is waiting. Search Console reporting dates follow Google’s Pacific day when those figures are stored. The rest of the platform stays on Singapore time.

---

## 1. How to sign in, and what you see first

### Sign in

1. Open Genie Works and go to `/sign-in`.
2. Use the method your administrator has turned on.
   - **Continue with Google Workspace** when that button is shown. Genie Works does not store a password.
   - **Work email** and **Send sign-in link** appear only in a development workspace. The link is not emailed. On a local development machine, an engineer opens `/dev/magic-links` to use it. That page is not a production staff step. It is hidden in production, and those links expire after 15 minutes.
3. If you see **This email is not an active staff account**, an administrator has not created your staff record, or the account is deactivated. Signing in with an unknown email is refused.
4. After a successful sign-in you land on the Dashboard at `/`.

Your session ends after 12 hours, when you sign out, or when an administrator deactivates your account.

### What is on every signed-in page

The left menu has three groups.

**Main Menu**

- **Dashboard**
- **Clients**

**Work**

- **Website analytics**
- **SEO performance**
- **Blog**
- **Leads and forms**
- **Reports**

**Others**

- **Settings**
- **Admin** — shown only to an admin

On a small screen, open the menu with **Open menu**. On a large screen you can collapse the menu with **Close navigation**.

The top bar shows your name, a search box labelled **Search clients and pages**, a **Reports** link, and **Add new** when you are allowed to add something. **Add new** offers **Add blog** if you can edit at least one blog website, and **Add client** if you are an admin or manager. Search matches menu pages and clinic names, client IDs, short codes and specialties. Press the K shortcut (Command or Control, then K) to focus search.

Your name, role and the environment label (for example development or production) sit at the bottom of the menu. Use **Sign out** there.

Several working areas are not in the left menu. You reach them from a client, or by the route:

- Approvals — a client’s **Approvals**, or `/approvals`
- Issues — the **Open issues** count on a client, or `/issues`
- Timeline — a client’s **Timeline**, or `/timeline`
- Tasks — `/my-tasks`, a task opened from SEO, or `/clients/[client]/tasks`
- Google Ads — `/google-ads` or `/clients/[client]/google-ads`
- HCSA — `/medical-review` or `/clients/[client]/medical-review`

You only see clinics you are allowed to see. A link to another clinic shows **Not available** or an empty result. Ask an administrator for access.

---

## 2. Roles and what each role is allowed to do

Your role is on your staff record. Which clinics you can open is a separate assignment, except for admin and manager, who can open every active clinic. An assignment covers every website of that clinic.

| What | Admin | Manager | Specialist | Reviewer | Read-only |
| --- | --- | --- | --- | --- | --- |
| Clinics you can open | Every active clinic | Every active clinic | Assigned clinics only | Assigned clinics only | Assigned clinics only |
| Edit clinic profile, websites, contacts, file links and account references | Yes | Yes | No | No | No |
| Assign or remove staff on a clinic | Yes | No | No | No | No |
| Create and edit tasks, SEO records, Google Ads records, reports and blog drafts | Yes | Yes | Yes, on assigned clinics | No, except a task you own, or an internal task with no clinic | No |
| Submit work for review (approvals and blog) | Yes | Yes | Yes, on assigned clinics | No | No |
| Decide an approval | Yes, if you did not request it | Yes, if you did not request it | No | Yes, on assigned clinics, if you did not request it | No |
| Decide an HCSA review | Yes | Yes | No | Yes, when you are the assigned reviewer | No |
| Open an issue, add evidence, move an issue through investigation and resolution | Yes | Yes | Yes, on assigned clinics | Can open an issue and add evidence for a clinic you can open. Can record a passed or failed verification. Cannot edit the issue text. | No |
| Verify your own resolution | Yes | No. Ask a colleague. | No. Ask a colleague. | No. Ask a colleague. | No |
| Publish or unpublish a blog article, and publish SEO settings or redirects | Yes | Yes | No | No | No |
| Download a report CSV or an enquiry CSV | Yes | Yes | No. You can still open a printable summary. | No. You can still open a printable summary. | No |
| Search enquiries by name, email or telephone | Yes | Yes | Yes | No. Reference search still works. | No |
| Retry a failed clinic notification | Yes | Yes | Yes | No | No |
| Connect, disconnect or bind an analytics provider, or generate and rotate a website token | Yes | No | No | No | No |
| Refresh a recent analytics window, or import a metric file | Yes | Yes | No | No | No |
| Add staff, change roles, read the audit log, see backup records | Yes | No | No | No | No |

A reviewer does not edit the article while it is in review. An admin or manager can edit, review and publish. There is no rule that two different people must approve.

Read-only staff can open the pages their clinics allow and cannot save changes.

---

## 3. Daily way of working

Use this order on a normal day. Skip a step when that work is not yours.

1. **Sign in and read the Dashboard.** Check how many clients and websites you are managing, whether website sessions are available, and which enquiries or unfinished reports need attention. A failed clinic notification is called out on the enquiries panel when one exists.
2. **Open the client.** From **Clients**. Confirm you are on the right clinic before you change anything.
3. **Do the work in the module that owns it.** Enquiries and notification retries live under **Leads and forms**. Figures live under **Website analytics**. Page settings, redirects and the SEO checklist live under **SEO performance**. Articles live under **Blog**. Account changes you made in Google Ads are recorded under Google Ads. Wording that needs a source and a reviewer goes to HCSA. Day-to-day jobs go to Tasks.
4. **Send work that needs a decision.** Use **Submit for decision** on an approval, or **Submit for review** on an article. The person who requested an approval cannot decide it.
5. **Record evidence on an issue** before you ask someone else to verify it. Uploaded files stay private and open only for staff who can open that client.
6. **Close the loop on the record.** Verify an issue only if you did not resolve it, unless you are an admin. Publish a blog article only after the current version is approved, and only if you are an admin or manager. Save a report draft while you are still adjusting it. Use **Save for review** when a version should be kept. That saved version is not an approval, and it is not a final artifact.
7. **Check the client Timeline** if you need to see what was recorded today. The timeline is written by the workflows. You do not type events into it.

SEO, Google Ads and HCSA are not on the Dashboard. Open those pages from the menu or from the client.

---

## 4. Page-by-page guide

### 4.1 Dashboard

**Route:** `/`  
**Purpose:** A short view of agency status, website sessions, and the enquiries or report drafts that need attention. It does not replace Clients, Analytics, Enquiries or Reports.  
**Who uses it:** Everyone who can sign in. Counts include only the clinics you can open. Admins and managers see every active clinic.

**What is on the page**

- **All clients** and a period (**Last 7 days**, **Last 30 days**, **Last 90 days** or **This month**). The default period is the last 30 days. Choosing one client limits websites, sessions, enquiries and reports. The period limits enquiry counts and sessions. Active clients and linked websites stay current totals, and the active-client total does not change when you choose one client.
- **Active clients** and **Linked websites** open the client directory. One selected client opens that client.
- **Enquiries received** is the total of stored production submissions in the period. **New**, **Acknowledged** and **Closed** open Enquiries with that status and the same period already applied. Closed does not mean an appointment. Names, telephone numbers, email addresses and messages are not on this page.
- **Reports in progress** is the number of unfinished drafts. The most recently edited draft has **Continue**, which opens that draft. **Open reports** goes to Reports, where a new report is created. A saved-for-review report is not in progress.
- **Website performance** is sessions from the connected analytics provider, compared with the previous period of the same length, with a simple trend and the top three websites. Each website opens its Analytics page. A recorded zero stays zero. Missing data says **Not connected**, **Not yet synchronised** or **Unavailable**.
- **Connection notice** appears only when an enquiry source or an analytics connection is failed, disconnected, stale or unreachable. A healthy connection is not listed. A failed clinic notification is shown on the enquiries panel, not in this notice, and opens Notification status filtered to Failed.

**How to use it**

1. Read the four totals, then website sessions.
2. Open any enquiry status or failed notification that needs follow-up.
3. Use **Continue** when a report draft is waiting. Create a report from Reports.

**Rules**

- Read the sentence under a figure before you treat a dash as zero. **Connection required**, **Not connected**, **Not yet synchronised** and **Unavailable** are not zero.
- Form starts, contact clicks and confirmed bookings are not enquiry counts.
- If Analytics cannot be read, Enquiries and Reports still show. If the enquiry database cannot be read, the other sections still show.

---

### 4.2 Clients

#### Client directory

**Route:** `/clients`  
**Purpose:** The clinic directory. Contract dates, service-scope documents and renewal reminders are not part of this record.  
**Who uses it:** Everyone, limited to clinics they can open. **Add client** is for admins and managers.

**What is on the page**

Filters: **Search** (name, client ID or short code), **Status** (Active, Active and inactive, Inactive), **Specialty**, **Clinic Genie owner**.

Table columns: **Client ID**, **Short code**, **Client name**, **Specialty**, **Clinic Genie owner**, **Status** (Active or Inactive). A fictional seed clinic shows **Demonstration data** under the name.

Empty states: **No clients match this search.** **No clients yet. Add one and mark it as demonstration data.** **No clients are visible to you. Ask an administrator for access.** A refused link shows **Not available**.

**How to add a client** (admin or manager)

1. Choose **Add client** or **Add new** → **Add client**. Route: `/clients/new`.
2. Fill **Client ID** (unique, for example a code such as CG-001), **Short code**, **Clinic name** (required), **Specialty**, **Identifier** (required; lowercase letters, numbers and hyphens; permanent), **Clinic Genie owner**, **Registered business name**, **Public clinic name**, **General email**, **General telephone**, **Clinic address**.
3. Set the operational owners: **Enquiries**, **Notification issues**, **Account administration**.
4. Write **Services** as a plain description. Channel checkboxes are separate from the service list. Channels are Website, Seo, Google ads, Social, Email and Other.
5. Add **Notes** if needed. Tick **This is demonstration data (fictional client)** for a training clinic.
6. Choose **Create client**. Contacts, websites, account references and assigned staff are added on the profile after the clinic exists.

#### Client overview

**Route:** `/clients/[client]`  
**Purpose:** The working home for one clinic: identity, files, websites, profile, links into the rest of Genie Works, account references and recent activity.  
**Who uses it:** Anyone who can open that clinic. **Edit profile** saves only for an admin or manager.

The inner menu for this client is:

- **Profile**, **Workspace**, **Account references** (sections on this page)
- **Approvals**, **Reports**, **Timeline**, **Edit profile**

**What is on the page**

- Header: clinic name, **Active** or **Inactive**, **Demonstration data** when the clinic is fictional, client ID, short code, specialty, Clinic Genie owner, public name and address.
- **Files** — titled links. Genie Works does not store the file. Opening it depends on the site that hosts the link.
- **Websites** — name, environment (Production, Staging or Development), platform and URL.
- **Profile** — registered name, public name, address, general contact, primary contact, services, channels, enquiry owner, notification owner, account administration, assigned team, notes.
- **Approvals waiting** and **Open issues** — counts that open the client’s approval list and issue list.
- **Workspace** — Website analytics, SEO performance, Blog, Leads and forms, Approvals, Reports, Timeline. Analytics, SEO and Blog open the first production website when one exists, otherwise the first website.
- **Account references** — kind, label, owner, external identifier and link. The secret itself is not stored here.
- **Recent activity** — latest timeline events for this clinic, excluding task events.

**Rules**

- Deactivating a clinic hides it from the active directory. Tasks, decisions and other records are kept.
- Do not paste a real clinic URL into a demonstration record.

#### Edit profile

**Route:** `/clients/[client]/profile`  
**Purpose:** Maintain the clinic record, people, team, file links, booking destination, account references and websites.  
**Who uses it:** Everyone who can open the clinic can read it. Admins and managers edit it. Only an admin can assign or remove staff.

**Sections and what to do**

1. **Client profile.** Change the same fields as Add client, then **Save details**. **Deactivate client** hides it from the active directory. **Restore client** brings an inactive clinic back. The identifier does not change.
2. **Client contacts.** **Contact name** (required), **Designation**, **Work email**, **Work telephone**, **Primary contact**. **Save contact** or **Add contact**. **Deactivate this contact** keeps the row and marks it inactive. One contact can be primary.
3. **Assigned team.** Shows name, role and email. An admin chooses **Assign staff** and **Assign**, or **Remove**. Admins and managers already see every clinic without an assignment. An assignment covers every website of this client.
4. **Files.** **Title**, **https link**, **Notes**, then **Add file link**. **Remove** takes the link off the profile. The file stays wherever it was hosted.
5. **Booking.** Shows an account reference whose kind is Booking, or the words **Appointment enquiry form** when none is saved. The fallback is the primary contact, then any active contact.
6. **Account references.** **Kind**, **Label** (required), **Identifier** (an account or property ID, never a password), **Link**, **Vault reference** (where the credential lives; the secret is not stored here), **Account owner**, **Notes**. **Add reference** or **Save reference**. **Deactivate this reference** retires it. Kinds include Ga4, Search console, Google ads, Tag manager, Google business, Wix, Hosting, Domain, Booking and Other.
7. **Websites.** **Name** (required), **URL**, **Platform** (for example Wix, WordPress, or Next.js on Vercel), **Environment**, **Status**, **Notes**. Blog submission rules, all optional unless you tick them: **Require an author**, **Require a category**, **Require a featured image and alt text**, **Require an SEO title and description**, **Require a sharing title and description**. **Add website** or **Save website**. Use a placeholder address on a demonstration clinic.
8. **Record history.** Who created or updated this client record, and when. Contact details are not copied into the history.

**Rules**

- A saved account reference is not a live connection. Connections are configured under Settings.
- Only admins and managers see the edit forms. Everyone else sees the stored values and the notice **Only admins and managers can edit the profile.**

---

### 4.3 Website analytics

**Routes:** `/analytics` (Overview), `/analytics/traffic` (Traffic), `/analytics/behavior` (Behaviour). `/analytics/behaviour` opens Behaviour.  
**Purpose:** Read recorded website figures for one client and one website, for a chosen period, compared with the previous period of the same length.  
**Who uses it:** Anyone who can open the client. Connecting a provider is an admin or manager task on Settings, not on this page.

**What is on the page**

Choose the client, website and period in the header. Periods include Custom, Today, Yesterday, Last 7 days, Last 14 days, Last 30 days (the default), Last 90 days, Last 365 days and This month. The comparison label shows the previous window.

Inner menu: **Overview**, **Traffic**, **Behaviour**.

Overview key figures, when the export contains them:

- **Sessions** — a visit. One person can have more than one session.
- **Total users** — people who visited. This is not the same measure as a session.
- **Total leads** — stored enquiries. Contact clicks are counted separately.
- **Visitor-to-lead conversion rate** — stored enquiries divided by visitors.
- **Engagement rate** — shown only when the export records an engagement rate.
- **Organic traffic** — sessions from organic search. This is not Search Console clicks.

Other overview blocks: **Traffic trend**, **Channel mix** (including **Organic share this period**), **Landing pages**. Contact actions on a landing page are clicks. Stored leads are not split by page.

Traffic adds **New visitors**, **Returning visitors** and device share, including **Mobile share this period**.

Behaviour adds **Form starts** and **Successful submissions**. WhatsApp and phone can bypass the form. A form start is not a submission. A contact click is not an enquiry. A booking-link click is not an appointment.

Panels say **Not recorded** when the export does not contain that split. A blank or missing figure is not a zero.

**How to read a figure**

1. Select the client and the website. If the website in a link does not belong to the client, it is left out and a notice says so.
2. Set the period.
3. Read the source line. It names where the figures came from and links to leads and SEO.
4. Open a breakdown from a panel link when you need the table behind a chart. Breakdown pages live under `/reports/breakdown/...` and can offer **Download CSV** to an admin or manager.

**Rules**

- One traffic source applies to a website. Wix traffic and GA4 traffic are not added together. Search Console can sit beside the traffic source.
- Saved exports remain the report source until live reports are turned on. A connection on Settings does not by itself rewrite older saved reports.
- **No websites yet** means the client has no website on the platform. **That client is not available** means the link is outside your access.

---

### 4.4 SEO performance

**Route:** `/seo`, then the inner SEO menu.  
**Purpose:** Record and, for a connected Next.js website, publish a limited set of SEO settings. This is a soft launch. Many panels are present so staff can see the intended destination, and they state clearly when no check has been run.  
**Who uses it:** Anyone who can open the client can read it. Specialists, managers and admins edit records for clinics they can edit. Publishing a verification tag, page settings or a redirect stays with an admin or manager. The website must be an active Next.js site for publication. Wix and other platforms are not changed from this screen.

Every SEO page asks you to choose a **Client** and **Website** first. **Demonstration** mode, when used, is labelled **Demo data**. Those figures are fictional and are not a clinic record. Leave demonstration before you work on a real website. You cannot view demonstration data and a selected clinic at the same time.

**SEO menu**

- **SEO Overview** — `/seo`
- **Checklist & Tasks** — `/seo/tasks`
- **Pages & Content** — `/seo/pages`
- **Site Health** — `/seo/site-health`
- **URL Redirects** — `/seo/redirects`
- **Google Business Profile** — `/seo/business-profile`
- **AI Visibility** — `/seo/ai-visibility`
- **Reports** — `/seo/reports`
- **Settings & Connections** — `/seo/settings`

An older address `/seo/checklist` opens Checklist & Tasks on the Setup tab. `/seo/business-profiles` opens Google Business Profile on Locations.

#### SEO Overview

**What is on the page:** **Run website check** is visible and disabled, because no crawler is connected. **Review changes** opens Publishing & History and shows how many saved changes have no verification date. **SEO Assistant** counts saved setup records, mapping issues, review reminders and verified change records from the last 30 days. It says when website checks have not been run. **Site performance on Google** lets you pick Last 7 days, Last 30 days, Last 90 days or Custom, and Clicks, Impressions, CTR or Average position, plus Pages or Queries and Increased or Decreased. Without a connected property the numbers say **Unavailable**. **Open Google Search Console** leaves Genie Works. **AI Visibility** on this page is marked **Not connected** and links to the detail screens. **Quick actions** open page SEO, image descriptions, a new redirect, and Google Business Profile. **Recent changes** lists saved before-and-after records. They are not a live publication log.

#### Checklist & Tasks

**Purpose:** One queue for setup and ongoing SEO work. Automated checks have not been run.  
**Tabs:** **Setup**, **Issues**, **Recommendations**, **Completed**.

Setup shows the saved checklist for this website. Issues are page mappings with a mapping flag. Recommendations are pages marked needs update, or pages whose next review date is before today. Completed includes verified change records in the recent window and completed staff tasks linked to SEO. Filters: owner, priority, status and search.

Opening a mapping issue goes to the page editor. Opening a staff task goes to `/tasks/[task]`. Completing a task does not prove a technical check passed. A crawl cannot recheck the mapping yet.

#### Pages & Content

**Tabs:** **Pages**, **Images**, **Keywords & Planning**, **Templates**.

**Pages** is the working list. Filter by **Publication status** or **Missing title or keyword**. **Map a page** opens `/seo/new`.

**How to map a page**

1. Choose the client, then **Map a page**.
2. Enter **Page path or URL** (for example `/dental-implants`), **Website**, **Page title**, **Owner**, **Primary keyword**, **Secondary keywords** (comma separated), **Search intent** (Informational, Navigational, Commercial, Transactional), **Content status**, **Last reviewed on**, **Next review on**, **Mapping flag** and **Flag note**.
3. **Flag note** is required when a flag is set. Flags are None, Duplicate target, Cannibalisation, Missing page, Wrong intent, Thin content and Other. A flag is a staff note. The platform has not crawled the site.
4. Choose **Add page** or, later, **Save page**.

Content statuses: Planned, Drafting, In review, Published, Needs update, Retired.

On a mapped page (`/seo/pages/[page]`) you can read the path, canonical path, configured indexing, focus topic and mapping. **Live indexability** says **Not checked**. **Google indexing** says **Not connected**. Social sharing and structured data on this screen are not stored. **Record a change** saves a staff record with **What changed**, **Changed on**, **Before**, **After**, **Reason** and an optional **Approval reference**. It does not publish the website. **Record** on a change asks for **Verified on** and **What was observed afterwards**. Later movement is observed. It is not proof the change caused it.

**How to publish page SEO** (admin or manager, Next.js website)

1. Open **Settings & Connections** → **Website Defaults**, or the page settings editor.
2. Enter **Published page path** (the exact route), **SEO title**, **Meta description**, and **Canonical path** if it should differ from the page’s own URL.
3. Choose **Publish SEO settings**.

**Images**, **Keywords & Planning** and **Templates** explain that image descriptions, keyword volume and templates are not connected. Do not treat those tabs as a completed audit.

The client also has a page list at `/clients/[client]/seo` with **Map a page** and **Open SEO pages**. It is not in the client’s inner menu. Use **SEO performance** from the client workspace, or this route.

#### Site Health

**Tabs:** **Website Checks**, **Google Indexing**, **Speed & Mobile**, **Crawl Settings**.  
**Run check** is disabled. Nothing on this page has been crawled. Broken links, speed scores and sitemap submission are unavailable. A page that was not scanned is not marked Passed. **Google Indexing** can show the saved index preference. That preference is not live indexability and it is not Google’s reported index. The screen has not fetched sitemap or robots files.

#### URL Redirects

**Tabs:** **Redirects**, **Import & Export**, **Migration**.  
**Purpose:** Keep individual permanent redirects. Imports, exports, dry-runs and migration inventories do not run from this screen.

**How to add a redirect** (admin or manager, active Next.js website)

1. Open **Redirects**. If the site is not Next.js, the page says the platform is not editable here.
2. Enter **From path** and **To path**.
3. Choose **Add redirect**, or **Save** on an existing rule.

The supported type is a permanent 301. Temporary redirects are not implemented. Wix is not changed.

#### Google Business Profile

**Tabs:** **Locations**, **Reviews**, **Insights**.  
**Purpose:** Store branch references. Saving one does not change the public Google profile. Reviews and insights are not connected, so there is no reply to send and no call or direction count. A missing insight is not shown as zero.

**How to add a branch reference** (someone who can edit the client)

1. Open **Locations**.
2. Enter **Clinic branch** (required), **Google Business Profile URL** (optional HTTPS profile or Maps link), **Google profile/location ID** (optional), **Setup status** and **Notes**.
3. Setup status is **Not started**, **In progress** or **Staff marked verified**. Staff-marked verified is not confirmation from Google.
4. Choose **Add branch profile** or **Save branch profile**. **Open in Google** and **Open branch profile** leave Genie Works.

#### AI Visibility

**Tabs:** **Visibility**, **Questions & Tests**, **Sources & Perception**, **AI Access**.  
No provider is connected. Mentions, citations, question libraries, saved answers, llms.txt and NLWeb are unavailable. A missing test is not a negative mention. Do not report a result from this page.

#### SEO Reports

**Tabs:** **Google Search**, **AI Traffic**, **Crawler Activity**, **Saved Reports**.  
Export and scheduled delivery are not available here. Google Search figures appear only after a connection has stored them. AI traffic and crawler activity are unavailable and are not combined into one number. **Saved Reports** points you to the main Reports module. This page does not create a second reporting system.

#### Settings & Connections

**Tabs:** **Connections**, **Website Defaults**, **Publishing & History**, **Access & Schedules**.

- **Connections** shows Search Console as Connected, Reconnect required or Not connected, and whether the website settings API can publish page settings and redirects. **Generate website token** or **Rotate website token** is for an administrator on a Next.js site. A manager cannot do this. The token is what a public website would use to read published settings. Treat it as a secret. Put it only in that website’s server settings. Rotating it stops the previous token. No clinic website has been shown consuming that token. **Save verification code** publishes a Google Search Console HTML verification tag and is available to an administrator or a manager. It does not verify ownership. Keyword tools, crawler logs and other providers on this tab are not connected.
- **Website Defaults** shows the public domain, environment, site name and platform from the clinic website record. Changing them on the client profile does not publish SEO by itself. Page title and description overrides are edited here.
- **Publishing & History** lists staff-recorded before and after values. Release rollback, draft batches and protected previews are not available. Saving a page setting updates the settings API record only.
- **Access & Schedules** is the place for access notes on this module. Alert schedules are not an active notification system.

---

### 4.5 Blog

**Routes:** `/blog`, `/blog/new`, `/blog/[article]`, preview at `/blog/[article]/preview`.  
**Purpose:** Create, edit, review, approve, preview, publish and unpublish articles for native clinic websites. Article performance is not part of this version. Wix Blog publishing is not available. There is no schedule and no AI writing.  
**Who uses it:** Anyone who can open the client can read articles for its websites. A specialist can edit and submit. A reviewer can review without editing. An admin or manager can edit, review and publish. **+ New article** appears when the selected website belongs to a client you can edit. **Add blog** in the top bar opens `/blog/new`.

**What is on the list**

You must choose **Client** and **Website** before the list appears. **Select a client and website** is the empty state until you do. Status menu: **All**, **Draft**, **In review**, **Approved**, **Published**, **Archived**, each with a count. **All** lists every article that is not archived, newest update first. Choose **Archived** to see archived articles. **Sort** can be **Last updated** or **Published on**. Also filter by **Author** and **Search title**.

Columns: **Article**, **Client**, **Status**, **Author**, **Last updated**, **Published on**. A published article that has a working revision also shows **Draft revision**, **Revision in review** or **Approved revision**. **Preview** opens the saved version. **View live** opens the public article when the website URL and live slug exist. **Public blog** opens the website’s `/blog` path.

**How to draft an article**

1. Choose the client and website, then **+ New article**.
2. On **Write**, enter the title and body. A draft may be incomplete. You can use paragraph, Heading 2, Heading 3, bulleted list, numbered list, **Bold**, **Italic**, **Insert link** and **Insert image**.
3. Open **Settings** for **Excerpt**, **Featured image**, **Category**, **Author**, **Reviewer**, **Website**, **Slug**, **Sharing title**, **Sharing description** and **Sharing image**. Leave **Slug** blank to suggest one from the title. A slug you edit is kept. Save the draft before you upload an image.
4. Open **SEO** for **SEO title** and **Meta description**.
5. Choose **Save draft**. If you try to leave with unsaved changes, choose **Save**, **Discard** or **Cancel**.

Author, category, featured image, SEO and social fields are optional unless that website’s blog requirements say otherwise. The public byline is the staff display name. Images must be PNG, JPEG or WebP, 1 MB or smaller, with alt text of 300 characters or fewer.

**How to submit, review and publish**

Use the **Review** tab.

1. **Submit for review** when the draft has a title, a meaningful body, a unique slug on that website, and an eligible reviewer. Eligible reviewers are reviewer, manager or admin accounts.
2. The assigned reviewer, or an admin or manager, chooses **Approve**, or enters **Feedback** and **Request changes**. Feedback is required when requesting changes. Only the assigned reviewer, or an admin or manager, can decide.
3. **Return for editing** sends an in-review or approved article back to draft. The editor, or the assigned reviewer, can do this.
4. An admin or manager on a native website chooses **Publish**, checks destination, article, URL and approval, then **Publish now**. The approved snapshot becomes the live version. Publishing the same approved version again does not create another public article. If the public URL is not configured, the confirm box says so.
5. **View live article** opens the public page after a successful publish.
6. **Create revision** on a published article keeps the live article Published and starts one working draft. You cannot start a second revision while one is open.
7. **Unpublish** removes the live article and returns it to draft. History is kept. If a revision existed, that revision remains the draft. Unpublish is admin or manager only.
8. **Archive** is for a draft or approved article that is not live. An article in review must return to draft before it can be archived. **Restore to draft** brings an archived article back.
9. On **History**, restoring an older version creates a new draft. It does not change the live snapshot. If a working revision already exists, you must confirm that it should be replaced.

**Rules**

- A website that is not native shows **Publishing is unavailable**. You can still draft and approve. The article will not be published to Wix.
- Specialists see **Publishing and unpublishing are limited to an admin or manager.**
- There is no public redirect when a slug changes.
- Preview is a signed-in page of a saved version. It is not the public article.

---

### 4.6 Leads and forms

**Routes:** `/enquiries`, `/enquiries/[enquiry]`, `/enquiries/notifications`. `/forms` opens Enquiries. An old `/forms/[id]` link opens that enquiry.  
**Purpose:** Read requests that clinic websites have already stored, update follow-up, and see whether the clinic notification email was accepted by the mail provider. Genie Works does not present a form builder, a routing proposal, or an acknowledgement email to send. Replies are sent from the marketing mailbox, outside this page.  
**Who uses it:** Anyone who can open the matching clinic. Admins and managers see every submitted form. Other roles see a submission only when the website clinic matches an assignment. Specialists can update follow-up, search by person, and retry a failed notification. Reviewers and read-only staff can read the enquiries they are allowed to see. They cannot search by name, email or telephone, and they cannot retry.

**Enquiries list**

Inner menu: **Enquiries**, **Notification status**.

Filters: **From**, **To** (default is this Singapore month), **Client**, **Website**, **Form**, **Follow-up status**, **Notification**, **Reference**, and **Name, email or telephone** when your role allows it.

The overview compares the selected window with the previous window of the same length. Demonstration submissions stay in the working list and are left out of that comparison. A previous period with zero enquiries shows a numerical change and no percentage. Form starts, contact clicks and confirmed bookings are not added into the enquiry total.

Columns: **Received**, **Reference**, **Client / website**, **Form**, **Name**, **Follow-up status**, **Notification**.

**How to export** (admin or manager)

1. Set the filters first. The file uses those filters.
2. Read the production record count. Demonstration submissions are not included.
3. Tick **Include contact details** only when the file should contain name, telephone and email. The message and other free text stay out of the file either way.
4. Choose **Download CSV**. The download is recorded: who exported, when, which filters, how many rows, whether contact details were included, and which clinics were in the file.

**Enquiry detail**

Shows name, telephone, email, reason, preferred time, page, source and message. A preferred time is a request, not a booked appointment. **Demonstration data** is badged when the row is a training submission. Opening the enquiry does not change follow-up status. The view is recorded in the audit log without copying the message into that log.

**How to update follow-up** (someone who can edit the client)

1. Set **Follow-up status**.
   - **New** — waiting for staff.
   - **Acknowledged** — staff have taken follow-up. It does not mean an email was sent.
   - **Closed** — no further action in this workflow. It does not mean an appointment was booked. Closed can be reopened.
2. **Internal note** is optional. It stays in Genie Works and is not sent to the clinic or the person who enquired.
3. Choose **Save follow-up**.

Each change is kept. The history shows who moved the status, and from which status to which. The note does not copy the person’s contact details into Genie Works as a second enquiry record. The status itself is updated on the clinic website’s enquiry row.

**Clinic notification**

- **Sent** means the provider accepted the message. It does not mean the mailbox confirmed delivery.
- **Pending** means a send is still outstanding.
- **Failed** means the send did not succeed. The enquiry stays in the list. **Retry** updates that notification row only. It does not create another enquiry.
- **Not configured** means no clinic mailbox is configured.
- **No notification recorded** means there is no outbox row.

The panel shows the stored time, the attempt count, the last attempt and the next retry. Attempts are **Automatic** unless a person triggered them. A staff retry is listed separately with the staff name. **Retry** is shown to admins, managers and specialists.

**Notification status page**

Filters by date, client, website and delivery status (Pending, Sent, Failed, Not configured). Use it when the Dashboard shows failed clinic notifications. Retry from the row when you are allowed to.

**Rules**

- A missing or unrecognised source is **Unknown / not captured**. The page path stays separate from the source.
- Two submissions are not merged because they share an email or telephone.
- If the clinic website database is not connected, the page says no enquiries are available. Nothing was changed.

---

### 4.7 Reports

**Routes:** `/reports`, `/reports/new`, `/reports/[report]`, print at `/reports/[report]/print`.  
**Purpose:** Prepare a client report from recorded figures, save a draft, keep a saved version, and export. The screen has two states: **draft** and **saved**. A proposed Draft → In review → Approved → Final workflow is not implemented. A saved version is not Approved or Final, and there is no stored PDF. **Generate PDF** opens a print view in the browser. Analytics stays on its own page. A contact click is not shown as an enquiry or an appointment. Figures are the ones already stored. They are not a confirmed live provider result.  
**Who uses it:** Anyone who can open the client can read reports for that client. Specialists, managers and admins can create and edit. **Download CSV** is admin and manager only. Anyone who can open the report can use **Generate PDF** or **Open summary**, which opens a print view so the browser can save a PDF.

**Report library**

Columns: **Report**, **Client**, **Reporting period**, **Creator**, **Date created**. A draft is labelled **Draft**. Filter with **Client** and **Filter**. Empty state: **No reports saved yet.**

**How to create a report**

1. Choose **Create**. If you cannot edit any client, the page says **You cannot create a report.**
2. **1. Select client.** **Report title**, **Client**, **Website** (required when the client has websites), **Report type** (Monthly, Quarterly or Custom) and **Prepared by**.
3. **2. Choose report template.** One of:
   - **Monthly Performance Report** — executive summary, website analytics, SEO, leads, recommendations
   - **SEO Performance Report** — SEO, organic traffic, blog performance, recommendations
   - **SEM Performance Report** — Google Ads, leads, conversions, recommendations
   - **Comprehensive Report** — all available sections
4. **3. Set reporting period.** **Reporting period starts** and **ends** are required. **Comparison period starts** and **ends** are optional. Leave both comparison dates blank when there is nothing to compare. Enter both, or neither. Monthly and quarterly types fill the previous month or quarter until you edit the dates.
5. **4. Select metrics and sections.** Untick anything this report should leave out. Narrative items are filled from recorded figures, completed work and open issues. You do not rewrite that wording in the builder. Missing figures stay blank. Clicks are not counted as enquiries. Cost per lead stays blank unless advertising cost and a recorded enquiry count both exist.
6. **Preview report** shows recorded figures only. A blank cell means the figure is not stored. It does not mean zero.
7. **Save draft** updates the working copy and does not create a saved version.
8. **Save for review** keeps a numbered **saved** version. Later edits do not change an earlier version. Open a version from **Saved versions**. This is not an approval and not a final file.
9. **Generate PDF** opens the print view. The browser can print it. Genie Works does not store a PDF.

**Older reports** that were saved before the checklist still open with **Report name**, period dates, **Report sections**, **Summary**, **Observations**, **Actions taken**, **Proposed next steps**, **Data sources**, **Missing connections** and **Measurement limitations**. **Save** updates that report. **Duplicate** makes a new report from it. **Open summary** is the print path for those reports. **Download CSV** downloads the tables and commentary.

**Rules**

- A saved report stays with its client.
- Observations describe what was recorded. They are not a claim that one change caused a later movement.
- The report period uses Singapore dates, with the period control on the report itself.

---

### 4.8 Tasks

Tasks are in the product and are not in the left menu.

**Routes:** `/my-tasks`, `/tasks/new`, `/tasks/[task]`, and a client list at `/clients/[client]/tasks`. SEO Checklist & Tasks links to the task page when the row is a staff task.  
**Purpose:** Track work with one accountable owner, a priority, a due date, and a status history.  
**Who uses it:** Read-only staff can view tasks on clinics they can open and cannot change them. Everyone else can create a task. You can edit a client task if you can edit that client, or if you are the owner. An internal task (no clinic) can be edited by anyone except read-only. Reviewers do not get a general edit right on other people’s client tasks.

**My tasks**

Inner menu: **My tasks** (your active tasks), **All tasks**, **Completed**.

**Add task** opens a panel. Fields: **Task title**, **Client** (required; choose a clinic or **Internal**), **Description**, **Assigned to**, **Priority** (Low, Medium, High), **Due date**, **Status** (To do, In progress, Blocked, Completed), **Reference link**. **Create task** or **Cancel**.

Filters: **Search** by title, **Client** (including Internal), **Status**, **Priority**, **Due date** (Overdue, Today, This week, No due date). Due dates use the Singapore day.

On this list the status words are **To do**, **In progress**, **Blocked**, **Completed** and **Cancelled**. **Blocked** is the same status the full task page calls **Waiting**.

Click a row to open the side panel. If you can edit it: change title, description, assignee, priority, due date, status and reference link, then **Save**. **Mark completed** and **Reopen** are on the panel. Completed and cancelled tasks cannot be edited until they are reopened.

**Full task page**

Shows **Accountable owner**, **Due date**, **Waiting on** and **Follow-up date** when the task is waiting, **Reference link**, **Related record**, created, completed and cancelled times. Status words here are **Open**, **In progress**, **Waiting**, **Completed** and **Cancelled**. Priority can include **Critical** in the full editor.

**How to change status**

1. Open the task. On a client task table the row may offer **Start**, **Complete**, **Resume** or **Reopen**.
2. On the task page, set **New status**.
3. If the new status is Waiting, enter **Waiting on** (who or what must happen) and **Follow-up date**. The follow-up date is not the deadline.
4. Add a **Note**. A note is required in spirit when you complete: say what was done. The field is marked optional except where the form says otherwise. Empty notes are refused when you use **Add note**.
5. Save. The button name follows the status, for example marking the task completed.

Allowed moves: Open, In progress and Waiting can move among those three, or to Completed or Cancelled. Completed and Cancelled can move back to Open. The history keeps each change.

**How to create a task from a client list**

Open `/clients/[client]/tasks`. The list is ordered as urgent, due today, waiting, upcoming, then later, unless you filter to Completed or Cancelled. **New task** goes to `/tasks/new` with the client already chosen. The full create form asks for **Title**, **Description**, **Accountable owner** (exactly one person), **Priority** (Low, Medium, High, Critical), **Due date**, and an optional related record that must belong to the same client.

**Rules**

- One person is accountable.
- A related record that belongs to another client is refused.
- A reference link must start with http:// or https://.

---

### 4.9 Approvals

**Routes:** `/approvals`, `/approvals/new`, `/approvals/[approval]`, and `/clients/[client]/approvals`.  
**Purpose:** Ask for a decision and keep every decision. A decision is never edited. A revised decision is a new record linked to the earlier one. The earlier one stays in the history and is marked **Superseded**.  
**Who uses it:** Anyone who can open the client can read its approvals. Specialists, managers and admins see **New request**. Reviewers and read-only staff do not. Admins, managers and assigned reviewers can decide, and only if they did not request it.

**List filters:** **Client**, **Status** (Draft, Submitted, Approved, Changes requested, Withdrawn).

**How to raise a request**

1. Choose **New request**, or **New request** on the client’s Approvals page.
2. Pick the client.
3. Enter **What needs approval**, **Type** and **Summary and evidence**. Types are Content, Seo change, Ads change, Medical claim, Website change and Other. Say what is proposed, why, and where the decider can see it. You can link a related record on the same client.
4. **Save draft** keeps it editable. **Submit for decision** sends it.

**How to decide**

1. Open the request. Status must be **Submitted**, or you are revising an earlier decision.
2. Enter **Decision note**. The note is required when you request changes.
3. Choose **Approve** or **Request changes**.
4. To revise an approved or changes-requested decision, use **Revise decision**, enter **Reason for revising the decision**, then **Record approval** or **Request changes**. The new decision is linked. The old one remains.

**Other actions**

- **Edit request** while the status is Draft or Changes requested.
- **Submit for decision** from the request page.
- **Withdraw** while it is draft, changes requested, or submitted. Approved and withdrawn requests cannot be withdrawn.

**Rules**

- You cannot decide a request you submitted. The page says **You requested this approval, so someone else must decide it.**
- Changes requested sends the request back to the person who can edit it. They submit again after the change.

---

### 4.10 Google Ads

Google Ads is in the product and is not in the left menu.

**Routes:** `/google-ads`, `/google-ads/audits/new`, `/google-ads/audits/[audit]`, `/google-ads/changes/new`, `/google-ads/changes/[change]`, and `/clients/[client]/google-ads`.  
**Purpose:** Record audits, findings and changes that staff made in Google Ads. This module never changes a live account.  
**Who uses it:** Anyone who can open the client can read the log. **New audit** and **Record a change** are for people who can edit that client. Reviewers and read-only staff do not get those buttons.

**List:** filter by **Client** and **Audit status** (Open or Closed). Two tables: **Audits** and **Change log** (most recent first).

**How to open an audit**

1. Choose **New audit** and the client.
2. Enter **Title**, **Review period from** and **to**, **Account reference** (a saved Google Ads reference, not a live connection), **Scope** (which campaigns, ad groups, keywords or landing pages were reviewed) and **Summary**.
3. Choose **Open audit**.

**How to add a finding** (open audits only)

1. Open the audit.
2. Set **Area** (Campaign, Ad group, Keywords, Search terms, Ads, Landing pages, Budget, Bidding, Conversion tracking, Other), **Severity** (Low, Medium, High), **Finding** and **Recommendation**.
3. Choose **Add finding**.

An open finding can be marked **Dismiss**, or you choose **Record the change made**, which opens the change form with the audit and finding filled in. Recording the change marks the finding **Implemented**.

**How to record a change**

1. Choose **Record a change**.
2. Optionally link **Audit** and **Finding addressed**.
3. Enter **Where (campaign, ad group, keyword)**, **Implemented on**, **Before**, **After**, **Responsible staff**, **Approval reference** (optional), **What was changed** and **Reason**.
4. Choose **Record change**.

**How to verify a change**

On the change page, if it is not yet verified, enter **Verified on** and **What was observed afterwards**, then **Record verification**. The page then shows **Verified** with the date, or **Not yet verified**. Later movement is observed. It is not proof the change caused it.

**Close audit** is on an open audit. A closed audit cannot take new findings. **Edit audit** is available while it is open.

---

### 4.11 Issues and evidence

**Routes:** `/issues`, `/issues/new`, `/issues/[issue]`, and `/clients/[client]/issues`.  
**Purpose:** Record a problem, investigate it, resolve it, and have someone else verify the result, with evidence kept on the client.  
**Who uses it:** Anyone who can open the client can read its issues. People who can edit the client can open and edit issues and move them through the workflow. A reviewer can open an issue and add evidence, and can record verification. Read-only staff cannot change an issue.

**List filters:** **Client**, **Status**, **Severity**. Statuses: Open, Investigating, Resolved pending verification, Verified closed, Reopened. Severities: Low, Medium, High, Critical. **Open an issue** is the create button.

**How to open an issue**

1. Choose **Open an issue** and the client.
2. Enter **Title**, **Description** (what is wrong, where, and how it was noticed), **Severity** and **Owner**.
3. Optionally link a related record on the same client.
4. Choose **Open issue**.

**How to move it**

Use **Change status** and **Move to**. The allowed path is:

- Open can go to Investigating or Resolved pending verification.
- Investigating can go back to Open, or to Resolved pending verification.
- Resolved pending verification can go to Verified closed or Reopened.
- Verified closed can go to Reopened.
- Reopened can go to Investigating or Resolved pending verification.

When you mark it resolved, **Resolution** is required. Say what was done. When you verify, **What was checked and the result** is required. Verification records you as the verifier, with the date and **Passed**. Reopening from pending verification records a **Failed** verification and needs a note. Reopening later also needs a note that says why.

**The person who resolved the issue should not be the one verifying it**, unless that person is an admin. Ask a colleague.

**Evidence**

On the issue, **Add evidence** with a **Label** and either **Upload a file** or **Or an https link**.

- Files: PNG, JPEG, WebP, GIF, PDF, text or CSV, up to 10 MB. They are stored privately. Open them from the issue. The link works only for staff who can open that client.
- Links must be full `https://` addresses.

**Remove** is for people who can edit the client. **Edit issue** is available until the issue is verified closed. A verified closed issue must be reopened before the text can change. History lists every status change, the note, and any verification result.

Open issues from the client, or from `/issues`. The Dashboard does not list them.

---

### 4.12 HCSA

HCSA is the medical-wording review. It is in the product and is not in the left menu. The page title is **HCSA**.

**Routes:** `/medical-review`, `/medical-review/new`, `/medical-review/[claim]`, and `/clients/[client]/medical-review`.  
**Purpose:** Keep a claim, its wording versions, the assigned reviewer, the sources, and the decision.  
**Who uses it:** Anyone who can open the client can read claims. **New claim** is for people who can edit the client. The assigned reviewer, or an admin or manager, records the decision. An approved status here means an assigned reviewer accepted the wording and at least one source is recorded. It is not regulatory certification or legal clearance. The page shows that warning.

**List filters:** **Client**, **Status** (Draft, Under review, Approved, Rejected, Withdrawn), **Reviews** (**All claims** or **Assigned to me**).

**How to create a claim**

1. Choose **New claim** and the client.
2. Enter **Claim summary** (one line), **Where it appears** (page, section or asset) and **Proposed wording (version 1)**.
3. Choose **Create claim**.

**How to review it**

1. Add at least one source before anyone approves. **Source title** is required. **Type** is Guideline, Peer reviewed, Regulator, Manufacturer, Clinic record or Other. **Link** and **Citation** are optional. Choose **Add source**.
2. Choose a **Reviewer** (an active reviewer, manager or admin) and **Assign review of current wording**. The same reviewer cannot have two open reviews of the current wording.
3. The assigned reviewer, or an admin or manager, sets **Decision** to Approved, Rejected or Changes required, writes **Reasoning** (required) and chooses **Record decision**. Approval is refused when no source is recorded. If the wording changed after the review was assigned, assign a new review of the current wording. A decision that was already recorded cannot be edited.
4. **Add wording version** creates a new version, marks earlier reviews superseded, and returns the claim to draft.
5. **Withdraw claim** stops further changes. A withdrawn claim cannot be edited or reviewed.

---

### 4.13 Timeline

**Routes:** `/timeline` and `/clients/[client]/timeline`.  
**Purpose:** A read-only list of material events the workflows write in the same moment as the work: tasks completed or cancelled, approvals submitted or decided, SEO and Ads changes, issues, HCSA decisions, reports, client create or archive, and blog submit, approve, return, publish and unpublish.  
**Who uses it:** Anyone who can open the client. You do not add, edit or delete timeline rows.

Filters: **Client**, **Event type**, **From**, **To**.

A notice on the page says later movement in the figures is observed, not proven to be caused by a change. The security audit log is separate, under Admin.

The Dashboard does not list timeline events. Task events still appear on the Timeline when you do not filter them out. They are also omitted from the client overview’s recent activity.

---

### 4.14 Settings

**Route:** `/settings`  
**Purpose:** Your staff record, what your role can do, and which outside systems this workspace can reach. Clinic records and enquiry messages stay in their own systems.  
**Who uses it:** Everyone sees their own record. Analytics provider controls are for admins and managers. Links to users, audit and backups are for admins.

**What you can change**

- **Name**, then **Save name**. This is the name other staff see.
- **Sign-in email** is read-only. An admin changes it. No password is stored.

The page also shows your role, clinic scope, whether CSV export is on, and the Singapore clock. It states:

- Which clinics you can open
- Whether you see every enquiry or only assigned clinics
- Whether you can edit the registry
- That a session ends after 12 hours, on sign-out, or when the account is deactivated
- Whether Google Workspace sign-in is configured

**Connections**

- **Enquiry records** — Reachable, Unreachable or Not connected. Read from the clinic website database. A contact click is not an enquiry.
- **Google Workspace** — Configured or Not configured. Staff sign-in only.
- **Measurement exports** — saved exports remain the report source until live reports are turned on.
- **Analytics providers** — one traffic source per website. Search Console can sit beside it. An administrator can **Connect GA4**, **Connect Search Console**, **Connect Wix** (Wix sites, using a site instance, with no Wix user sign-in step), **Disconnect** and **Use this property**, when the server has provider credentials. An administrator or a manager can **Refresh recent window** and **Import a metric file** with **Preview and store**. The import columns are date, metric and value. Tick **Replace overlap** only when a repeated range should be stored again. Provider rows stay in place. Wix and GA4 are not both connected as the traffic source. Tokens stay on the server and are not shown again. A successful button press in a local fixture is not a verified live provider sync.

**Kept outside Genie Works**

The page lists boundaries you should not expect to configure here: no platform-wide notification recipient list (operational contacts live on the client), no approved retention period and no deletion, no stored MFA, no saved display preference, no named incident owner, and privacy-notice versions stay with the submitted form in the clinic website database.

---

### 4.15 Admin

**Routes:** `/admin`, `/admin/users`, `/admin/audit`, `/admin/backups`.  
**Purpose:** Staff accounts, the security audit log, and recorded backup and restore runs.  
**Who uses it:** Admins only. Anyone else is returned to the Dashboard. The menu item is hidden for other roles.

Inner menu: **Status**, **Users and roles**, **Audit history**, **Backups and recovery**.

**Status** shows active clients, active staff, approvals awaiting decision, the last recorded backup, and the last recorded restore test. A green status appears only after a recorded run passed. A schedule by itself is not a backup. The page names the operator commands that record a run. Those commands are for the person who operates the database, not for everyday client work.

**Users and roles**

Each person shows name, email, Active or Deactivated, role, and either **All clients** or the assigned clinic names.

**How to add a staff member**

1. Enter **Work email**, **Display name** and **Role**.
2. Choose **Add staff member**.

This creates the staff record for the existing sign-in method. It does not create a password. Assign clinics on the client’s **Edit profile** page. An admin or manager does not need an assignment to see active clinics.

**How to change a person**

1. Edit **Name** and **Role**.
2. Tick deactivate when the person should lose access. Deactivation ends that person’s sessions.
3. Choose **Save**.

**Audit history**

Filter by **Client**. Columns: When, Actor, Action, Target, Client, Outcome (success, denied or other), Details. The log records access changes, form views, exports and other privileged actions. It does not copy names, email addresses or messages. Audit rows are append-only. You do not edit them.

**Backups and recovery**

A table of recorded backup and restore runs: kind, started, finished, outcome, target, record counts and notes. An empty table means no run has been recorded. The page does not claim that hosting backups exist.

---

## 5. Status words and what they mean

Words below are the ones on the screen. Colour is only a reinforcement. Read the word.

### Clients and websites

| Word | Meaning |
| --- | --- |
| Active | The clinic is in the working directory. |
| Inactive | The clinic was deactivated. Records remain. It is hidden from the active list until restored. |
| Production, Staging, Development | The website environment. In the SEO website picker, Staging is labelled Preview. |
| Demonstration data | A fictional training record. Leave it out of client-facing claims. Enquiry comparisons and enquiry CSV files already leave demonstration rows out. |

### Tasks

| On My tasks | On the task page | Meaning |
| --- | --- | --- |
| To do | Open | Not started. |
| In progress | In progress | Being worked on. |
| Blocked | Waiting | Stopped until someone or something happens. Needs **Waiting on** and a **Follow-up date**. |
| Completed | Completed | Done. Reopen before editing. |
| Cancelled | Cancelled | Stopped without completion. Reopen before editing. |

Priority: Low, Medium, High, Critical. The quick add form on My tasks offers Low, Medium and High. The full task editor also offers Critical.

### Approvals

| Word | Meaning |
| --- | --- |
| Draft | Saved, not yet submitted. |
| Submitted | Waiting for a decision. |
| Approved | Decided yes. A later revision is a new decision. |
| Changes requested | Sent back. The note says what must change. Editable again, then resubmit. |
| Withdrawn | Taken back. Cannot be withdrawn again. |
| Superseded | An earlier decision that a newer decision replaced. Still visible. |

### Blog

| Word | Meaning |
| --- | --- |
| Draft | Editable working copy. May be incomplete. |
| In review | With the assigned reviewer. Editing is locked until it returns to draft. |
| Approved | The current version was accepted. Not live until an admin or manager publishes a native site. |
| Published | Live on a native website. A revision can exist beside it. |
| Archived | Not live, and not in the active working list until restored. |
| Draft revision, Revision in review, Approved revision | A second copy on a still-published article. |

### Enquiries and notifications

| Word | Meaning |
| --- | --- |
| New | Waiting for staff follow-up. |
| Acknowledged | Staff have taken follow-up. An email was not necessarily sent. |
| Closed | No further action in this workflow. An appointment was not necessarily booked. Can be reopened. |
| Pending | Clinic email not finished. |
| Sent | The mail provider accepted the message. Delivery to the mailbox is not confirmed. |
| Failed | The clinic email did not send. The enquiry remains. |
| Not configured | No clinic mailbox is configured. |
| No notification recorded | No email row is stored for this enquiry. |
| Unknown / not captured | The source value is missing or not recognised. |

### Issues

| Word | Meaning |
| --- | --- |
| Open | Recorded, not yet in investigation. |
| Investigating | Being looked at. |
| Resolved pending verification | A resolution note is saved. Someone else should verify it. |
| Verified closed | A verifier recorded a passed check. |
| Reopened | The issue is active again. A failed verification is recorded when it is reopened from pending verification. |
| Passed, Failed | The verification result. |

Severity: Low, Medium, High, Critical. Review open issues on the Issues page.

### HCSA

| Word | Meaning |
| --- | --- |
| Draft | Wording is being prepared. |
| Under review | A reviewer is assigned to the current wording. |
| Approved | The assigned reviewer accepted this wording, with at least one source. Workflow status only. |
| Rejected | The reviewer did not accept it. |
| Withdrawn | Closed off. No further edits. |
| Changes required | The reviewer asked for different wording. |
| Superseded | An earlier review, kept because the wording changed. |

### SEO content and mapping

Content status: Planned, Drafting, In review, Published, Needs update, Retired.

Mapping flag: None, Duplicate target, Cannibalisation, Missing page, Wrong intent, Thin content, Other. These are staff flags, not crawl results.

Search intent: Informational, Navigational, Commercial, Transactional.

Google Business Profile setup: Not started, In progress, Staff marked verified. The last one is a staff mark, not a Google confirmation.

### Google Ads

Audit: Open, Closed. Finding: Open, Implemented, Dismissed. A change line shows **Verified** with a date, or **Not yet verified**.

### Reports

**Draft** on the library means the working copy has not been kept as a saved version. **Version** numbers under **Saved versions** are the copies retained by **Save for review**. Those copies are **saved**. They are not Approved or Final. Empty metric cells mean the figure is not stored. The words In review, Approved and Final are not report statuses on this screen.

---

## 6. Before you finish

There is no separate end-of-day button. Use this checklist for the work you touched.

- The clinic on the screen is the clinic you meant to update. Demonstration data is still marked as demonstration data.
- Enquiries you handled have a follow-up status you can explain. Acknowledged and Closed match the meanings in this guide. Any internal note is something you would be willing to keep, and it was not sent to the enquirer.
- Failed clinic notifications that are yours have been retried, or left with a clear owner. **Sent** has not been described to a client as delivered.
- Tasks you finished are **Completed**, with a note of what was done. Tasks you cannot move have **Waiting on** and a **Follow-up date**.
- Approvals you finished are submitted, or decided by someone who did not request them. If you changed a decision, the new decision is recorded and the old one is still visible as superseded.
- Blog articles you intended to send are **In review** with a reviewer, or **Published** only after approval, by an admin or manager, on a native website. A Wix article was not described as published from Genie Works.
- SEO changes you made in the live site are either published through **Publish SEO settings** or **Add redirect** on a connected Next.js site, or recorded as a staff change with before, after and reason. You did not treat **Unavailable**, **Not checked** or **Not connected** as a pass.
- Issues you resolved are **Resolved pending verification** with a resolution note and evidence, and a colleague who did not resolve them has been asked to verify, unless you are an admin verifying your own fix.
- HCSA wording you want accepted has a source and an assigned reviewer. You have not described an approved claim as regulatory certification.
- Google Ads changes you made in the ads account are in the change log with before, after, reason and the responsible person.
- A report you are handing on was **Save for review**, not only **Save draft**, and blank cells were left blank. You have not called that saved version Approved or Final.
- You signed out on a shared computer. Your session otherwise ends after 12 hours or when your account is deactivated.

Corrections to an approval decision, a report version kept for review, an audit event, or an enquiry follow-up are new records. Do not expect an old decision or an old report version to change in place.

---

## 7. Quick reference: routes

The launch menu is the nine modules in section 1. The routes for tasks, approvals, Google Ads, issues, HCSA and timeline still open. They are outside that menu.

| Route | Page |
| --- | --- |
| `/sign-in` | Sign in |
| `/` | Dashboard |
| `/clients` | Client directory |
| `/clients/new` | Add client |
| `/clients/[client]` | Client overview |
| `/clients/[client]/profile` | Edit profile |
| `/clients/[client]/approvals` | Client approvals |
| `/clients/[client]/reports` | Client reports |
| `/clients/[client]/timeline` | Client timeline |
| `/clients/[client]/issues` | Client issues |
| `/clients/[client]/tasks` | Client tasks |
| `/clients/[client]/seo` | Client SEO page list |
| `/clients/[client]/google-ads` | Client Google Ads |
| `/clients/[client]/medical-review` | Client HCSA |
| `/analytics` | Website analytics overview |
| `/analytics/traffic` | Traffic |
| `/analytics/behavior` | Behaviour |
| `/seo` | SEO overview |
| `/seo/tasks` | Checklist and tasks |
| `/seo/pages` | Pages and content |
| `/seo/new` | Map a page |
| `/seo/pages/[page]` | One mapped page |
| `/seo/site-health` | Site health |
| `/seo/redirects` | URL redirects |
| `/seo/business-profile` | Google Business Profile |
| `/seo/ai-visibility` | AI visibility |
| `/seo/reports` | SEO reports |
| `/seo/settings` | SEO settings and connections |
| `/blog` | Blog list |
| `/blog/new` | New article |
| `/blog/[article]` | Article |
| `/enquiries` | Enquiries |
| `/enquiries/[enquiry]` | One enquiry |
| `/enquiries/notifications` | Notification status |
| `/reports` | Report library |
| `/reports/new` | Create a report |
| `/reports/[report]` | One report |
| `/reports/[report]/print` | Printable summary |
| `/my-tasks` | My tasks |
| `/tasks/new` | New task |
| `/tasks/[task]` | One task |
| `/approvals` | Approvals |
| `/approvals/new` | New request |
| `/approvals/[approval]` | One request |
| `/google-ads` | Google Ads log |
| `/google-ads/audits/new` | New audit |
| `/google-ads/audits/[audit]` | One audit |
| `/google-ads/changes/new` | Record a change |
| `/google-ads/changes/[change]` | One change |
| `/issues` | Issue register |
| `/issues/new` | Open an issue |
| `/issues/[issue]` | One issue |
| `/medical-review` | HCSA |
| `/medical-review/new` | New claim |
| `/medical-review/[claim]` | One claim |
| `/timeline` | Timeline |
| `/settings` | Platform settings |
| `/admin` | Admin status |
| `/admin/users` | Users and roles |
| `/admin/audit` | Audit history |
| `/admin/backups` | Backups and recovery |

These addresses open a page you already have above. They are not extra modules.

| Address | Opens |
| --- | --- |
| `/forms` | Enquiries |
| `/forms/[id]` | That enquiry |
| `/analytics/behaviour` | Behaviour |
| `/seo/checklist` | Checklist & Tasks, Setup tab |
| `/seo/business-profiles` | Google Business Profile, Locations tab |

`/dev/magic-links` is a local development list of sign-in links. It is not part of production staff work.
