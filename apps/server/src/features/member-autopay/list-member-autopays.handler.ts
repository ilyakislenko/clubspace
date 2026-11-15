import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead, isClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListMemberAutopaysFeature,
    ListMemberAutopaysFeatureResponse,
} from './list-member-autopays.feature'
import { AUTOPAY_STAFF_REFUSAL, loadAutopayViews, loadStaffNames } from './member-autopay-view'
import { serializeMemberAutopay } from './schemas'

// The member card's autopay block: sport leads see the state (renewal work),
// club admins also the amounts and the card.
@Feature(ListMemberAutopaysFeature)
export class ListMemberAutopaysHandler
    implements
        IFeatureHandler<ListMemberAutopaysFeature, ListMemberAutopaysFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListMemberAutopaysFeature): Promise<ListMemberAutopaysFeatureResponse> {
        const caller = {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        }
        const ctx = await assertSportLead(this.rbac, caller, AUTOPAY_STAFF_REFUSAL)
        const [member, views] = await Promise.all([
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                select: { id: true },
            }),
            loadAutopayViews(this.prisma, {
                workspaceId: f.workspaceId,
                userId: f.userId,
                now: new Date(),
            }),
        ])
        if (!member && views.length === 0) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }
        const names = await loadStaffNames(this.prisma, views)
        return {
            data: views.map((v) => serializeMemberAutopay(v, isClubAdmin(ctx, caller), names)),
        }
    }
}
