import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { UserCompleteCodeTooEarlyError } from '../../domains/users/errors/users.errors'
import { MailHealthService } from '../../domains/notifications/services/mail-health.service'
import { UsersService } from '../../domains/users/services/users.service'
import { PrismaService } from '../../infrastructure/prisma'
import { environment } from '../../environments/environment'
import { isDemoAccountEmail } from '../../shared/utils/demo-mode.util'
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
    ) {}

    async execute({ payload }: SendAuthCodeFeature) {
        // Before anything is written: if mail is known to be failing and still
        // is, say so now instead of answering 200 for a code that never arrives.
        await this.mailHealth.assertCanSend()

        const { email, workspaceKey, requestJoin } = payload

        // Fixed-code accounts (store review; demo accounts while DEMO_MODE is
        // on) sign in with a fixed code: no mail, no code, no user and no
        // membership are created. It still stamps the issue/cooldown fields
        // like a normal send, so sign-in and a too-early repeat behave the same
        // as for any account.
        if (isStoreReviewEmail(email) || isDemoAccountEmail(email)) {
            this.logger.warn('Auth code requested for a fixed-code account')
            await this.stampFixedCodeRequest(email)
            return { sent: true as const }
        }

        // Explicit flag wins; without one (older app builds) only a brand-new
        // account files the request — an existing member of another club
        // signing in to this club's branded app must not land in its queue.
        // Either way it is only filed once sign-in proves the address.
        const existing = await this.userService.getUserByEmail({ email })
        const joinWorkspaceKey =
            workspaceKey && (requestJoin ?? !existing) ? workspaceKey : null

        if (existing) {
            await this.userService.createCompleteCode({ userId: existing.id })
            await this.rememberJoinRequest(existing.email ?? email, joinWorkspaceKey)
        } else {
            // No User row until the code is proven (sign-in creates it).
            await this.userService.createPendingSignInCode({
                email,
                language: payload.language,
                joinWorkspaceKey,
            })
        }

        // The same answer for a new and an existing account: this endpoint is
        // unauthenticated, and anything else confirms who has an account here.
        // A new account is told apart after sign-in (an empty profile).
        return { sent: true as const }
    }

    // An existing account keeps its code on User; the join request asked for
    // with it waits in PendingSignIn until sign-in, and a later request
    // without one clears it.
    private async rememberJoinRequest(
        email: string,
        joinWorkspaceKey: string | null,
    ) {
        if (joinWorkspaceKey) {
            await this.prisma.pendingSignIn.upsert({
                where: { email },
                create: { email, joinWorkspaceKey },
                update: { joinWorkspaceKey },
            })
        } else {
            await this.prisma.pendingSignIn.updateMany({
                where: { email },
                data: { joinWorkspaceKey: null },
            })
        }
    }

    private async stampFixedCodeRequest(email: string) {
        const user = await this.userService.getUserByEmail({ email })
        // No account: nothing to stamp, and one is deliberately not created.
        if (
            !user ||
            !user.email ||
            !(isStoreReviewEmail(user.email) || isDemoAccountEmail(user.email))
        ) {
            return
        }

        if (
            user.completeCodeNextResendAt &&
            user.completeCodeNextResendAt > new Date()
        ) {
            throw new UserCompleteCodeTooEarlyError()
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
}
