import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetClubAboutFeature,
    GetClubAboutFeatureResponse,
} from './get-club-about.feature'
import { serializeClubAbout } from './schemas'

@Feature(GetClubAboutFeature)
export class GetClubAboutHandler
    implements IFeatureHandler<GetClubAboutFeature, GetClubAboutFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: GetClubAboutFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                aboutContacts: true,
                aboutLinks: true,
                aboutRules: true,
                aboutUpdatedAt: true,
            },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        return serializeClubAbout(workspace)
    }
}
