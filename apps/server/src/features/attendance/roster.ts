import {
    effectiveCapacity,
    waitlistPositions,
} from '../../domains/class-bookings/class-booking-rules'
import { currentSubscriptionWhere } from '../../domains/subscriptions/current-subscriptions'
import { dbDateToYmd, ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import {
    toVisitAbonement,
    type VisitAbonement,
} from '../../domains/subscriptions/visit-abonement'
import { PrismaService } from '../../infrastructure/prisma'
import { ownGroupsWhere } from '../../shared/services/rbac.service'
import { awaitingPaymentWhere } from '../get-workspace-stats/revenue'
import { localDateInTz } from './attendance-utils'
import { loadExpectedAttendees } from './expected-attendees'
import {
    displayName,
    type ExpectedAttendee,
    type RosterEntry,
    SessionRosterOutput,
} from './schemas'
import {
    exhaustedPackCovers,
    loadSessionVisitOptions,
    loadUsedAbonements,
    sessionUsesAbonements,
} from './session-visits'

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

// «Запись на занятие»: places and the waitlist of a scheduled class of a
// BOOKING group; null for everything else.
const loadBookingBlock = async (
    prisma: PrismaService,
    s: SessionLike,
): Promise<SessionRosterOutput['booking']> => {
    if (!s.groupId || !s.slotId) return null
    const group = await prisma.group.findUnique({
        where: { id: s.groupId },
        select: { bookingMode: true, capacity: true },
    })
    if (group?.bookingMode !== 'BOOKING') return null
    const slot = await prisma.groupScheduleSlot.findUnique({
        where: { id: s.slotId },
        select: { capacity: true },
    })
    const occurrence = await prisma.classOccurrence.findUnique({
        where: {
            workspaceId_occurrenceKey: {
                workspaceId: s.workspaceId,
                occurrenceKey: s.occurrenceKey,
            },
        },
        select: {
            capacity: true,
            bookings: {
                where: {
                    status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW', 'WAITLISTED'] },
                },
                select: {
                    id: true,
                    userId: true,
                    status: true,
                    createdAt: true,
                    user: {
                        select: { firstname: true, lastname: true, email: true },
                    },
                },
            },
        },
    })
    const rows = occurrence?.bookings ?? []
    const positions = waitlistPositions(rows)
    return {
        capacity: effectiveCapacity({
            occurrence: occurrence?.capacity,
            slot: slot?.capacity ?? null,
            group: group.capacity,
        }),
        booked: rows.filter((b) => b.status !== 'WAITLISTED').length,
        waitlist: rows
            .filter((b) => positions.has(b.id))
            .map((b) => ({
                userId: b.userId,
                displayName: displayName(b.user),
                position: positions.get(b.id) ?? 0,
            }))
            .sort((a, b) => a.position - b.position),
    }
}

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
        select: { userId: true, isGuest: true, usedSubscriptionId: true },
    })
    const present = new Map(records.map((r) => [r.userId, r.isGuest]))
    const usedBy = new Map(
        records.map((r) => [r.userId, r.usedSubscriptionId]),
    )
    const expected = await loadExpectedAttendees(
        prisma,
        s,
        new Set(present.keys()),
    )
    const entries = new Map<string, RosterEntry>()
    const blank = {
        frozenUntil: null,
        awaitingPayment: null,
        canViewSubscription: false,
        abonement: null,
        abonementOptions: [],
    }

    // A class of a «Запись на занятие» group lists its bookings (in
    // `expected`), not the group's members.
    const booking = await loadBookingBlock(prisma, s)
    if (s.groupId && !booking) {
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
                ...blank,
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
                ...blank,
            })
        }
    }

    const rows: Array<RosterEntry | ExpectedAttendee> = [
        ...entries.values(),
        ...expected,
    ]
    const visitorIds = [...new Set(rows.map((r) => r.userId))]
    if (visitorIds.length) {
        // "The day" is the club calendar (workspace timezone), the same one
        // the freeze dates are written in — not the gym/event timezone the
        // session itself may carry — so the badges stay right for past
        // sessions too.
        const workspace = await prisma.workspace.findUnique({
            where: { id: s.workspaceId },
            select: { timezone: true },
        })
        const dayYmd = localDateInTz(s.startAt, workspace?.timezone ?? 'UTC')
        const now = new Date()

        // Which abonement each visit was / would be spent on: one candidates
        // query for everybody plus one lookup of the abonements present
        // visits were attributed to. Personal sessions and paid events never
        // touch abonements.
        if (await sessionUsesAbonements(prisma, s)) {
            const visits = await loadSessionVisitOptions(prisma, {
                workspaceId: s.workspaceId,
                sessionId: s.id,
                dayYmd,
                userIds: visitorIds,
                now,
            })
            const used = await loadUsedAbonements(
                prisma,
                [...usedBy.values()].filter((id): id is string => !!id),
            )
            for (const row of rows) {
                const ranked = visits.ranked.get(row.userId) ?? []
                let options: VisitAbonement[]
                if (row.present) {
                    const usedId = usedBy.get(row.userId) ?? null
                    const usedOne = usedId ? (used.get(usedId) ?? null) : null
                    row.abonement = usedOne
                    options = ranked
                        .filter((c) => c.id !== usedId)
                        .map(toVisitAbonement)
                    if (usedOne) options.unshift(usedOne)
                } else {
                    options = ranked.map(toVisitAbonement)
                    row.abonement = options[0] ?? null
                }
                row.abonementOptions = options
                if ('classesLeft' in row) {
                    // A guest whose only matching pack ran out reads "0 left",
                    // as a single used-up pack always did.
                    row.classesLeft = row.abonement
                        ? row.abonement.classesRemaining
                        : exhaustedPackCovers(
                                visits.candidates.get(row.userId) ?? [],
                                visits.sessionDirectionId,
                            )
                          ? 0
                          : null
                }
            }
        }

        // The freeze badge: a freeze of a current abonement covering the
        // class day, shown only when nothing unfrozen can pay for the class
        // (a frozen «Тайский бокс» doesn't matter while «БЖЖ» covers БЖЖ).
        const day = ymdToDbDate(dayYmd)
        const frozen = await prisma.subscriptionFreeze.findMany({
            where: {
                workspaceId: s.workspaceId,
                userId: { in: visitorIds },
                fromDate: { lte: day },
                untilDate: { gte: day },
                subscription: currentSubscriptionWhere(now),
            },
            select: { userId: true, untilDate: true },
        })
        const frozenUntil = new Map<string, string>()
        for (const f of frozen) {
            const until = dbDateToYmd(f.untilDate)
            const prev = frozenUntil.get(f.userId)
            if (!prev || until > prev) frozenUntil.set(f.userId, until)
        }
        for (const row of rows) {
            if (row.abonementOptions.length > 0) continue
            row.frozenUntil = frozenUntil.get(row.userId) ?? null
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
                                  ...ownGroupsWhere(viewer.userId),
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
        booking,
    }
}
