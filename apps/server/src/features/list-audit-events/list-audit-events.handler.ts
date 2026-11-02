import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
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
        // events touching only their own students or groups (ownGroupsWhere:
        // coached or of a direction they run).
        let extraOr:
            | Array<Record<string, unknown>>
            | undefined
        if (!this.rbac.canSeeAllGroups(ctx)) {
            const [groupIds, studentIds] = await Promise.all([
                this.rbac.ownGroupIds(ctx),
                this.rbac.ownGroupMemberIds(ctx),
            ])

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
            actionPrefix: payload.actionPrefix,
            extraOr,
        })
    }
}
