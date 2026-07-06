import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { GeocodingService } from '../../shared/services/geocoding.service'
import { serializeGymCard } from '../list-gyms/gym-card'
import {
    CreateGymFeature,
    CreateGymFeatureResponse,
} from './create-gym.feature'

// Validate against the runtime's IANA database. Catches typos like
// "Europe/Mosсow" (Cyrillic с) without us shipping a full whitelist.
const isValidIanaTz = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}

@Feature(CreateGymFeature)
export class CreateGymHandler
    implements IFeatureHandler<CreateGymFeature, CreateGymFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly geocoding: GeocodingService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({ payload, workspaceId, invokerUserId }: CreateGymFeature) {
        if (payload.timezone && !isValidIanaTz(payload.timezone)) {
            throw new BadRequestError({ message: 'Unknown IANA timezone' })
        }

        // Best-effort geocoding — saves the gym anyway if Nominatim is
        // unreachable, since the map is incremental enrichment.
        const coords = await this.geocoding.geocode(payload.address)

        const gym = await this.prisma.gym.create({
            data: {
                workspaceId,
                name: payload.name,
                address: payload.address,
                timezone: payload.timezone ?? null,
                lat: coords?.lat ?? null,
                lng: coords?.lng ?? null,
            },
        })

        await this.audit.record({
            action: 'gym.create',
            targetType: 'gym',
            targetId: gym.id,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                name: gym.name,
                address: gym.address,
                timezone: gym.timezone,
            },
        })

        // A brand-new gym has no groups yet → groupCount 0.
        this.realtime.emitListDelta(
            workspaceId,
            'gyms',
            'create',
            serializeGymCard(gym, 0),
        )

        return {
            id: gym.id,
            name: gym.name,
            address: gym.address,
            timezone: gym.timezone,
        }
    }
}
