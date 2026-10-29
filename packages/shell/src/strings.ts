// The few words the shell itself puts on a menu: allergen and dietary names, "from …", "Ask your
// waiter", sold out, "from 18:00", yes/no and measurement units. Menu text never comes from here
// (it comes from the snapshot's localized texts). The shell is pure and has no next-intl, so the
// tables for the two pilot languages (BG, EN) live here; every other locale reads the English one.

import type { Allergen, DietaryLabel, Locale, MeasurementUnit } from '@restro/core'

import type { ServiceKind } from './features'
import type { BillLineStatus, GuestRefusalCode, PayEnd, RequestStatus } from './service-vocabulary'

/**
 * The words of a guest page that are not menu text (S3-03: the phone face and its loader). Menu
 * text never comes from here; these are the controls and the messages around it.
 */
export interface GuestStrings {
  /** The banner for a known table: "Table 12". A label that is not a plain number is shown as it is. */
  readonly table: (label: string) => string
  /** The page's heading for a screen reader when the menu has no title of its own. */
  readonly menu: string
  readonly language: string
  readonly sections: string
  readonly filters: string
  /** The line under the title of the filter sheet. */
  readonly filterIntro: string
  readonly filterAll: string
  readonly filterDiet: string
  readonly filterTags: string
  readonly noMatches: string
  readonly clearFilters: string
  readonly more: string
  readonly less: string
  readonly allergens: string
  readonly allergensTitle: string
  readonly allergensHint: string
  readonly footerTitle: string
  readonly footerText: string
  readonly close: string
  /** The close control of a dish page: it goes back to the menu. */
  readonly back: string
  /** The name of the control that switches how the menu is laid out. */
  readonly layout: string
  readonly layoutList: string
  readonly layoutOne: string
  readonly layoutTwo: string
  readonly loading: string
  /** "Menu from 18:00": the whole menu is outside its schedule. */
  readonly menuSchedule: (when: string) => string
  readonly notFoundTitle: string
  readonly notFoundText: string
  readonly notPublishedTitle: string
  readonly notPublishedText: string
  readonly loadFailedTitle: string
  readonly loadFailedText: string
  readonly retry: string
}

/**
 * The words of the service screens (D71): the bag, the table bill, calling a waiter, paying and
 * the receipt. Like the guest strings, they are interface words; menu text never comes from here.
 */
export interface ServiceStrings {
  /** The small label on every service sheet in the admin's preview with demo data. */
  readonly preview: string
  /** "approx.": a total the face added up itself, until the host's quote exists. */
  readonly approx: string
  readonly addNamed: (name: string) => string
  readonly increase: string
  readonly decrease: string
  readonly quantity: string
  // The dish page.
  readonly required: string
  readonly optional: string
  readonly pickOne: string
  readonly pickUpTo: (max: number) => string
  readonly pickAtLeast: (min: number) => string
  readonly note: string
  readonly notePlaceholder: string
  readonly addToBag: string
  // The bag.
  readonly bag: string
  readonly viewBag: string
  readonly emptyBag: string
  readonly remove: string
  readonly edit: string
  readonly sendToKitchen: string
  readonly estimateTotal: string
  /** The host accepted the order (shown when the venue shows no bill to open instead). */
  readonly sent: string
  readonly sentHint: string
  readonly sending: string
  /** The host has the order but has not said yes or no yet. */
  readonly sendReceived: string
  /** The answer did not arrive (an error or a timeout): the order may or may not have gone. */
  readonly sendFailedTitle: string
  readonly sendFailedHint: string
  /** The host said no and gave no reason. */
  readonly sendRejectedTitle: string
  readonly sendRejectedHint: string
  readonly unavailableLine: string
  readonly unavailableHint: string
  readonly reference: (ref: string) => string
  readonly retry: string
  // The table bill.
  readonly bill: string
  readonly tab: string
  readonly tabIntro: string
  readonly emptyTab: string
  readonly round: string
  readonly fromApp: string
  readonly fromWaiter: string
  readonly lineStatus: { readonly [S in BillLineStatus]: string }
  readonly tableTotal: string
  readonly pay: string
  // Calling a waiter.
  readonly callServer: string
  /** The label of the waiter button before the bag has anything in it. */
  readonly bell: string
  readonly kinds: { readonly [K in ServiceKind]: string }
  readonly otherPlaceholder: string
  readonly send: string
  readonly requesting: string
  readonly requestFailed: string
  readonly requestStates: {
    readonly [S in RequestStatus]: { readonly title: string; readonly hint: string }
  }
  readonly cancelRequest: string
  readonly newRequest: string
  // Paying.
  readonly payTitle: string
  readonly tip: string
  readonly total: string
  readonly nothingToPay: string
  readonly done: string
  readonly table: string
  // The table's shared order (#75).
  readonly tableOrder: string
  readonly emptyOrder: string
  /** A line drawn before the server answered. */
  readonly saving: string
  /** "Burger removed", with its Undo. */
  readonly removedNamed: (name: string) => string
  readonly undo: string
  /** The order set aside when nobody touched it for a while. */
  readonly earlierOrder: string
  readonly restore: string
  /** A pay-first item: it is not ordered from the phone. */
  readonly orderFromWaiter: string
  /** A bill line with no item of ours. */
  readonly otherItem: string
  /** A line held by a payment. */
  readonly heldLine: string
  /** Ordering is paused (staff, Restro, the connection, the table; #79): the order is kept. */
  readonly orderingPaused: string
  readonly orderingClosed: string
  /** The last-orders notice, shown 10 minutes before them (#82): "Last orders at 04:30". */
  readonly lastOrdersAt: (time: string) => string
  /** After last orders, and all night on a closed weekday (#82). */
  readonly orderingClosedTonight: string
  /** Before the venue opens for phones (#82). */
  readonly orderingOpensAt: (time: string) => string
  /** The phone has not reached the server for a while (a weak signal): nothing new was sent. */
  readonly offline: string
  // The location check (#76, D119, D122 §4). The consent words are versioned by core's
  // `LOCATION_CONSENT_VERSION`: changing them means raising it, so phones are asked again.
  /** The consent screen's text, naming the venue. */
  readonly locationConsent: (venue: string) => string
  readonly locationAllow: string
  readonly locationNotNow: string
  readonly locationChecking: string
  /**
   * The failed check's heading; it offers `locationCallWaiter` (where the venue takes calls) or
   * the still card `locationOrderFromWaiter` (where it does not), and `locationCancel`.
   */
  readonly locationFailed: string
  /** The failed check's small print: why, and how to allow location next time. */
  readonly locationWhy: string
  readonly locationCallWaiter: string
  /** The still card where the venue takes no waiter calls (D122 §4): never a button. */
  readonly locationOrderFromWaiter: string
  readonly locationCancel: string
  /** Where the venue checks and the phone isn't located yet: why the order and bill are hidden. */
  readonly locationNeeded: string
  /** The guest's own tap that reopens the consent screen after "Not now". */
  readonly locationAllowAgain: string
  // Send and its states (#77, D116, D122 §5).
  /** The Send button: "Send 3 items". */
  readonly sendItems: (count: number) => string
  /** A Send on its way, on the sending phone only. */
  readonly sendingNow: string
  /** A sent order in flight, on the other phones. */
  readonly beingSent: string
  readonly sentAdded: string
  /** A pay-first round on the POS whose card was not charged ("No receipt", Martin 10-29). */
  readonly sentUnpaid: string
  /** Only where the POS approves orders at the bar. */
  readonly sentAwaitingApproval: string
  readonly sentNotSent: string
  /** Not sent because ordering paused (an order behind an Unconfirmed one, or a pause). */
  readonly sentNotSentPaused: string
  /** Not sent because only a waiter opens the table's POS bill (`needs_first_item`, D115). */
  readonly sentNotSentFirstItem: string
  /** "Not confirmed: show K7Q to your waiter", for 15 minutes on every phone. */
  readonly sentUnconfirmed: (ref: string) => string
  /** Opens the panel any phone can show a waiter: the items, the time and the reference. */
  readonly showWaiter: string
  readonly showWaiterClose: string
  /** A Send refused for one item: names it. */
  readonly itemUnavailableNamed: (name: string) => string
  // Send's guards (#78, D117, D122 §4).
  /** The duplicate check: "Same as 4 minutes ago. Send another?" (closes after 60 s). */
  readonly duplicateAsk: (minutes: number) => string
  /** Sends the same round again, as a new action. */
  readonly sendAnother: string
  /** Closes the duplicate check: back to the order. */
  readonly duplicateCancel: string
  /** A line the menu shows sold out: it stays on the order, greyed, and is not sent. */
  readonly lineSoldOut: string
  /** The Send button when sold-out lines stay behind: "Send the other 4". */
  readonly sendOthers: (count: number) => string
  /** Where the POS doesn't take notes and options: the fixed line instead of a note field. */
  readonly notesAtStaff: string
  /** Not sent because the POS said items ran out (#80): nothing was sent, the rest can go. */
  readonly sentNotSentOutOfStock: string
  /** Why a command was refused, by code; `refusedOther` for any other code. */
  readonly refusals: { readonly [C in Exclude<GuestRefusalCode, 'below_minimum'>]: string }
  readonly refusedOther: string
  /** The bill screen and paying from it (#114; the guide's "Guest words: the bill and paying"). */
  readonly paying: PayingStrings
}

/**
 * The words of the bill screen and of paying (#45, D127; the table in
 * `docs/guides/menu-template-functionality.md` → "Guest words: the bill and paying", Martin read
 * them 10-28). An amount is the text of a `ViewMoney`: "27,50 EUR" or "27.50 EUR".
 */
export interface PayingStrings {
  readonly billTitle: string
  readonly updated: (seconds: number) => string
  readonly stale: (seconds: number) => string
  readonly beingPaid: string
  readonly leftToPay: string
  readonly emptyBill: string
  readonly payOpen: string
  readonly askWaiterToPay: string
  readonly pickTitle: string
  readonly wholeBill: string
  readonly tipLabel: string
  readonly tipOther: string
  readonly yourItems: string
  readonly tip: string
  readonly total: string
  readonly payX: (amount: string) => string
  readonly legalPrices: string
  readonly legalProcessor: (processor: string, venue: string) => string
  readonly belowMinimum: (min: string) => string
  readonly notUpToDate: string
  readonly cardsPaused: string
  readonly nothingPicked: string
  readonly sameQuestion: (minutes: number) => string
  readonly sameYes: string
  readonly sameNo: string
  readonly preparing: string
  readonly payLater: string
  readonly waiting: string
  readonly paid: string
  readonly paidNumber: string
  readonly paidReceipt: string
  /** The bill's section of lines paid in the app in this sitting (D127 1.2). */
  readonly paidInApp: string
  /** The Paid screen's button and the title of the Payment confirmation (D127 1.4). */
  readonly confirmTitle: string
  readonly paidByCard: string
  /** "This is not your receipt. Your waiter brings the venue's receipt." */
  readonly confirmNotReceipt: string
  /** The same line where an electronic receipt went to an email (#186). */
  readonly confirmReceiptEmailed: (email: string) => string
  readonly confirmSave: string
  /**
   * A Save that failed (the lead's words, awaiting Martin 10-30). No "Saved" line exists: the
   * phone's share sheet or download already shows it worked.
   */
  readonly confirmSaveFailed: string
  readonly backToBill: string
  readonly checkingTitle: string
  readonly checkingBody: string
  /** Ended with nothing charged, by how it ended. */
  readonly ended: { readonly [E in Exclude<PayEnd, 'below_minimum'>]: string }
  /** Released after the pricing, below the venue's smallest card payment (`min` the amount). */
  readonly endedBelowMinimum: (min: string) => string
  readonly payAgain: string
  readonly locationTitle: string
  readonly locationBody: string
  readonly allowLocation: string
  readonly callWaiter: string
  /** Pay: "Too many tries. Wait a moment and try again." (the guide's `rate_limited`). */
  readonly rateLimited: string
  /** The greyed Pay's reason when the tip is more than the amount (Martin 10-29). */
  readonly tipTooBig: string
  /** What the card form says when it could not load (Martin 10-29). */
  readonly cardFormFailed: string
}

/** The words of one language. `lang` is the language the strings are really in. */
export interface Strings {
  readonly lang: Locale
  readonly newBadge: string
  readonly askWaiter: string
  readonly soldOut: string
  readonly unavailable: string
  readonly yes: string
  readonly no: string
  /** "from 12,50 €": the price prefix (R4). */
  readonly fromPrice: (amount: string) => string
  /** "from 18:00" (R1). */
  readonly scheduledFrom: (time: string) => string
  /** "tomorrow from 18:00". */
  readonly scheduledTomorrow: (time: string) => string
  /** "Fri from 18:00". */
  readonly scheduledOnDay: (day: string, time: string) => string
  readonly units: { readonly [U in MeasurementUnit]: string }
  readonly allergens: { readonly [A in Allergen]: string }
  readonly dietary: { readonly [D in DietaryLabel]: string }
  readonly guest: GuestStrings
  readonly services: ServiceStrings
}

const EN: Strings = {
  lang: 'en_US',
  newBadge: 'New',
  askWaiter: 'Ask your waiter',
  soldOut: 'Sold out',
  unavailable: 'Unavailable',
  yes: 'Yes',
  no: 'No',
  fromPrice: (amount) => `from ${amount}`,
  scheduledFrom: (time) => `from ${time}`,
  scheduledTomorrow: (time) => `tomorrow from ${time}`,
  scheduledOnDay: (day, time) => `${day} from ${time}`,
  units: { g: 'g', kg: 'kg', ml: 'ml', l: 'l', cl: 'cl', pcs: 'pcs' },
  allergens: {
    gluten: 'Gluten',
    crustaceans: 'Crustaceans',
    eggs: 'Eggs',
    fish: 'Fish',
    peanuts: 'Peanuts',
    soybeans: 'Soybeans',
    milk: 'Milk',
    nuts: 'Nuts',
    celery: 'Celery',
    mustard: 'Mustard',
    sesame: 'Sesame',
    sulphites: 'Sulphites',
    lupin: 'Lupin',
    molluscs: 'Molluscs',
  },
  dietary: {
    vegan: 'Vegan',
    vegetarian: 'Vegetarian',
    gluten_free: 'Gluten-free',
    lactose_free: 'Lactose-free',
    halal: 'Halal',
    kosher: 'Kosher',
  },
  guest: {
    table: (label) => (/^\d+[A-Za-z]?$/.test(label) ? `Table ${label}` : label),
    menu: 'Menu',
    language: 'Language',
    sections: 'Menu sections',
    filters: 'Filter the menu',
    filterIntro: 'Choose one or more labels.',
    filterAll: 'All',
    filterDiet: 'Diet',
    filterTags: 'Tags',
    noMatches: 'Nothing on the menu matches these filters.',
    clearFilters: 'Clear filters',
    more: 'More',
    less: 'Less',
    allergens: 'Allergens',
    allergensTitle: 'Allergens',
    allergensHint: 'Tap a code to see what it stands for.',
    footerTitle: 'Allergen information',
    footerText:
      'The codes on each item stand for the allergens it contains. Ask the staff if you have an allergy or any doubt.',
    close: 'Close',
    back: 'Back to menu',
    layout: 'Menu layout',
    layoutList: 'List',
    layoutOne: '1 column',
    layoutTwo: '2 columns',
    loading: 'Loading the menu',
    menuSchedule: (when) => `Menu ${when}`,
    notFoundTitle: 'This menu is not available',
    notFoundText: 'Check the link, or ask the staff for the right code.',
    notPublishedTitle: 'This menu is not published yet',
    notPublishedText: 'Please come back in a little while.',
    loadFailedTitle: 'The menu could not be loaded',
    loadFailedText: 'Check your connection and try again.',
    retry: 'Try again',
  },
  services: {
    preview: 'Preview',
    approx: 'approx.',
    addNamed: (name) => `Add ${name}`,
    increase: 'One more',
    decrease: 'One less',
    quantity: 'Quantity',
    required: 'Required',
    optional: 'Optional',
    pickOne: 'Choose 1',
    pickUpTo: (max) => `Choose up to ${max}`,
    pickAtLeast: (min) => `Choose at least ${min}`,
    note: 'Note for the kitchen',
    notePlaceholder: 'e.g. no onion, sauce on the side',
    addToBag: 'Add to bag',
    bag: 'Your bag',
    viewBag: 'View bag',
    emptyBag: 'Your bag is empty. Add something from the menu.',
    remove: 'Remove',
    edit: 'Edit',
    sendToKitchen: 'Send to kitchen',
    estimateTotal: 'Total (approx.)',
    sent: 'Sent to the kitchen',
    sentHint: 'Your order has been received.',
    sending: 'Sending your order',
    sendReceived: 'Your order is received. We are waiting for the kitchen to confirm it.',
    sendFailedTitle: 'Your order was not confirmed',
    sendFailedHint: 'Nothing is lost: your bag is still here. Try again, or ask your waiter.',
    sendRejectedTitle: 'The kitchen could not take your order',
    sendRejectedHint: 'Your bag is still here. Ask your waiter.',
    unavailableLine: 'No longer available',
    unavailableHint: 'Remove the items that are no longer available to send your order.',
    reference: (ref) => `Reference ${ref}`,
    retry: 'Try again',
    bill: 'Bill',
    tab: 'Table order',
    tabIntro: 'Everything ordered at this table, from the app and from the waiter.',
    emptyTab: 'Nothing has been ordered yet.',
    round: 'Round',
    fromApp: 'From the app',
    fromWaiter: 'From the waiter',
    lineStatus: {
      received: 'Received',
      preparing: 'Preparing',
      served: 'Served',
      cancelled: 'Cancelled',
    },
    tableTotal: 'Table total',
    pay: 'Pay',
    callServer: 'Call a server',
    bell: 'Waiter',
    kinds: {
      waiter: 'Call waiter',
      bill: 'Bring the bill',
      ice: 'Ice',
      water: 'Water',
      glasses: 'Glasses',
      clean_table: 'Clean the table',
      terminal: 'Card terminal',
    },
    otherPlaceholder: 'Tell us what you need',
    send: 'Send',
    requesting: 'Sending your request',
    requestFailed: 'Your request did not go through. Try again, or call a waiter over.',
    requestStates: {
      sent: { title: 'Request sent', hint: 'We are waiting for the team to confirm it.' },
      accepted: { title: 'The team has your request', hint: 'You can keep browsing.' },
      on_the_way: {
        title: 'A waiter is on the way',
        hint: 'You can keep browsing. We let the team know.',
      },
      done: { title: 'Done', hint: 'The team has taken care of your request.' },
      cancelled: { title: 'Request cancelled', hint: 'You can send a new one.' },
      rejected: { title: 'The team could not take this request', hint: 'Ask your waiter.' },
    },
    cancelRequest: 'Cancel request',
    newRequest: 'Send another request',
    payTitle: 'Pay',
    tip: 'Tip for the team',
    total: 'Total',
    nothingToPay: 'There is nothing to pay yet.',
    done: 'Back to menu',
    table: 'Table',
    tableOrder: 'Table order',
    emptyOrder: 'Nothing on the table order yet.',
    saving: 'Saving…',
    removedNamed: (name) => `${name} removed`,
    undo: 'Undo',
    earlierOrder: 'Earlier order',
    restore: 'Restore',
    orderFromWaiter: 'Order this from your waiter',
    otherItem: 'Other item',
    heldLine: 'Being paid',
    orderingPaused: 'Ordering is paused right now, please order from a waiter.',
    orderingClosed: 'This table is not taking orders from phones right now.',
    lastOrdersAt: (time) => `Last orders at ${time}`,
    orderingClosedTonight: 'Ordering from phones has closed for tonight',
    orderingOpensAt: (time) => `Ordering from phones opens at ${time}`,
    offline: 'Weak connection. Nothing new was sent yet, we keep trying.',
    locationConsent: (venue) =>
      `${venue} and Restro check your location so only guests at the table can see and order onto its bill. Never stored. You can stop anytime and order from your waiter instead.`,
    locationAllow: 'Allow',
    locationNotNow: 'Not now',
    locationChecking: 'Checking your location…',
    locationFailed: 'We could not confirm you are at the venue.',
    locationWhy:
      'Your phone did not share a precise location, or it showed you elsewhere. To try again, allow location for this page and turn on precise location.',
    locationCallWaiter: 'Call a waiter',
    locationOrderFromWaiter: 'Please order from your waiter',
    locationCancel: 'Cancel',
    locationNeeded: 'Allow location to see and add to your table’s order and bill.',
    locationAllowAgain: 'Allow location',
    sendItems: (count) => (count === 1 ? 'Send 1 item' : `Send ${count} items`),
    sendingNow: 'Sending…',
    beingSent: 'Being sent',
    sentAdded: 'Added to your bill',
    sentUnpaid: 'Ordered, not paid: pay your waiter',
    sentAwaitingApproval: 'Waiting for the bar to take it',
    sentNotSent: 'We couldn’t send your order, please call a waiter.',
    sentNotSentPaused: 'Ordering is paused, please call a waiter.',
    sentNotSentFirstItem: 'Ask your waiter to put your first item on, then send again.',
    sentUnconfirmed: (ref) => `Not confirmed: show ${ref} to your waiter`,
    showWaiter: 'Show this to your waiter',
    showWaiterClose: 'Close',
    itemUnavailableNamed: (name) => `${name} is no longer available. Remove it and send again.`,
    duplicateAsk: (minutes) =>
      minutes < 1
        ? 'Same as a moment ago. Send another?'
        : minutes === 1
          ? 'Same as 1 minute ago. Send another?'
          : `Same as ${minutes} minutes ago. Send another?`,
    sendAnother: 'Send another',
    duplicateCancel: 'Cancel',
    lineSoldOut: 'Sold out',
    sendOthers: (count) => `Send the other ${count}`,
    notesAtStaff: 'Allergies or special requests? Tell the staff.',
    sentNotSentOutOfStock: 'Nothing was sent: something ran out. Send the rest when you’re ready.',
    refusals: {
      order_changed: 'Someone at your table changed this. Here is the latest order.',
      line_held: 'This is being paid and can no longer change.',
      undo_expired: 'It is too late to undo that.',
      order_full: 'The order is full. Send it or remove something first.',
      quantity_limit: 'That is as many as one line can hold.',
      stale_action: 'That took too long to arrive. Try again.',
      rate_limited: 'Too many changes at once. Wait a moment.',
      table_not_open: 'This table is not taking orders from phones right now.',
      code_retired: 'This table code has changed. Scan the code on your table again.',
      location_needed: 'Allow location to order onto the bill.',
      location_failed: 'We could not confirm you are at the venue.',
      human_check: 'We could not check this request. Try again.',
      ordering_paused: 'Ordering is paused, please call a waiter.',
      ordering_closed: 'Ordering from phones is closed right now. Please order from a waiter.',
      menu_unavailable: 'The menu is being updated. Try again in a moment.',
      order_empty: 'There is nothing to send yet.',
      item_unavailable: 'Something in your order is no longer available. Remove it and send again.',
      order_from_waiter: 'Something in your order has to be ordered from your waiter.',
      needs_first_item: 'Ask your waiter to put your first item on, then send again.',
      duplicate_order: 'Your table sent the same order a few minutes ago.',
      guard_tripped: 'Ask your waiter to take this order.',
      paying_not_offered: 'Ask your waiter to pay.',
      paying_paused: 'Card payments are paused right now. Ask your waiter.',
      being_paid: 'Someone is already paying for this line.',
      bill_changed: 'Your bill changed since you opened it.',
      ask_waiter_to_split: 'Ask your waiter to split this bill.',
      turnstile: 'We couldn’t check this request. Try again.',
      sitting_ended:
        'Your visit at this table has ended. If you’re still here, scan the code again.',
      too_late: 'Too late to cancel: the payment is being processed.',
      unknown_payment: 'We can’t find this payment. Ask your waiter.',
      // Martin 10-29.
      tip_not_offered: 'A tip can’t be added right now. Pay without a tip.',
      not_built: 'This is not available yet.',
    },
    refusedOther: 'That did not work. Try again.',
    paying: {
      billTitle: 'Your table’s bill',
      updated: (seconds) => `Updated ${seconds} s ago`,
      stale: (seconds) => `Not up to date · updated ${seconds} s ago`,
      beingPaid: 'Being paid',
      leftToPay: 'Left to pay',
      emptyBill: 'Nothing on your bill yet',
      payOpen: 'Pay',
      askWaiterToPay: 'Ask your waiter to pay.',
      pickTitle: 'What are you paying for?',
      wholeBill: 'The whole bill',
      tipLabel: 'Tip: goes to the venue',
      tipOther: 'Other amount',
      yourItems: 'Your items',
      tip: 'Tip',
      total: 'Total',
      payX: (amount) => `Pay ${amount}`,
      legalPrices: 'Prices in EUR incl. VAT. Complaints and refunds: the venue.',
      legalProcessor: (processor, venue) => `Payment processed by ${processor} for ${venue}.`,
      belowMinimum: (min) => `Card payments start at ${min}. Add an item or ask your waiter.`,
      notUpToDate: 'We can’t read the bill right now. We keep trying.',
      cardsPaused: 'Card payments are paused right now. Ask your waiter.',
      nothingPicked: 'Choose at least one line.',
      sameQuestion: (minutes) => `Same amount as ${minutes} minutes ago. Pay again?`,
      sameYes: 'Yes, pay',
      sameNo: 'Back',
      preparing: 'Preparing your bill…',
      payLater: 'Pay later',
      waiting: 'Processing your payment…',
      paid: 'Paid',
      paidNumber: 'Payment number',
      paidReceipt: 'Show this number to your waiter. Your waiter brings your receipt.',
      paidInApp: 'Paid in the app',
      confirmTitle: 'Payment confirmation',
      paidByCard: 'Paid by card',
      confirmNotReceipt: 'This is not your receipt. Your waiter brings the venue’s receipt.',
      confirmReceiptEmailed: (email) =>
        `This is not your receipt. Your receipt was sent to ${email}.`,
      confirmSave: 'Save',
      confirmSaveFailed: 'Couldn’t save. Try again.',
      backToBill: 'Back to the bill',
      checkingTitle: 'The venue is checking the payment',
      checkingBody: 'You don’t need to do anything. If you have a question, call a waiter.',
      ended: {
        busy: 'Paying in the app is busy, try again in a minute or call a waiter.',
        paying_paused: 'Card payments are paused right now. Nothing was charged. Ask your waiter.',
        check_failed:
          'Your bill changed just before paying. Nothing was charged. Check the bill and try again.',
        isolate_refused: 'We couldn’t prepare this payment. Nothing was charged. Ask your waiter.',
        no_receipt:
          'The payment wasn’t completed. Nothing was charged. Any amount your bank reserved will be released.',
        expired: 'Your time ran out. Nothing was charged.',
        // The guide has no words of its own for a payment the guest cancelled or for a pay-first
        // release it has not worded yet (the lead drafts them): the calm general ones, true
        // wherever a payment was released.
        // Martin 10-29: the guest's own cancel, the pay-first release reasons, paying switched
        // off, and a pay-first round that reached the till and ended "No receipt".
        cancelled: 'Payment cancelled. Nothing was charged.',
        enter_refused: 'We couldn’t send this order. Nothing was charged. Please call a waiter.',
        item_unavailable:
          'Something ran out, so nothing was sent and nothing was charged. Pay for the rest when you’re ready.',
        paying_off: 'Ask your waiter to pay.',
        pay_first_unpaid:
          'Nothing was charged. Your order went through, and your waiter will take the payment.',
        other: 'We couldn’t prepare this payment. Nothing was charged. Ask your waiter.',
      },
      endedBelowMinimum: (min) =>
        `Card payments start at ${min}. Nothing was charged. Add an item or ask your waiter.`,
      rateLimited: 'Too many tries. Wait a moment and try again.',
      tipTooBig: 'The tip can’t be more than the amount you’re paying.',
      cardFormFailed: 'The card form didn’t load. Try again or ask your waiter.',
      payAgain: 'Pay again',
      locationTitle: 'The bill shows only at the table',
      locationBody:
        'Allow location so we know you’re at the table. Otherwise your waiter tells you the total.',
      allowLocation: 'Allow location',
      callWaiter: 'Call a waiter',
    },
  },
}

const BG: Strings = {
  lang: 'bg_BG',
  newBadge: 'Ново',
  askWaiter: 'Попитайте сервитьора',
  soldOut: 'Изчерпано',
  unavailable: 'Недостъпно',
  yes: 'Да',
  no: 'Не',
  fromPrice: (amount) => `от ${amount}`,
  scheduledFrom: (time) => `от ${time}`,
  scheduledTomorrow: (time) => `утре от ${time}`,
  scheduledOnDay: (day, time) => `${day} от ${time}`,
  units: { g: 'гр', kg: 'кг', ml: 'мл', l: 'л', cl: 'cl', pcs: 'бр.' },
  allergens: {
    gluten: 'Глутен',
    crustaceans: 'Ракообразни',
    eggs: 'Яйца',
    fish: 'Риба',
    peanuts: 'Фъстъци',
    soybeans: 'Соя',
    milk: 'Мляко',
    nuts: 'Ядки',
    celery: 'Целина',
    mustard: 'Синап',
    sesame: 'Сусам',
    sulphites: 'Сулфити',
    lupin: 'Лупина',
    molluscs: 'Мекотели',
  },
  dietary: {
    vegan: 'Веган',
    vegetarian: 'Вегетарианско',
    gluten_free: 'Без глутен',
    lactose_free: 'Без лактоза',
    halal: 'Халал',
    kosher: 'Кашер',
  },
  guest: {
    table: (label) => (/^\d+[A-Za-z]?$/.test(label) ? `Маса ${label}` : label),
    menu: 'Меню',
    language: 'Език',
    sections: 'Раздели на менюто',
    filters: 'Филтриране на менюто',
    filterIntro: 'Изберете един или повече етикети.',
    filterAll: 'Всички',
    filterDiet: 'Диета',
    filterTags: 'Етикети',
    noMatches: 'Нищо от менюто не отговаря на тези филтри.',
    clearFilters: 'Изчисти филтрите',
    more: 'Още',
    less: 'По-малко',
    allergens: 'Алергени',
    allergensTitle: 'Алергени',
    allergensHint: 'Докоснете код, за да видите какво означава.',
    footerTitle: 'Информация за алергените',
    footerText:
      'Кодовете при всяка позиция обозначават алергените в нея. Попитайте персонала, ако имате алергия или съмнение.',
    close: 'Затвори',
    back: 'Обратно към менюто',
    layout: 'Изглед на менюто',
    layoutList: 'Списък',
    layoutOne: '1 колона',
    layoutTwo: '2 колони',
    loading: 'Менюто се зарежда',
    menuSchedule: (when) => `Менюто е ${when}`,
    notFoundTitle: 'Това меню не е налично',
    notFoundText: 'Проверете връзката или попитайте персонала за правилния код.',
    notPublishedTitle: 'Менюто още не е публикувано',
    notPublishedText: 'Моля, върнете се след малко.',
    loadFailedTitle: 'Менюто не можа да се зареди',
    loadFailedText: 'Проверете връзката си и опитайте отново.',
    retry: 'Опитайте отново',
  },
  services: {
    preview: 'Преглед',
    approx: 'прибл.',
    addNamed: (name) => `Добави ${name}`,
    increase: 'Още едно',
    decrease: 'Едно по-малко',
    quantity: 'Количество',
    required: 'Задължително',
    optional: 'По избор',
    pickOne: 'Изберете 1',
    pickUpTo: (max) => `Изберете до ${max}`,
    pickAtLeast: (min) => `Изберете поне ${min}`,
    note: 'Бележка за кухнята',
    notePlaceholder: 'напр. без лук, сосът отделно',
    addToBag: 'Добави в поръчката',
    bag: 'Вашата поръчка',
    viewBag: 'Виж поръчката',
    emptyBag: 'Поръчката е празна. Добавете нещо от менюто.',
    remove: 'Премахни',
    edit: 'Промени',
    sendToKitchen: 'Изпрати към кухнята',
    estimateTotal: 'Общо (прибл.)',
    sent: 'Изпратено към кухнята',
    sentHint: 'Поръчката ви е получена.',
    sending: 'Поръчката се изпраща',
    sendReceived: 'Поръчката е получена. Чакаме кухнята да я потвърди.',
    sendFailedTitle: 'Поръчката не беше потвърдена',
    sendFailedHint:
      'Нищо не е изгубено: поръчката ви още е тук. Опитайте отново или попитайте сервитьора.',
    sendRejectedTitle: 'Кухнята не можа да приеме поръчката',
    sendRejectedHint: 'Поръчката ви още е тук. Попитайте сервитьора.',
    unavailableLine: 'Вече не е налично',
    unavailableHint: 'Премахнете артикулите, които вече не са налични, за да изпратите поръчката.',
    reference: (ref) => `Номер ${ref}`,
    retry: 'Опитай отново',
    bill: 'Сметка',
    tab: 'Поръчка на масата',
    tabIntro: 'Всичко поръчано на тази маса — от приложението и от сервитьора.',
    emptyTab: 'Все още няма поръчки.',
    round: 'Поръчка',
    fromApp: 'От приложението',
    fromWaiter: 'От сервитьора',
    lineStatus: {
      received: 'Приета',
      preparing: 'Приготвя се',
      served: 'Сервирана',
      cancelled: 'Отказана',
    },
    tableTotal: 'Общо за масата',
    pay: 'Плати',
    callServer: 'Повикай сервитьор',
    bell: 'Сервитьор',
    kinds: {
      waiter: 'Повикай сервитьор',
      bill: 'Сметката, моля',
      ice: 'Лед',
      water: 'Вода',
      glasses: 'Чаши',
      clean_table: 'Почистване на масата',
      terminal: 'ПОС терминал',
    },
    otherPlaceholder: 'Напишете от какво имате нужда',
    send: 'Изпрати',
    requesting: 'Заявката се изпраща',
    requestFailed: 'Заявката не стигна до екипа. Опитайте отново или повикайте сервитьора.',
    requestStates: {
      sent: { title: 'Заявката е изпратена', hint: 'Чакаме екипът да я потвърди.' },
      accepted: { title: 'Екипът получи заявката', hint: 'Може да продължите да разглеждате.' },
      on_the_way: {
        title: 'Сервитьор идва',
        hint: 'Може да продължите да разглеждате. Екипът е уведомен.',
      },
      done: { title: 'Готово', hint: 'Екипът се погрижи за заявката ви.' },
      cancelled: { title: 'Заявката е отменена', hint: 'Може да изпратите нова.' },
      rejected: { title: 'Екипът не можа да приеме заявката', hint: 'Попитайте сервитьора.' },
    },
    cancelRequest: 'Отмени заявката',
    newRequest: 'Изпрати друга заявка',
    payTitle: 'Плащане',
    tip: 'Бакшиш за екипа',
    total: 'Общо',
    nothingToPay: 'Все още няма какво да се плати.',
    done: 'Обратно към менюто',
    table: 'Маса',
    tableOrder: 'Поръчка на масата',
    emptyOrder: 'В поръчката на масата още няма нищо.',
    saving: 'Записване…',
    removedNamed: (name) => `${name} е премахнато`,
    undo: 'Отмени',
    earlierOrder: 'Предишна поръчка',
    restore: 'Върни',
    orderFromWaiter: 'Поръчайте това от сервитьора',
    otherItem: 'Друг артикул',
    heldLine: 'Плаща се',
    orderingPaused: 'Поръчките са спрени в момента, моля, поръчайте от сервитьор.',
    orderingClosed: 'Тази маса не приема поръчки от телефон в момента.',
    lastOrdersAt: (time) => `Последни поръчки в ${time}`,
    orderingClosedTonight: 'Поръчките от телефон приключиха за тази вечер',
    orderingOpensAt: (time) => `Поръчките от телефон започват в ${time}`,
    offline: 'Слаба връзка. Нищо ново не е изпратено още, продължаваме да опитваме.',
    locationConsent: (venue) =>
      `${venue} и Restro проверяват местоположението ви, за да могат само гостите на масата да виждат сметката ѝ и да поръчват към нея. Не се съхранява. Можете да спрете по всяко време и да поръчате от сервитьора.`,
    locationAllow: 'Разреши',
    locationNotNow: 'Не сега',
    locationChecking: 'Проверяваме местоположението ви…',
    locationFailed: 'Не успяхме да потвърдим, че сте в заведението.',
    locationWhy:
      'Телефонът ви не сподели точно местоположение или показа, че сте другаде. За да опитате отново, разрешете местоположението за тази страница и включете точното местоположение.',
    locationCallWaiter: 'Повикай сервитьор',
    locationOrderFromWaiter: 'Моля, поръчайте от сервитьора',
    locationCancel: 'Отказ',
    locationNeeded:
      'Разрешете местоположението, за да виждате и добавяте към поръчката и сметката на масата.',
    locationAllowAgain: 'Разреши местоположението',
    sendItems: (count) => (count === 1 ? 'Изпрати 1 артикул' : `Изпрати ${count} артикула`),
    sendingNow: 'Изпраща се…',
    beingSent: 'Изпраща се',
    sentAdded: 'Добавено към сметката ви',
    sentUnpaid: 'Поръчано, без плащане: платете на сервитьора',
    sentAwaitingApproval: 'Чака бара да я приеме',
    sentNotSent: 'Не успяхме да изпратим поръчката ви, моля, повикайте сервитьор.',
    sentNotSentPaused: 'Поръчките са спрени, моля, повикайте сервитьор.',
    sentNotSentFirstItem:
      'Помолете сервитьора да маркира първия ви артикул, после изпратете отново.',
    sentUnconfirmed: (ref) => `Непотвърдено: покажете ${ref} на сервитьора`,
    showWaiter: 'Покажете това на сервитьора',
    showWaiterClose: 'Затвори',
    itemUnavailableNamed: (name) => `${name} вече не е налично. Премахнете го и изпратете отново.`,
    duplicateAsk: (minutes) =>
      minutes < 1
        ? 'Същото като преди малко. Да изпратим ли още едно?'
        : minutes === 1
          ? 'Същото като преди 1 минута. Да изпратим ли още едно?'
          : `Същото като преди ${minutes} минути. Да изпратим ли още едно?`,
    sendAnother: 'Изпрати още едно',
    duplicateCancel: 'Отказ',
    lineSoldOut: 'Изчерпано',
    sendOthers: (count) => `Изпрати останалите ${count}`,
    notesAtStaff: 'Алергии или специални желания? Кажете на персонала.',
    sentNotSentOutOfStock:
      'Нищо не беше изпратено: нещо се изчерпа. Изпратете останалото, когато сте готови.',
    refusals: {
      order_changed: 'Някой на масата промени това. Ето последната поръчка.',
      line_held: 'Това се плаща и вече не може да се променя.',
      undo_expired: 'Твърде късно е за отмяна.',
      order_full: 'Поръчката е пълна. Изпратете я или премахнете нещо.',
      quantity_limit: 'Един ред не може да побере повече.',
      stale_action: 'Това пристигна твърде късно. Опитайте отново.',
      rate_limited: 'Твърде много промени наведнъж. Изчакайте малко.',
      table_not_open: 'Тази маса не приема поръчки от телефон в момента.',
      code_retired: 'Кодът на масата е сменен. Сканирайте отново кода на масата.',
      location_needed: 'Разрешете местоположението, за да поръчвате към сметката.',
      location_failed: 'Не успяхме да потвърдим, че сте в заведението.',
      human_check: 'Не успяхме да проверим заявката. Опитайте отново.',
      ordering_paused: 'Поръчките са спрени, моля, повикайте сервитьор.',
      ordering_closed: 'Поръчките от телефон са затворени в момента. Моля, поръчайте от сервитьор.',
      menu_unavailable: 'Менюто се обновява. Опитайте отново след малко.',
      order_empty: 'Още няма какво да се изпрати.',
      item_unavailable: 'Нещо от поръчката ви вече не е налично. Премахнете го и изпратете отново.',
      order_from_waiter: 'Нещо от поръчката ви трябва да поръчате от сервитьора.',
      needs_first_item: 'Помолете сервитьора да маркира първия ви артикул, после изпратете отново.',
      duplicate_order: 'Масата ви изпрати същата поръчка преди малко.',
      guard_tripped: 'Помолете сервитьора да приеме тази поръчка.',
      paying_not_offered: 'За да платите, попитайте сервитьора.',
      paying_paused: 'Плащането с карта е спряно в момента. Попитайте сервитьора.',
      being_paid: 'Някой вече плаща този ред.',
      bill_changed: 'Сметката ви се промени, откакто я отворихте.',
      ask_waiter_to_split: 'Помолете сервитьора да раздели сметката.',
      turnstile: 'Не успяхме да проверим заявката. Опитайте отново.',
      sitting_ended:
        'Посещението ви на тази маса приключи. Ако сте още тук, сканирайте кода отново.',
      too_late: 'Вече е късно за отказ: плащането се обработва.',
      unknown_payment: 'Не намираме това плащане. Попитайте сервитьора.',
      // Martin 10-29.
      tip_not_offered: 'В момента не може да се добави бакшиш. Платете без бакшиш.',
      not_built: 'Това още не е налично.',
    },
    refusedOther: 'Не се получи. Опитайте отново.',
    paying: {
      billTitle: 'Сметката на масата',
      updated: (seconds) => `Обновено преди ${seconds} сек.`,
      stale: (seconds) => `Не е актуална · обновена преди ${seconds} сек.`,
      beingPaid: 'Плаща се',
      leftToPay: 'За плащане',
      emptyBill: 'Все още няма нищо в сметката',
      payOpen: 'Плати',
      askWaiterToPay: 'За да платите, попитайте сервитьора.',
      pickTitle: 'Какво плащате?',
      wholeBill: 'Цялата сметка',
      tipLabel: 'Бакшиш: отива за заведението',
      tipOther: 'Друга сума',
      yourItems: 'Избрано',
      tip: 'Бакшиш',
      total: 'Общо',
      payX: (amount) => `Плати ${amount}`,
      legalPrices: 'Цените са в EUR с ДДС. Рекламации и връщане на пари: заведението.',
      legalProcessor: (processor, venue) => `Плащането се обработва от ${processor} за ${venue}.`,
      belowMinimum: (min) =>
        `Плащането с карта е от ${min}. Добавете артикул или попитайте сервитьора.`,
      notUpToDate: 'В момента не можем да прочетем сметката. Опитваме отново.',
      cardsPaused: 'Плащането с карта е спряно в момента. Попитайте сервитьора.',
      nothingPicked: 'Изберете поне един ред.',
      sameQuestion: (minutes) => `Същата сума като преди ${minutes} мин. Да платите ли отново?`,
      sameYes: 'Да, плати',
      sameNo: 'Назад',
      preparing: 'Подготвяме сметката ви…',
      payLater: 'Плати по-късно',
      waiting: 'Обработваме плащането…',
      paid: 'Платено',
      paidNumber: 'Номер на плащането',
      paidReceipt: 'Покажете този номер на сервитьора. Сервитьорът ще ви донесе касовата бележка.',
      paidInApp: 'Платено в приложението',
      confirmTitle: 'Потвърждение за плащане',
      paidByCard: 'Платено с карта',
      confirmNotReceipt:
        'Това не е касова бележка. Касовата бележка за плащането ви носи сервитьорът.',
      confirmReceiptEmailed: (email) =>
        `Това не е касова бележка. Касовата бележка е изпратена на ${email}.`,
      confirmSave: 'Запази',
      confirmSaveFailed: 'Не успяхме да запазим. Опитайте отново.',
      backToBill: 'Към сметката',
      checkingTitle: 'Заведението проверява плащането',
      checkingBody: 'Не е нужно да правите нищо. Ако имате въпрос, повикайте сервитьор.',
      ended: {
        busy: 'Плащането в приложението е заето. Опитайте след минута или повикайте сервитьор.',
        paying_paused:
          'Плащането с карта е спряно в момента. Картата ви не е таксувана. Попитайте сервитьора.',
        check_failed:
          'Сметката се промени точно преди плащането. Картата ви не е таксувана. Проверете сметката и опитайте отново.',
        isolate_refused:
          'Не успяхме да подготвим плащането. Картата ви не е таксувана. Попитайте сервитьора.',
        no_receipt:
          'Плащането не беше завършено. Картата ви не е таксувана. Ако банката е запазила сума, тя ще бъде освободена.',
        expired: 'Времето изтече. Картата ви не е таксувана.',
        // Martin 10-29: the guest's own cancel, the pay-first release reasons, paying switched
        // off, and a pay-first round that reached the till and ended "No receipt".
        cancelled: 'Плащането е отменено. Картата ви не е таксувана.',
        enter_refused:
          'Не успяхме да изпратим поръчката. Картата ви не е таксувана. Моля, повикайте сервитьор.',
        item_unavailable:
          'Нещо се изчерпа, затова нищо не е изпратено и картата ви не е таксувана. Платете останалото, когато сте готови.',
        paying_off: 'За да платите, попитайте сервитьора.',
        pay_first_unpaid:
          'Картата ви не е таксувана. Поръчката е приета, сервитьорът ще вземе плащането.',
        other:
          'Не успяхме да подготвим плащането. Картата ви не е таксувана. Попитайте сервитьора.',
      },
      endedBelowMinimum: (min) =>
        `Плащането с карта е от ${min} нагоре. Картата ви не е таксувана. Добавете артикул или попитайте сервитьора.`,
      rateLimited: 'Твърде много опити. Изчакайте малко и опитайте отново.',
      tipTooBig: 'Бакшишът не може да е повече от сумата за плащане.',
      cardFormFailed: 'Формата за карта не се зареди. Опитайте отново или попитайте сервитьора.',
      payAgain: 'Плати отново',
      locationTitle: 'Сметката се вижда само на масата',
      locationBody:
        'Разрешете местоположение, за да знаем, че сте на масата. Иначе сервитьорът ще ви каже сумата.',
      allowLocation: 'Разреши местоположение',
      callWaiter: 'Повикай сервитьор',
    },
  },
}

/** The words for a locale: Bulgarian for `bg_BG`, English for every other. */
export function stringsFor(locale: Locale): Strings {
  return locale === 'bg_BG' ? BG : EN
}
