import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { GeocodingService } from '../../shared/services/geocoding.service'
import {
    CreateGymFeature,
    CreateGymFeatureResponse,
} from './create-gym.feature'

@Feature(CreateGymFeature)
export class CreateGymHandler
    implements IFeatureHandler<CreateGymFeature, CreateGymFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly geocoding: GeocodingService,
    ) {}

    async execute({ payload, workspaceId, invokerUserId }: CreateGymFeature) {
        // Best-effort geocoding — saves the gym anyway if Nominatim is
        // unreachable, since the map is incremental enrichment.
        const coords = await this.geocoding.geocode(payload.address)

        const gym = await this.prisma.gym.create({
            data: {
                workspaceId,
                name: payload.name,
                address: payload.address,
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
            metadata: { name: gym.name, address: gym.address },
        })

        return {
            id: gym.id,
            name: gym.name,
            address: gym.address,
        }
    }
}
