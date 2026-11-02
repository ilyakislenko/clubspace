# Руководители направлений (direction managers)

A club with several directions (see `2026-11-01-directions.md`) has a head of
each: the руководитель направления БЖЖ runs БЖЖ — its groups and schedule,
ladders, gradings and promotions, achievements, events, announcements, course
audience and tariffs — without the club-wide admin powers (settings, billing,
payment setup, roles, gyms, directions, members, other directions).

## Model

`DirectionManager(workspaceId, directionId, userId)`, unique per
(direction, user). It sits **on top of the `coach` role** — no new role:

- Only a member with role `coach` can be assigned. Admins and head coaches
  already write every direction; a student has no admin side.
- Admins and head coaches assign and remove
  (`GET/POST /workspaces/:id/direction-managers`,
  `DELETE /workspaces/:id/direction-managers/:managerId`), audited as
  `direction.managerAssign` / `direction.managerRemove`.
- Seats go when the member leaves or is removed, and when their role changes
  away from `coach` (a later re-promotion does not silently restore them).
- `GET /workspaces/:id/members/me` returns `managedDirectionIds` so the clients
  can shape navigation and forms.

A club without assignments behaves exactly as before.

## One rule

`RbacService.assertCanManageDirection(ctx, ...directionIds)`:

- admin scope (owner, admin, head coach, super admin) passes;
- anyone else must manage **every** direction named — the entity's current
  direction and, on an update, the target one;
- `null` (club-wide) is admin-only; naming nothing fails closed.

Handlers resolve the coach scope, load the entity, then call the rule. Routes
using it are `COACHING_ROLES` (RoleGuard must let the coach through).

| Entity | Rule |
|---|---|
| Ladders, levels | ladder's direction (+ target on update) |
| Gradings, candidates, results | the grading ladder's direction |
| Promotions (one / many), ladder roster | the ladder's direction |
| Achievements, announcements, tariffs | own direction (+ target); reorder: every row reordered |
| Events | any coach writes events (unchanged); a manager is held to the rule |
| Course audience | coaches edit it (unchanged); a manager adding/removing `DIRECTION` rows is held to the rule for those rows |
| Groups | `assertCanWriteGroup` lets a manager write every group of their direction (schedule, members, coaches, attendance — like an own group); moving a group they reached that way needs the target direction. A coach keeps full rights on the groups they personally coach. `assertCanCreateGroupAs`: a manager may pin another coach only in their direction. |

Admin-only lists opened to managers (ladders, gradings, achievements,
announcements, a member's rank history) go through
`assertManagesDirections(ctx)`: admins see everything, a manager only their
directions' rows, a coach managing nothing is refused as before. Staff reads
(groups, schedule, tariffs, events) are unchanged; in a `coachSeesAllGroups =
false` club a manager's group list also includes their directions' groups, and
member reads/writes cover members of those groups. «Own groups» is one rule,
`ownGroupsWhere` (groups coached as primary or assistant + every group of a
managed direction): `assertCanReadMember` / `canWriteMember` and every
coach-narrowed list — members, dashboard stats, audit feed, at-risk, attendance
sessions/overview/roster card flags, pending freeze requests, rank readiness,
analytics — go through it (`RbacService.ownGroupIds` / `ownGroupMemberIds`).

Two static specs keep it that way:
`shared/access/direction-scope-source.spec.ts` (every direction-owned write
calls the rule, every handler writing a direction-owned model has a gate) and
Rule C of `route-tier-consistency.spec.ts` (handlers on the rule sit behind
`COACHING_ROLES`).

## Not covered

- Club settings, billing, payment setup, roles, members roster admin, gyms,
  directions CRUD, import and exports stay admin-only.
- Mobile has no ranks/gradings management screens; the club schedule lets a
  manager mark attendance for their directions' classes.
