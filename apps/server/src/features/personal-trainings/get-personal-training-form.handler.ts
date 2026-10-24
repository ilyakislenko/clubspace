import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    GetPersonalTrainingFormFeature,
    GetPersonalTrainingFormFeatureResponse,
} from './get-personal-training-form.feature'
import { loadOfferingCoaches } from './personal-training-access'

@Feature(GetPersonalTrainingFormFeature)
export class GetPersonalTrainingFormHandler
    implements
        IFeatureHandler<
            GetPersonalTrainingFormFeature,
            GetPersonalTrainingFormFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, invokerUserId }: GetPersonalTrainingFormFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        })
        const timezone = workspace?.timezone ?? 'UTC'
        const coaches = (
            await loadOfferingCoaches(this.prisma, workspaceId)
        ).filter((c) => c.userId !== invokerUserId)
        const gyms = await this.prisma.gym.findMany({
            where: { workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, address: true, timezone: true },
        })
        return {
            timezone,
            coaches,
            gyms: gyms.map((g) => ({
                id: g.id,
                name: g.name,
                address: g.address,
                timezone: g.timezone ?? timezone,
            })),
        }
    }
}
