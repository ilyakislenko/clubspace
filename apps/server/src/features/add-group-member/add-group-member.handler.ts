import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AddGroupMemberFeature,
    AddGroupMemberFeatureResponse,
} from './add-group-member.feature'

@Feature(AddGroupMemberFeature)
export class AddGroupMemberHandler
    implements
        IFeatureHandler<
            AddGroupMemberFeature,
            AddGroupMemberFeatureResponse
        >
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
    }: AddGroupMemberFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)
        const [group, userMembership] = await Promise.all([
            this.prisma.group.findFirst({
                where: { id: groupId, workspaceId },
                select: { id: true, coachId: true },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { userId: payload.userId, workspaceId },
                select: { id: true },
            }),
        ])

        if (!group) throw new NotFoundError({ message: 'Группа не найдена' })
        if (!userMembership) {
            throw new NotFoundError({
                message: 'Пользователь не участник этого клуба',
            })
        }
        if (group.coachId === payload.userId) {
            throw new BadRequestError({
                message:
                    'Тренера нельзя добавить учеником в его же группу',
            })
        }

        // Idempotent — re-adding an existing member is a no-op rather than
        // a 409 error, so the UI can re-emit the request after a flaky tap
        // without having to handle the duplicate case.
        const entry = await this.prisma.groupMember.upsert({
            where: {
                groupId_userId: { groupId, userId: payload.userId },
            },
            update: {},
            create: { groupId, userId: payload.userId },
        })
        // A member of the group is no longer a guest there.
        await this.prisma.dropInBooking.deleteMany({
            where: { groupId, userId: payload.userId },
        })

        await this.audit.record({
            action: 'group.addMember',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { userId: payload.userId },
        })

        return {
            groupId: entry.groupId,
            userId: entry.userId,
            joinedAt: entry.joinedAt.toISOString(),
        }
    }
}
