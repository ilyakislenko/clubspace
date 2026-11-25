import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { ConflictError, NotFoundError } from '../../../shared/errors/shared.errors'
import { isP2002 } from './schemas'
import { findOrgTemplate, respondWithTemplate } from './template-access'
import {
    UpdateOrgLadderTemplateLevelFeature,
    UpdateOrgLadderTemplateLevelFeatureResponse,
} from './update-org-ladder-template-level.feature'

@Feature(UpdateOrgLadderTemplateLevelFeature)
export class UpdateOrgLadderTemplateLevelHandler
    implements
        IFeatureHandler<
            UpdateOrgLadderTemplateLevelFeature,
            UpdateOrgLadderTemplateLevelFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdateOrgLadderTemplateLevelFeature) {
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
        try {
            await this.prisma.$transaction([
                this.prisma.organizationLadderTemplateLevel.update({
                    where: { id: level.id },
                    data: f.payload,
                }),
                this.prisma.organizationLadderTemplate.update({
                    where: { id: t.id },
                    data: { version: { increment: 1 } },
                }),
            ])
        } catch (e) {
            if (isP2002(e)) {
                throw new ConflictError({ message: 'Ступень с таким порядком уже есть' })
            }
            throw e
        }
        return respondWithTemplate(this.prisma, this.audit, {
            organizationId: f.organizationId,
            templateId: t.id,
            actorId: f.invokerUserId,
            action: 'org.templateUpdate',
            metadata: { levelUpdated: level.name, fields: Object.keys(f.payload) },
        })
    }
}
