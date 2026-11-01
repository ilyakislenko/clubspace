import { compare } from 'bcrypt'
import { createHash } from 'crypto'

import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'
import { LanguageEnum, Prisma, PrismaService } from '../../infrastructure/prisma'
import { AuditAction, AuditService } from '../../domains/audit/services/audit.service'
import { isDemoOnlyAccount } from '../../domains/demo/demo-access'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UserNoCompleteCodeError } from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { JoinRequestService } from '../../domains/workspace/services/join-request.service'
import { StoreReviewMembershipService } from '../../domains/workspace/services/store-review-membership.service'
import { UserBlockedError } from '../../shared/errors/shared.errors'
import { demoCodeMatches, isDemoAccountEmail } from '../../shared/utils/demo-mode.util'
import { hasPrivilegedAccess } from '../../shared/utils/store-review-access.util'
import {
    isStoreReviewEmail,
    storeReviewCodeMatches,
} from '../../shared/utils/store-review.util'
import {
    LOCKOUT_MS,
    PendingSignInAttempts,
    SignInAttempts,
    UserSignInAttempts,
} from './sign-in-attempts'
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

// Compared against on the store-review path so it spends the same bcrypt time
// as a normal account (which compares against its emailed code's hash).
const DUMMY_HASH = '$2b$10$4ztxPTDvmLpKogYQGru0BOvy.ePGpMHLJgUIb6t8KWBwUhjJ2QVXW'

type SignInUser = {
    id: string
    email: string | null
    isSuperAdmin: boolean
    signInLockedUntil: Date | null
    completeCodeIssuedAt: Date | null
    sessionVersion: number
}

@Feature(SignInFeature)
export class SignInHandler
    implements IFeatureHandler<SignInFeature, SignInFeatureResponse>
{
    private readonly logger = new Logger(SignInHandler.name)

    constructor(
        private readonly tokensService: TokensService,
        private readonly usersService: UsersService,
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly storeReviewMembership: StoreReviewMembershipService,
        private readonly joinRequests: JoinRequestService,
    ) {}

    async execute({
        payload,
        clientIp,
    }: SignInFeature): Promise<SignInFeatureResponse> {
        const { email, code } = payload

        const user = await this.usersService.getUserByEmail({
            email,
        })

        // The client address is only ever stored hashed.
        const ipHash = createHash('sha256').update(clientIp).digest('hex')

        // No account yet: the code was issued against the address alone and
        // the account is created only once it is proven.
        if (!user) {
            return await this.signUpWithCode(email, code, ipHash)
        }

        // A row without an e-mail (a dependent) can never sign in; it answers
        // like an address with no pending code.
        if (!user.email) {
            throw new UserNoCompleteCodeError()
        }

        // BLOCKED (banned) or DELETED (self-deleted, anonymized) — neither may
        // sign in. A DELETED row's email is scrubbed anyway, but guard in case.
        if (user.status === 'BLOCKED' || user.status === 'DELETED') {
            throw new UserBlockedError()
        }

        const attempts = new UserSignInAttempts(this.prisma, this.audit, user)

        // Brute-force lockout — checked before bcrypt.compare so an
        // attacker can't keep burning CPU/timing-leak attempts during
        // the lockout window.
        if (await attempts.isLocked(ipHash)) {
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }

        // Fixed-code accounts: the store-review account, and the demo accounts
        // while DEMO_MODE is on. Sits after the lockout check so wrong guesses
        // still lock the account (and the controller's per-IP throttle still
        // applies).
        if (isStoreReviewEmail(email) && isStoreReviewEmail(user.email)) {
            // Never let the fixed code open a real account.
            return await this.signInWithFixedCode(user, code, ipHash, attempts, {
                allowed: async () => !(await hasPrivilegedAccess(this.prisma, user)),
                matches: storeReviewCodeMatches,
                action: 'auth.storeReviewSignIn',
                afterAudit: () => this.storeReviewMembership.ensureDemoMembership(user.id),
            })
        }
        if (isDemoAccountEmail(user.email)) {
            // Only a generated account that belongs to the demo club alone.
            return await this.signInWithFixedCode(user, code, ipHash, attempts, {
                allowed: () => isDemoOnlyAccount(this.prisma, user),
                matches: demoCodeMatches,
                action: 'auth.demoSignIn',
            })
        }

        if (!user.completeCode) {
            throw new UserNoCompleteCodeError()
        }

        // Code TTL — reject without bcrypt work if it's stale.
        if (this.isCodeStale(user.completeCodeIssuedAt)) {
            throw new InvalidCredentialsError()
        }

        await attempts.claim(ipHash)

        const isCodeValid = await compare(code, user.completeCode)

        if (!isCodeValid) {
            return await this.recordFailedAttempt(attempts, ipHash)
        }

        const session = await this.issueSession(user)
        await this.fileRequestedJoin(user.email, user.id)
        return session
    }

    // First sign-in of an address: the same checks as for an account, against
    // the code kept in PendingSignIn; a correct code creates the account.
    private async signUpWithCode(
        email: string,
        code: string,
        ipHash: string,
    ): Promise<SignInFeatureResponse> {
        const pending = await this.prisma.pendingSignIn.findUnique({
            where: { email: email.trim().toLowerCase() },
        })
        // An unknown address answers exactly like a known account with no
        // pending code — the one state every account is in most of the time —
        // so this endpoint can't be used to check who has an account.
        if (!pending?.codeHash) {
            throw new UserNoCompleteCodeError()
        }

        const attempts = new PendingSignInAttempts(this.prisma, pending)
        if (await attempts.isLocked(ipHash)) {
            throw new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)
        }
        if (this.isCodeStale(pending.codeIssuedAt)) {
            throw new InvalidCredentialsError()
        }

        await attempts.claim(ipHash)

        if (!(await compare(code, pending.codeHash))) {
            return await this.recordFailedAttempt(attempts, ipHash)
        }

        const user = await this.createProvenUser(pending.email, pending.language)
        const session = await this.issueSession(user)
        await this.fileRequestedJoin(pending.email, user.id)
        return session
    }

    private async createProvenUser(
        email: string,
        language: LanguageEnum | null,
    ): Promise<SignInUser> {
        const select = {
            id: true,
            email: true,
            isSuperAdmin: true,
            signInLockedUntil: true,
            completeCodeIssuedAt: true,
            sessionVersion: true,
        } as const
        try {
            const { id } = await this.usersService.createUser({
                email,
                language: language ?? undefined,
            })
            return await this.prisma.user.findUniqueOrThrow({
                where: { id },
                select,
            })
        } catch (error) {
            // Two correct submissions at once, or an invitation created the
            // account in between: the address is proven either way.
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                return await this.prisma.user.findUniqueOrThrow({
                    where: { email },
                    select,
                })
            }
            throw error
        }
    }

    // A club join request asked for together with the code (branded app,
    // workspaceKey) is filed only now that the address is proven. Never
    // confirms whether the key exists, never auto-approves, pings only the
    // owner; the applicant sees the outcome through GET /me/join-requests.
    private async fileRequestedJoin(email: string, userId: string) {
        const pending = await this.prisma.pendingSignIn.findUnique({
            where: { email },
            select: { joinWorkspaceKey: true },
        })
        if (!pending) return
        await this.prisma.pendingSignIn.deleteMany({ where: { email } })
        if (!pending.joinWorkspaceKey) return
        try {
            const workspace = await this.prisma.workspace.findUnique({
                where: { key: pending.joinWorkspaceKey },
                select: { id: true, name: true, ownerId: true, isActive: true },
            })
            if (!workspace || !workspace.isActive) return

            await this.joinRequests.requestMembership({
                userId,
                workspace,
                autoApprove: false,
                audience: 'owner',
            })
        } catch (error) {
            // Signing in must never fail because of this side effect.
            this.logger.warn(
                `Failed to file a join request: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }

    private async signInWithFixedCode(
        user: SignInUser,
        code: string,
        ipHash: string,
        attempts: SignInAttempts,
        fixed: {
            allowed: () => Promise<boolean>
            matches: (code: string) => boolean
            action: AuditAction
            afterAudit?: () => Promise<void>
        },
    ): Promise<SignInFeatureResponse> {
        // An account the fixed code may not open is refused exactly like a
        // wrong code.
        if (!(await fixed.allowed())) {
            throw new InvalidCredentialsError()
        }

        // Like a normal account, it only signs in after a code was "requested"
        // (send-auth-code stamps completeCodeIssuedAt for these accounts).
        if (!user.completeCodeIssuedAt) {
            throw new UserNoCompleteCodeError()
        }
        if (this.isCodeStale(user.completeCodeIssuedAt)) {
            throw new InvalidCredentialsError()
        }

        await attempts.claim(ipHash)

        // Timing parity with a normal account; the result is not used.
        await compare(code, DUMMY_HASH)

        if (!fixed.matches(code)) {
            return await this.recordFailedAttempt(attempts, ipHash)
        }

        await this.audit.record({
            action: fixed.action,
            targetType: 'member',
            targetId: user.id,
            actorId: user.id,
            workspaceId: null,
        })
        await fixed.afterAudit?.()
        return await this.issueSession(user)
    }

    private isCodeStale(issuedAt: Date | null): boolean {
        return !!issuedAt && Date.now() - issuedAt.getTime() > CODE_TTL_MS
    }

    private async recordFailedAttempt(
        attempts: SignInAttempts,
        ipHash: string,
    ): Promise<never> {
        await attempts.afterFailure(ipHash)
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

        await this.audit.record({
            action: 'auth.signIn',
            targetType: 'member',
            targetId: user.id,
            actorId: user.id,
            workspaceId: null,
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
