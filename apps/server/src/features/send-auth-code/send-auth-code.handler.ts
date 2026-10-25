import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    UserCompleteCodeTooEarlyError,
    UserNotFoundError,
} from '../../domains/users/errors/users.errors'
import { MailHealthService } from '../../domains/notifications/services/mail-health.service'
import { UsersService } from '../../domains/users/services/users.service'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import { PrismaService } from '../../infrastructure/prisma'
import { environment } from '../../environments/environment'
import { isStoreReviewEmail } from '../../shared/utils/store-review.util'
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
        private mailHealth: MailHealthService,
        private joinRequests: JoinRequestService,
    ) {}

    async execute({ payload }: SendAuthCodeFeature) {
        // Before anything is written: if mail is known to be failing and still
        // is, say so now instead of answering 200 for a code that never arrives.
        await this.mailHealth.assertCanSend()

        const { email, workspaceKey } = payload

        // The store-review account signs in with a fixed code: no mail, no
        // code, no user and no membership are created. It still stamps the
        // issue/cooldown fields like a normal send, so sign-in and a too-early
        // repeat behave the same as for any account.
        if (isStoreReviewEmail(email)) {
            this.logger.warn('Auth code requested for the store review account')
            await this.stampStoreReviewRequest(email)
            return { new: false }
        }

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
            await this.requestMembership({ userId, workspaceKey })
        }

        return { new: isNew }
    }

    private async stampStoreReviewRequest(email: string) {
        const user = await this.userService.getUserByEmail({ email })
        // No account: nothing to stamp, and one is deliberately not created.
        if (!user) return

        if (
            user.completeCodeNextResendAt &&
            user.completeCodeNextResendAt > new Date()
        ) {
            throw new UserCompleteCodeTooEarlyError({ id: user.id })
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                completeCodeIssuedAt: new Date(),
                completeCodeNextResendAt: new Date(
                    Date.now() + environment.completeCodeTimeout,
                ),
            },
        })
    }

    // Asking for a code by e-mail with a club key files a join request. The
    // endpoint is unauthenticated, so it never confirms whether the key exists
    // and never auto-approves or pings anyone but the owner; the applicant sees
    // the outcome through GET /me/join-requests once signed in.
    private async requestMembership(params: {
        userId: string
        workspaceKey: string
    }) {
        try {
            const workspace = await this.prisma.workspace.findUnique({
                where: { key: params.workspaceKey },
                select: { id: true, name: true, ownerId: true, isActive: true },
            })
            if (!workspace || !workspace.isActive) return

            await this.joinRequests.requestMembership({
                userId: params.userId,
                workspace,
                autoApprove: false,
                audience: 'owner',
            })
        } catch (error) {
            // Sign-up must never fail because of this side effect.
            this.logger.warn(
                `Failed to file a join request: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }
}
