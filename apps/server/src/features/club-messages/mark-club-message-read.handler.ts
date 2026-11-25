import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    MarkClubMessageReadFeature,
    type MarkClubMessageReadFeatureResponse,
} from './mark-club-message-read.feature'
import { loadClubCard, loadMyRecipient, serializeMyClubMessage } from './my-club-messages'

// Opening a message in the app stamps «открыли» — once: the first open sets
// readAt and bumps the message's readCount in one transaction; later opens
// change nothing.
@Feature(MarkClubMessageReadFeature)
export class MarkClubMessageReadHandler
    implements IFeatureHandler<MarkClubMessageReadFeature, MarkClubMessageReadFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: MarkClubMessageReadFeature): Promise<MarkClubMessageReadFeatureResponse> {
        await loadMyRecipient(this.prisma, f)
        const now = new Date()
        const first = await this.prisma.$transaction(async (tx) => {
            const stamped = await tx.clubMessageRecipient.updateMany({
                where: { messageId: f.messageId, userId: f.userId, readAt: null },
                data: { readAt: now },
            })
            if (stamped.count === 0) return false
            await tx.clubMessage.update({
                where: { id: f.messageId },
                data: { readCount: { increment: 1 } },
            })
            return true
        })
        if (first) {
            this.realtime.invalidateCoalesced(f.workspaceId, ['messages'])
            this.realtime.invalidateUsersInWorkspace([f.userId], f.workspaceId, ['club-messages'])
        }
        const [row, club] = await Promise.all([
            loadMyRecipient(this.prisma, f),
            loadClubCard(this.prisma, this.files, f.workspaceId),
        ])
        return serializeMyClubMessage(row, club)
    }
}
