import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetClubMessageFeature,
    type GetClubMessageFeatureResponse,
} from './get-club-message.feature'
import { loadClubMessageOutput } from './schemas'
import { loadVisibleMessage, resolveMessageViewer } from './visibility'

@Feature(GetClubMessageFeature)
export class GetClubMessageHandler
    implements IFeatureHandler<GetClubMessageFeature, GetClubMessageFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetClubMessageFeature): Promise<GetClubMessageFeatureResponse> {
        const viewer = await resolveMessageViewer(this.rbac, f)
        const row = await loadVisibleMessage(this.prisma, viewer, f.messageId)
        return loadClubMessageOutput(this.prisma, f.workspaceId, row)
    }
}
