import { Logger } from '@nestjs/common'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { claimDispatch } from '../../domains/scheduler/dispatch-claims'
import { PrismaService } from '../../infrastructure/prisma'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import { displayName } from '../attendance/schemas'
import { type ClassSubstitutionRow, substitutionWhen } from './schemas'

export type SubstitutionEvent =
    // Approved: assigned at once or a request given the go-ahead.
    | 'approved'
    | 'requested'
    | 'declined'
    | 'cancelled'

// «И. Фамилия» — how members see who runs the class.
export const shortCoachName = (u: {
    firstname: string | null
    lastname: string | null
    email: string | null
}): string =>
    u.firstname && u.lastname
        ? `${u.firstname.charAt(0)}. ${u.lastname}`
        : displayName(u)

const classLabel = (row: ClassSubstitutionRow): string =>
    `${row.group.name}, ${formatRuDate(row.sessionDate, 'UTC')} в ${row.slot.startTime}`

// Members expecting the class: its group, guests who booked it, places held
// in a «Запись на занятие» class.
const classAudience = async (
    prisma: PrismaService,
    row: ClassSubstitutionRow,
): Promise<string[]> => {
    const [members, dropIns, places] = await Promise.all([
        prisma.groupMember.findMany({
            where: { groupId: row.groupId },
            select: { userId: true },
        }),
        prisma.dropInBooking.findMany({
            where: { workspaceId: row.workspaceId, occurrenceKey: row.occurrenceKey },
            select: { userId: true },
        }),
        prisma.classBooking.findMany({
            where: {
                status: 'BOOKED',
                occurrence: {
                    workspaceId: row.workspaceId,
                    occurrenceKey: row.occurrenceKey,
                },
            },
            select: { userId: true },
        }),
    ])
    return [...new Set([...members, ...dropIns, ...places].map((m) => m.userId))]
}

// Pushes for one transition of a substitution. Best-effort: a failed push
// never fails the transition. Dedupe keys carry the transition time, so a
// later re-assignment of the same class is announced again.
export const notifyClassSubstitution = async (
    deps: {
        prisma: PrismaService
        notifications: NotificationProducerService
        logger: Logger
    },
    row: ClassSubstitutionRow,
    event: SubstitutionEvent,
    actorId: string,
    // Approvers of a request: the group's coaches and its direction's managers.
    deciderIds: string[] = [],
): Promise<void> => {
    const { prisma, notifications, logger } = deps
    const stamp = `${row.id}:${event}:${row.updatedAt.getTime()}`
    const label = classLabel(row)
    const substitute = shortCoachName(row.substitute)
    const regular = shortCoachName(row.group.coach)
    const coachIds = row.group.coaches.map((c) => c.userId)
    const metadata = {
        workspaceId: row.workspaceId,
        substitutionId: row.id,
        groupId: row.groupId,
        slotId: row.slotId,
        sessionDate: row.sessionDate.toISOString().slice(0, 10),
    }

    const direct: Array<{ userId: string; topic: string; message: string }> = []
    const add = (ids: string[], topic: string, message: string) => {
        for (const userId of ids) {
            if (userId === actorId || direct.some((d) => d.userId === userId)) continue
            direct.push({ userId, topic, message })
        }
    }

    let audience: { topic: string; message: string } | null = null
    if (event === 'approved') {
        add(
            [row.substituteId],
            row.kind === 'OFFER' ? 'Замену одобрили' : 'Вам назначили замену',
            `Вы ведёте: ${label}`,
        )
        add(
            coachIds.filter((id) => id !== row.substituteId),
            'Замена в вашей группе',
            `${label} — проведёт ${substitute}`,
        )
        audience = {
            topic: `Замена ${(await loadClubVocabulary(prisma, row.workspaceId)).coach.gen}`,
            message: `${label} — проведёт ${substitute}`,
        }
    } else if (event === 'requested') {
        add(
            deciderIds.filter((id) => id !== row.substituteId),
            'Запрос на замену',
            `${displayName(row.substitute)} хочет провести: ${label}`,
        )
    } else if (event === 'declined') {
        add([row.substituteId], 'Замену отклонили', label)
    } else {
        add([row.substituteId], 'Замена отменена', label)
        if (row.status === 'APPROVED') {
            add(
                coachIds.filter((id) => id !== row.substituteId),
                'Замена отменена',
                `${label} — ${substitute} не проведёт занятие`,
            )
            audience = {
                topic: 'Замена отменена',
                message: `${label} — занятие проведёт ${regular}`,
            }
        }
    }

    for (const d of direct) {
        try {
            await notifications.notifyUser({
                userId: d.userId,
                kind: `substitution.${event}`,
                refId: `${stamp}:${d.userId}`,
                topic: d.topic,
                message: d.message,
                metadata,
                workspaceId: row.workspaceId,
            })
        } catch (err) {
            logger.warn(
                `Substitution notification failed: ${err instanceof Error ? err.message : String(err)}`,
            )
        }
    }

    // Members only hear about a class still ahead.
    if (!audience || substitutionWhen(row).startAt.getTime() <= Date.now()) return
    try {
        const skip = new Set([actorId, row.substituteId, ...coachIds])
        const recipients = (await classAudience(prisma, row)).filter(
            (id) => !skip.has(id),
        )
        if (recipients.length === 0) return
        if (!(await claimDispatch(prisma, 'substitution.members', stamp))) return
        await notifications.writeMany(
            recipients.map((userId) => ({
                userId,
                topic: audience.topic,
                message: audience.message,
                metadata: { kind: 'substitution.members', ...metadata },
            })),
        )
    } catch (err) {
        logger.warn(
            `Substitution members notification failed: ${err instanceof Error ? err.message : String(err)}`,
        )
    }
}
