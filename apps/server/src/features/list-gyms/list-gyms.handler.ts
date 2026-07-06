import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { serializeGymCard } from './gym-card'
import {
    ListGymsFeature,
    ListGymsFeatureResponse,
} from './list-gyms.feature'

@Feature(ListGymsFeature)
export class ListGymsHandler
    implements IFeatureHandler<ListGymsFeature, ListGymsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: ListGymsFeature) {
        const gyms = await this.prisma.gym.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'asc' },
            include: {
                _count: { select: { groups: true } },
            },
        })

        return {
            data: gyms.map((gym) =>
                serializeGymCard(gym, gym._count.groups),
            ),
            total: gyms.length,
        }
    }
}
