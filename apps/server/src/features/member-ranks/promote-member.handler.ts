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
        if (!workspace) throw new NotFoundError({ message: 'Workspace not found' })
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
                    message: 'Member is not an active member of this workspace',
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
            const stripeSuffix = promotion.stripes
                ? ` (${promotion.stripes}★)`
                : ''
            await this.notifications.notifyUser({
                userId: f.userId,
                kind: 'rank.promoted',
                refId: promotion.id,
                topic: 'Новый ранг',
                message: `Поздравляем! Вам присвоен ранг: ${promotion.level.name}${stripeSuffix} — ${promotion.ladder.name}`,
                metadata: {
                    promotionId: promotion.id,
                    ladderId: promotion.ladderId,
                    levelId: promotion.levelId,
                },
                category: 'promotionsEnabled',
            })
        }

        // Live-refresh the promoted member's rank screen.
        this.realtime.invalidate(f.workspaceId, ['ranks'])

        return serializePromotion(promotion)
    }
}
