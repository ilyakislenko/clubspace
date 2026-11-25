import { Feature, IFeatureHandler } from '@shelfjs/features'

import type { PushSkip } from '../../domains/messages/kinds'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import { memberGuardiansSelect } from '../dependents/schemas'
import {
    ListClubMessageRecipientsFeature,
    type ListClubMessageRecipientsFeatureResponse,
} from './list-club-message-recipients.feature'
import { CLUB_MESSAGES_DEFAULT_PER_PAGE } from './schemas'
import { loadVisibleMessage, resolveMessageViewer } from './visibility'

// Who got a message and who opened it. A coach or direction manager sees only
// recipients still in their own groups.
@Feature(ListClubMessageRecipientsFeature)
export class ListClubMessageRecipientsHandler
    implements
        IFeatureHandler<ListClubMessageRecipientsFeature, ListClubMessageRecipientsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: ListClubMessageRecipientsFeature,
    ): Promise<ListClubMessageRecipientsFeatureResponse> {
        const viewer = await resolveMessageViewer(this.rbac, f)
        await loadVisibleMessage(this.prisma, viewer, f.messageId)
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? CLUB_MESSAGES_DEFAULT_PER_PAGE
        const inScope = viewer.isLead ? null : await this.rbac.ownGroupMemberIds(viewer.ctx)
        const where: Prisma.ClubMessageRecipientWhereInput = {
            messageId: f.messageId,
            ...(inScope ? { userId: { in: inScope } } : {}),
            ...(f.payload.read === true ? { readAt: { not: null } } : {}),
            ...(f.payload.read === false ? { readAt: null } : {}),
        }
        const [rows, total] = await Promise.all([
            this.prisma.clubMessageRecipient.findMany({
                where,
                orderBy: [
                    { readAt: { sort: 'asc', nulls: 'first' } },
                    { user: { firstname: { sort: 'asc', nulls: 'last' } } },
                    { user: { lastname: { sort: 'asc', nulls: 'last' } } },
                    { id: 'asc' },
                ],
                skip: (curPage - 1) * perPage,
                take: perPage,
                select: {
                    userId: true,
                    pushSkip: true,
                    emailedAt: true,
                    readAt: true,
                    user: {
                        select: {
                            firstname: true,
                            lastname: true,
                            email: true,
                            dependentOf: memberGuardiansSelect,
                        },
                    },
                },
            }),
            this.prisma.clubMessageRecipient.count({ where }),
        ])
        return {
            data: rows.map((r) => ({
                userId: r.userId,
                name: displayName(r.user),
                isDependent: r.user.dependentOf.length > 0,
                guardianNames: r.user.dependentOf
                    .filter((g) => g.consentAt !== null)
                    .map((g) => displayName(g.guardian)),
                pushSkip: r.pushSkip as PushSkip | null,
                emailedAt: r.emailedAt?.toISOString() ?? null,
                readAt: r.readAt?.toISOString() ?? null,
            })),
            total,
            curPage,
            perPage,
        }
    }
}
