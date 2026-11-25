import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { loadTemplateAdoptions } from '../../../domains/organizations/templates'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    ListOrgLadderTemplatesFeature,
    ListOrgLadderTemplatesFeatureResponse,
} from './list-org-ladder-templates.feature'
import { ORG_TEMPLATE_INCLUDE, serializeOrgLadderTemplate } from './schemas'

@Feature(ListOrgLadderTemplatesFeature)
export class ListOrgLadderTemplatesHandler
    implements
        IFeatureHandler<
            ListOrgLadderTemplatesFeature,
            ListOrgLadderTemplatesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListOrgLadderTemplatesFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const rows = await this.prisma.organizationLadderTemplate.findMany({
            where: {
                organizationId: f.organizationId,
                ...(f.payload.includeInactive ? {} : { isActive: true }),
            },
            include: ORG_TEMPLATE_INCLUDE,
            orderBy: [{ name: 'asc' }],
        })
        const adoptions = await loadTemplateAdoptions(
            this.prisma,
            f.organizationId,
            rows.map((r) => r.id),
        )
        return {
            data: rows.map((r) =>
                serializeOrgLadderTemplate(r, adoptions.get(r.id) ?? []),
            ),
        }
    }
}
