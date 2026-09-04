# Changelog

Verioned by ISO week number `{year}w{WW}`, with a `.N` suffix for a same-week bugfix
release shipped after that week's main deploy already went out.

## 2026w37 (2026-09-07)

### Improvements

- **Credits are now a plain running number instead of a table of individual credit
  records.** A member can go into a negative balance instead of being blocked or
  flagged the moment they're out — only flagged for review if a check-in actually
  leaves them negative, so reconciling is a quick "who's negative" look instead of a
  manual audit.
- **Comp credits (manually granted, e.g. as a courtesy) now live in their own table**,
  separate from purchased/signup credits, so they stay individually auditable.
- **The nightly Givebutter contacts sync now pulls incrementally** (last 7 days)
  instead of a full re-pull every run.

### Bugfixes

- **Fixed the front desk and kiosk check-in dialogs showing a member's "remaining"
  count as 0 (or negative) even when they had a real drop-in credit** — the counter
  wasn't factoring credits in at all for members with no membership allowance.
- **Fixed the kiosk "available" counter reading 0 on any day with no scheduled
  classes** (i.e. any day but Thursday), even for a member with real credits.
- **Fixed a timezone bug in "Backdate check-ins"**: a backdated time typed on a
  browser not set to Pacific was silently misinterpreted, throwing off both the
  recorded check-in time and which classes the kiosk considered visible.
- **Fixed two Givebutter webhook sync failures** caused by sending Airtable a write
  in the wrong shape for select and linked-record fields — real transactions/plans
  were failing to sync.
- **Fixed the nightly Transactions sync not recording whether a payment was a
  membership charge**, which could let a real membership payment slip through and
  get credited as a one-time drop-in instead.
- **Fixed a race condition that could create a duplicate Member record** when a new
  signup fired multiple Givebutter webhook events in quick succession.

## 2026w36.1 (2026-09-02)

### Bugfixes

- **The public sign-up page now matches each site's own look** when embedded —
  theoaklandgrove.com/zouk gets its dark green/cream palette, oaktownzouk.com gets
  its own plain black-on-white — via a `?theme=` param on the embedding iframe's URL,
  since an iframe can't otherwise pick up the surrounding page's CSS.
- **Tweaks to sign-up page** To give a way to jump from the "sign up for your free class"
  to "buy a drop-in credit" for when someone erroneously hits "Its my first time".
  Attempted to make the "Is it your first time?" question clearer.

## 2026w36 (2026-08-31)

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
