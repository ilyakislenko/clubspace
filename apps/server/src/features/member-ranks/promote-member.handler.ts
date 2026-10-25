import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RankService } from '../../domains/ranks/services/rank.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    PromoteMemberFeature,
    PromoteMemberFeatureResponse,
} from './promote-member.feature'
import { notifyPromotion } from './notify-promotion'
import { serializePromotion } from './schemas'

@Feature(PromoteMemberFeature)
export class PromoteMemberHandler
    implements
        IFeatureHandler<PromoteMemberFeature, PromoteMemberFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly ranks: RankService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: PromoteMemberFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        // Target must be an ACTIVE member — or the owner (who has no member row
        // but can hold a rank).
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        if (f.userId !== workspace.ownerId) {
            const member = await this.prisma.workspaceMember.findFirst({
                where: {
                    userId: f.userId,
                    workspaceId: f.workspaceId,
                    status: 'ACTIVE',
                },
                select: { id: true },
            })
            if (!member) {
                throw new BadRequestError({
                    message: 'Участник неактивен в этом клубе',
                })
            }
        }

        const promotion = await this.ranks.promote({
            workspaceId: f.workspaceId,
            userId: f.userId,
            ladderId: f.payload.ladderId,
            levelId: f.payload.levelId,
            stripes: f.payload.stripes,
            awardedById: f.invokerUserId,
            note: f.payload.note,
        })

        // Congratulate the member (unless a coach promoted themselves).
        if (f.userId !== f.invokerUserId) {
            await notifyPromotion(this.notifications, f.workspaceId, promotion)
        }

        // Live-refresh the promoted member's rank screen.
        this.realtime.invalidate(f.workspaceId, ['ranks'])

        const awardedBy = await this.prisma.user.findUnique({
            where: { id: f.invokerUserId },
            select: { firstname: true, lastname: true, status: true },
        })
        return serializePromotion(promotion, awardedBy)
    }
}
