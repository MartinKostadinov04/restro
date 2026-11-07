# Repair-review: your hands-on (about 35 minutes)

For Martin. Only what you can judge: how it feels, the wording, what a club would miss. The agents already proved the rest.

**Set-up:** the lead sets it up for you on this PC: the simulated POS and payment provider, plus a manager and a waiter with their own sign-in. It follows steps 1 to 9 of [the ordering guide](../../deliverables/2026-10-30-ordering-acceptance-walk.md) and step 7 of [the paying guide](../../deliverables/2026-10-30-paying-acceptance-walk.md). Those two guides remain the full list if you want more; two lines in them are out of date: the switch "Only at tables a waiter has opened" is gone, and "Call a waiter" isn't on this guest page.

**Don't judge:** the guest page's look (it is the plain test template; the real one comes with the menu designer), or the composer (the Studio replaces it).

**You need:** your phone as the guest, a second phone or narrow window as the manager, a second browser as the bar tablet. Read each screen in Bulgarian at least once.

## 1. A guest at table 7 (8 min)
Have the waiter put a round on: `pnpm sim-pos waiter add-round --table 7 --items 2001:2,2502`. Turn the location check on, then open table 7 on your phone.
- Allow location, and read the consent card. Then open the same table in a second tab: it must not ask again.
- Add something and Send. Tap "Stop location check", then "Allow location" again.
- Pay for one line and finish. Read the Paid screen.
- **Judge:** at every step, does a guest know what just happened and what comes next? Which sentence would you change?

## 2. A waiter's night (8 min)
Have the guest's order on Tonight, on the manager's phone and on the tablet.
- Handled, then Undo. Pause all bars, read the banner, then Undo.
- On the tablet: answer something that asks for a PIN, and try a staff PIN where a manager's is needed.
- Sign in as the waiter and open the venue: there should be no Publish anywhere.
- **Judge:** can you read Tonight at first sight, in a dark club? Is anything a tap too many? Is anything calling for attention that shouldn't?

## 3. The connection drops (3 min)
Turn Wi-Fi off on the manager's phone and wait 10 seconds.
- Tonight stays, with "No connection. This is how things stood at {time}. It refreshes by itself." Tap something: "Not saved..." Tap Sign out: it says it couldn't.
- Wi-Fi back on: the line goes by itself.
- **Judge:** the wording, in both languages. Is it calm enough, and clear enough?

## 4. A payment goes wrong (8 min)
The lead stages these on the simulator: a "Payment not confirmed" with a tip on it, then a refund and a dispute.
- Read "Was the receipt printed?" as a manager at 3 a.m., and answer it.
- Compare the same payment on the tablet and on the manager's phone. The tablet shows it without the tip, which is by design: staff never see tips.
- **Judge:** does the manager know which button to press and what it does to the guest's money?

## 5. End of the night (4 min)
Open End of night, then the Log.
- **Judge:** would an owner trust this page the next morning? Does each Log line say who did what, in plain words?

## 6. The owner, with large text (4 min)
Set your phone's text to its largest size. Open Tonight, then Settings: Hours, Ordering, Staff and roles, Alerts, Paying.
- Nothing should run off the side. Buttons grow rather than cut words.
- **Judge:** is it still usable, or only technically fitting?

## 7. What a club would miss
Thirty seconds of honest thought: what would a club owner ask for that you didn't see?

## What to report
One line per thing: the screen, what you saw, what you'd want. Wording: the sentence as shown, and what it should say. A yes here opens the pull request into `main`; you merge it.

**Not in this script (they need staging or a real POS):** alerts buzzing a real phone, Apple Pay and Google Pay, Stripe's signed notices, and any real POS.
