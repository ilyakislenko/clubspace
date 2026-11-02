# Направления (disciplines inside one club)

One club — one management, one brand, many gyms — often runs several
disciplines: БЖЖ, ММА, тайский бокс, самбо, ОФП. Before this change ranks,
achievements, the leaderboard, announcements and abonements were club-wide, so
everything was mixed. A `Direction` is a discipline of one club
(`workspaceId, name, color, icon, order, isActive`).

## Rule: null = club-wide

`directionId` is optional on `Group`, `RankLadder`, `Achievement`,
`WorkspaceEvent`, `Announcement` and `CourseAudience` (kind `DIRECTION`).
`null` keeps today's club-wide behaviour, so a club that never creates a
direction sees no difference. Tariffs and abonements carry a **set** of
directions instead (see below); an empty set is club-wide.

All direction rules live in `apps/server/src/domains/directions/direction-scope.ts`;
abonement scopes and the visit precedence in
`apps/server/src/domains/subscriptions/current-subscriptions.ts` and
`visit-abonement.ts`.

## Who belongs to a direction

A member's directions are **the directions of the groups they train in
(`GroupMember`) or coach (`GroupCoach`)**. There is no separate membership
table: who trains where is already the group roster, and a second list would
drift from it (a student moved from the БЖЖ group to ММА would keep seeing БЖЖ
announcements until someone remembered the other list). Dependents (children)
count through their own group memberships; a guardian acting for a child
(`X-Act-As`) sees the child's directions.

A session belongs to a direction through its group (or its event for an event
session). The direction is derived at read time, so retagging a group moves its
past attendance with it. Personal trainings and ad-hoc sessions without a group
have no direction.

## What is scoped

| Area | Behaviour |
|---|---|
| Achievements | A direction achievement counts only visits to that direction's sessions (value, streak, date). Club-wide ones count everything. The app shows a section per direction the member belongs to or has trained in. `seed-defaults` can seed the default ladder per direction. |
| Leaderboard | `?directionId=` ranks only that direction's visits (and the caller's streak). |
| Announcements | A direction announcement (AND-ed with `audience` ALL/EXPIRING) appears in the feed and is pushed only to that direction's members and to the staff. Instead of a direction it may name groups (`AnnouncementGroup`, never both): only their students (a child through its guardians — act-as feed, routed push), their coaches and the staff; a direction manager may name only groups of the directions they run. A deleted target group leaves a row matching nobody. Its live update is a refetch signal, not a broadcast of the item. |
| Course audience | `DIRECTION` rows work like `GROUP`: the course is hidden from students outside the listed directions. |
| Schedule | `GET schedule?directionId=` returns only that direction's classes and events; agenda items carry `direction` for the app filter. |
| Ranks | Ladders carry a direction; promotions expose it so the app shows the direction name and color. |
| Events | Visible to the whole club as before; the direction is a tag (filter, attendance counts towards it). |

## Abonements (tariffs) per direction

A tariff's scope is a **set of directions** (`PlanDirection`): «БЖЖ 12
занятий» = {БЖЖ}, «БЖЖ + ММА 12 занятий» = {БЖЖ, ММА}. The empty set
(«Весь клуб», the default) is club-wide: every direction and classes without
a direction. A sold abonement snapshots the set (`SubscriptionDirection`) like
the other tariff fields, so editing a tariff never changes what was bought.

- **A scoped abonement is drawn only by classes of one of its directions.** A
  visit elsewhere (or to a class without a direction) is still recorded and
  counts for attendance and achievements, but takes nothing from it and isn't
  blocked by its freeze.
- A club-wide abonement is drawn by any visit — unchanged.

### Several current abonements

A member may hold several current abonements at once («БЖЖ 12» and «Тайский
бокс 8»). There is no "current" pointer: a member's current abonements are
every `ACTIVE` one not past its `endDate` (`currentSubscriptionWhere`). Every
reader (access, check-in, coach roster, freezes and freeze requests, renewal
candidates and reminders, awaiting payment, at-risk, exports, revenue, online
purchase, course audience by tariff, the apps) works over that set; an
"is there a live abonement" check passes when any (matching) one is live.

- **Selling.** A second abonement is allowed when its set differs from every
  current one. Against a current abonement with the *same* set the old
  one-live-abonement rules apply unchanged (a pack with classes left refuses
  the sale; a back-to-back dated renewal is allowed; a used-up pack is closed
  on sale). A club without directions only ever has the empty set, so it
  behaves exactly as before.
- **Freezes** pause one abonement; the others keep working. The single access
  window (`accessUntil`) is moved by a freeze only when the frozen abonement
  is the one that ends last; otherwise it is only extended to the frozen
  abonement's new end if that is later.
- **Freeze requests** name the abonement; with one current abonement the app
  may omit it, as before.

### Visit precedence

A visit to a class of direction D (or of no direction) is attributed to one
abonement (`AttendanceRecord.usedSubscriptionId`; `consumedSubscriptionId`
keeps meaning "a class was deducted here" and drives the refund on un-mark).

1. **Eligible**: current, already started (a dated renewal that starts later
   is not; one waiting for its first visit is), not frozen on the class day,
   its set contains D or is empty — a class without a direction draws only
   club-wide ones — and either a class pack with classes left or time-based.
   An exhausted pack is skipped so the next matching one pays.
2. **Order**: the narrowest set first (a set containing D, fewest directions
   first, before club-wide), then the one ending soonest (open-ended / not
   started yet last), then the older sale.
3. A class pack is decremented; a time-based abonement counts the visit
   without deducting. Nothing eligible → the visit is recorded unattributed
   (training past an exhausted pack is never refused).

The coach roster shows, per member, the abonement the visit is (or will be)
spent on and the other eligible ones; the coach may pick another one when
marking or move a marked visit to another eligible abonement (refund + new
deduction). Self check-in previews the same choice; with one eligible
abonement it checks in directly, as before. A frozen abonement refuses a self
check-in only when no other eligible abonement remains.

«Срок с первой тренировки» starts at the first visit attributed to that
abonement (so a БЖЖ visit spent on a БЖЖ pack does not start a club-wide one
waiting next to it). A visit marked on the sale day before the sale is taken
by the new abonement when it was attributed to none.

Existing data is migrated once (`apps/server/scripts/migrate-parallel-abonements.sql`):
the old single `Plan.directionId` becomes a one-element set on the tariff and
on every abonement sold on it.

## Deleting

A direction that anything still points at (including a tariff's or a sold
abonement's set) can't be deleted — archive it (`isActive = false`) instead.
Otherwise every tagged row would silently become club-wide (a БЖЖ-only
announcement reaching everyone, a БЖЖ pack drawn by any class). Archived
directions are hidden from members and from pick-lists.

## Follow-ups

- ~~Managers scoped to a direction~~ — done: `2026-11-01-direction-managers.md`.
- ~~Two parallel per-direction abonements per member~~ — done (see «Several current abonements» above).
