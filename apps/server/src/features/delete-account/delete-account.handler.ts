import { createHash } from 'crypto'

import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import { UserNoCompleteCodeError } from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { PrismaService } from '../../infrastructure/prisma'
import { demoCodeMatches, isDemoAccountEmail } from '../../shared/utils/demo-mode.util'
import {
    isStoreReviewEmail,
    storeReviewCodeMatches,
} from '../../shared/utils/store-review.util'
import { consumeAccountCode, verifyIssuedCode } from '../sign-in/account-code'
import { LOCKOUT_MS, UserSignInAttempts } from '../sign-in/sign-in-attempts'
import { TooManySignInAttemptsError } from '../sign-in/sign-in.feature'
import {
    DeleteAccountFeature,
    DeleteAccountFeatureResponse,
} from './delete-account.feature'

// The fixed code of an account that has no mailed one (store review; demo
// accounts while DEMO_MODE is on), as at sign-in.
const fixedCodeOf = (email: string) => {
    if (isStoreReviewEmail(email)) return storeReviewCodeMatches
    if (isDemoAccountEmail(email)) return demoCodeMatches
    return undefined
}

@Feature(DeleteAccountFeature)
export class DeleteAccountHandler
    implements IFeatureHandler<DeleteAccountFeature, DeleteAccountFeatureResponse>
{
    constructor(
        private readonly users: UsersService,
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    // Re-authentication: a stolen access token must not be enough to erase
    // the account. The code is checked exactly like at sign-in — same TTL,
    // same per-address and per-account lockouts (a wrong code here counts
    // towards the sign-in lock too) — and burnt before the deletion. A
    // refused deletion (owner / coach) is refused first, so the code is
    // neither checked nor burnt for it. (Acting for a child never reaches
    // here: AuthGuard refuses X-Act-As on this route.)
    async execute({
        payload,
        userId,
        clientIp,
    }: DeleteAccountFeature): Promise<DeleteAccountFeatureResponse> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                completeCode: true,
                completeCodeIssuedAt: true,
                signInLockedUntil: true,
                signInFailedAttempts: true,
            },
        })
        // No address, nothing a code could have been sent to.
        if (!user?.email) {
            throw new UserNoCompleteCodeError()
        }
        await this.users.assertDeletable(userId)

        const ipHash = createHash('sha256').update(clientIp).digest('hex')
        const attempts = new UserSignInAttempts(this.prisma, this.audit, user)
        if (await attempts.isLocked(ipHash)) {
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }
        await verifyIssuedCode({
            attempts,
            ipHash,
            code: payload.code,
            codeHash: user.completeCode,
            issuedAt: user.completeCodeIssuedAt,
            fixedMatches: fixedCodeOf(user.email),
        })
        await consumeAccountCode(this.prisma, user.id)

        // Every club's autopay stops first: the tokens are wiped before the
        // account is de-identified (376-ФЗ, docs/design/2026-11-15-member-autopay.md §8).
        await this.autopay.cancelForUser(null, userId, 'аккаунт удалён')
        await this.users.deleteAccount(userId)
        return { status: 'deleted' as const }
    }
}
