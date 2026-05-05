import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
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
            throw new NotFoundError({ message: 'Gym not found' })
        }

        const updated = await this.prisma.gym.update({
            where: { id: gymId },
            data: {
                ...(payload.name !== undefined ? { name: payload.name } : {}),
                ...(payload.address !== undefined
                    ? { address: payload.address }
                    : {}),
            },
        })

        await this.audit.record({
            action: 'gym.update',
            targetType: 'gym',
            targetId: gymId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { changes: payload },
        })

        return {
            id: updated.id,
            name: updated.name,
            address: updated.address,
        }
    }
}
