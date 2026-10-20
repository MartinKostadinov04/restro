# Weak signal in ordering apps

Made by: research subagent (Sonnet) for #40, 10-20.

Scope: what comparable ordering and shared-cart products do when the phone loses signal on the bag or bill screen, and whether cart edits show at once or after the server answers. Honest headline: no product in the list publishes its offline or optimistic-edit behaviour. What exists is general design guidance and API practice. Everything about specific products below is marked as such.

## Answer

- **Common practice (verified, general guidance):** keep the screen usable, say plainly what is wrong, switch off only what truly needs the network, and recover by itself when signal returns. Do not freeze the screen with a blocking pop-up.
- **When to show a notice:** only when a real request has failed or stalled, not when the browser says "offline". The browser flag is a hint and can be wrong for a long time (verified, MDN). No product states a delay in seconds (unknown). Recommendation: show a calm banner after a request fails, or has had no answer for about 5 seconds. Remove it on the next success.
- **Wording:** avoid the word "offline". Say what the guest can do: "Weak connection. Your bag is saved. We will keep trying." Pair text with an icon, not colour alone (verified, web.dev and Google design).
- **What to grey out:** the Send / Pay buttons, and any price that may be stale. Keep the bag visible and scrollable. Grey is read as "disabled", so add a short reason next to the button (verified, web.dev: its shop example disables the Buy button and prices, keeps browsing).
- **Queue or block Send:** block it. A queued "Send" the guest cannot see succeeding is dangerous in a nightclub: they may walk away believing drinks are coming. Recommendation: Send is allowed only when the last request worked; if the answer is lost mid-send, show "Not sure it went through" and check the table's orders before offering a second try. Web guidance favours queueing, but for messages and saves, not for money or orders (inferred).
- **Avoiding double orders:** the standard tool is an idempotency key. The phone makes one random id per Send and re-uses it on every retry; the server then returns the first result and never makes a second order. Stripe documents this; keys last at least 24 hours (verified). A "Send" button must be pressed once, then show "Sending..." until a real answer.
- **Cart edits (+1, remove):** recommendation: show the change at once, because a shared bag that waits for the server feels broken on a slow link. Mark it as "saving" (small spinner or faded line) until confirmed. If refused or timed out, put the old amount back and say why in one line next to that item. Optimistic is judged safe for private, low-conflict data and harmful where the server is unreliable (partly verified, see table); a shared bag has conflicts, so the server's answer always wins and the guest sees the corrected bag.
- **Never show a green "added" for something the server has not confirmed on Send itself.** This matches Restro's rule D72 (no local success), applied to Send and Pay; only the bag edits may be optimistic (inferred, Restro-specific).

## Evidence

| Product / source | What they do | Verified / Inferred |
|---|---|---|
| web.dev, offline UX guidelines | Features needing a connection can be disabled while the rest works (shop: prices and Buy button off). Queue actions and sync later. No blocking dialogs. Avoid the word "offline" for general audiences. Say whether the problem is the user's side or ours. Do not rely on grey alone. | Verified: https://web.dev/articles/offline-ux-design-guidelines |
| Google design, offline design | Pair an icon with a short text such as "no internet". Queue requests, then notify when the connection returns. Short one-line snackbar tied to the action. Silent on optimistic updates and poor (not absent) signal. | Verified: https://design.google/library/offline-design |
| Material Design offline states (M2) | Page could not be read by the fetch tool. Search summary only: show offline state when some features work and others do not. | Inferred (search summary): https://m2.material.io/design/communication/offline-states.html |
| MDN, navigator.onLine | The flag is "inherently unreliable"; may stay true after signal is lost; use it only as a hint, do not disable features from it. Confirm with a real request. | Verified: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine |
| Stripe, idempotent requests | One key per operation; retry after a connection error returns the saved result, no second object. Keys pruned after 24 hours or more; same key with different data is an error. | Verified: https://docs.stripe.com/api/idempotent_requests |
| NN/g, error messages | On mobile, avoid modal pop-ups for errors; a small toast at the bottom can go unnoticed. Nothing found on optimistic UI. | Verified (search summary): https://www.nngroup.com/articles/error-messages-scoring-rubric/ and https://www.nngroup.com/videos/error-messages-101/ |
| Apple HIG | Loading and Progress pages only: show progress so the app does not seem stalled. No offline page found. | Verified (search summary): https://developer.apple.com/design/human-interface-guidelines/progress-indicators |
| Optimistic UI, general | Update first, undo and tell the user on failure. Costs extra complexity; suited to private, low-conflict data; harmful if the server is unreliable. | Verified (secondary blogs): https://blog.vaadin.com/hilla/optimistic-ui-updates and https://uxplanet.org/optimistic-ui-34d9eefe4c05 |
| Wolt | Own blog says connections can drop and return suddenly and apps must cope; keep requests few. Nothing on the basket or checkout offline. | Verified, general only: https://careers.wolt.com/en/blog/tech/building-great-mobile-apps-tips-and-considerations |
| me&u | If an order cannot be passed to the venue's POS, the guest is told by text message and staff check live orders in the venue manager. Guest-side weak-signal behaviour not found. | Verified (staff training page): https://meandu.helpjuice.com/foh-staff-training/foh-staff-training-material |
| Toast Mobile Order & Pay | Help pages cover join-window limits (about 20 minutes) and setup errors, not signal loss. | Verified, but off-topic: https://support.toasttab.com/en/article/Unable-to-join-a-group-order-with-Toast-Mobile-Order-PayTM |
| Square Online, Sunday, Qerko | Nothing found about dropped signal. A Square community post mentioned a signal drop mid-order, but the page did not say what the guest saw. StoreHub (not on the list) says its QR ordering needs the POS online. | Inferred / unknown |
| Uber Eats, DoorDash, Deliveroo | No official write-up on cart sync or offline. A third-party design article describes "update locally, send later, last write wins" as an example, not their method. | Unknown |

## Unknowns

- How Uber Eats, DoorDash, Wolt, Deliveroo, Toast, Square, Sunday, Qerko and me&u behave in a real weak-signal test. The only way to learn is to try their guest flows on a throttled phone (a short field test).
- Any stated delay before an offline notice appears. None found; the 5-second figure above is our recommendation, not industry fact.
- Whether any of them queue an order while offline. Not documented.
- Whether any of them show cart edits before the server answers. Not documented.
- Material Design and Apple pages were read only through search summaries, so exact wording was not checked.
