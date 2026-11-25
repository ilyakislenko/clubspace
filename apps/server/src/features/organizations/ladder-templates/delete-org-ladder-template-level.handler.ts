import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    DeleteOrgLadderTemplateLevelFeature,
    DeleteOrgLadderTemplateLevelFeatureResponse,
} from './delete-org-ladder-template-level.feature'
import { findOrgTemplate, respondWithTemplate } from './template-access'

// Club copies keep the rung (templateLevelId is a plain id).
@Feature(DeleteOrgLadderTemplateLevelFeature)
export class DeleteOrgLadderTemplateLevelHandler
    implements
        IFeatureHandler<
            DeleteOrgLadderTemplateLevelFeature,
            DeleteOrgLadderTemplateLevelFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DeleteOrgLadderTemplateLevelFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await findOrgTemplate(this.prisma, f.organizationId, f.templateId)
        const level = await this.prisma.organizationLadderTemplateLevel.findFirst({
            where: { id: f.levelId, templateId: t.id },
            select: { id: true, name: true },
        })
        if (!level) throw new NotFoundError({ message: 'Ступень не найдена' })
        await this.prisma.$transaction([
            this.prisma.organizationLadderTemplateLevel.delete({ where: { id: level.id } }),
            this.prisma.organizationLadderTemplate.update({
                where: { id: t.id },
                data: { version: { increment: 1 } },
            }),
        ])
        return respondWithTemplate(this.prisma, this.audit, {
            organizationId: f.organizationId,
            templateId: t.id,
            actorId: f.invokerUserId,
            action: 'org.templateUpdate',
            metadata: { levelDeleted: level.name },
        })
    }
}
