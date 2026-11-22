import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RefundService } from '../../domains/payments/services/refund.service'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { DeleteRefundFeature, type DeleteRefundFeatureResponse } from './delete-refund.feature'

// «Удалить запись о возврате»: a mistaken offline refund record goes (audited)
// and its amount counts as revenue again. Money, owner and admins only.
@Feature(DeleteRefundFeature)
export class DeleteRefundHandler
    implements IFeatureHandler<DeleteRefundFeature, DeleteRefundFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly refunds: RefundService,
    ) {}

    async execute(f: DeleteRefundFeature): Promise<DeleteRefundFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.refunds.deleteRecord({
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            refundId: f.refundId,
        })
        return { status: 'deleted' }
    }
}
