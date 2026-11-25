import { Feature, IFeatureHandler } from '@shelfjs/features'

import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListClubMessagesFeature,
    type ListClubMessagesFeatureResponse,
} from './list-club-messages.feature'
import {
    CLUB_MESSAGES_DEFAULT_PER_PAGE,
    clubMessageSelect,
    loadAudienceLabels,
    serializeClubMessage,
} from './schemas'
import { resolveMessageViewer } from './visibility'

// «Ученики → Сообщения» and the member card block: sport leads see every
// message of the club, a coach or direction manager the ones they wrote.
@Feature(ListClubMessagesFeature)
export class ListClubMessagesHandler
    implements IFeatureHandler<ListClubMessagesFeature, ListClubMessagesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListClubMessagesFeature): Promise<ListClubMessagesFeatureResponse> {
        const viewer = await resolveMessageViewer(this.rbac, f)
        const { userId, status } = f.payload
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? CLUB_MESSAGES_DEFAULT_PER_PAGE
        const where: Prisma.ClubMessageWhereInput = {
            ...viewer.where,
            ...(status ? { status } : {}),
            ...(userId ? { recipients: { some: { userId } } } : {}),
        }
        const [rows, total, workspace] = await Promise.all([
            this.prisma.clubMessage.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                skip: (curPage - 1) * perPage,
                take: perPage,
                select: clubMessageSelect,
            }),
            this.prisma.clubMessage.count({ where }),
            this.prisma.workspace.findUniqueOrThrow({
                where: { id: f.workspaceId },
                select: { timezone: true },
            }),
        ])
        const [labels, reads] = await Promise.all([
            loadAudienceLabels(this.prisma, f.workspaceId, rows),
            userId && rows.length > 0
                ? this.prisma.clubMessageRecipient.findMany({
                      where: { userId, messageId: { in: rows.map((r) => r.id) } },
                      select: { messageId: true, readAt: true },
                  })
                : [],
        ])
        const readAt = new Map(reads.map((r) => [r.messageId, r.readAt]))
        return {
            data: rows.map((r) =>
                serializeClubMessage(r, labels.get(r.id) ?? '', readAt.get(r.id) ?? null),
            ),
            total,
            curPage,
            perPage,
            timezone: workspace.timezone,
        }
    }
}
