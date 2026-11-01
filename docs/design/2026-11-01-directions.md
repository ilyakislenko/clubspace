# Направления (disciplines inside one club)

One club — one management, one brand, many gyms — often runs several
disciplines: БЖЖ, ММА, тайский бокс, самбо, ОФП. Before this change ranks,
achievements, the leaderboard, announcements and abonements were club-wide, so
everything was mixed. A `Direction` is a discipline of one club
(`workspaceId, name, color, icon, order, isActive`).

## Rule: null = club-wide

`directionId` is optional on `Group`, `RankLadder`, `Achievement`, `Plan`,
`WorkspaceEvent`, `Announcement` and `CourseAudience` (kind `DIRECTION`).
`null` keeps today's club-wide behaviour, so a club that never creates a
direction sees no difference.

All direction rules live in `apps/server/src/domains/directions/direction-scope.ts`.

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
| Announcements | A direction announcement (AND-ed with `audience` ALL/EXPIRING) appears in the feed and is pushed only to that direction's members and to the staff. Its live update is a refetch signal, not a broadcast of the item. |
| Course audience | `DIRECTION` rows work like `GROUP`: the course is hidden from students outside the listed directions. |
| Schedule | `GET schedule?directionId=` returns only that direction's classes and events; agenda items carry `direction` for the app filter. |
| Ranks | Ladders carry a direction; promotions expose it so the app shows the direction name and color. |
| Events | Visible to the whole club as before; the direction is a tag (filter, attendance counts towards it). |

## Abonements (tariffs) per direction

A tariff may be tagged with a direction («БЖЖ 12 занятий»).

- **A per-direction pack is drawn only by visits to its own direction's
  sessions.** A visit to another direction's class (or a class with no
  direction) is still recorded and counts for attendance and achievements,
  but takes no class from that pack and isn't blocked by its freeze.
- A club-wide tariff (no direction) is drawn by any visit — unchanged.
- «Срок с первой тренировки» on a per-direction tariff starts at the first
  visit of that direction.
- A member still holds **one current abonement** (the existing
  one-live-abonement rule is unchanged). A member who trains in two
  directions buys a club-wide tariff (e.g. «Безлимит все направления»).
  Holding two parallel per-direction packs at once is not supported yet.

## Deleting

A direction that anything still points at can't be deleted — archive it
(`isActive = false`) instead. Otherwise every tagged row would silently become
club-wide (a БЖЖ-only announcement reaching everyone, a БЖЖ pack drawn by any
class). Archived directions are hidden from members and from pick-lists.

## Follow-ups

- ~~Managers scoped to a direction~~ — done: `2026-11-01-direction-managers.md`.
- Two parallel per-direction abonements per member.
