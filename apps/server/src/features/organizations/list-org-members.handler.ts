import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { PrismaService } from '../../infrastructure/prisma'
import { ListOrgMembersFeature, ListOrgMembersFeatureResponse } from './org-members.feature'
import { ORG_MEMBER_SELECT, serializeOrgMember } from './schemas'

@Feature(ListOrgMembersFeature)
export class ListOrgMembersHandler
    implements IFeatureHandler<ListOrgMembersFeature, ListOrgMembersFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListOrgMembersFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            {
                userId: f.invokerUserId,
                organizationId: f.organizationId,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Команду федерации видит администратор федерации',
        )
        const rows = await this.prisma.organizationMember.findMany({
            where: { organizationId: f.organizationId },
            select: ORG_MEMBER_SELECT,
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        })
        return { data: rows.map(serializeOrgMember) }
    }
}
