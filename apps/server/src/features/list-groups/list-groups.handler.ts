import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import {
    ListGroupsFeature,
    ListGroupsFeatureResponse,
} from './list-groups.feature'
import { groupRowInclude, serializeGroupRow } from './schemas'

@Feature(ListGroupsFeature)
export class ListGroupsHandler
    implements IFeatureHandler<ListGroupsFeature, ListGroupsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
        filters,
    }: ListGroupsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // Coach-own-only forces the filter to their own groups (coached,
        // primary or assistant, plus the groups of the directions they
        // manage). Coach_read_all should see all groups but
        // is NOT allowed to enumerate another coach's students by passing
        // ?coachId=<other> — that's targeted prying. Only admin scope
        // (head_coach / admin / owner / superuser) gets the discretionary
        // filter.
        const groups = await this.prisma.group.findMany({
            where: {
                workspaceId,
                ...(ctx.scope === 'coach_own_only'
                    ? ownGroupsWhere(invokerUserId)
                    : ctx.scope === 'admin' && filters.coachId
                      ? { coachId: filters.coachId }
                      : {}),
                ...(filters.directionId
                    ? { directionId: filters.directionId }
                    : {}),
            },
            orderBy: { createdAt: 'asc' },
            include: groupRowInclude(new Date()),
        })

        return {
            data: groups.map(serializeGroupRow),
            total: groups.length,
        }
    }
}
