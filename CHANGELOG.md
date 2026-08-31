# Changelog

Versioned by deploy week, not by feature: `{year}w{WW}` (ISO week number), since
production only ships once a week. An entry covers everything merged since the
previous week's deploy.

## 2026w36 (deploying 2026-08-31)

### New Features

- **Merge duplicate students.** "Merge duplicate…" on a roster row's ⋮ menu combines
  two `Members` records that represent the same real person — the recurring cause is
  a Givebutter sync that doesn't match emails case-insensitively (`cindy@gmail.com`
  vs. `Cindy@gmail.com`). Search finds the other half of the pair from the already-
  loaded roster; the dialog pre-selects whichever side holds an active membership as
  the survivor, but you can always override it. Check-ins, transactions, credits,
  notes, and level history all move to the survivor; the other record is hidden from
  the roster, not deleted.
- **Notes can now be edited** — but only by the staffer who wrote them. An Edit
  button appears on a note's detail view when it's your own; other staff can still
  read every note on a student's timeline, just not change someone else's write-up.
- **Check-in dialogs show a live "remaining" counter** in a large font, which
  increments/decrements locally as you pick classes — no more guessing whether a
  student has enough classes left before you finish picking.
- **Kiosk bolds any class the student attended in the last week**, as a hint toward
  what they probably want to check into today.
- **Kiosk sign-up now offers the same first-day-second-class option as the public
  sign-up page**: choosing "First time? Sign up for a free class!" now asks how many
  classes you want on your first day. Picking two goes straight to paying for the
  (already-priced) second class instead of a return trip after filling out the
  free-class contact form. Picking one now also shows the studio's waiver/code-of-
  conduct links before the free-class form, matching the public sign-up page.
- **The public sign-up/purchase page (used on oaktownzouk.com and
  theoaklandgrove.com) now lives in this repo**, served from the student site
  (`my.oaktownzouk.com/signup`), instead of being hand-pasted HTML separately
  maintained on each site. Its pricing/policy text is now the same source the kiosk
  pulls from, so the two can no longer say different things.

### Improvements

- **Check-in dialogs (kiosk and front desk) now show a class you've already checked
  into today as checked off and grayed out**, and disable the other classes in that
  same time slot — instead of letting you pick it again or silently pre-selecting a
  class from a visit weeks ago as if it were still relevant.
- **Kiosk now works like the front desk**: pick your class(es), then press Check In
  once to submit — instead of creating a check-in the instant you tap a button. Fewer
  network requests, and it's easier to change your mind before committing.
- **Kiosk's "Welcome" message now shows whenever Check In is pressed**, not only when
  the screen auto-closes after using up your last class/credit.
- **Kiosk check-in dialog now has separate Cancel and Check In buttons**, matching the
  front desk — Check In is disabled until at least one class is picked, and Cancel
  always closes with no submission regardless of any pending picks, for a student who
  started picking classes on the wrong person's dialog.
- **Kiosk's "Buy a pass" screen now leads with a QR code to the public sign-up page**
  (so a student can finish on their own phone from the very first tap) instead of
  showing a separate QR code after every individual product choice — picking a class
  count on the tablet now goes straight to the embedded checkout widget.
- **Kiosk checkout screens now show the same sliding-scale/refund/cancellation
  disclaimers the public sign-up page always has** — previously the kiosk showed no
  pricing context at all before a purchase. Since the kiosk is used in person, its
  version points to "ask the front desk" instead of only an email address.
- Both purchase widgets' embedded Givebutter forms are now horizontally centered
  (previously left-aligned).

### Bugfixes

- **Check-ins now correctly record which UI created them** (kiosk vs. front desk) —
  this field was always being left blank.
- **Password login (kiosk tablets) is now genuinely case-insensitive.** Matching
  already ignored case, but the session that got created afterward remembered
  whatever casing was typed, so the same account could show up differently attributed
  depending on how someone logged in that day.
- **Credits are now consumed and freed entirely by application code.** The Airtable
  automation this used to depend on for consuming a credit on check-in was unreliable
  and impossible to test — it's fully retired now, and undoing a check-in immediately
  frees its credit again instead of leaving it in limbo.
- **The kiosk's "remaining" counter now accounts for drop-in credits, not just
  membership allowance.** A student with a purchased/comp credit but no membership
  used to see "0 remaining" even with a credit available — it now correctly shows
  credits plus membership allowance, minus today's check-ins and picks so far, capped
  at however many class timeslots are actually still on today's schedule.
- **A member who also holds an unused credit (e.g. a leftover signup credit) now sees
  both their membership and credit badges** on the check-in dialogs and student
  pages — previously the credit was hidden entirely once a membership badge showed.
  The roster list still shows one badge per row on purpose, to avoid clutter.

### Performance

- **The student timeline page now makes about half as many Airtable requests** (~6
  instead of ~11) — notes and level-change history are read straight off the Member
  record instead of separately scanning the Notes and Levelups tables.
- **Check-in creation no longer blocks the page.** Both kiosk and front desk now
  start the write, update the screen immediately as if it already succeeded, and
  reconcile with the server in the background — the page stays interactive the whole
  time. If a write actually fails, a dismissible banner shows the error and stays up
  until someone closes it, instead of a blocking alert popup.
