import { TZDate } from '@date-fns/tz'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { serializeEvent } from './schemas'
import {
    UpdateWorkspaceEventFeature,
    UpdateWorkspaceEventFeatureResponse,
} from './update-workspace-event.feature'

const isValidIanaTz = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

const wallClockToUtc = (wallClock: string, tz: string): Date => {
    const [datePart, timePart] = wallClock.split('T')
    const [y, mo, d] = datePart.split('-').map((p) => parseInt(p, 10))
    const [h, mi, s] = timePart.split(':').map((p) => parseInt(p, 10))
    return new Date(
        new TZDate(y, mo - 1, d, h, mi, s ?? 0, tz).getTime(),
    )
}

// Extract the wall-clock string ("YYYY-MM-DDTHH:MM:SS") that the given
// UTC instant represents in the given IANA zone. Used when an update
// changes only the timezone — we want the wall-clock the admin
// originally typed to be preserved, just reinterpreted in the new zone.
const utcToWallClock = (utc: Date, tz: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
        .formatToParts(utc)
        .reduce<Record<string, string>>((acc, p) => {
            if (p.type !== 'literal') acc[p.type] = p.value
            return acc
        }, {})
    // Intl returns hour "24" for midnight in some locales; coerce to 00.
    const hour = parts.hour === '24' ? '00' : parts.hour
    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`
}

@Feature(UpdateWorkspaceEventFeature)
export class UpdateWorkspaceEventHandler
    implements
        IFeatureHandler<
            UpdateWorkspaceEventFeature,
            UpdateWorkspaceEventFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        eventId,
        invokerUserId,
    }: UpdateWorkspaceEventFeature) {
        const existing = await this.prisma.workspaceEvent.findFirst({
            where: { id: eventId, workspaceId },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Event not found' })
        }

        // Pick the effective timezone for this update. If the admin
        // changes only the tz (no new wall-clocks), we re-interpret the
        // wall-clock that's currently saved — admin intent is "the
        // event happens at the same wall-clock, but I tagged the wrong
        // city". If they pass new wall-clocks, those parse in the new
        // tz directly.
        const effectiveTz = payload.timezone ?? existing.timezone
        if (payload.timezone && !isValidIanaTz(payload.timezone)) {
            throw new BadRequestError({ message: 'Unknown IANA timezone' })
        }

        const startWall =
            payload.startAt ??
            (payload.timezone
                ? utcToWallClock(existing.startAt, existing.timezone)
                : null)
        const endWall =
            payload.endAt ??
            (payload.timezone
                ? utcToWallClock(existing.endAt, existing.timezone)
                : null)

        const startAt = startWall
            ? wallClockToUtc(startWall, effectiveTz)
            : existing.startAt
        const endAt = endWall
            ? wallClockToUtc(endWall, effectiveTz)
            : existing.endAt
        if (startAt >= endAt) {
            throw new BadRequestError({
                message: 'startAt must be before endAt',
            })
        }

        if (payload.gymId !== undefined && payload.gymId !== null) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Gym not found' })
        }
        if (payload.coachId !== undefined && payload.coachId !== null) {
            const member = await this.prisma.workspaceMember.findFirst({
                where: { userId: payload.coachId, workspaceId },
                select: { userId: true },
            })
            if (!member) {
                throw new NotFoundError({
                    message: 'Coach is not a workspace member',
                })
            }
        }

        const updated = await this.prisma.workspaceEvent.update({
            where: { id: eventId },
            data: {
                ...(payload.title !== undefined && { title: payload.title }),
                ...(payload.description !== undefined && {
                    description: payload.description,
                }),
                ...(payload.link !== undefined && { link: payload.link }),
                // Persist startAt/endAt whenever the timezone changed
                // even if the admin didn't pass new wall-clocks — the
                // UTC instants slide to keep the wall-clock fixed.
                ...((payload.startAt !== undefined ||
                    payload.timezone !== undefined) && { startAt }),
                ...((payload.endAt !== undefined ||
                    payload.timezone !== undefined) && { endAt }),
                ...(payload.timezone !== undefined && {
                    timezone: payload.timezone,
                }),
                ...(payload.gymId !== undefined && { gymId: payload.gymId }),
                ...(payload.coachId !== undefined && {
                    coachId: payload.coachId,
                }),
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
            action: 'event.update',
            targetType: 'event',
            targetId: eventId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { fields: Object.keys(payload) },
        })

        return serializeEvent(updated)
    }
}
