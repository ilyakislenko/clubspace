import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteDirectionFeature,
    DeleteDirectionFeatureResponse,
} from './delete-direction.feature'
import { DIRECTION_ADMIN_MESSAGE } from './schemas'

const USAGE_LABELS = {
    groups: 'группы',
    rankLadders: 'системы рангов',
    achievements: 'достижения',
    planScopes: 'тарифы',
    subscriptionScopes: 'проданные абонементы',
    events: 'события',
    announcements: 'объявления',
    courseAudiences: 'доступ к курсам',
} as const

// Hard delete only of an unused direction. Every tagged row would otherwise
// fall back to club-wide (SetNull) — a БЖЖ-only announcement reaching the
// whole club, a БЖЖ pack drawn by any class — so a used one is archived
// (isActive = false) instead.
@Feature(DeleteDirectionFeature)
export class DeleteDirectionHandler
    implements
        IFeatureHandler<DeleteDirectionFeature, DeleteDirectionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeleteDirectionFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            DIRECTION_ADMIN_MESSAGE,
        )
        const direction = await this.prisma.direction.findFirst({
            where: { id: f.directionId, workspaceId: f.workspaceId },
            select: {
                id: true,
                name: true,
                _count: {
                    select: {
                        groups: true,
                        rankLadders: true,
                        achievements: true,
                        planScopes: true,
                        subscriptionScopes: true,
                        events: true,
                        announcements: true,
                        courseAudiences: true,
                    },
                },
            },
        })
        if (!direction) {
            throw new NotFoundError({ message: 'Направление не найдено' })
        }
        const used = (
            Object.keys(USAGE_LABELS) as Array<keyof typeof USAGE_LABELS>
        )
            .filter((k) => direction._count[k] > 0)
            .map((k) => `${USAGE_LABELS[k]}: ${direction._count[k]}`)
        if (used.length > 0) {
            throw new BadRequestError({
                message: `Направление используется (${used.join(', ')}). Уберите его оттуда или архивируйте направление.`,
            })
        }
        await this.prisma.direction.delete({ where: { id: direction.id } })
        await this.audit.record({
            action: 'direction.delete',
            targetType: 'direction',
            targetId: direction.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { name: direction.name },
        })
        this.realtime.invalidate(f.workspaceId, ['directions'])
        return { status: 'deleted' as const }
    }
}
