import { TZDate } from '@date-fns/tz'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    CreateWorkspaceEventFeature,
    CreateWorkspaceEventFeatureResponse,
} from './create-workspace-event.feature'
import { serializeEvent } from './schemas'

// Validate against the runtime's IANA database. Catches typos like
// "Europe/Mosсow" (Cyrillic с) and unknown aliases without shipping a
// 400-entry whitelist.
const isValidIanaTz = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

// "2026-05-08T14:00" + tz -> absolute UTC instant for that wall-clock
// in that zone. Seconds optional. We parse manually because TZDate's
// constructor takes (year, month, day, hour, minute, tz) numerics, and
// the input arrives as a string from the admin form.
const wallClockToUtc = (wallClock: string, tz: string): Date => {
    const [datePart, timePart] = wallClock.split('T')
    const [y, mo, d] = datePart.split('-').map((p) => parseInt(p, 10))
    const [h, mi, s] = timePart.split(':').map((p) => parseInt(p, 10))
    return new Date(
        new TZDate(y, mo - 1, d, h, mi, s ?? 0, tz).getTime(),
    )
}

@Feature(CreateWorkspaceEventFeature)
export class CreateWorkspaceEventHandler
    implements
        IFeatureHandler<
            CreateWorkspaceEventFeature,
            CreateWorkspaceEventFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: CreateWorkspaceEventFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        // Falls back to workspace.timezone when the admin doesn't pick
        // one — most workspaces have a single canonical zone.
        const timezone = payload.timezone ?? workspace.timezone
        if (!isValidIanaTz(timezone)) {
            throw new BadRequestError({ message: 'Неизвестный часовой пояс' })
        }

        if (payload.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
        }
        if (payload.coachId) {
            const member = await this.prisma.workspaceMember.findFirst({
                where: { userId: payload.coachId, workspaceId },
                select: { userId: true },
            })
            if (!member) {
                throw new NotFoundError({
                    message: 'Тренер не является участником клуба',
                })
            }
        }

        // Default coachId to the creator so list views show "by [Coach
        // name]" without the form forcing an explicit pick.
        const coachId = payload.coachId ?? invokerUserId

        const created = await this.prisma.workspaceEvent.create({
            data: {
                workspaceId,
                title: payload.title,
                description: payload.description ?? null,
                link: payload.link ?? null,
                startAt: wallClockToUtc(payload.startAt, timezone),
                endAt: wallClockToUtc(payload.endAt, timezone),
                timezone,
                gymId: payload.gymId ?? null,
                coachId,
                createdById: invokerUserId,
            },
            include: {
                gym: { select: { id: true, name: true, address: true } },
                coach: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
            },
        })

        await this.audit.record({
            action: 'event.create',
            targetType: 'event',
            targetId: created.id,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                title: created.title,
                startAt: created.startAt.toISOString(),
                endAt: created.endAt.toISOString(),
                gymId: created.gymId,
                coachId: created.coachId,
            },
        })

        const serialized = serializeEvent(created)
        this.realtime.emitListDelta(
            workspaceId,
            'events',
            'create',
            serialized,
        )
        return serialized
    }
}
