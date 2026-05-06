import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetWorkspaceSettingsFeature,
    GetWorkspaceSettingsFeatureResponse,
} from './get-workspace-settings.feature'

@Feature(GetWorkspaceSettingsFeature)
export class GetWorkspaceSettingsHandler
    implements
        IFeatureHandler<
            GetWorkspaceSettingsFeature,
            GetWorkspaceSettingsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: GetWorkspaceSettingsFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                id: true,
                name: true,
                coachSeesAllGroups: true,
                timezone: true,
            },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }
        return workspace
    }
}
