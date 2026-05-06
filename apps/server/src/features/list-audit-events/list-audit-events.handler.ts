import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListAuditEventsFeature,
    ListAuditEventsFeatureResponse,
} from './list-audit-events.feature'

@Feature(ListAuditEventsFeature)
export class ListAuditEventsHandler
    implements
        IFeatureHandler<ListAuditEventsFeature, ListAuditEventsFeatureResponse>
{
    constructor(
        private readonly audit: AuditService,
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: ListAuditEventsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // Admin / read_all see the whole feed. Coach in own_only mode is
        // narrowed to events relevant to them: own actions, anything
        // about content (videos/courses are shared), and member/group
        // events touching only their own students or groups.
        let extraOr:
            | Array<Record<string, unknown>>
            | undefined
        if (ctx.scope === 'coach_own_only') {
            const ownGroups = await this.prisma.group.findMany({
                where: { workspaceId, coachId: invokerUserId },
                select: {
                    id: true,
                    members: { select: { userId: true } },
                },
            })
            const groupIds = ownGroups.map((g) => g.id)
            const studentIds = Array.from(
                new Set(
                    ownGroups.flatMap((g) =>
                        g.members.map((m) => m.userId),
                    ),
                ),
            )

            // The '__none__' sentinels keep the OR branch from
            // collapsing to "all rows" when the coach happens to have
            // no groups or no students yet.
            extraOr = [
                { actorId: invokerUserId },
                {
                    targetType: { in: ['video', 'playlist', 'gym'] },
                },
                {
                    targetType: 'group',
                    targetId: {
                        in: groupIds.length > 0 ? groupIds : ['__none__'],
                    },
                },
                {
                    targetType: 'member',
                    targetId: {
                        in: [invokerUserId, ...studentIds],
                    },
                },
            ]
        }

        return await this.audit.list({
            workspaceId,
            curPage: payload.curPage,
            perPage: payload.perPage,
            extraOr,
        })
    }
}
