import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { LAST_ORG_ADMIN_MESSAGE } from './add-org-member.handler'
import { RemoveOrgMemberFeature, RemoveOrgMemberFeatureResponse } from './org-members.feature'

@Feature(RemoveOrgMemberFeature)
export class RemoveOrgMemberHandler
    implements IFeatureHandler<RemoveOrgMemberFeature, RemoveOrgMemberFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute({ organizationId, userId, invokerUserId, isSuperAdmin }: RemoveOrgMemberFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Команду федерации меняет администратор федерации',
        )
        const removed = await this.prisma.$transaction(async (tx) => {
            const member = await tx.organizationMember.findUnique({
                where: { organizationId_userId: { organizationId, userId } },
                select: { id: true, role: true },
            })
            if (!member) throw new NotFoundError({ message: 'Этого человека нет в команде' })
            if (member.role === 'ORG_ADMIN') {
                const admins = await tx.organizationMember.count({
                    where: { organizationId, role: 'ORG_ADMIN' },
                })
                if (admins <= 1) throw new BadRequestError({ message: LAST_ORG_ADMIN_MESSAGE })
            }
            await tx.organizationMember.delete({ where: { id: member.id } })
            return member
        })

        await this.audit.record({
            action: 'org.memberRemove',
            targetType: 'organizationMember',
            targetId: userId,
            organizationId,
            workspaceId: null,
            actorId: invokerUserId,
            metadata: { userId, role: removed.role },
        })
        return { success: true as const }
    }
}
