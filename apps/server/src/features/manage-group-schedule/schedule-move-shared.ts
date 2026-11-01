// The I/O both calendar drags share: loading the group with its slots, who
// hears about the change, the push and the realtime refresh.
import { Logger } from '@nestjs/common'

import type { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import type { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'

const logger = new Logger('ScheduleMoves')

export const loadMoveContext = async (
    prisma: PrismaService,
    p: { workspaceId: string; groupId: string; slotId: string },
) => {
    const group = await prisma.group.findFirst({
        where: { id: p.groupId, workspaceId: p.workspaceId },
        select: {
            id: true,
            name: true,
            bookingMode: true,
            gym: { select: { timezone: true } },
            workspace: { select: { timezone: true } },
            slots: true,
        },
    })
    const slot = group?.slots.find((s) => s.id === p.slotId)
    if (!group || !slot) {
        throw new NotFoundError({ message: 'Слот расписания не найден' })
    }
    return {
        group,
        slot,
        // Slot times are wall-clock in the gym's zone, else the club's.
        tz: group.gym?.timezone ?? group.workspace.timezone,
    }
}

// The group's coaches, the substitute coach of the moved class(es), its people
// — its members for a fixed group (or `allMembers`), the live bookings for
// «Запись на занятие» — and the drop-in guests; never the actor. Read before
// the re-key.
export const collectMoveRecipients = async (
    prisma: PrismaService,
    p: {
        workspaceId: string
        group: { id: string; bookingMode: string }
        slotId: string
        sessionDate: Date | { gte: Date }
        allMembers: boolean
        actorId: string
    },
): Promise<string[]> => {
    const occurrence = {
        workspaceId: p.workspaceId,
        slotId: p.slotId,
        sessionDate: p.sessionDate,
    }
    const members = p.allMembers || p.group.bookingMode !== 'BOOKING'
    const [coaches, substitutes, groupMembers, bookers, guests] = await Promise.all([
        prisma.groupCoach.findMany({
            where: { groupId: p.group.id },
            select: { userId: true },
        }),
        prisma.classSubstitution.findMany({
            where: occurrence,
            select: { substituteId: true },
        }),
        members
            ? prisma.groupMember.findMany({
                  where: { groupId: p.group.id },
                  select: { userId: true },
              })
            : Promise.resolve([]),
        p.group.bookingMode === 'BOOKING'
            ? prisma.classBooking.findMany({
                  where: {
                      status: { in: ['BOOKED', 'WAITLISTED'] },
                      occurrence,
                  },
                  select: { userId: true },
              })
            : Promise.resolve([]),
        prisma.dropInBooking.findMany({
            where: occurrence,
            select: { userId: true },
        }),
    ])
    const ids = new Set([
        ...[...coaches, ...groupMembers, ...bookers, ...guests].map((r) => r.userId),
        ...substitutes.map((r) => r.substituteId),
    ])
    ids.delete(p.actorId)
    return [...ids]
}

// Best-effort push: the move is committed, a failed push must not undo it.
export const pushScheduleMoved = async (
    producer: NotificationProducerService,
    realtime: RealtimeEmitter,
    p: {
        recipients: string[]
        topic: string
        message: string
        workspaceId: string
        groupId: string
        slotId: string
        sessionDate: string
    },
): Promise<void> => {
    if (p.recipients.length === 0) return
    try {
        await producer.writeMany(
            p.recipients.map((userId) => ({
                userId,
                topic: p.topic,
                message: p.message,
                link: null,
                metadata: {
                    kind: 'schedule.moved',
                    workspaceId: p.workspaceId,
                    groupId: p.groupId,
                    slotId: p.slotId,
                    sessionDate: p.sessionDate,
                },
            })),
        )
        realtime.invalidateUsers(p.recipients, ['notifications'])
    } catch (err) {
        logger.warn(
            `schedule.moved push failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        )
    }
}

export const invalidateSchedule = (
    realtime: RealtimeEmitter,
    workspaceId: string,
): void =>
    realtime.invalidate(workspaceId, [
        'schedule',
        'groups',
        'attendance',
        'classbookings',
    ])
