import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    GRANTABLE_ROLE_NAMES,
    type RoleName,
    WORKSPACE_ADMINS,
} from '../../shared/decorators/roles.decorator'
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
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
    }: UpdateMemberRoleFeature) {
        // Self-modification of role is forbidden — without this, a
        // head_coach could demote themselves to 'user' and end up locked
        // out (RbacService would resolve them as 'user' and RoleGuard
        // would reject every admin call). Owner has its own check below.
        if (userId === invokerUserId) {
            throw new BadRequestError({
                message:
                    'Свою роль изменить нельзя — попросите другого администратора клуба',
            })
        }

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
            throw new NotFoundError({ message: 'Участник не найден' })
        }
        if (!role) {
            throw new NotFoundError({ message: 'Роль не найдена' })
        }
        if (role.superuser) {
            // Superuser is a platform-level role granted from the /platform
            // staff console, not by club admins. Refusing here keeps club
            // owners from accidentally giving global power to a coach.
            throw new BadRequestError({
                message: 'Эту роль нельзя назначить из админки клуба',
            })
        }
        // The Role table is global, so a head_coach with a raw roleId
        // could otherwise grant any non-superuser platform role (e.g. a
        // future 'platform_moderator'). Pin the grantable list to the
        // roles we actually use in the workspace UI.
        if (!GRANTABLE_ROLE_NAMES.includes(role.name as RoleName)) {
            throw new BadRequestError({
                message: `Роль «${role.name}» нельзя назначить из админки клуба`,
            })
        }

        // Workspace owner can't be demoted from the workspace UI. RbacService
        // treats ownerId as 'admin' regardless of role, so allowing this
        // creates a split-brain (admin in scope but RoleGuard rejects them).
        // Owner role changes belong to a future "transfer ownership" flow.
        if (workspace?.ownerId === userId) {
            if (!WORKSPACE_ADMINS.includes(role.name as RoleName)) {
                throw new BadRequestError({
                    message:
                        'У владельца клуба должна остаться роль администратора. Сначала передайте клуб другому владельцу.',
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

        this.realtime.invalidate(workspaceId, ['members'])

        return {
            userId,
            roleId: role.id,
            roleName: role.name,
        }
    }
}
