import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../../infrastructure/prisma'
import { RbacService } from '../../../shared/services/rbac.service'
import {
    ListAdoptableLadderTemplatesFeature,
    ListAdoptableLadderTemplatesFeatureResponse,
} from './list-adoptable-ladder-templates.feature'

// «Пояса → Лестницы → Стандарты федерации»: active standards of the
// organizations this club is ACTIVE in, for whoever may create ladders
// (sport leads and direction managers — the ladders page's own gate).
@Feature(ListAdoptableLadderTemplatesFeature)
export class ListAdoptableLadderTemplatesHandler
    implements
        IFeatureHandler<
            ListAdoptableLadderTemplatesFeature,
            ListAdoptableLadderTemplatesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListAdoptableLadderTemplatesFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.rbac.assertManagesDirections(ctx)
        const templates = await this.prisma.organizationLadderTemplate.findMany({
            where: {
                isActive: true,
                organization: {
                    isActive: true,
                    clubs: { some: { workspaceId: f.workspaceId, status: 'ACTIVE' } },
                },
            },
            include: {
                organization: { select: { name: true } },
                levels: { orderBy: { order: 'asc' } },
            },
            orderBy: [{ organization: { name: 'asc' } }, { name: 'asc' }],
        })
        const ladders = await this.prisma.rankLadder.findMany({
            where: {
                workspaceId: f.workspaceId,
                templateId: { in: templates.map((t) => t.id) },
            },
            select: { id: true, name: true, templateId: true, templateVersion: true },
            orderBy: { name: 'asc' },
        })
        return {
            data: templates.map((t) => ({
                id: t.id,
                organizationId: t.organizationId,
                organizationName: t.organization.name,
                name: t.name,
                audience: t.audience,
                version: t.version,
                levels: t.levels.map((l) => ({
                    id: l.id,
                    name: l.name,
                    order: l.order,
                    color: l.color,
                    maxStripes: l.maxStripes,
                })),
                adoptedLadders: ladders
                    .filter((l) => l.templateId === t.id)
                    .map((l) => ({
                        ladderId: l.id,
                        ladderName: l.name,
                        templateVersion: l.templateVersion ?? 1,
                    })),
            })),
        }
    }
}
