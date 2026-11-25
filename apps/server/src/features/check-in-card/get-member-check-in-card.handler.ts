import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { assertCanManageRoles } from '../../shared/access/role-hierarchy'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetMemberCheckInCardFeature,
    GetMemberCheckInCardFeatureResponse,
} from './get-member-check-in-card.feature'
import { CARD_HOLDER_SELECT, serializeCheckInCard } from './schemas'

// «⋯ → Карта для входа»: a sport lead prints a member's card (a child with no
// phone). A staff member's card is the club admins' call, the same rule as
// editing their profile.
@Feature(GetMemberCheckInCardFeature)
export class GetMemberCheckInCardHandler
    implements
        IFeatureHandler<
            GetMemberCheckInCardFeature,
            GetMemberCheckInCardFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        targetUserId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: GetMemberCheckInCardFeature) {
        const ctx = await assertSportLead(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Карту для входа может распечатать администратор клуба',
        )

        // The owner has no member row.
        const isTargetOwner = ctx.workspaceOwnerId === targetUserId
        const membership = isTargetOwner
            ? null
            : await this.prisma.workspaceMember.findFirst({
                  where: { workspaceId, userId: targetUserId },
                  select: { role: { select: { name: true } } },
              })
        if (!membership && !isTargetOwner) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }

        await assertCanManageRoles(
            this.prisma,
            ctx,
            { roleName, isSuperAdmin },
            [isTargetOwner ? 'admin' : membership?.role.name],
            (v) =>
                `Карту ${v.coach.gen}, ${v.headCoach.gen} или администратора может распечатать только владелец или администратор клуба`,
        )

        const user = await this.prisma.user.findUnique({
            where: { id: targetUserId },
            select: CARD_HOLDER_SELECT,
        })
        if (!user) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }
        return serializeCheckInCard(user)
    }
}
