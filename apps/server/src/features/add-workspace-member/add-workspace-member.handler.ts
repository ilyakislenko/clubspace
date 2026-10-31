import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { UsersService } from '../../domains/users/services/users.service'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
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

        const email = payload.email.toLowerCase().trim()

        const existing = await this.users.getUserByEmail({ email })
        let userId: string
        let isNew = false

        if (existing) {
            userId = existing.id
        } else {
            const created = await this.users.createUser({ email })
            userId = created.id
            isNew = true
        }

        const alreadyMember = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            select: { id: true, status: true },
        })

        let member: { id: string }
        if (alreadyMember) {
            // Approving an INVITED self-registration is the common case for
            // this endpoint now — flip the status instead of refusing.
            if (alreadyMember.status !== 'INVITED') {
                throw new BadRequestError({
                    message: 'Пользователь уже участник этого клуба',
                })
            }
            member = await this.prisma.workspaceMember.update({
                where: { id: alreadyMember.id },
                // The row keeps its role: an admin-invited coach stays a coach.
                data: { status: 'ACTIVE' },
                select: { id: true },
            })
            await this.joinRequests.notifyApproved({
                userId,
                workspaceId,
                workspaceName: workspace.name,
                membershipId: member.id,
            })
        } else {
            member = await this.prisma.workspaceMember.create({
                data: {
                    status: 'ACTIVE',
                    workspace: { connect: { id: workspaceId } },
                    user: { connect: { id: userId } },
                    role: { connect: { id: role.id } },
                },
                select: { id: true },
            })
        }

        await this.audit.record({
            action: 'member.add',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { email, isNew },
        })

        this.realtime.invalidate(workspaceId, ['members'])
        this.realtime.joinWorkspaceRoom([userId], workspaceId)

        return {
            id: member.id,
            userId,
            email,
            isNew,
        }
    }
}
