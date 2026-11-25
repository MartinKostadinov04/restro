# Final check of the reservations decisions before write-up

Written 2026-11-07 by an independent Fable agent on `rv/foundation`, for Martin and the Port flow lead. Read: every row of `2026-10-30-reservations-decision-log.md`, weighted to 12.x; `GLOSSARY.md`; the two earlier checks, taken as given. Eight nights were walked end to end, from a phone booking to a guest asking to be forgotten. Nothing was run.

**Right as it stands.** The status list (2.22 plus Declined and Not seated) is OpenTable's and SevenRooms'. Hold, take on Confirm, release on Decline (2.27, 12.1) is how SevenRooms and Tock take deposits through Stripe. Blocks with a date range (5.1) are OpenTable's. A linked group as one unit (12.27) is OpenTable's table combination; settling by table inside it (12.23) is our own and better. The simple queue (3.24), the automatic No-show (6.20), the PIN line (12.9) and an email for every event (12.5) are standard. The nights hold together; below are the seams.

## A. For Martin

1. **A round paid at the bar cuts the party's phones.** "Maria, 6" is seated on table 7 until the end of the night (1.44). At 01:30 they pay a round at the bar; the POS bill closes; ordering ends the sitting (12.14, D122 §4) and the next order says "this table is closed". Nobody reopens it until a waiter finds Tonight (12.15); the hostess has no tap, seating already happened (12.12). In a club that pays by the round, 1.44's own reason, this is every table, every hour. *Rows 1.44, 1.62, 12.12, 12.14.* Recommendation: while a reservation is Seated on a table, a closed POS bill leaves the sitting open; only freeing the spot (1.48) or the night's end closes it, which also makes 1.62's "Is this still Maria's party?" unnecessary.

2. **"Whoever made it" leaves the door without a hand.** Ana takes "Georgi, 8" by phone on Friday. Saturday Ana is off; Georgi arrives at 01:20 already marked No-show. Vera may seat him but may not change the count, cancel or undo the No-show (2.24): that needs Ana or a manager. A booking confirmed automatically (12.7) has no maker at all. OpenTable, SevenRooms and Resy let any host with the permission edit any booking. *Rows 2.24, 2.31, 12.7.* Recommendation: anyone with the reservations permission changes, cancels and undoes tonight's and future bookings; deleting another's and restoring stay with the manager.

3. **A wrong No-show can never be fixed and follows the guest.** Sunday the manager sees "Dimitar, 4" marked No-show by the night's end because nobody tapped Arrived, though they drank €300. The night is read-only (4.25), so his card says "did not come 1" for good (8.22). OpenTable and SevenRooms let managers correct a past status. *Rows 4.25, 6.20, 8.22.* Recommendation: a past night stays read-only except that a manager may flip No-show and Finished, logged.

4. **The warning on every waiter-opened table will be clicked through within a week.** Where waiters seat walk-ins themselves, 3.22 fires on every open, so the one that matters, "Maria holds this from 01:00" (3.27), is swiped away too. *Rows 3.22, 3.27.* Recommendation: warn only when the table is reserved later tonight or blocked; otherwise it opens silently and goes red on the plan.

5. **"Open on seating" is a switch that breaks the model when off.** 12.12 makes seating what opens the menu, with no open tap on the plan; 12.14 keeps 1.42's setting that can turn it off, leaving a hostess who seats a party and must then find Tonight. A venue without phone ordering has it off already. *Rows 1.42, 12.12, 12.14.* Recommendation: drop the setting; seating always opens the code.

6. **One booking, four tables, grouped or not?** 12.27 says a group is one thing and an unwilling party "is simply not grouped", while 1.43 still carries a venue default for putting a reservation's spots on one bill. So a four-table booking can exist ungrouped, and a setting decides. *Rows 1.43, 12.24, 12.27.* Recommendation: a reservation's tables are always its group, 1.43's setting goes, and a party that wants separate bills gets separate reservations (2.29 only warns).

7. **Two time settings for one idea.** 2.20 gives a default booking length, 3.26 a minimum seating window before the next booking; OpenTable has one number, the turn time. *Rows 2.20, 3.26.* Recommendation: the minimum window is the default length.

8. **The manager's private list and its switch.** 8.20 gives one venue list, a private list per manager, and a setting for whether managers get one; the earlier check found two readings of it. SevenRooms and Resy keep one guest book with notes only some roles see. *Row 8.20.* Recommendation: one venue list with a note that only the manage permission reads; no private list, no setting.

9. **A per-role switch on the PIN line.** 12.9 ends "configurable in the role settings": a venue could make "cancel" quick, so the Log's "whose hand" means something different per club. *Row 12.9.* Recommendation: the quick/PIN line is fixed in code, as today's two quick answers are.

## B. For the lead

1. **Seating onto a table a waiter opened must offer "same guests".** 3.27 turns it red; a hostess recording the walk-in on it hits 12.13's "New guests", which empties the cart of the people already ordering. Add "they are the ones sitting there", attaching the walk-in to the standing sitting as 12.21 does.

2. **Arrived at another table in one gesture:** tap the party, tap the table (OpenTable's drag-to-seat), not Change tables then Arrived.

3. **Change tables carries 1.48's warning** when the old table's last reading showed lines: "Bill on 12: move it in the POS" (4.22, 12.14).

4. **Define "passed".** A night has passed when its service day ended (4.25); the night's end runs at the closing hour (12.17); 6.21's put-back lives between. A booking after the closing hour (2.36) is told the night's end will mark it No-show first.

5. **Stale wording:** 12.9's "open or close a table from the plan" (12.12/12.15); 1.42 and 1.43 amended by 12.12–12.14 and 12.23–12.27; 10.20's "editing a past night" (4.25); 2.27's "5 days" and "7-day hold" (12.3).

6. **Phone booking with prepayment:** the form asks for an email (2.34 needs one); a link payment captures at once, no hold; a request whose hold lapsed and is confirmed later offers the link; the night list filters "Prepayment pending".

7. **Plan states not by colour alone:** reserved later, seated, open with nobody seated, blocked, late, past end time, prepayment pending; a label and a legend, since red is five things.

8. **Cancel and Delete side by side,** one line each ("the guest called it off" / "entered by mistake").

9. **Groups from Tonight (12.24)** are quick under the table permission by 12.9's rule; a grouped phone pays its own table's bill; one-tap group payment is ordering's work (12.18).

10. **12.11's session on a shared device** ends on idle, not after a fixed length: Toast and Lightspeed lock after one to ten idle minutes; five is a fair default.

11. **Erasure (8.21)** also clears the regulars list and every note on him; the lawyer's wording says Stripe keeps cardholder data on its side.

**Verdict:** ready to ticket once A1 to A3 are answered; the rest are trims the write-up can carry without another round.
