import { Feature, IFeatureHandler } from '@shelfjs/features'

import { UserNotFoundError } from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RolesEnum } from '../../shared/interfaces/shared.intefaces'
import {
    SendAuthCodeFeature,
    SendAuthCodeFeatureResponse,
} from './send-auth-code.feature'

@Feature(SendAuthCodeFeature)
export class SendAuthCodeHandler
    implements
        IFeatureHandler<SendAuthCodeFeature, SendAuthCodeFeatureResponse>
{
    constructor(
        private userService: UsersService,
        private prisma: PrismaService,
    ) {}

    async execute({ payload }: SendAuthCodeFeature) {
        const { email, workspaceKey } = payload

        let userId: string
        let isNew = false

        try {
            const user = await this.userService.getUserByEmail({ email })

            if (!user) {
                throw new UserNotFoundError({ email })
            }

            userId = user.id
            await this.userService.createCompleteCode({ userId })
        } catch (error) {
            if (!(error instanceof UserNotFoundError)) {
                throw error
            }

            const created = await this.userService.createUser({
                email,
                language: payload.language,
            })
            userId = created.id
            isNew = true
            await this.userService.createCompleteCode({ userId })
        }

        // If the client passed a workspaceKey (mobile app does, web admin
        // typically doesn't), make sure the user has at least an INVITED
        // membership there. Trainer flips it to ACTIVE in admin's "ожидают
        // приглашения" panel.
        if (workspaceKey) {
            await this.ensureInvitedMembership({ userId, workspaceKey })
        }

        return { new: isNew }
    }

    private async ensureInvitedMembership(params: {
        userId: string
        workspaceKey: string
    }) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { key: params.workspaceKey },
            select: { id: true, ownerId: true },
        })
        if (!workspace) return
        // Owners and existing members don't need a duplicate INVITED row.
        if (workspace.ownerId === params.userId) return

        const existing = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: params.userId,
                    workspaceId: workspace.id,
                },
            },
            select: { id: true },
        })
        if (existing) return

        const role = await this.prisma.role.findUnique({
            where: { name: RolesEnum.USER.toLowerCase() },
            select: { id: true },
        })
        if (!role) return

        await this.prisma.workspaceMember.create({
            data: {
                status: 'INVITED',
                workspace: { connect: { id: workspace.id } },
                user: { connect: { id: params.userId } },
                role: { connect: { id: role.id } },
            },
        })
    }
}
