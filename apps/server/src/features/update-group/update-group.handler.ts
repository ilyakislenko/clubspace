import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    UpdateGroupFeature,
    UpdateGroupFeatureResponse,
} from './update-group.feature'

@Feature(UpdateGroupFeature)
export class UpdateGroupHandler
    implements IFeatureHandler<UpdateGroupFeature, UpdateGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        groupId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: UpdateGroupFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId },
            select: { id: true, name: true, gymId: true, coachId: true },
        })

        if (!group) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }

        if (payload.gymId && payload.gymId !== group.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
        }
        if (payload.coachId && payload.coachId !== group.coachId) {
            const coach = await this.prisma.workspaceMember.findFirst({
                where: { userId: payload.coachId, workspaceId },
                include: { role: { select: { name: true } } },
            })
            if (!coach) {
                throw new NotFoundError({
                    message: 'Новый тренер должен быть участником клуба',
                })
            }
            const COACH_CAPABLE = ['admin', 'head_coach', 'coach']
            const isOwner = ctx.workspaceOwnerId === payload.coachId
            if (!isOwner && !COACH_CAPABLE.includes(coach.role.name)) {
                throw new BadRequestError({
                    message:
                        'У выбранного участника нет тренерской роли — сначала повысьте его',
                })
            }
        }

        // Keep Group.coachId and the GroupCoach 'primary' row in sync.
        // When the primary coach changes we drop the old primary row and
        // promote the new one (or insert if they weren't on the group).
        // If the new primary was previously an assistant, just flip the
        // role to 'primary' instead of duplicating.
        const updated = await this.prisma.$transaction(async (tx) => {
            const next = await tx.group.update({
                where: { id: groupId },
                data: {
                    ...(payload.name !== undefined && { name: payload.name }),
                    ...(payload.gymId !== undefined && {
                        gymId: payload.gymId,
                    }),
                    ...(payload.coachId !== undefined && {
                        coachId: payload.coachId,
                    }),
                },
            })
            if (
                payload.coachId !== undefined &&
                payload.coachId !== group.coachId
            ) {
                // Demote / drop the old primary row.
                await tx.groupCoach.deleteMany({
                    where: { groupId, role: 'primary' },
                })
                // Upsert: if the new lead was already an assistant, the
                // upsert flips the role; otherwise it inserts.
                await tx.groupCoach.upsert({
                    where: {
                        groupId_userId: { groupId, userId: payload.coachId },
                    },
                    update: { role: 'primary' },
                    create: {
                        groupId,
                        userId: payload.coachId,
                        role: 'primary',
                    },
                })
            }
            return next
        })

        await this.audit.record({
            action: 'group.update',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                changes: payload,
            },
        })

        return {
            id: updated.id,
            name: updated.name,
            gymId: updated.gymId,
            coachId: updated.coachId,
        }
    }
}
