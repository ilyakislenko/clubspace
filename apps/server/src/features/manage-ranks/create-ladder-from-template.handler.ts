import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { directionRefSelect } from '../../domains/directions/direction-ref'
import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateRankLadderFromTemplateFeature,
    CreateRankLadderFromTemplateFeatureResponse,
} from './create-ladder-from-template.feature'
import { serializeLadder } from './schemas'

// «Взять за основу»: a federation standard becomes a club ladder the club
// edits freely. Provenance only (templateId, templateVersion, each level's
// templateLevelId) — no live link, so later edits on either side stay put.
// A ladder is direction-owned: the direction scope decides, as on create.
@Feature(CreateRankLadderFromTemplateFeature)
export class CreateRankLadderFromTemplateHandler
    implements
        IFeatureHandler<
            CreateRankLadderFromTemplateFeature,
            CreateRankLadderFromTemplateFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateRankLadderFromTemplateFeature) {
        assertOrganizationsEnabled()
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const directionId = f.payload.directionId ?? null
        await assertDirectionInWorkspace(this.prisma, f.workspaceId, directionId)
        await this.rbac.assertCanManageDirection(ctx, directionId)

        const template = await this.prisma.organizationLadderTemplate.findFirst({
            where: {
                id: f.payload.templateId,
                isActive: true,
                organization: {
                    isActive: true,
                    clubs: { some: { workspaceId: f.workspaceId, status: 'ACTIVE' } },
                },
            },
            include: { levels: { orderBy: { order: 'asc' } } },
        })
        if (!template) throw new NotFoundError({ message: 'Стандарт не найден' })

        const ladder = await this.prisma.rankLadder.create({
            data: {
                workspaceId: f.workspaceId,
                name: f.payload.name ?? template.name,
                audience: template.audience,
                directionId,
                templateId: template.id,
                templateVersion: template.version,
                levels: {
                    create: template.levels.map((l) => ({
                        name: l.name,
                        order: l.order,
                        color: l.color,
                        maxStripes: l.maxStripes,
                        requirements: l.requirements,
                        minVisits: l.minVisits,
                        minWeeks: l.minWeeks,
                        templateLevelId: l.id,
                    })),
                },
            },
            include: {
                levels: { orderBy: { order: 'asc' } },
                direction: directionRefSelect,
            },
        })
        // The org journal labels club-side rows by the club's name.
        const club = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { name: true },
        })
        await this.audit.record({
            action: 'ladder.fromTemplate',
            targetType: 'rankLadder',
            targetId: ladder.id,
            workspaceId: f.workspaceId,
            organizationId: template.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                name: ladder.name,
                clubName: club?.name ?? null,
                templateId: template.id,
                templateName: template.name,
                templateVersion: template.version,
            },
        })
        return serializeLadder(ladder)
    }
}
