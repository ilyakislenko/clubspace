import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListLaddersFeature,
    ListLaddersFeatureResponse,
} from './list-ladders.feature'
import { serializeLadder } from './schemas'

@Feature(ListLaddersFeature)
export class ListLaddersHandler
    implements IFeatureHandler<ListLaddersFeature, ListLaddersFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListLaddersFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const directionIds = await this.rbac.assertManagesDirections(ctx)
        const ladders = await this.prisma.rankLadder.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(directionIds ? { directionId: { in: directionIds } } : {}),
                ...(f.payload.includeInactive ? {} : { isActive: true }),
            },
            include: {
                levels: { orderBy: { order: 'asc' } },
                direction: directionRefSelect,
            },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        })
        const templateIds = [
            ...new Set(ladders.flatMap((l) => (l.templateId ? [l.templateId] : []))),
        ]
        const templates =
            templateIds.length > 0 && environment.organizations.enabled
                ? await this.prisma.organizationLadderTemplate.findMany({
                      where: { id: { in: templateIds } },
                      select: {
                          id: true,
                          name: true,
                          version: true,
                          organization: { select: { name: true } },
                      },
                  })
                : []
        return {
            data: ladders.map(serializeLadder),
            templates: templates.map((t) => ({
                id: t.id,
                name: t.name,
                organizationName: t.organization.name,
                version: t.version,
            })),
        }
    }
}
