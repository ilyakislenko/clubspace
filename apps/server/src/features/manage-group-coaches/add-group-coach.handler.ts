import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AddGroupCoachFeature,
    AddGroupCoachFeatureResponse,
} from './add-group-coach.feature'

const COACH_CAPABLE_ROLES = ['admin', 'head_coach', 'coach']

@Feature(AddGroupCoachFeature)
export class AddGroupCoachHandler
    implements IFeatureHandler<AddGroupCoachFeature, AddGroupCoachFeatureResponse>
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
    }: AddGroupCoachFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: payload.userId, workspaceId },
            include: { role: { select: { name: true } } },
        })
        if (!member) {
            throw new NotFoundError({
                message: 'Пользователь не участник этого клуба',
            })
        }
        const isOwner = ctx.workspaceOwnerId === payload.userId
        if (!isOwner && !COACH_CAPABLE_ROLES.includes(member.role.name)) {
            throw new BadRequestError({
                message:
                    'У выбранного участника нет тренерской роли — сначала повысьте его',
            })
        }

        // Coaches can't double as students. If the new assistant is in
        // GroupMember, we drop them first so the relationship stays
        // unambiguous (mirrors create-group's coach/member rule).
        await this.prisma.$transaction([
            this.prisma.groupMember.deleteMany({
                where: { groupId, userId: payload.userId },
            }),
            this.prisma.groupCoach.upsert({
                where: {
                    groupId_userId: { groupId, userId: payload.userId },
                },
                update: {}, // already there — no-op (don't downgrade primary)
                create: {
                    groupId,
                    userId: payload.userId,
                    role: 'assistant',
                },
            }),
        ])

        await this.audit.record({
            action: 'group.update',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { added: { userId: payload.userId, role: 'assistant' } },
        })

        return {
            groupId,
            userId: payload.userId,
            role: 'assistant' as const,
        }
    }
}
