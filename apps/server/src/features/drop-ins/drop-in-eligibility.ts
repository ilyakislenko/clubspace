import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    scopeDirectionIds,
    subscriptionScopeIdsSelect,
} from '../../domains/subscriptions/current-subscriptions'
import {
    addDaysYmd,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    localDateInTz,
    resolveSlotOccurrence,
} from '../attendance/attendance-utils'
import {
    DropInAbonement,
    DropInBlockReason,
    dropInBlockReason,
} from './drop-in-utils'

// The member's bookings that haven't finished yet, soonest first, with the
// occurrence each one resolves to.
export const loadUpcomingBookings = async (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
    timezone: string,
    now: Date,
) => {
    // One day of slack: a class in a zone ahead of the club's can still be
    // upcoming while the club calendar has moved on.
    const since = ymdToDbDate(addDaysYmd(localDateInTz(now, timezone), -1))
    const bookings = await prisma.dropInBooking.findMany({
        where: { workspaceId, userId, sessionDate: { gte: since } },
        include: {
            slot: true,
            group: {
                select: {
                    id: true,
                    name: true,
                    directionId: true,
                    gym: {
                        select: {
                            id: true,
                            name: true,
                            address: true,
                            timezone: true,
                        },
                    },
                    coach: {
                        select: {
                            firstname: true,
                            lastname: true,
                            email: true,
                        },
                    },
                },
            },
        },
    })

    const groupIds = [...new Set(bookings.map((b) => b.groupId))]
    const lastDate = new Date(
        Math.max(...bookings.map((b) => b.sessionDate.getTime())),
    )
    const exceptions = bookings.length
        ? await prisma.scheduleException.findMany({
              where: {
                  groupId: { in: groupIds },
                  fromDate: { lte: lastDate },
                  untilDate: { gte: since },
              },
              select: {
                  groupId: true,
                  slotId: true,
                  fromDate: true,
                  untilDate: true,
                  reason: true,
              },
          })
        : []

    return bookings
        .map((b) => ({
            b,
            occ: resolveSlotOccurrence({
                slot: b.slot,
                sessionDate: b.sessionDate.toISOString().slice(0, 10),
                gymTz: b.group.gym?.timezone ?? null,
                workspaceTz: timezone,
                exceptions: exceptions.filter((e) => e.groupId === b.groupId),
            }),
        }))
        .filter(({ occ }) => occ.endAt.getTime() > now.getTime())
        .sort((a, z) => a.occ.startAt.getTime() - z.occ.startAt.getTime())
}

// Shared by booking and the "my bookings" read, so the screen's canBook and the
// POST's refusal always agree.
export const loadDropInEligibility = async (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
    now: Date,
): Promise<{
    timezone: string
    subscriptionRequired: boolean
    reason: DropInBlockReason | null
    upcoming: Awaited<ReturnType<typeof loadUpcomingBookings>>
    // The bookings that still hold a place: future, running, not yet marked.
    openBookings: Awaited<ReturnType<typeof loadUpcomingBookings>>
    // The member's current abonements (any of them may pay for a class).
    abonements: Array<DropInAbonement & { id: string }>
}> => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            timezone: true,
            guestVisitsEnabled: true,
            scheduleEnabled: true,
            subscriptionEnabled: true,
        },
    })
    if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })

    // The owner has no member row: member stays null and reads as not_member.
    const member = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        select: {
            status: true,
            subscriptions: {
                where: currentSubscriptionWhere(now),
                orderBy: currentSubscriptionOrderBy,
                select: {
                    id: true,
                    status: true,
                    startDate: true,
                    endDate: true,
                    classesRemaining: true,
                    ...subscriptionScopeIdsSelect,
                },
            },
        },
    })
    const abonements = (member?.subscriptions ?? []).map((s) => ({
        id: s.id,
        status: s.status,
        startDate: s.startDate,
        endDate: s.endDate,
        classesRemaining: s.classesRemaining,
        directionIds: scopeDirectionIds(s),
    }))

    const upcoming = await loadUpcomingBookings(
        prisma,
        workspaceId,
        userId,
        workspace.timezone,
        now,
    )
    const openBookings = upcoming.filter(
        ({ occ }) =>
            occ.scheduled &&
            !occ.cancelled &&
            occ.startAt.getTime() > now.getTime(),
    )

    return {
        timezone: workspace.timezone,
        subscriptionRequired: workspace.subscriptionEnabled,
        upcoming,
        openBookings,
        reason: dropInBlockReason({
            featureOn: workspace.guestVisitsEnabled && workspace.scheduleEnabled,
            member,
            subscriptionRequired: workspace.subscriptionEnabled,
            abonements,
            openBookings: openBookings.length,
            now,
        }),
        abonements,
    }
}
