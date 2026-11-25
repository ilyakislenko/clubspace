import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { ConflictError } from '../../../shared/errors/shared.errors'
import {
    CreateOrgLadderTemplateLevelFeature,
    CreateOrgLadderTemplateLevelFeatureResponse,
} from './create-org-ladder-template-level.feature'
import { isP2002 } from './schemas'
import { findOrgTemplate, respondWithTemplate } from './template-access'

@Feature(CreateOrgLadderTemplateLevelFeature)
export class CreateOrgLadderTemplateLevelHandler
    implements
        IFeatureHandler<
            CreateOrgLadderTemplateLevelFeature,
            CreateOrgLadderTemplateLevelFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateOrgLadderTemplateLevelFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const t = await findOrgTemplate(this.prisma, f.organizationId, f.templateId)
        const p = f.payload
        try {
            await this.prisma.$transaction([
                this.prisma.organizationLadderTemplateLevel.create({
                    data: {
                        templateId: t.id,
                        name: p.name,
                        order: p.order,
                        color: p.color ?? null,
                        maxStripes: p.maxStripes ?? 0,
                        requirements: p.requirements ?? null,
                        minVisits: p.minVisits ?? null,
                        minWeeks: p.minWeeks ?? null,
                    },
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
            metadata: { levelAdded: p.name },
        })
    }
}
