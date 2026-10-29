# Decision log: "Service data: its tables, write path, staff roles and how long each record is kept" (#55)

Made by: the ordering lead session (Opus), 10-21, from the Opus design agent's proposal (`2026-10-21-service-data-design.md`). For: anyone who needs #55's decisions at a glance, and the architecture doc update that the map's Notes plan. Map #29 "Ordering from the menu".

#55 is a technical grilling: the lead decides and reports, while role names, the defaults and changes to a rule or a guardrail go to Martin. Each row has a **status**:
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on a fact or a ticket.

**Recorded in** names the binding text. The design file holds the detail behind each row.

## 1. Tables

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | **Service data lives in its own tables:**<br>- sittings (a table is open for phones while its sitting has no end);<br>- one order per sitting;<br>- order notes, in their own rows;<br>- sent orders;<br>- locks;<br>- readings;<br>- payments, with append-only payment steps;<br>- the provider's notices;<br>- the Log;<br>- waiter calls;<br>- alerts;<br>- pauses;<br>- bars;<br>- service days;<br>- staff members, roles, assignments and shared devices.<br><br>Nothing about the location pass is stored. | Design §1. | firm | D122 §9 |
| 1.2 | **Payment steps are the money events.** The Log reads them, and they are never written twice. The confirmed amounts and lines of a payment can't be changed, which a database trigger enforces. | Dispute evidence must not drift (D122 §8). | firm | D122 §9 |
| 1.3 | **A provider's name never appears in a service table.** The provider kind sits on the venue's payment-account row in the integration layer. | The vendor-word guard (D67). | firm | D122 §9 |
| 1.4 | **The table code: a sealed copy is kept beside its hash** (D55's pattern), so stickers can be printed again, and the published file is named by the code's SHA-256. This refines D122 §9's "stored as a hash". | Today `tables.qr_token` is plain and names the published file, and owners must be able to reprint stickers. A sealed copy keeps the code away from a database-only leak, as with POS credentials. | firm | D122 §9 |

## 2. The write path

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | **One entry point, `applyService(command)` in `core/service`,** beside `apply()`. The commands are one checked union, and each declares its origins (guest, staff, worker) and the permission it needs. The answer is accepted, or refused with a code (D72). | `apply()` locks a tenant's whole document, and service writes need a lock per table and state machines with deadlines (design §2.1). | firm | D122 §9 |
| 2.2 | **Provenance on service rows** is `source` (guest, staff, worker, provider, restro, pos), `actor` and `job_id`, NOT NULL, plus `via` (Tonight or Telegram). | Rule 2's who, where from and which job. | firm | D122 §9 |
| 2.3 | **Rule 2's "layer" applies to the menu's values only** (Martin 10-21). Service rows carry `source`, `actor` and `job_id` instead; a layer is a slot in the menu's layer stack. CLAUDE.md's rule 2 says so in one sentence. | Who did what stays complete; only the menu-specific part is skipped. | firm | D122 §9, CLAUDE.md |
| 2.4 | **Taking a lock is the one conditional statement.** Every other write locks its row first (order, then sent order or payment, then the lock), decides in memory and writes. No POS or provider call happens inside a transaction. | D122 §9 literally, with one fixed lock order so two writers can't deadlock. | firm | D122 §9 |
| 2.5 | **Idempotency:**<br>- a ring of 64 action ids on the order;<br>- unique action ids on sent orders and payments;<br>- unique (payment, step, attempt);<br>- notices stored by their id;<br>- staff actions return the current state. | D121 2.4, with no table that grows. | firm | D122 §9 |
| 2.6 | **Who calls it:**<br>- the guest endpoints of D121;<br>- Tonight's server actions;<br>- the worker.<br><br>Telegram works by long polling in the worker, so there is no new public endpoint. The provider's notices get one web endpoint that only checks and stores them, built only when the tracker opens it. | No POS call from the web (D121 5.5). | firm | D122 §9 |
| 2.7 | **Import rules:**<br>- the write rule is widened to `core/apply` and `core/service`;<br>- `@restro/core/service` may be imported only by the guest API, the admin's server actions and the worker;<br>- a new write-target guard test pins which tables each folder writes. | One database door, with the split enforced. It only tightens (D67). | firm | D122 §9 |

## 3. Row-level security and retention

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | **Every service table follows the existing tenant pattern,** with its own RLS migration and its line in `table-access.ts`. There is no owner role, no `BYPASSRLS` and no Data API. | CLAUDE.md "Never". | firm | D122 §9 |
| 3.2 | **Retention:**<br>- Log entries are classed `night` (31 days) or `record` (18 months);<br>- the service path sets `retain_until`, and the purge only compares dates;<br>- notes are deleted at 31 days;<br>- a disputed payment is kept until 6 months after the dispute closes. | Evidence is never cut short by purge logic (D122 §8). | firm | D122 §9 |
| 3.3 | **`restro_purge` may delete from the new service tables** (Martin 10-21, round 2), only by `retain_until` and the dispute hold (3.2). The grant lands with the tables' migration. | Retention needs it; a guardrail role widened with Martin's OK (D83, D67). | firm | D122 §9 |
| 3.4 | **The venue is offered an export before its data is erased** (Н-18 чл. 52к, ал. 3, lawyer question 10). | #52's working answers. | firm | D122 §9 |
| 3.5 | **Rate counters live in the web app's memory,** and are never stored. They move into Postgres when the web app runs on more than one instance. | D122 §4: the server keeps these for minutes only. | firm | D122 §9 |

## 4. Staff roles

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | **Per-venue roles built from a fixed list of 15 permissions** (design §5), with three defaults. Organisation owners and admins hold every venue permission. D99's DJ role stays separate. | No lockout, and today's admin behaviour stays. | firm | D122 §7 |
| 4.2 | **A PIN unlocks Tonight's actions only.** Settings need the person's own sign-in. Permissions are checked only on the server, inside `applyService` and `readTonight`. | A 4-digit secret is weak. | firm | D122 §7 |
| 4.3 | **Restro generates the PIN,** unique in the organisation, with "New PIN" for the person or an owner. | A PIN the person chooses, refused as taken, would reveal someone else's. A security choice, so the lead's. | firm | D122 §7 |
| 4.4 | **The venue roles are Staff, Manager and Owner** (Martin 10-21). Organisation owners and admins hold every venue permission (4.1). | Names are Martin's. | firm | D122 §7 |
| 4.5 | **A venue can't change a default role;** it copies one into its own role and adjusts the copy (Martin 10-21). | The defaults stay safe and gain new permissions as features ship. | firm | D122 §7 |
| 4.6 | **Staff work with a PIN; an account isn't needed** (Martin 10-21). | Bar staff rarely want an account, and the Log still names a person. | firm | D122 §7 |
| 4.8 | **Because staff PINs can be shown again, a PIN is stored sealed** (encrypted, as the table code's copy, 1.4), beside a hash used for checking. It is shown only in venue settings, to Restro's admin team (5.1) and the venue's owner (Martin 10-22). Restro still generates it, unique in the organisation (4.3), and "New PIN" stays. | A hash alone can't be shown again. The lead's security choice. | firm | D122 §7 |
| 4.7 | **Stock lives in the POS** (Martin 10-21). Staff never mark sold out in Restro for a POS venue, and Tonight has no "Sold out" tab. A run-out item found by the menu reading or by the check before Send is greyed out for every phone, and Tonight's actions get a notice. Found at Send, nothing of that order is sent; the guest sees the item out of stock in the bag and sends the rest again (Martin 10-22). Hand-made venues keep the admin's switch. | Martin's. | firm | D122 §4 |

## 5. Follow-ups

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | **Restro's admin team is a role of its own** (Martin 10-21): in any venue it adds roles, changes their rights, and sees and manages staff PINs. It also lifts any pause (D120 2.7) and reads the raw POS call log (merged fix 28). This is the operator identity the code lacks; it is built with the service data. | Martin's answer brings it into the pilot. | firm | D122 §7 |
| 5.2 | **The DJ as a venue role.** | D100's owner decides. | out | D100 |
