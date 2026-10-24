import { compare } from 'bcrypt'

import { Feature, IFeatureHandler } from '@shelfjs/features'
import { PrismaService } from '../../infrastructure/prisma'
import { AuditService } from '../../domains/audit/services/audit.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import {
    UserNoCompleteCodeError,
    UserNotFoundError,
} from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { UserBlockedError } from '../../shared/errors/shared.errors'
import { RolesEnum } from '../../shared/interfaces/shared.intefaces'
import {
    isStoreReviewEmail,
    storeReviewCodeMatches,
} from '../../shared/utils/store-review.util'
import {
    InvalidCredentialsError,
    SignInFeature,
    SignInFeatureResponse,
} from './sign-in.feature'

// OTP lifetime — long enough for a slow inbox / SMS, short enough that
// a leaked code can't be redeemed later. 15 minutes is the industry
// default (Google, GitHub, AWS).
const CODE_TTL_MS = 15 * 60 * 1000

// After this many wrong codes against the same account we lock sign-in
// for LOCKOUT_MS. Issuing a fresh code resets the counter so a user
// who genuinely forgot the code can recover.
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

type SignInUser = {
    id: string
    isSuperAdmin: boolean
    signInFailedAttempts: number
    signInLockedUntil: Date | null
}

@Feature(SignInFeature)
export class SignInHandler
    implements IFeatureHandler<SignInFeature, SignInFeatureResponse>
{
    constructor(
        private readonly tokensService: TokensService,
        private readonly usersService: UsersService,
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({ payload }: SignInFeature): Promise<SignInFeatureResponse> {
        const { email, code } = payload

        const user = await this.usersService.getUserByEmail({
            email,
        })

        if (!user) {
            throw new UserNotFoundError({ email })
        }

        // BLOCKED (banned) or DELETED (self-deleted, anonymized) — neither may
        // sign in. A DELETED row's email is scrubbed anyway, but guard in case.
        if (user.status === 'BLOCKED' || user.status === 'DELETED') {
            throw new UserBlockedError()
        }

        // Brute-force lockout — checked before bcrypt.compare so an
        // attacker can't keep burning CPU/timing-leak attempts during
        // the lockout window.
        if (
            user.signInLockedUntil &&
            user.signInLockedUntil.getTime() > Date.now()
        ) {
            throw new UserBlockedError()
        }

        // Store-review account: fixed code, no emailed OTP. Sits after the
        // lockout check so wrong guesses still lock the account (and the
        // controller's per-IP throttle still applies).
        if (isStoreReviewEmail(email)) {
            // Never let the fixed code open a real account. Refuse exactly like
            // a wrong code so nothing reveals the address is special.
            if (await this.hasPrivilegedAccess(user)) {
                throw new InvalidCredentialsError()
            }
            if (!storeReviewCodeMatches(code)) {
                return await this.recordFailedAttempt(user)
            }
            await this.audit.record({
                action: 'auth.storeReviewSignIn',
                targetType: 'member',
                targetId: user.id,
                actorId: user.id,
                workspaceId: null,
            })
            return await this.issueSession(user, { burnCode: false })
        }

        if (!user.completeCode) {
            throw new UserNoCompleteCodeError({ id: user.id })
        }

        // Code TTL — reject without bcrypt work if it's stale.
        if (
            user.completeCodeIssuedAt &&
            Date.now() - user.completeCodeIssuedAt.getTime() > CODE_TTL_MS
        ) {
            throw new InvalidCredentialsError()
        }

        const isCodeValid = await compare(code, user.completeCode)

        if (!isCodeValid) {
            return await this.recordFailedAttempt(user)
        }

        return await this.issueSession(user)
    }

    private async hasPrivilegedAccess(user: SignInUser): Promise<boolean> {
        if (user.isSuperAdmin) return true

        const owned = await this.prisma.workspace.findFirst({
            where: { ownerId: user.id },
            select: { id: true },
        })
        if (owned) return true

        const memberships = await this.prisma.workspaceMember.findMany({
            where: { userId: user.id },
            select: { role: { select: { name: true } } },
        })
        return memberships.some(
            (m) => m.role.name.toLowerCase() !== RolesEnum.USER.toLowerCase(),
        )
    }

    private async recordFailedAttempt(user: SignInUser): Promise<never> {
        const nextAttempts = user.signInFailedAttempts + 1
        const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                signInFailedAttempts: shouldLock ? 0 : nextAttempts,
                signInLockedUntil: shouldLock
                    ? new Date(Date.now() + LOCKOUT_MS)
                    : user.signInLockedUntil,
            },
        })
        throw new InvalidCredentialsError()
    }

    private async issueSession(
        user: SignInUser,
        options: { burnCode: boolean } = { burnCode: true },
    ): Promise<SignInFeatureResponse> {
        // Successful sign-in — burn the OTP so it can't be replayed and
        // reset brute-force state.
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                ...(options.burnCode
                    ? { completeCode: null, completeCodeIssuedAt: null }
                    : {}),
                signInFailedAttempts: 0,
                signInLockedUntil: null,
            },
        })

        const accessToken = await this.tokensService.generateToken({
            userId: user.id,
        })

        const refreshToken = await this.tokensService.generateStoredToken({
            userId: user.id,
        })

        return {
            userId: user.id,
            accessToken,
            refreshToken,
            expiresAt:
                Math.floor(Date.now() / 1000) +
                this.tokensService.accessTokenTTL,
        }
    }
}
