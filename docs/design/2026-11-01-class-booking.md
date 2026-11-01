# Запись на занятие (per-class booking for studios)

Dance, yoga and fitness studios don't run fixed rosters: a member books a
class, a pole class has 8 stands, a full class has a waitlist, and a late
cancellation or a no-show costs a class. ClubSpace had fixed group rosters plus
guest drop-ins (`DropInBooking`). This adds a second way a group can work.

## Group mode

`Group.bookingMode`:

| Mode | UI | Who is on a class |
|---|---|---|
| `FIXED` (default) | «Постоянная группа» | the group's members; others may drop in (`DropInBooking`) |
| `BOOKING` | «Запись на занятие» | whoever booked that class (`ClassBooking`) |

Every existing group stays `FIXED`, so a club that never switches a group sees
no difference. In a `BOOKING` group the group's member list is no longer the
class list: the attendance roster lists the class's bookings (as `expected`,
`source: 'booking'`) and the waitlist, and session reminders go to the booked
members (plus the group's members and coaches, as before).

### Drop-ins: kept, not generalized

`DropInBooking` stays exactly as it is — a guest's RSVP to another **fixed**
group's class: no capacity, no waitlist, cancel = delete, nothing charged until
marked. Generalizing it would have changed its semantics for every existing
club (rows are deleted on cancel, unique per member and class, deleted when the
member joins the group). Booking classes need history (late cancels, no-shows,
burns), several rows per member and class over time, and a lock per class.
So booking-mode classes use their own model and **a drop-in into a `BOOKING`
group is refused** («записываются в расписании»). Both count towards the
class-pack allocation rule (below), so a member can't over-promise one pack
across the two.

## Capacity, window, deadline

* Spots of one class = `ClassOccurrence.capacity` (this date) ?? 
  `GroupScheduleSlot.capacity` (this weekly slot) ?? `Group.capacity`;
  null everywhere = unlimited.
* Booking opens `bookingWindowDays` before the class (club calendar day of
  the class minus N) and closes at the start.
* A member cancels freely until `bookingCancelHours` before the start.
* Window and deadline are club settings (`Workspace.bookingWindowDays` = 14,
  `bookingCancelHours` = 12) with a per-group override
  (`Group.bookingWindowDays` / `bookingCancelHours`, null = the club's).
* `Workspace.bookingLateCancelBurn` / `bookingNoShowBurn` (both on by
  default): whether a late cancel / a no-show burns a class.

## Models

`ClassOccurrence` — one dated class of a `BOOKING` group that somebody booked
(or whose capacity was overridden), keyed like an attendance session
(`occurrenceKey = slot:<slotId>:<yyyy-mm-dd>`, unique per club). Created lazily
by the first booking. Stores start/end (refreshed on every booking write) and
`settledAt` (closed by the sweep).

`ClassBooking` — a member's place in one class. Rows are history; a re-booking
after a cancel is a new row. Statuses:

| Status | Meaning |
|---|---|
| `BOOKED` | holds a place |
| `WAITLISTED` | in the queue (oldest first) |
| `ATTENDED` | marked present (coach marking or self check-in) |
| `CANCELLED` | cancelled in time, a waitlist place given up, removed by staff, or the member left the club |
| `LATE_CANCELLED` | a held place given up after the deadline |
| `NO_SHOW` | booked, not marked by the time the class was settled |
| `CANCELLED_BY_CLUB` | the class was cancelled (schedule exception, or the group left `BOOKING` mode) — never burns |
| `EXPIRED` | still waitlisted when the class was settled |

`classBurned` + `burnedSubscriptionId` record what a late cancel / no-show
took. Members see it in «Мои записи» (history), staff in the class roster.

## Who may book

Any **active member** of the club (not only the group's members) — a guardian
for a child through `X-Act-As`; the group's coaches can't. With abonements on
(`subscriptionEnabled`) the member needs a current abonement the visit
precedence (`visit-abonement.ts`) could spend on the class: its scope covers
the group's direction, it runs at the class start, it isn't frozen on the
class's club day, and it has a class left or is time-based. Class packs can't
be over-promised: the member's other live bookings (and open drop-ins) of
classes those packs cover must stay below the classes left together, unless a
time-based abonement pays. A trial is simply a (free-trial) abonement; a club
with abonements off books without one. Nothing is charged at booking — the
visit is charged when the member is marked present, exactly as before.

## Burns

A late cancel or a no-show (when the switch is on) takes one class from the
abonement the visit would have been spent on — the precedence's first eligible
one at the class start. A time-based abonement (or none) burns nothing; the
status is recorded anyway. A member promoted from the waitlist **after** the
deadline may decline (cancel) without a burn. A no-show the coach marks
present later (after the sweep) becomes `ATTENDED` and the burned class is
refunded (the visit is charged normally instead).

## Waitlist promotion

When a place frees (a member cancels, staff remove one, staff raise the date's
capacity) the oldest waitlisted bookings move to `BOOKED` (`promotedAt` set) in
the **same transaction**, and the member gets a push («Освободилось место — вы
записаны… не сможете — отмените»). Promotions close at the class start.
Places freed outside a booking transaction (the group's or slot's capacity
raised, a member removed from the club) are promoted by the sweep below.

## Concurrency

Every write to the bookings of one class takes the `ClassOccurrence` row lock
(`SELECT … FOR UPDATE`) inside its transaction first; the capacity count, the
"one live booking per member and class" rule and promotion all run under it.
Concurrent bookings of the last place therefore serialize: exactly `capacity`
get `BOOKED`, the rest `WAITLISTED`, across any number of API replicas. The
occurrence row itself is created with `create` + catch `P2002` → read.
Pushes are deduped on `(kind, bookingId)` through `NotificationDispatchLog`,
so a promotion is announced once even if two paths race.

## The sweep

`scheduler-class-bookings` (BullMQ, every minute, global concurrency 1 like
the other scheduler queues) runs `ClassBookingService.sweep`:

1. promotes waitlists of future classes that have free places;
2. settles classes that ended more than 2 hours ago (so a coach marking right
   after class isn't raced): marked → `ATTENDED`, booked but unmarked →
   `NO_SHOW` (+ burn per setting, + push), still waitlisted → `EXPIRED`; a
   class cancelled by an exception → `CANCELLED_BY_CLUB`. `settledAt` is set
   under the lock, so a re-run is a no-op.

## Club-side cancellation

Cancelling a class is the existing schedule exception (one slot, one day, or a
whole range). For a `BOOKING` group, creating the exception closes every live
booking of the covered classes as `CANCELLED_BY_CLUB` (nothing burned) and
pushes each member («Занятие отменено… не списано»). Deleting the exception
does not restore bookings — members book again. Switching a group back to
`FIXED` does the same for its future classes.

## API

Member (any member, act-as allowed):

* `GET  /workspaces/:id/schedule` — each session of a `BOOKING` group carries
  `booking { capacity, booked, waitlist, opensOn, cancelDeadline, myBookingId,
  myStatus, myWaitlistPosition }` (null for fixed groups).
* `POST /workspaces/:id/class-bookings` `{ slotId, sessionDate }` — a place or
  a waitlist place; re-sending returns the held booking.
* `DELETE /workspaces/:id/class-bookings/:bookingId` — cancel / decline.
* `GET  /workspaces/:id/class-bookings/mine` — upcoming + 60 days of history
  with late cancels, no-shows and burns.

Staff (coaches of the group, its direction's managers, admins):

* `GET    /workspaces/:id/class-occurrences/:slotId/:date` — roster: booked,
  waitlist, attended, cancels with burns.
* `POST   …/bookings` `{ userId }` — add a member, over the capacity if full.
* `DELETE …/bookings/:bookingId` — take a member off (no burn).
* `PUT    …/capacity` `{ capacity | null }` — this date's places.

Settings: `bookingWindowDays`, `bookingCancelHours`, `bookingLateCancelBurn`,
`bookingNoShowBurn` on the workspace settings endpoints; `bookingMode`,
`capacity`, `bookingWindowDays`, `bookingCancelHours` on create/update group;
`capacity` on create/update slot.

## Code

* `apps/server/src/domains/class-bookings/class-booking-rules.ts` — pure rules.
* `apps/server/src/domains/class-bookings/class-booking.service.ts` — booking,
  cancel, promotion, staff actions, club cancellations, the sweep.
* `apps/server/src/features/class-bookings/` — HTTP slices.
* `apps/server/src/features/attendance/class-booking-marks.ts` — marks ↔
  booking status (and the no-show refund).

## Analytics

The occupancy snapshot (`AnalyticsSlotOccurrence`) takes a `BOOKING` class's
`capacity` from the date / slot / group places and counts everyone who held a
place as booked (unmarked = missed). The churn signals count a `NO_SHOW` as a
missed booking, like a drop-in nobody came to.
