import { compare } from 'bcrypt'
import { createHash } from 'crypto'

import { Feature, IFeatureHandler } from '@shelfjs/features'
import { PrismaService } from '../../infrastructure/prisma'
import { AuditService } from '../../domains/audit/services/audit.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UserNoCompleteCodeError } from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { StoreReviewMembershipService } from '../../domains/workspace/services/store-review-membership.service'
import { UserBlockedError } from '../../shared/errors/shared.errors'
import { hasPrivilegedAccess } from '../../shared/utils/store-review-access.util'
import {
    isStoreReviewEmail,
    storeReviewCodeMatches,
} from '../../shared/utils/store-review.util'
import {
    InvalidCredentialsError,
    SignInFeature,
    SignInFeatureResponse,
    TooManySignInAttemptsError,
} from './sign-in.feature'

// OTP lifetime — long enough for a slow inbox / SMS, short enough that
// a leaked code can't be redeemed later. 15 minutes is the industry
// default (Google, GitHub, AWS).
const CODE_TTL_MS = 15 * 60 * 1000

// Wrong codes are counted twice. Per (account, client address): the address
// that keeps guessing is locked for LOCKOUT_MS after MAX_FAILED_ATTEMPTS_PER_ADDRESS,
// while the owner signing in from their own device is unaffected. Per account:
// a ceiling across all addresses, so spreading guesses over many addresses
// still stops at a handful per lockout window. Issuing a new code resets
// neither (issuance is unauthenticated).
const MAX_FAILED_ATTEMPTS_PER_ADDRESS = 5
const MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 10
const LOCKOUT_MS = 15 * 60 * 1000

// Compared against on the store-review path so it spends the same bcrypt time
// as a normal account (which compares against its emailed code's hash).
const DUMMY_HASH = '$2b$10$4ztxPTDvmLpKogYQGru0BOvy.ePGpMHLJgUIb6t8KWBwUhjJ2QVXW'

type SignInUser = {
    id: string
    isSuperAdmin: boolean
    signInLockedUntil: Date | null
    completeCodeIssuedAt: Date | null
    sessionVersion: number
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
        private readonly storeReviewMembership: StoreReviewMembershipService,
    ) {}

    async execute({
        payload,
        clientIp,
    }: SignInFeature): Promise<SignInFeatureResponse> {
        const { email, code } = payload

        const user = await this.usersService.getUserByEmail({
            email,
        })

        // An unknown address answers exactly like a known account with no
        // pending code — the one state every account is in most of the time —
        // so this endpoint can't be used to check who has an account.
        if (!user) {
            throw new UserNoCompleteCodeError()
        }

        // BLOCKED (banned) or DELETED (self-deleted, anonymized) — neither may
        // sign in. A DELETED row's email is scrubbed anyway, but guard in case.
        if (user.status === 'BLOCKED' || user.status === 'DELETED') {
            throw new UserBlockedError()
        }

        // The client address is only ever stored hashed.
        const ipHash = createHash('sha256').update(clientIp).digest('hex')

        // Brute-force lockout — checked before bcrypt.compare so an
        // attacker can't keep burning CPU/timing-leak attempts during
        // the lockout window.
        if (
            (user.signInLockedUntil &&
                user.signInLockedUntil.getTime() > Date.now()) ||
            (await this.isAddressLocked(user, ipHash))
        ) {
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }

        // Store-review account: fixed code instead of an emailed OTP. Sits
        // after the lockout check so wrong guesses still lock the account (and
        // the controller's per-IP throttle still applies).
        if (isStoreReviewEmail(email) && isStoreReviewEmail(user.email)) {
            return await this.signInStoreReview(user, code, ipHash)
        }

        if (!user.completeCode) {
            throw new UserNoCompleteCodeError()
        }

        // Code TTL — reject without bcrypt work if it's stale.
        if (this.isCodeStale(user)) {
            throw new InvalidCredentialsError()
        }

        await this.claimAttempt(user, ipHash)

        const isCodeValid = await compare(code, user.completeCode)

        if (!isCodeValid) {
            return await this.recordFailedAttempt(user, ipHash)
        }

        return await this.issueSession(user)
    }

    private async signInStoreReview(
        user: SignInUser,
        code: string,
        ipHash: string,
    ): Promise<SignInFeatureResponse> {
        // Never let the fixed code open a real account. Refuse exactly like
        // a wrong code.
        if (await hasPrivilegedAccess(this.prisma, user)) {
            throw new InvalidCredentialsError()
        }

        // Like a normal account, it only signs in after a code was "requested"
        // (send-auth-code stamps completeCodeIssuedAt for this account).
        if (!user.completeCodeIssuedAt) {
            throw new UserNoCompleteCodeError()
        }
        if (this.isCodeStale(user)) {
            throw new InvalidCredentialsError()
        }

        await this.claimAttempt(user, ipHash)

        // Timing parity with a normal account; the result is not used.
        await compare(code, DUMMY_HASH)

        if (!storeReviewCodeMatches(code)) {
            return await this.recordFailedAttempt(user, ipHash)
        }

        await this.audit.record({
            action: 'auth.storeReviewSignIn',
            targetType: 'member',
            targetId: user.id,
            actorId: user.id,
            workspaceId: null,
        })
        await this.storeReviewMembership.ensureDemoMembership(user.id)
        return await this.issueSession(user)
    }

    private isCodeStale(user: SignInUser): boolean {
        return (
            !!user.completeCodeIssuedAt &&
            Date.now() - user.completeCodeIssuedAt.getTime() > CODE_TTL_MS
        )
    }

    private async isAddressLocked(
        user: SignInUser,
        ipHash: string,
    ): Promise<boolean> {
        const throttle = await this.prisma.signInThrottle.findUnique({
            where: { userId_ipHash: { userId: user.id, ipHash } },
            select: { lockedUntil: true },
        })
        return !!throttle?.lockedUntil && throttle.lockedUntil > new Date()
    }

    // Counts this attempt atomically BEFORE the code is compared. Deciding from
    // the row read at the top lets a burst of concurrent guesses all pass the
    // lock check and each write "n + 1" — the whole burst would count once.
    // Each conditional increment hands out a bounded number of tickets between
    // locks; when none is left the address (or the account) gets locked.
    //
    // The address is claimed first: an address that is already out of tickets
    // must not be able to push the account-wide counter towards its ceiling.
    private async claimAttempt(user: SignInUser, ipHash: string): Promise<void> {
        await this.prisma.signInThrottle.createMany({
            data: [{ userId: user.id, ipHash }],
            skipDuplicates: true,
        })
        const claimedByAddress = await this.prisma.signInThrottle.updateMany({
            where: {
                userId: user.id,
                ipHash,
                failedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ADDRESS },
                OR: [
                    { lockedUntil: null },
                    { lockedUntil: { lt: new Date() } },
                ],
            },
            data: { failedAttempts: { increment: 1 } },
        })
        if (claimedByAddress.count === 0) {
            await this.lockAddressIfExhausted(user, ipHash)
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }

        const claimed = await this.prisma.user.updateMany({
            where: {
                id: user.id,
                signInFailedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                ],
            },
            data: { signInFailedAttempts: { increment: 1 } },
        })
        if (claimed.count === 0) {
            await this.lockIfExhausted(user)
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }
    }

    // Same as lockIfExhausted, for one address of the account.
    private async lockAddressIfExhausted(
        user: SignInUser,
        ipHash: string,
    ): Promise<void> {
        await this.prisma.signInThrottle.updateMany({
            where: {
                userId: user.id,
                ipHash,
                failedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ADDRESS },
                OR: [
                    { lockedUntil: null },
                    { lockedUntil: { lt: new Date() } },
                ],
            },
            data: {
                failedAttempts: 0,
                lockedUntil: new Date(Date.now() + LOCKOUT_MS),
            },
        })
    }

    // Starts the lockout (and zeroes the counter, so the account is fresh when
    // the lock expires) once every ticket is spent. Idempotent under races.
    private async lockIfExhausted(user: SignInUser): Promise<void> {
        await this.prisma.user.updateMany({
            where: {
                id: user.id,
                signInFailedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                ],
            },
            data: {
                signInFailedAttempts: 0,
                signInLockedUntil: new Date(Date.now() + LOCKOUT_MS),
            },
        })
    }

    private async recordFailedAttempt(
        user: SignInUser,
        ipHash: string,
    ): Promise<never> {
        // The attempt was already counted by claimAttempt; this only starts the
        // lockouts when that was the last ticket.
        await this.lockAddressIfExhausted(user, ipHash)
        await this.lockIfExhausted(user)
        throw new InvalidCredentialsError()
    }

    private async issueSession(
        user: SignInUser,
    ): Promise<SignInFeatureResponse> {
        // Successful sign-in — burn the OTP so it can't be replayed and
        // reset brute-force state. (For the store-review account there is no
        // stored code; the write is a harmless no-op on those fields.)
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                completeCode: null,
                completeCodeIssuedAt: null,
                signInFailedAttempts: 0,
                signInLockedUntil: null,
            },
        })
        // Wrong-code counters of this account's addresses go too, except
        // locks still running: a success here must not unlock whoever was
        // guessing from elsewhere.
        await this.prisma.signInThrottle.deleteMany({
            where: {
                userId: user.id,
                OR: [
                    { lockedUntil: null },
                    { lockedUntil: { lte: new Date() } },
                ],
            },
        })

        const accessToken = await this.tokensService.generateToken({
            userId: user.id,
            sessionVersion: user.sessionVersion,
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
