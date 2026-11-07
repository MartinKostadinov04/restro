# What we need from the Zamboo API

Restro is a QR-to-phone ordering app: the guest scans the code on their table, sees the venue's menu and orders from their phone; when they pay, the venue's fiscal device has to print. That is why everything below is about tables, open bills and receipts.

We have read the published `Zamboo api v1` description in full (45 operations) and made read-only calls against the demo installation. The menu reads well. These eleven things we could not find. The last column is how barsy's API does the same thing, only as evidence that what we are asking for is ordinary.

| What we need | Not in the Zamboo API | barsy |
|---|---|---|
| The table a bill belongs to, and a venue's list of tables | No table field anywhere; the word is not in the description | `Places_getlist`; a bill carries `place_id` |
| Read a table's open bills, with rows, total, paid and owed | No endpoint returns a bill — `GetOrderSales` is a date-range sales report | `Accounts_getlist` by table and open status |
| Add a round to a bill that is already open | `SaveOrder` always creates a new standalone sale | `Accounts_place` with the bill's id appends to it |
| The POS prices the order and gives us the total back | `price` is required on every row; no call returns the applied total | No price sent = current price; the bill reads back its final total |
| Close a bill with a payment and return the fiscal receipt | No close, no fiscal device, only an operation GUID comes back | `Accounts_close` prints on the fiscal device; the sale number reads back |
| Split a bill, merge a table's bills, move a bill | Nothing moves rows between bills | `Accounts_divide`, `Accounts_merge`, `Accounts_move` |
| Cancel a row, or reverse a bill already closed | No cancel and no storno | A reason on the order; `Accounts_storno` with the Н-18 reasons |
| Ask whether an order can be taken right now | `/api/Test` is a liveness ping; no cash desk, cash period or device state | `Poses_getcurrent`: the cash desk and the fiscal printer's state |
| Which options an item allows | Modifier sets exist, but nothing links a set to an item | `Articlesupplements_get`: an item's option groups, with min and max |
| Allergens per item | `GetAllergens` answers `204` with no body | `Articledetails_gettree` carries "Алергени" |
| Whether an item may be sold | `GetMaterialAvailablity` returns a bare number — `0.0` for a drink on sale at a normal price | A for-sale flag per venue on `Articles_getlist` |

Your own Zamboo web interface applies actions to an open bill, so this exists in your product. **Our question is whether there is a second interface for tables and open bills, and whether you will open it to us.** Where the answer is "it already does that", the work is ours — we need the documentation and permission, nothing more.

## Three questions outside the API

- **Authorisation.** Under Наредба Н-18, чл. 52з, ал. 5 a venue may not add an outside module to registered sales software without the producer's written authorisation, and Приложение 32, т. 17 asks the venue to declare its links. Will you authorise Restro at your customers' venues, on what terms and at what price, and what does the venue declare?
- **A sandbox.** Is `demorestaurant.zamboo.bg` a test installation we may write test orders to? We have only read from it so far.
- **Keys.** One key today reads a venue's whole customer base by phone, email or card and can delete customers and cards, and it travels in the query string. Are keys with a limited scope possible, and can a key be sent in a header?

## Four small things we hit

- An empty result comes back as `204` with no body rather than an empty list.
- The `ResError` body is a double-encoded JSON string, so it unwraps twice.
- `GetMealPlans` has no date filter and returned 49.7 MB on the demo restaurant.
- `GetItemContent` answered `404` for every item we tried.

One thing you got right that we would keep: the `409` when an order repeats an `ExtId`. If the same guard applies to adding a round to a bill, most of an integration's reliability problems are solved.
