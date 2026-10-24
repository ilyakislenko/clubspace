import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RankService } from '../../domains/ranks/services/rank.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { notifyPromotion } from './notify-promotion'
import {
    PromoteMembersFeature,
    PromoteMembersFeatureResponse,
} from './promote-members.feature'

// Awards one level of one ladder to many members at once. Same rules as the
// single promote: workspace-admin scope, targets must be active members or the
// owner, one immutable history row + one congratulation per member.
@Feature(PromoteMembersFeature)
export class PromoteMembersHandler
    implements
        IFeatureHandler<PromoteMembersFeature, PromoteMembersFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly ranks: RankService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: PromoteMembersFeature) {
        const ctx = await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        const userIds = [...new Set(f.payload.userIds)]
        const stripes = f.payload.stripes ?? 0

        // All-or-nothing on eligibility: a stale admin list (someone left the
        // club since it loaded) must not half-apply the batch.
        const active = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'ACTIVE',
                userId: { in: userIds },
            },
            select: { userId: true },
        })
        const eligible = new Set(active.map((m) => m.userId))
        if (userIds.includes(ctx.workspaceOwnerId)) {
            eligible.add(ctx.workspaceOwnerId)
        }
        if (eligible.size !== userIds.length) {
            throw new BadRequestError({
                message:
                    'Часть выбранных участников неактивна в этом клубе — обновите список',
            })
        }

        const latest = await this.prisma.rankPromotion.findMany({
            where: {
                workspaceId: f.workspaceId,
                ladderId: f.ladderId,
                userId: { in: userIds },
            },
            distinct: ['userId'],
            orderBy: { awardedAt: 'desc' },
            select: { userId: true, levelId: true, stripes: true },
        })
        const unchanged = new Set(
            latest
                .filter(
                    (p) =>
                        p.levelId === f.payload.levelId && p.stripes === stripes,
                )
                .map((p) => p.userId),
        )
        const targets = userIds.filter((id) => !unchanged.has(id))

        // Sequential: RankService validates the level (and its stripe cap) on
        // the first call, so a bad level fails before anything is written.
        for (const userId of targets) {
            const promotion = await this.ranks.promote({
                workspaceId: f.workspaceId,
                userId,
                ladderId: f.ladderId,
                levelId: f.payload.levelId,
                stripes,
                awardedById: f.invokerUserId,
                note: f.payload.note,
            })
            if (userId !== f.invokerUserId) {
                await notifyPromotion(this.notifications, f.workspaceId, promotion)
            }
        }

        if (targets.length > 0) {
            this.realtime.invalidate(f.workspaceId, ['ranks'])
        }
        return { promoted: targets.length, unchanged: unchanged.size }
    }
}
