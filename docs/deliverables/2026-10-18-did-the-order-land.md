# Did the order land? Retries after a timeout, and what barsy offers

Made by: research subagent (Sonnet) for #35, 10-18

Martin's question (10-18): "I don't think Restro should send something twice. If I am not mistaken, APIs work in a standardised way where you can figure out if a POST was received or something failed?"

Method: RFC 9110 and RFC 9112 and the IETF Idempotency-Key draft were downloaded and read as text. Stripe, Adyen, PayPal and the AWS Builders' Library were read through a page fetch on 10-18, so their wording below is paraphrased unless in quotation marks. For barsy only Restro's own notes on the signed-in reading were used (see section 4); nothing about barsy is invented, and gaps are marked **unknown**.

## 1. The answer in plain words

**Martin is half right.** The standard way the web works tells a client what happened only when an answer arrives. When no answer arrives (a timeout, a dropped connection) HTTP itself says nothing: the order may have landed, may be waiting, or may never have arrived. The standard text says so: a client "SHOULD NOT automatically retry" a request like this "unless it has some means to know that the request semantics are actually idempotent ... or some means to detect that the original request was never applied" ([RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)).

**The "means to know" exists, but the other side has to offer it.** The industry answer is an *idempotency key*: the client puts a unique number on the request, and the server remembers it, so a repeat of the same number does nothing a second time and answers like the first. Stripe, Adyen, PayPal and Amazon all work this way. It is a convention, not a law of HTTP: the IETF draft that would standardise it expired in April 2026 without becoming an RFC. Only the server can offer it; the client cannot force it.

**What barsy offers.** Only half of it, and only for a *new* bill. A new bill carries our `uuid`; a second request with the same `uuid` is refused and creates nothing. So a resend of a new bill is safe, and the refusal itself tells us "the first one landed". For *adding a round to an open bill* (`account_id`) nothing in the notes says the `uuid` protects it, and no call finds a bill or a round by our id. After a timeout Restro could read the bill back and recognise its own rows, **probably, not with certainty** (details in section 5).

**Recommendation:** each guest order goes in as its own new bill with our `uuid` (option b below). A timeout is then handled by sending the identical request again, which is safe whichever way the first attempt went. If after a short while nothing is confirmed, the guest sees "please call a waiter" and staff are alerted. Do not add rounds to an open bill until Lukanet answers the questions in section 7.

## 2. What the client knows in each case

HTTP status classes: "2xx ... successfully received, understood, and accepted"; "4xx ... the client seems to have erred"; "5xx ... the server is aware that it has erred or is incapable of performing the requested method" ([RFC 9110 section 15](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3)).

| What the client sees | What it knows | Could it have been processed without the client knowing? |
|---|---|---|
| **2xx** | The request was received and accepted. A plain 200 means it succeeded; a 202 means accepted but "processing has not been completed" and the standard has "no facility ... for re-sending a status code from an asynchronous operation" ([15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)). | No for 200/201. For 202, the outcome is still open. |
| **4xx** | The server judged the request faulty. Usually nothing was applied (a bad parameter, a refused right). | Not guaranteed by HTTP; each API documents it. Stripe says it caches the result of a 4xx that happened after execution began (so the error was a real outcome) and does not for errors before execution ([Stripe, errors](https://docs.stripe.com/error-low-level)). For barsy the error format is **unknown**. |
| **5xx** | The server failed. 500 is "an unexpected condition". 503 is "unable to handle the request due to a temporary overload" ([15.6.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4)). 504 means a gateway or proxy "did not receive a timely response from an upstream server" ([15.6.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.5)). | **Yes for 500, 502 and 504.** Stripe: treat a 500 as "indeterminate: the operation might have produced side effects even though you received an error" ([Stripe, server errors](https://docs.stripe.com/error-low-level)). A 504 says the proxy gave up waiting, not that the origin did nothing. 503 usually means it was not started, but HTTP does not promise it. |
| **Timeout before any answer** | Nothing. The request may be queued, running, finished with a lost answer, or never received. | **Yes.** "Restoring connectivity doesn't tell you whether the original request succeeded" ([Stripe](https://docs.stripe.com/error-low-level)). Our reading: giving up on the client side does not stop work the server already started. The IETF draft opens with exactly this case: "the client is left uncertain about the status of the resource" ([draft section 1](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07#section-1)). |
| **Connection dropped after the request was fully sent** | Nothing, same as a timeout. | **Yes.** RFC 9110 section 9.2.2 describes it: the connection "is closed before any response is received". |
| **Connection dropped in the middle of sending** | The server received an incomplete message. A server that gets one must treat it as incomplete: a message shorter than its declared length is "incomplete" and the connection is closed ([RFC 9112 section 6.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3), rule 6; [section 8](https://www.rfc-editor.org/rfc/rfc9112.html#section-8)). | Normally not processed, but the client cannot know how many bytes arrived, and the standard governs the HTTP layer, not what an application does. Treat it as unknown. |
| **Network error before sending** (no connection, name lookup failed, TLS failed) | Nothing reached the server. | No. Our reading: no request bytes were delivered, so a retry cannot duplicate anything. The sources do not spell this case out. |
| **Server closed an idle connection just as we sent** | The request was probably not read. | Possible. RFC 9112 section 9.5 describes the race: the client "might have started to send a new request at the same time that the server has decided to close the 'idle' connection" ([9.5](https://www.rfc-editor.org/rfc/rfc9112.html#section-9.5)). |

Summary: only a complete answer settles the question. The dangerous zone is exactly "request sent, no complete answer": timeout, drop after sending, and 500, 502, 504.

## 3. Standard ways to make a retry safe, and who must offer them

| Mechanism | How it works | Who must offer it | Source |
|---|---|---|---|
| **Idempotent methods** (GET, PUT, DELETE) | Repeating has the same effect as once, so retries are safe by definition. POST is not idempotent. | The API's design. The client cannot turn a POST into one. | [RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2). "A proxy MUST NOT automatically retry non-idempotent requests." |
| **Idempotency key** (client makes up a unique value, server remembers it) | First sight: process normally. Seen again after completion: answer with the result of the first one. Seen again while the first is still running: answer 409 "conflict". Same key with a different body: answer 422. | Both. The client creates the key; the server "MUST publish" the rules and manage the key's lifetime. "Without a priori knowledge, a general client cannot assume the server will respect" the header. | [IETF draft-ietf-httpapi-idempotency-key-header-07, sections 2.2 to 2.7](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07). The draft is expired (revision 07 of 2025-10-15, "Expired" on [datatracker](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)). |
| **Stripe** | Header `Idempotency-Key`, up to 255 characters, on all POST. Stripe stores the status and body of the first run and replays it on a repeat, including 500 errors; keys can be pruned after 24 hours; a different body under the same key is an error; a replay carries `Idempotent-Replayed: true`. Retrying a connection failure with the same key within 24 hours is the documented answer; after that, reconcile by reading the object. | The server. | [Stripe, idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Stripe, advanced error handling](https://docs.stripe.com/error-low-level) |
| **Adyen** | Header `Idempotency-Key`, at most 64 characters, valid 7 to 14 days; a repeat returns the first response "without duplication"; a duplicate sent while the first still runs may get 422 or 409 (error 704); retry only when the response header `transient-error` is true; use webhooks to catch lost responses. | The server. | [Adyen, API idempotency](https://docs.adyen.com/development-resources/api-idempotency) |
| **PayPal** | Header `PayPal-Request-Id` on POST, only on APIs that say they support it. A repeat returns the current status of the earlier request, not a second action. Their example: a capture that timed out after succeeding; the retry returned the capture and charged nothing twice. | The server, per API. | [PayPal, idempotency](https://developer.paypal.com/api/rest/reference/idempotency/) |
| **Amazon (EC2 ClientToken and the Builders' Library)** | Client supplies a unique request id. The server records the id and the changes together, as one unit. A repeat gets a "semantically equivalent" answer to the first, not an error like "already exists", so the caller can tell its own request succeeded. The id is kept "for the lifetime of the resource plus an interval". A reused id with different parameters is a validation error. | The server. | [AWS Builders' Library, Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) |
| **Client-generated id plus a look-up** ("did it land?") | The client puts its own id in the data (Stripe: a local id in `metadata`) and later reads the object back or gets a webhook. Reconciliation, not prevention. | The server must store and return the client's id on reads. | [Stripe, server errors](https://docs.stripe.com/error-low-level), [AWS](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) (the id also helps trace which request made a resource) |
| **Conditional request** (`If-Match` with an `ETag`) | The write applies only if the thing still looks as the client last saw it. After a first attempt that did land, the second fails (412), so a retry cannot duplicate. | The server (it must produce ETags and honour the header). | [RFC 9110 section 13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1). The same section 9.2.2 mentions "checking the target resource revision(s) after a failed connection" as a recovery. |
| **Read-back by state comparison** | Before the write, read the state. After a timeout, read again and see whether the write is in it. | No cooperation needed beyond a read call, but it is only as certain as the data allows (section 5). | [RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) ("some means to detect that the original request was never applied") |

Two rules every source repeats: the same key must go with the *same* body, and a retry must reuse the key, never mint a new one (Stripe: "A new key can start a second operation").

## 4. barsy: what the notes say and do not say

Source: Restro's notes on the signed-in reading of docs.lukanet.com, file `docs/research/2026-10-18-barsy-api-reference.md` on branch `origin/research/barsy-signed-in` (ticket #34; this file was not yet on `origin/ad/foundation`). The notes are Restro's summary of barsy's pages, not barsy's text; the barsy pages need a sign-in. Page URLs are barsy's, under `https://docs.lukanet.com/barsy.api/`.

Facts:

- `Accounts_place` "creates a new bill or continues an existing one (by `account_id`)", adds `orders`, and returns the bill's number ([methods/accounts/place.html](https://docs.lukanet.com/barsy.api/methods/accounts/place.html)).
- `account.uuid` is a "unique bill id for duplicate protection; generated by barsy when omitted"; it must be a valid UUID; "a second request with the same uuid returns an error and creates nothing" ([faq/41](https://docs.lukanet.com/barsy.api/faq/41-account-create-duplicate-protection.html), [place.html](https://docs.lukanet.com/barsy.api/methods/accounts/place.html)).
- No method reads a bill back by uuid: `AccountData` has no uuid field and `Accounts_getlist` has no uuid filter ([getlist.html](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html)).
- `Accounts_get` and `Accounts_getlist` accept `extra_properties` including `orders_history` ("every row") and `ref_id`, `remote_id` ([get.html](https://docs.lukanet.com/barsy.api/methods/accounts/get.html)). Each row (`OrderData`) has `order_id`, `account_id`, `article_id`, `amount`, `date`, `status`, `user_name` ("who placed it"), `served_date`, `served_by`, and `order_ref_id` (the row's id in an outside system; "how it is set is not stated").
- `AccountData.ref_id` is "the bill's id in a remote system; how it is set is not stated".
- `Accounts_getlist` can filter by `place_id`, `status` (open or closed), `create_date`, `last_order_date`, `user_id`, and returns `last_order_num`, `total_sum`, `total_remain` ([getlist.html](https://docs.lukanet.com/barsy.api/methods/accounts/getlist.html)).
- Bill-level free text: `account_alias` (shown in lists), `description` (printed on the receipt), `notes` (not printed); `Accounts_save_notes` edits notes without touching rows ([save_notes.html](https://docs.lukanet.com/barsy.api/methods/accounts/save_notes.html)).
- Writes need a registered cash desk assigned to the API user ([faq/91](https://docs.lukanet.com/barsy.api/faq/91-posnotfound.html)).

**Unknown (the notes are silent; do not assume):**

1. Whether `uuid` is checked or stored when `account_id` continues an existing bill. Nothing says a repeated round with the same `uuid` is refused. This is the key gap.
2. How a duplicate-`uuid` refusal looks: HTTP status, error code, text. Restro needs it to tell "duplicate, the first landed" from any other failure. The notes record no error format for barsy at all.
3. Whether the uuid check is race-free (two identical requests arriving together), how long a `uuid` is remembered, whether it is checked against closed bills, and whether it is global or per venue.
4. Whether an integrator can set `ref_id` or `order_ref_id` (the open question Q82.3), and whether a value set there would be returned by `Accounts_getlist`.
5. Whether `Accounts_place` is all-or-nothing: if it fails midway, can only some of the 4 rows be on the bill?
6. Whether the rows of one call share a timestamp or any marker that groups them as one round (`date` is a per-row field; "round" is not a barsy object in the notes).
7. How long a call can run before barsy answers, and whether barsy keeps processing after the client has hung up.
8. The HTTP verb and the status codes barsy uses; the notes name methods (`Accounts_place`) and show one PHP example with positional arguments, not a REST contract. Whether barsy honours an `Idempotency-Key` header: not stated, so assume no.
9. Whether the `description` of a row's `modificators` is free text that would show on the bar ticket (the notes say `mod_name`/`description` exist but are "undescribed"), which would make it a possible carrier for our id.
10. ETags or conditional writes: the notes mention none.

## 5. After a timeout, could Restro read the bill back and be sure?

Setup: before sending, Restro reads the bill and keeps the list of its rows with their `order_id`s. After the timeout it reads again (`Accounts_get` with `orders_history`) and compares.

**What the comparison can establish.**

- *New rows are present*, with the expected `article_id` and `amount`, a `date` after the send time, and `user_name` equal to Restro's own API user: Restro's round landed. This is **very probably right, not provable**. Staff cannot appear as Restro's API user, so a match on the API user is strong. The leftover risk is another Restro request on the same bill: two guests ordering the same beer in the same seconds. That risk is removable by Restro's own rule of one write in flight per bill (a lock on our side), then rows by the API user that appeared between the two readings can only be that round.
- *No new rows*: **cannot be treated as "it did not land"**. If barsy was only slow, the original call may still complete after the read-back, and a resend then doubles it. Sources: the timeout case above and Stripe's "restoring connectivity doesn't tell you whether the original request succeeded". Waiting longer and reading again lowers the risk but never reaches zero, because barsy's maximum processing time is unknown (item 7).
- *Some rows present, not all*: only if `Accounts_place` can fail partway (item 5, unknown).
- *The same article ordered by staff at the same moment*: the API-user match covers it; the match by article and quantity alone does not.

So: a read-back can **confirm** "yes, it landed" with high confidence under a one-write-per-bill rule. It cannot confirm "no, it did not land" with certainty. Certainty on "no" would need either a barsy-side guard (a `uuid`/`ref_id` on the round) or a bounded, documented barsy timeout.

**For a new bill with our `uuid` the position is better**, because the guard sits in barsy: a resend with the same `uuid` either succeeds (the first never landed) or is refused as a duplicate (the first landed). Both outcomes are certain, provided the refusal can be told apart from other errors (item 2) and the check is race-free (item 3). What Restro does not get is the original answer (the bill number), because the refusal is an error, not a replay of the first result. AWS describes the better design: return the equivalent first answer, "rather than an error", so the caller knows its own request created it ([AWS](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)). Restro would find the bill number by reading the table's open bills created after the send time and matching rows and API user: probable, not certain, but the bill already exists once, so the harm if matching fails is a missing status display, not a double order.

## 6. The options, in plain words

**(a) Never resend. After a timeout, read the bill back; if the round cannot be confirmed, tell the guest "please call a waiter".**
Safe against doubles. Cost: some guests see a failure for an order that did land, or that did not, and a waiter has to look. On a slow barsy night that could be often. It also never resolves the "no" case by itself.

**(b) Each guest order opens its own new POS bill, carrying our `uuid`.**
A resend of the identical request is safe: barsy refuses the second, so 4 beers can never become 8. The refusal means "it landed". Cost: many small bills on a table (waiters can merge them, barsy has merge-by-table; see Out-of-scope note); finding the bill number after a duplicate refusal is by matching, not by lookup; works only if the duplicate refusal is distinguishable (item 2) and race-free (item 3).

**(c) Add to the open bill, with a read-back check before any resend.**
Convenient for staff (one bill) but this is the weak spot: no barsy guard on rounds is documented; the read-back can confirm "landed" but never "not landed"; a resend after "no new rows" can still double. Not recommended until Lukanet confirms a guard.

**(d) Something better.**
- Combine (b) with (a) as the fall-back: send as a new bill with `uuid`; on timeout resend the same request with the same `uuid` for a short while (about a minute, matching Restro's existing plan); if still no clear yes/no, stop and show "please call a waiter" plus a staff alert. Never mint a new `uuid` for the same order.
- If Lukanet confirms that a round can carry its own guard (the `uuid` applies on `account_id` continuations, or Restro can set `order_ref_id` per row and read it back), option (c) becomes as safe as (b) and gives one bill per table.
- If Lukanet cannot offer either, a possible carrier for our id on a round is bill-level text (`notes`, not printed) or a row modifier description. Both are weak: bill text is shared by all rounds and can be edited by staff; a modifier description may print on the bar ticket (item 9). Treat as a last resort, not a plan.

**Recommendation: (b) now, with (a) as the fall-back inside it; ask Lukanet the questions below to make (c) possible later.** This matches the existing plan in the Restro notes (`docs/deliverables/2026-10-18-ordering-and-payment-processes.md`, item 22), which this research supports and does not change.

## 7. Questions for Lukanet that make the safest option possible

1. When `Accounts_place` is called with `account_id` and an `account.uuid` (or any other id of ours), does barsy refuse a repeat? Is the `uuid` stored per round or only for a new bill? (Decides whether (c) can ever be safe.)
2. What exactly does a duplicate-`uuid` refusal look like: HTTP status, error code and text, and does it say which bill already exists? Can it be told apart from every other error?
3. Is the `uuid` check atomic when two identical requests arrive at the same moment, how long is a `uuid` remembered, and does it cover closed bills? Is it global or per venue?
4. Can an integrator set `ref_id` on a bill and `order_ref_id` on a row (Q82.3), and does `Accounts_getlist` / `Orders_getlist` return them and filter by them? If yes, a lookup by our id replaces matching by rows and time.
5. Is `Accounts_place` all-or-nothing? If it fails or times out inside barsy, can some rows be saved?
6. What is the longest time a call can run inside barsy, and does barsy finish a call after the client has disconnected? (Tells us how long to wait before treating "no new rows" as final.)
7. Do the rows added in one `Accounts_place` call share a marker or timestamp that identifies them as one round?
8. Does barsy support any conditional write (an ETag or version on a bill)?
9. What HTTP status and body does barsy return on success, on a validation error and on an internal failure, so Restro can classify the 2xx / 4xx / 5xx cases above?

## 8. Out-of-scope observations

- Merging many small POS bills at payment is itself a write that can time out (`Accounts_merge`, `mergebyplaceid`); it needs the same read-back treatment. Restro's notes on this are in the bill-in-barsy research.
- A card capture after a POS timeout is the same problem with money attached; the payment side already requires a provider-side idempotency key (Stripe and Adyen support one, per section 3).

## 9. Sources

- RFC 9110, HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html (sections 9.2.1, 9.2.2, 13.1.1, 15.3 to 15.6)
- RFC 9112, HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html (sections 6.3, 8, 9.5)
- IETF draft, The Idempotency-Key HTTP Header Field, revision 07 (expired): https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- Stripe: https://docs.stripe.com/api/idempotent_requests and https://docs.stripe.com/error-low-level
- Adyen: https://docs.adyen.com/development-resources/api-idempotency
- PayPal: https://developer.paypal.com/api/rest/reference/idempotency/
- AWS Builders' Library: https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- barsy (Restro's notes of the signed-in reading, branch `origin/research/barsy-signed-in`, `docs/research/2026-10-18-barsy-api-reference.md`; pages under https://docs.lukanet.com/barsy.api/ : methods/accounts/place.html, get.html, getlist.html, save_notes.html; faq/41-account-create-duplicate-protection.html; faq/91-posnotfound.html)
