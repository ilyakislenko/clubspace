import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import {
    AssignDirectionManagerFeature,
    AssignDirectionManagerFeatureResponse,
    directionManagerInclude,
    ListDirectionManagersFeature,
    ListDirectionManagersFeatureResponse,
    RemoveDirectionManagerFeature,
    RemoveDirectionManagerFeatureResponse,
    serializeDirectionManager,
} from './direction-managers.feature'

const MANAGERS_ADMIN_MESSAGE =
    'Назначать руководителей направлений может только администратор клуба'

@Feature(ListDirectionManagersFeature)
export class ListDirectionManagersHandler
    implements
        IFeatureHandler<
            ListDirectionManagersFeature,
            ListDirectionManagersFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListDirectionManagersFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            MANAGERS_ADMIN_MESSAGE,
        )
        const rows = await this.prisma.directionManager.findMany({
            where: { workspaceId: f.workspaceId },
            include: directionManagerInclude,
            orderBy: { createdAt: 'asc' },
        })
        return { data: rows.map(serializeDirectionManager) }
    }
}

// Only a coach can run a direction: admins and head coaches already write
// every direction, and a student has no admin-side access at all.
@Feature(AssignDirectionManagerFeature)
export class AssignDirectionManagerHandler
    implements
        IFeatureHandler<
            AssignDirectionManagerFeature,
            AssignDirectionManagerFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: AssignDirectionManagerFeature) {
        const ctx = await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            MANAGERS_ADMIN_MESSAGE,
        )
        const { directionId, userId } = f.payload
        const [direction, member] = await Promise.all([
            this.prisma.direction.findFirst({
                where: { id: directionId, workspaceId: f.workspaceId },
                select: { id: true, name: true },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { userId, workspaceId: f.workspaceId },
                select: { role: { select: { name: true } } },
            }),
        ])
        if (!direction) {
            throw new NotFoundError({ message: 'Направление не найдено' })
        }
        if (ctx.workspaceOwnerId === userId) {
            throw new BadRequestError({
                message: 'У владельца клуба уже есть доступ ко всем направлениям',
            })
        }
        if (!member) {
            throw new NotFoundError({
                message: 'Пользователь не участник этого клуба',
            })
        }
        if (member.role.name !== 'coach') {
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new BadRequestError({
                message:
                    member.role.name === 'user'
                        ? `Руководителем направления может быть только ${v.coach.nom} — сначала назначьте роль ${v.coach.gen}`
                        : `У администратора и ${v.headCoach.gen} уже есть доступ ко всем направлениям`,
            })
        }

        let row
        try {
            row = await this.prisma.directionManager.create({
                data: { workspaceId: f.workspaceId, directionId, userId },
                include: directionManagerInclude,
            })
        } catch (e) {
            if ((e as { code?: string }).code !== 'P2002') throw e
            // Already assigned: idempotent, nothing to audit.
            const existing = await this.prisma.directionManager.findUnique({
                where: { directionId_userId: { directionId, userId } },
                include: directionManagerInclude,
            })
            if (!existing) throw e
            return serializeDirectionManager(existing)
        }
        await this.audit.record({
            action: 'direction.managerAssign',
            targetType: 'direction',
            targetId: directionId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { direction: direction.name, userId },
        })
        return serializeDirectionManager(row)
    }
}

@Feature(RemoveDirectionManagerFeature)
export class RemoveDirectionManagerHandler
    implements
        IFeatureHandler<
            RemoveDirectionManagerFeature,
            RemoveDirectionManagerFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: RemoveDirectionManagerFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            MANAGERS_ADMIN_MESSAGE,
        )
        const row = await this.prisma.directionManager.findFirst({
            where: { id: f.managerId, workspaceId: f.workspaceId },
            select: {
                id: true,
                directionId: true,
                userId: true,
                direction: { select: { name: true } },
            },
        })
        if (!row) {
            throw new NotFoundError({ message: 'Назначение не найдено' })
        }
        await this.prisma.directionManager.delete({ where: { id: row.id } })
        await this.audit.record({
            action: 'direction.managerRemove',
            targetType: 'direction',
            targetId: row.directionId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { direction: row.direction.name, userId: row.userId },
        })
        return { status: 'deleted' as const }
    }
}
