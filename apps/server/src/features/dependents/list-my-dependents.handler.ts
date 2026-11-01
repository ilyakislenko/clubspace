import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyDependentsFeature,
    ListMyDependentsFeatureResponse,
} from './my-dependents.feature'
import { myDependentSelect, serializeMyDependent } from './schemas'

@Feature(ListMyDependentsFeature)
export class ListMyDependentsHandler
    implements
        IFeatureHandler<ListMyDependentsFeature, ListMyDependentsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        guardianId,
    }: ListMyDependentsFeature): Promise<ListMyDependentsFeatureResponse> {
        const rows = await this.prisma.guardianship.findMany({
            where: { guardianId, dependent: { status: 'ACTIVE' } },
            orderBy: { createdAt: 'asc' },
            select: myDependentSelect,
        })
        return { data: rows.map(serializeMyDependent) }
    }
}
