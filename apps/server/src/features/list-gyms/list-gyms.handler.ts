import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
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
            data: gyms.map((gym) => ({
                id: gym.id,
                name: gym.name,
                address: gym.address,
                lat: gym.lat,
                lng: gym.lng,
                groupCount: gym._count.groups,
                createdAt: gym.createdAt.toISOString(),
            })),
            total: gyms.length,
        }
    }
}
