import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'
import {
    CreateOrgLadderTemplateFeature,
    CreateOrgLadderTemplateFeatureResponse,
} from './create-org-ladder-template.feature'
import { respondWithTemplate } from './template-access'

@Feature(CreateOrgLadderTemplateFeature)
export class CreateOrgLadderTemplateHandler
    implements
        IFeatureHandler<
            CreateOrgLadderTemplateFeature,
            CreateOrgLadderTemplateFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateOrgLadderTemplateFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const levels = f.payload.levels ?? []
        if (new Set(levels.map((l) => l.order)).size !== levels.length) {
            throw new BadRequestError({ message: 'У ступеней не может быть одинакового порядка' })
        }
        const t = await this.prisma.organizationLadderTemplate.create({
            data: {
                organizationId: f.organizationId,
                name: f.payload.name,
                audience: f.payload.audience ?? null,
                levels: {
                    create: levels.map((l) => ({
                        name: l.name,
                        order: l.order,
                        color: l.color ?? null,
                        maxStripes: l.maxStripes ?? 0,
                        requirements: l.requirements ?? null,
                        minVisits: l.minVisits ?? null,
                        minWeeks: l.minWeeks ?? null,
                    })),
                },
            },
            select: { id: true },
        })
        return respondWithTemplate(this.prisma, this.audit, {
            organizationId: f.organizationId,
            templateId: t.id,
            actorId: f.invokerUserId,
            action: 'org.templateCreate',
            metadata: { levels: levels.length },
        })
    }
}
