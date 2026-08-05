import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteLadderFeature,
    DeleteLadderFeatureResponse,
} from './delete-ladder.feature'

@Feature(DeleteLadderFeature)
export class DeleteLadderHandler
    implements IFeatureHandler<DeleteLadderFeature, DeleteLadderFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: DeleteLadderFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const ladder = await this.prisma.rankLadder.findFirst({
            where: { id: f.ladderId, workspaceId: f.workspaceId },
            select: { id: true, _count: { select: { promotions: true } } },
        })
        if (!ladder) throw new NotFoundError({ message: 'Лестница рангов не найдена' })

        // Preserve promotion history: a ladder people have been promoted on can't
        // be hard-deleted; archive it (isActive=false) via update-ladder instead.
        if (ladder._count.promotions > 0) {
            throw new BadRequestError({
                message:
                    'По лестнице есть присвоения — её нельзя удалить, отправьте в архив',
            })
        }
        // Levels cascade with the ladder.
        await this.prisma.rankLadder.delete({ where: { id: ladder.id } })
        return { status: 'deleted' as const }
    }
}
