import { dbDateToYmd, ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { awaitingPaymentWhere } from '../get-workspace-stats/revenue'
import { localDateInTz } from './attendance-utils'
import { loadExpectedAttendees } from './expected-attendees'
import { displayName, SessionRosterOutput } from './schemas'

type SessionLike = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    occurrenceKey: string
    workspaceEventId: string | null
    checkInCode: string | null
    isPersonal: boolean
    startAt: Date
}

export type RosterViewer = { userId: string; seesAllGroups: boolean }

const kindOf = (s: SessionLike): 'scheduled' | 'adhoc' | 'event' | 'personal' =>
    s.isPersonal
        ? 'personal'
        : s.workspaceEventId
          ? 'event'
          : s.slotId
            ? 'scheduled'
            : 'adhoc'

// Builds the roster for a session: group members pre-populated with a
// present flag, plus any marked users not in the group (guests / event
// attendees). Shared by the mark/unmark handlers and the roster read so the
// three always return the same shape.
export const buildRoster = async (
    prisma: PrismaService,
    s: SessionLike,
    // Who is looking: decides which rows may open the abonement card.
    viewer: RosterViewer,
): Promise<SessionRosterOutput> => {
    const records = await prisma.attendanceRecord.findMany({
        where: { sessionId: s.id },
        select: { userId: true, isGuest: true },
    })
    const present = new Map(records.map((r) => [r.userId, r.isGuest]))
    const expected = await loadExpectedAttendees(
        prisma,
        s,
        new Set(present.keys()),
    )
    const entries = new Map<
        string,
        {
            userId: string
            displayName: string
            present: boolean
            isGuest: boolean | null
            frozenUntil: string | null
            awaitingPayment: boolean | null
            canViewSubscription: boolean
        }
    >()

    if (s.groupId) {
        const members = await prisma.groupMember.findMany({
            where: { groupId: s.groupId },
            select: {
                userId: true,
                user: {
                    select: { firstname: true, lastname: true, email: true },
                },
            },
        })
        for (const m of members) {
            const isPresent = present.has(m.userId)
            entries.set(m.userId, {
                userId: m.userId,
                displayName: displayName(m.user),
                present: isPresent,
                isGuest: isPresent ? (present.get(m.userId) ?? false) : false,
                frozenUntil: null,
                awaitingPayment: null,
                canViewSubscription: false,
            })
        }
    }

    // Marked users not already in the roster: guests (group sessions) or
    // event attendees.
    const missing = [...present.keys()].filter((id) => !entries.has(id))
    if (missing.length) {
        const users = await prisma.user.findMany({
            where: { id: { in: missing } },
            select: { id: true, firstname: true, lastname: true, email: true },
        })
        for (const u of users) {
            entries.set(u.id, {
                userId: u.id,
                displayName: displayName(u),
                present: true,
                isGuest: present.get(u.id) ?? null,
                frozenUntil: null,
                awaitingPayment: null,
                canViewSubscription: false,
            })
        }
    }

    // Mark whose abonement was frozen on the session's own day, so the badge
    // stays right for past sessions too. "The day" is the club calendar
    // (workspace timezone), the same one the freeze dates are written in —
    // not the gym/event timezone the session itself may carry.
    const frozenIds = [...entries.keys(), ...expected.map((e) => e.userId)]
    if (frozenIds.length) {
        const workspace = await prisma.workspace.findUnique({
            where: { id: s.workspaceId },
            select: { timezone: true },
        })
        const day = ymdToDbDate(
            localDateInTz(s.startAt, workspace?.timezone ?? 'UTC'),
        )
        const frozen = await prisma.subscriptionFreeze.findMany({
            where: {
                workspaceId: s.workspaceId,
                userId: { in: frozenIds },
                fromDate: { lte: day },
                untilDate: { gte: day },
                subscription: { status: 'ACTIVE' },
            },
            select: { userId: true, untilDate: true },
        })
        for (const f of frozen) {
            const entry = entries.get(f.userId)
            if (entry) entry.frozenUntil = dbDateToYmd(f.untilDate)
            for (const e of expected) {
                if (e.userId === f.userId) e.frozenUntil = dbDateToYmd(f.untilDate)
            }
        }
    }

    // «ждёт оплаты» = the member has an unpaid sold abonement (the same
    // predicate as the dashboard receivable, so an expired debt still counts)
    // and `canViewSubscription` = the viewer may open that card (it reads like
    // the endpoint does: all members, or those in the viewer's own groups).
    // Three queries for the whole roster, no per-row lookups. A user without a
    // member row (the owner, a removed member) gets null / false.
    if (entries.size) {
        const userIds = [...entries.keys()]
        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId: s.workspaceId, userId: { in: userIds } },
            select: { userId: true },
        })
        const unpaid = await prisma.subscription.findMany({
            where: {
                ...awaitingPaymentWhere(s.workspaceId),
                workspaceMember: { userId: { in: userIds } },
            },
            select: { workspaceMember: { select: { userId: true } } },
        })
        const unpaidIds = new Set(unpaid.map((u) => u.workspaceMember?.userId))
        const viewable = viewer.seesAllGroups
            ? null
            : new Set(
                  (
                      await prisma.groupMember.findMany({
                          where: {
                              userId: { in: userIds },
                              group: {
                                  workspaceId: s.workspaceId,
                                  coaches: { some: { userId: viewer.userId } },
                              },
                          },
                          select: { userId: true },
                      })
                  ).map((g) => g.userId),
              )
        for (const m of members) {
            const entry = entries.get(m.userId)
            if (entry) {
                entry.awaitingPayment = unpaidIds.has(m.userId)
                entry.canViewSubscription =
                    viewable === null || viewable.has(m.userId)
            }
        }
    }

    return {
        sessionId: s.id,
        kind: kindOf(s),
        expected,
        // Coach-only: the code members type to self-check-in.
        checkInCode: s.checkInCode,
        roster: [...entries.values()],
    }
}
