import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListAuditEventsFeature,
    ListAuditEventsFeatureResponse,
} from './list-audit-events.feature'

// «История изменений» is a system screen: the owner and admins read the whole
// feed; a head coach or coach is refused.
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
        await assertClubAdmin(this.rbac, {
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        return await this.audit.list({
            workspaceId,
            curPage: payload.curPage,
            perPage: payload.perPage,
            actionPrefix: payload.actionPrefix,
        })
    }
}
