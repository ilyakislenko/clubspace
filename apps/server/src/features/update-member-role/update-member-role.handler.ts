import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    UpdateMemberRoleFeature,
    UpdateMemberRoleFeatureResponse,
} from './update-member-role.feature'

@Feature(UpdateMemberRoleFeature)
export class UpdateMemberRoleHandler
    implements
        IFeatureHandler<
            UpdateMemberRoleFeature,
            UpdateMemberRoleFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
    }: UpdateMemberRoleFeature) {
        const [membership, role, workspace] = await Promise.all([
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId, userId },
                select: { id: true, roleId: true },
            }),
            this.prisma.role.findUnique({
                where: { id: payload.roleId },
                select: { id: true, name: true, superuser: true },
            }),
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
        ])

        if (!membership) {
            throw new NotFoundError({ message: 'Member not found' })
        }
        if (!role) {
            throw new NotFoundError({ message: 'Role not found' })
        }
        if (role.superuser) {
            // Superuser is a platform-level role granted by Anthropic-style
            // staff console, not by club admins. Refusing here keeps club
            // owners from accidentally giving global power to a coach.
            throw new BadRequestError({
                message: 'Superuser role cannot be assigned via the workspace UI',
            })
        }

        // Workspace owner can't be demoted from the workspace UI. RbacService
        // treats ownerId as 'admin' regardless of role, so allowing this
        // creates a split-brain (admin in scope but RoleGuard rejects them).
        // Owner role changes belong to a future "transfer ownership" flow.
        if (workspace?.ownerId === userId) {
            const ADMIN_LEVEL = ['admin', 'head_coach']
            if (!ADMIN_LEVEL.includes(role.name)) {
                throw new BadRequestError({
                    message:
                        'Workspace owner must keep an admin-level role. Transfer ownership first if you want to change this.',
                })
            }
        }

        if (membership.roleId !== payload.roleId) {
            await this.prisma.workspaceMember.update({
                where: { id: membership.id },
                data: { roleId: payload.roleId },
            })

            await this.audit.record({
                action: 'member.updateRole',
                targetType: 'member',
                targetId: userId,
                workspaceId,
                actorId: invokerUserId,
                metadata: {
                    fromRoleId: membership.roleId,
                    toRoleId: payload.roleId,
                    toRoleName: role.name,
                },
            })
        }

        return {
            userId,
            roleId: role.id,
            roleName: role.name,
        }
    }
}
