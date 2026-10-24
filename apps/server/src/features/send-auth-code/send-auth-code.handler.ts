import { Logger } from '@nestjs/common'
import { Feature, FeaturesBus, IFeatureHandler } from '@shelfjs/features'

import { UserNotFoundError } from '../../domains/users/errors/users.errors'
import { MailHealthService } from '../../domains/notifications/services/mail-health.service'
import { UsersService } from '../../domains/users/services/users.service'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { environment } from '../../environments/environment'
import { RolesEnum } from '../../shared/interfaces/shared.intefaces'
import { isStoreReviewEmail } from '../../shared/utils/store-review.util'
import {
    SendNotificationFeature,
    SendNotificationFeatureResponse,
} from '../send-notification/send-notification.feature'
import {
    SendAuthCodeFeature,
    SendAuthCodeFeatureResponse,
} from './send-auth-code.feature'

@Feature(SendAuthCodeFeature)
export class SendAuthCodeHandler
    implements
        IFeatureHandler<SendAuthCodeFeature, SendAuthCodeFeatureResponse>
{
    private readonly logger = new Logger(SendAuthCodeHandler.name)

    constructor(
        private userService: UsersService,
        private prisma: PrismaService,
        private featuresBus: FeaturesBus,
        private mailHealth: MailHealthService,
    ) {}

    async execute({ payload }: SendAuthCodeFeature) {
        // The store-review account signs in with a fixed code: send no mail,
        // generate no code, create nothing. Answer like an existing user so
        // the response doesn't single this address out.
        if (isStoreReviewEmail(payload.email)) {
            this.logger.warn('Auth code requested for the store review account')
            return { new: false }
        }

        // Before anything is written: if mail is known to be failing and still
        // is, say so now instead of answering 200 for a code that never arrives.
        await this.mailHealth.assertCanSend()

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

        if (workspaceKey) {
            await this.ensureInvitedMembership({
                userId,
                userEmail: email,
                workspaceKey,
            })
        }

        return { new: isNew }
    }

    private async ensureInvitedMembership(params: {
        userId: string
        userEmail: string
        workspaceKey: string
    }) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { key: params.workspaceKey },
            select: { id: true, name: true, ownerId: true },
        })
        if (!workspace) return
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

        try {
            await this.prisma.workspaceMember.create({
                data: {
                    status: 'INVITED',
                    workspace: { connect: { id: workspace.id } },
                    user: { connect: { id: params.userId } },
                    role: { connect: { id: role.id } },
                },
            })
        } catch (err) {
            // A concurrent send-auth-code (e.g. a double-tap on "send code")
            // can pass the existence check above and then collide on the
            // unique(userId, workspaceId) constraint. Treat that as a no-op —
            // the membership exists — instead of surfacing a 500, and don't
            // double-notify the owner. (P2002 = unique violation.)
            if ((err as { code?: string }).code === 'P2002') return
            throw err
        }

        await this.notifyOwnerOfPendingMember({
            ownerUserId: workspace.ownerId,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            applicantEmail: params.userEmail,
        })
    }

    private async notifyOwnerOfPendingMember(params: {
        ownerUserId: string
        workspaceId: string
        workspaceName: string
        applicantEmail: string
    }) {
        const adminBase = environment.rootUrl.replace(/\/$/, '')
        try {
            await this.featuresBus.execute<
                SendNotificationFeature,
                SendNotificationFeatureResponse
            >(
                new SendNotificationFeature({
                    userId: params.ownerUserId,
                    topic: `Новая заявка в ${params.workspaceName}`,
                    message: {
                        htmlTemplateKey: 'pending-member',
                        data: {
                            workspaceName: params.workspaceName,
                            userEmail: params.applicantEmail,
                            adminUrl: `${adminBase}/workspace/${params.workspaceId}/users`,
                        },
                    },
                    types: [NotificationTypeEnum.EMAIL],
                    forced: true,
                    metadata: {
                        kind: 'pending-member',
                        workspaceId: params.workspaceId,
                        applicantEmail: params.applicantEmail,
                    },
                }),
            )
        } catch (error) {
            // Notification failures must not break the sign-up.
            this.logger.warn(
                `Failed to notify workspace owner about pending member: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }
}
