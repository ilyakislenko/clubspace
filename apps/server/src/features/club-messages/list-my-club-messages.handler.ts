import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyClubMessagesFeature,
    type ListMyClubMessagesFeatureResponse,
} from './list-my-club-messages.feature'
import {
    loadClubCard,
    myRecipientSelect,
    myRecipientWhere,
    serializeMyClubMessage,
} from './my-club-messages'
import { CLUB_MESSAGES_DEFAULT_PER_PAGE } from './schemas'

// The app's «Сообщения клуба»: every message the member received from this
// club, whether or not a push went out.
@Feature(ListMyClubMessagesFeature)
export class ListMyClubMessagesHandler
    implements IFeatureHandler<ListMyClubMessagesFeature, ListMyClubMessagesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(f: ListMyClubMessagesFeature): Promise<ListMyClubMessagesFeatureResponse> {
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? CLUB_MESSAGES_DEFAULT_PER_PAGE
        const where = myRecipientWhere(f.workspaceId, f.userId)
        const [rows, total, unreadCount, club] = await Promise.all([
            this.prisma.clubMessageRecipient.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                skip: (curPage - 1) * perPage,
                take: perPage,
                select: myRecipientSelect,
            }),
            this.prisma.clubMessageRecipient.count({ where }),
            this.prisma.clubMessageRecipient.count({ where: { ...where, readAt: null } }),
            loadClubCard(this.prisma, this.files, f.workspaceId),
        ])
        return {
            data: rows.map((r) => serializeMyClubMessage(r, club)),
            total,
            curPage,
            perPage,
            unreadCount,
        }
    }
}
