import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GeocodingService } from '../../shared/services/geocoding.service'
import { serializeGymCard } from '../list-gyms/gym-card'

const isValidIanaTz = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}
import {
    UpdateGymFeature,
    UpdateGymFeatureResponse,
} from './update-gym.feature'

@Feature(UpdateGymFeature)
export class UpdateGymHandler
    implements IFeatureHandler<UpdateGymFeature, UpdateGymFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly geocoding: GeocodingService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        gymId,
        invokerUserId,
    }: UpdateGymFeature) {
        const gym = await this.prisma.gym.findFirst({
            where: { id: gymId, workspaceId },
            select: { id: true, name: true, address: true },
        })

        if (!gym) {
            throw new NotFoundError({ message: 'Зал не найден' })
        }

        // Re-geocode only when the address changes — keeps Nominatim
        // requests minimal and avoids accidentally clobbering manual
        // corrections in cases where someone edits just the gym name.
        let lat: number | null | undefined
        let lng: number | null | undefined
        if (
            payload.address !== undefined &&
            payload.address !== gym.address
        ) {
            const coords = await this.geocoding.geocode(payload.address)
            lat = coords?.lat ?? null
            lng = coords?.lng ?? null
        }

        if (payload.timezone && !isValidIanaTz(payload.timezone)) {
            throw new BadRequestError({ message: 'Неизвестный часовой пояс' })
        }

        const updated = await this.prisma.gym.update({
            where: { id: gymId },
            data: {
                ...(payload.name !== undefined ? { name: payload.name } : {}),
                ...(payload.address !== undefined
                    ? { address: payload.address }
                    : {}),
                ...(payload.timezone !== undefined
                    ? { timezone: payload.timezone }
                    : {}),
                ...(lat !== undefined ? { lat } : {}),
                ...(lng !== undefined ? { lng } : {}),
            },
            include: { _count: { select: { groups: true } } },
        })

        await this.audit.record({
            action: 'gym.update',
            targetType: 'gym',
            targetId: gymId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { changes: payload },
        })

        this.realtime.emitListDelta(
            workspaceId,
            'gyms',
            'update',
            serializeGymCard(updated, updated._count.groups),
        )

        return {
            id: updated.id,
            name: updated.name,
            address: updated.address,
            timezone: updated.timezone,
        }
    }
}
