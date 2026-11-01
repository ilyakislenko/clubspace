import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { UsersService } from '../../domains/users/services/users.service'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import { WorkspaceInvitationService } from '../../domains/workspace/services/workspace-invitation.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { RolesEnum } from '../../shared/interfaces/shared.intefaces'
import {
    AddWorkspaceMemberFeature,
    AddWorkspaceMemberFeatureResponse,
} from './add-workspace-member.feature'

@Feature(AddWorkspaceMemberFeature)
export class AddWorkspaceMemberHandler
    implements
        IFeatureHandler<
            AddWorkspaceMemberFeature,
            AddWorkspaceMemberFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly users: UsersService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly rbac: RbacService,
        private readonly joinRequests: JoinRequestService,
        private readonly invitations: WorkspaceInvitationService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: AddWorkspaceMemberFeature) {
        // The route declares @Roles(WORKSPACE_ADMINS); comparing ownerId
        // directly here contradicted that and locked out admins/head_coaches
        // (and the platform super admin, who is never a member) while the UI
        // still offered them the control.
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Добавлять участников может только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true, ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }


        const role = await this.prisma.role.findUnique({
            where: { name: RolesEnum.USER.toLowerCase() },
            select: { id: true },
        })

        if (!role) {
            throw new NotFoundError({ message: 'Базовая роль участника не найдена (клуб не до конца инициализирован)' })
        }

        let email: string | null
        let existing: { id: string; email: string | null } | null
        if (payload.userId) {
            // Approving a pending request by its user: the only way to approve
            // a child profile, which has no e-mail to look up.
            const pending = await this.prisma.workspaceMember.findUnique({
                where: {
                    userId_workspaceId: { userId: payload.userId, workspaceId },
                },
                select: {
                    status: true,
                    user: { select: { id: true, email: true } },
                },
            })
            if (!pending || pending.status !== 'INVITED') {
                throw new NotFoundError({ message: 'Заявка не найдена' })
            }
            existing = pending.user
            email = pending.user.email
        } else if (payload.email) {
            email = payload.email.toLowerCase().trim()
            const found = await this.users.getUserByEmail({ email })
            if (found && (found.status === 'BLOCKED' || found.status === 'DELETED')) {
                throw new BadRequestError({
                    message: 'Этот аккаунт заблокирован — добавить его нельзя',
                })
            }
            if (found && found.id === workspace.ownerId) {
                throw new BadRequestError({
                    message: 'Это владелец клуба — он уже в клубе',
                })
            }
            existing = found
        } else {
            throw new BadRequestError({ message: 'Укажите e-mail участника' })
        }

        const alreadyMember = existing
            ? await this.prisma.workspaceMember.findUnique({
                  where: {
                      userId_workspaceId: { userId: existing.id, workspaceId },
                  },
                  select: {
                      id: true,
                      status: true,
                  },
              })
            : null
        if (alreadyMember?.status === 'ACTIVE') {
            throw new BadRequestError({
                message: 'Пользователь уже участник этого клуба',
            })
        }

        let userId: string
        let outcome: AddWorkspaceMemberFeatureResponse['outcome']
        if (existing && alreadyMember?.status === 'INVITED') {
            // Approving an INVITED self-registration is the common case for
            // this endpoint — the person asked to join, so flip the status.
            userId = existing.id
            outcome = 'approved'
            await this.prisma.workspaceMember.update({
                where: { id: alreadyMember.id },
                // The row keeps its role: an admin-invited coach stays a coach.
                data: { status: 'ACTIVE' },
            })
            await this.joinRequests.notifyApproved({
                userId,
                workspaceId,
                workspaceName: workspace.name,
                membershipId: alreadyMember.id,
            })
        } else if (email === null) {
            // Without an e-mail there is nobody to invite or create: only a
            // pending request (approved above) can be accepted by user id.
            throw new NotFoundError({ message: 'Заявка не найдена' })
        } else if (existing) {
            // Someone else's account: an offer they accept in the app, never a
            // silent enrolment (security M8).
            userId = existing.id
            outcome = 'invited'
            await this.invitations.invite({
                workspace,
                user: { id: existing.id, email },
                roleName: 'user',
                groupId: null,
                invitedById: invokerUserId,
                sendEmail: true,
            })
        } else {
            const created = await this.users.createUser({ email })
            userId = created.id
            outcome = 'added'
            await this.prisma.workspaceMember.create({
                data: {
                    status: 'ACTIVE',
                    workspace: { connect: { id: workspaceId } },
                    user: { connect: { id: userId } },
                    role: { connect: { id: role.id } },
                },
            })
        }

        await this.audit.record({
            action: 'member.add',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { email, outcome },
        })

        this.realtime.invalidate(workspaceId, ['members'])
        // An invited person is not a member yet: their room joins on accept.
        if (outcome !== 'invited') {
            this.realtime.joinWorkspaceRoom([userId], workspaceId)
        }

        return { userId, email, outcome }
    }
}
