import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetGroupFeature, GetGroupFeatureResponse } from './get-group.feature'
import { resolveGroupAccess } from './group-access'
import { clubToday, groupDetailsInclude, serializeGroupDetails } from './schemas'

// One group for its card: who may open it — resolveGroupAccess.
@Feature(GetGroupFeature)
export class GetGroupHandler
    implements IFeatureHandler<GetGroupFeature, GetGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetGroupFeature): Promise<GetGroupFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        if (!z.string().uuid().safeParse(f.groupId).success) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }
        const group = await this.prisma.group.findFirst({
            where: { id: f.groupId, workspaceId: f.workspaceId },
            include: groupDetailsInclude(
                await clubToday(this.prisma, f.workspaceId),
            ),
        })
        if (!group) throw new NotFoundError({ message: 'Группа не найдена' })
        const { canEdit } = await resolveGroupAccess(
            this.prisma,
            this.rbac,
            ctx,
            group.id,
        )
        return { ...serializeGroupDetails(group), canEdit }
    }
}
