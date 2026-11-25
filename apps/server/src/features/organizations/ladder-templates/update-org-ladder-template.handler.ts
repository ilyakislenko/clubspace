import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { findOrgTemplate, respondWithTemplate } from './template-access'
import {
    UpdateOrgLadderTemplateFeature,
    UpdateOrgLadderTemplateFeatureResponse,
} from './update-org-ladder-template.feature'

// Name, audience and archiving don't change the rungs: no version bump.
@Feature(UpdateOrgLadderTemplateFeature)
export class UpdateOrgLadderTemplateHandler
    implements
        IFeatureHandler<
            UpdateOrgLadderTemplateFeature,
            UpdateOrgLadderTemplateFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdateOrgLadderTemplateFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await findOrgTemplate(this.prisma, f.organizationId, f.templateId)
        await this.prisma.organizationLadderTemplate.update({
            where: { id: t.id },
            data: f.payload,
            select: { id: true },
        })
        return respondWithTemplate(this.prisma, this.audit, {
            organizationId: f.organizationId,
            templateId: t.id,
            actorId: f.invokerUserId,
            action: 'org.templateUpdate',
            metadata: { fields: Object.keys(f.payload) },
        })
    }
}
