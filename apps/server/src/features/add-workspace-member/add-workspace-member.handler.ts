import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { UsersService } from '../../domains/users/services/users.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
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
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: AddWorkspaceMemberFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        if (workspace.ownerId !== invokerUserId) {
            throw new ForbiddenError({
                message: 'Only workspace owner can add members',
            })
        }

        const role = await this.prisma.role.findUnique({
            where: { name: RolesEnum.USER.toLowerCase() },
            select: { id: true },
        })

        if (!role) {
            throw new NotFoundError({ message: 'Default user role not found' })
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
            select: { id: true },
        })

        if (alreadyMember) {
            throw new BadRequestError({
                message: 'User is already a member of this workspace',
            })
        }

        const member = await this.prisma.workspaceMember.create({
            data: {
                status: 'ACTIVE',
                workspace: { connect: { id: workspaceId } },
                user: { connect: { id: userId } },
                role: { connect: { id: role.id } },
            },
            select: { id: true },
        })

        await this.audit.record({
            action: 'member.add',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { email, isNew },
        })

        return {
            id: member.id,
            userId,
            email,
            isNew,
        }
    }
}
