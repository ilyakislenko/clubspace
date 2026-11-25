import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    GetMyClubMessageFeature,
    type GetMyClubMessageFeatureResponse,
} from './get-my-club-message.feature'
import { loadClubCard, loadMyRecipient, serializeMyClubMessage } from './my-club-messages'

@Feature(GetMyClubMessageFeature)
export class GetMyClubMessageHandler
    implements IFeatureHandler<GetMyClubMessageFeature, GetMyClubMessageFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(f: GetMyClubMessageFeature): Promise<GetMyClubMessageFeatureResponse> {
        const [row, club] = await Promise.all([
            loadMyRecipient(this.prisma, f),
            loadClubCard(this.prisma, this.files, f.workspaceId),
        ])
        return serializeMyClubMessage(row, club)
    }
}
