import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    DeleteOrgLadderTemplateFeature,
    DeleteOrgLadderTemplateFeatureResponse,
} from './delete-org-ladder-template.feature'
import { findOrgTemplate } from './template-access'

// Club copies keep their rungs: provenance ids are plain, no FK.
@Feature(DeleteOrgLadderTemplateFeature)
export class DeleteOrgLadderTemplateHandler
    implements
        IFeatureHandler<
            DeleteOrgLadderTemplateFeature,
            DeleteOrgLadderTemplateFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DeleteOrgLadderTemplateFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await findOrgTemplate(this.prisma, f.organizationId, f.templateId)
        await this.prisma.organizationLadderTemplate.delete({ where: { id: t.id } })
        await this.audit.record({
            action: 'org.templateDelete',
            targetType: 'organizationTemplate',
            targetId: t.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { name: t.name },
        })
        return { status: 'deleted' as const }
    }
}
