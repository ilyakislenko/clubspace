import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteLevelFeature,
    DeleteLevelFeatureResponse,
} from './delete-level.feature'

@Feature(DeleteLevelFeature)
export class DeleteLevelHandler
    implements IFeatureHandler<DeleteLevelFeature, DeleteLevelFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: DeleteLevelFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const level = await this.prisma.rankLevel.findFirst({
            where: {
                id: f.levelId,
                ladderId: f.ladderId,
                ladder: { workspaceId: f.workspaceId },
            },
            select: {
                id: true,
                _count: { select: { promotions: true, gradingCandidates: true } },
            },
        })
        if (!level) throw new NotFoundError({ message: 'Ранг не найден' })

        // A level people have been promoted to can't be hard-deleted (FK Restrict
        // + this guard). Archive it via update-level (isActive=false) instead.
        if (level._count.promotions > 0) {
            throw new BadRequestError({
                message:
                    'По рангу есть присвоения — его нельзя удалить, отправьте в архив',
            })
        }
        if (level._count.gradingCandidates > 0) {
            throw new BadRequestError({
                message:
                    'Уровень используется в аттестации — уберите кандидатов или отправьте уровень в архив',
            })
        }
        await this.prisma.rankLevel.delete({ where: { id: level.id } })
        return { status: 'deleted' as const }
    }
}
