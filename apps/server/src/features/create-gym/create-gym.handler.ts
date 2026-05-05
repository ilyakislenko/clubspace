import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
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
    ) {}

    async execute({ payload, workspaceId, invokerUserId }: CreateGymFeature) {
        const gym = await this.prisma.gym.create({
            data: {
                workspaceId,
                name: payload.name,
                address: payload.address,
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
