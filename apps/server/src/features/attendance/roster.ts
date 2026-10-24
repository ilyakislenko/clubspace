import { dbDateToYmd, ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { localDateInTz } from './attendance-utils'
import { displayName, SessionRosterOutput } from './schemas'

type SessionLike = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    workspaceEventId: string | null
    checkInCode: string | null
    startAt: Date
}

const kindOf = (s: SessionLike): 'scheduled' | 'adhoc' | 'event' =>
    s.workspaceEventId ? 'event' : s.slotId ? 'scheduled' : 'adhoc'

// Builds the roster for a session: group members pre-populated with a
// present flag, plus any marked users not in the group (guests / event
// attendees). Shared by the mark/unmark handlers and the roster read so the
// three always return the same shape.
export const buildRoster = async (
    prisma: PrismaService,
    s: SessionLike,
): Promise<SessionRosterOutput> => {
    const records = await prisma.attendanceRecord.findMany({
        where: { sessionId: s.id },
        select: { userId: true, isGuest: true },
    })
    const present = new Map(records.map((r) => [r.userId, r.isGuest]))
    const entries = new Map<
        string,
        {
            userId: string
            displayName: string
            present: boolean
            isGuest: boolean | null
            frozenUntil: string | null
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
            })
        }
    }

    // Mark whose abonement was frozen on the session's own day, so the badge
    // stays right for past sessions too. "The day" is the club calendar
    // (workspace timezone), the same one the freeze dates are written in —
    // not the gym/event timezone the session itself may carry.
    if (entries.size) {
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
                userId: { in: [...entries.keys()] },
                fromDate: { lte: day },
                untilDate: { gte: day },
                subscription: { status: 'ACTIVE' },
            },
            select: { userId: true, untilDate: true },
        })
        for (const f of frozen) {
            const entry = entries.get(f.userId)
            if (entry) entry.frozenUntil = dbDateToYmd(f.untilDate)
        }
    }

    return {
        sessionId: s.id,
        kind: kindOf(s),
        // Coach-only: the code members type to self-check-in.
        checkInCode: s.checkInCode,
        roster: [...entries.values()],
    }
}
