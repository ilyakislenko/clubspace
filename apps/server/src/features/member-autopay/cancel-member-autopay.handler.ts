import { Feature, IFeatureHandler } from '@shelfjs/features'

import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead, isClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CancelMemberAutopayFeature,
    CancelMemberAutopayFeatureResponse,
} from './cancel-member-autopay.feature'
import {
    AUTOPAY_NOT_FOUND,
    AUTOPAY_STAFF_REFUSAL,
    loadAutopayViews,
    loadStaffNames,
} from './member-autopay-view'
import { serializeMemberAutopay } from './schemas'

// Staff honour a member's refusal (a call, the desk): sport leads, because
// it only stops charges. The service wipes the token, records the reason and
// confirms to the member in writing. Idempotent.
@Feature(CancelMemberAutopayFeature)
export class CancelMemberAutopayHandler
    implements
        IFeatureHandler<CancelMemberAutopayFeature, CancelMemberAutopayFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async execute(f: CancelMemberAutopayFeature): Promise<CancelMemberAutopayFeatureResponse> {
        const caller = {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        }
        const ctx = await assertSportLead(this.rbac, caller, AUTOPAY_STAFF_REFUSAL)
        const row = await this.prisma.memberAutopay.findFirst({
            where: { id: f.autopayId, workspaceId: f.workspaceId },
            select: { id: true, userId: true, status: true },
        })
        if (!row) throw new NotFoundError({ message: AUTOPAY_NOT_FOUND })
        if (row.status !== 'CANCELLED') {
            await this.autopay.cancel({
                id: row.id,
                source: 'STAFF',
                actorId: f.invokerUserId,
                reason: f.payload.reason,
            })
        }
        const [view] = await loadAutopayViews(this.prisma, {
            workspaceId: f.workspaceId,
            userId: row.userId,
            now: new Date(),
            id: row.id,
        })
        const names = await loadStaffNames(this.prisma, [view])
        return serializeMemberAutopay(view, isClubAdmin(ctx, caller), names)
    }
}
