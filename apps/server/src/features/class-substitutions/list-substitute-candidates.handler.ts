import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { coachCandidatesWhere } from './class-substitution-access'
import {
    ListSubstituteCandidatesFeature,
    ListSubstituteCandidatesFeatureResponse,
} from './list-class-substitutions.feature'

@Feature(ListSubstituteCandidatesFeature)
export class ListSubstituteCandidatesHandler
    implements
        IFeatureHandler<
            ListSubstituteCandidatesFeature,
            ListSubstituteCandidatesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListSubstituteCandidatesFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const data = await this.prisma.user.findMany({
            where: coachCandidatesWhere(f.workspaceId, ctx.workspaceOwnerId),
            select: { id: true, email: true, firstname: true, lastname: true },
            orderBy: [{ lastname: 'asc' }, { firstname: 'asc' }],
        })
        return { data }
    }
}
