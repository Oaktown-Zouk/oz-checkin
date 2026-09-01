# Changelog

Verioned by ISO week number `{year}w{WW}` 

## 2026w36 (deploying 2026-08-31)

### New Features

- **Merge duplicate students.** "Merge duplicate…" on a roster row's ⋮ menu combines
  two `Members` records that represent the same real person.
- **Notes can now be edited** — by the staffer who wrote them.
- **Check-in dialogs show a live "remaining" counter** in a large font, which
  increments/decrements locally as you pick classes.
- **Kiosk bolds any class the student attended in the last 29 days**, as a hint
  toward what they probably want to check into today.
- **Kiosk has buttons to sign-up now or purchase**. Offers a QR code for purchases,
  but also allows purchases to be completed on the tablet.
- **The public sign-up/purchase page now lives in this repo**, served from the student site
  (`my.oaktownzouk.com/signup`), instead of being hand-pasted HTML separately
  maintained on each site. Its pricing/policy text is now the same source the kiosk
  pulls from, so the two can share copy.

### Improvements

- **Check-in dialogs (kiosk and front desk) now show a class you've already checked
  into today as checked off and grayed out**, and disable the other classes in that
  same time slot — instead of letting you pick it again or silently pre-selecting a
  class from a visit weeks ago as if it were still relevant.
- **Kiosk submits when done is pressed**: Like the front desk - pick classes, then hit
  done to submit. Allows correcting mistakes and better responsiveness.
- **Kiosk's "Welcome" message now shows whenever Check In is pressed**, 
- **Kiosk check-in dialog now has separate Cancel and Check In buttons**, matching the
  front desk — Check In is disabled until at least one class is picked, and Cancel
  always closes with no submission regardless of any pending picks.

### Bugfixes

- **Check-ins now correctly record which UI created them** (kiosk vs. front desk) —
  this field was always being left blank.
- **Password login (kiosk tablets) is now genuinely case-insensitive.**
- **Credits are now consumed and freed entirely by application code.** The Airtable
  automation this used to depend on for consuming a credit on check-in was unreliable
  and impossible to test — it's fully retired now, and undoing a check-in immediately
  frees its credit again instead of leaving it in limbo.
- **The kiosk shows a "Remaining" counter, with the number of available credits/classes,
  capped at the number of class slots available.
- **A member who also has drop-in credits now sees their credit badges** on the 
  check-in dialogs and student pages — previously the credit was hidden entirely once a
  membership badge showed.

### Performance

- **The student timeline page now makes about half as many Airtable requests** (~6
  instead of ~11) — notes and level-change history are read straight off the Member
  record instead of separately scanning the Notes and Levelups tables.
- **Check-in creation no longer blocks the page.** Both kiosk and front desk now
  start the write, update the screen immediately as if it already succeeded, and
  reconcile with the server in the background — the page stays interactive the whole
  time. If a write actually fails, a dismissible banner shows the error and stays up
  until someone closes it.
