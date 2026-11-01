import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { TooManySignInAttemptsError } from './sign-in.feature'

// Wrong codes are counted twice. Per (account, client address): the address
// that keeps guessing is locked for LOCKOUT_MS after MAX_FAILED_ATTEMPTS_PER_ADDRESS,
// while the owner signing in from their own device is unaffected. Per account:
// a ceiling across all addresses, so spreading guesses over many addresses
// still stops at a handful per lockout window. Issuing a new code resets
// neither (issuance is unauthenticated).
export const MAX_FAILED_ATTEMPTS_PER_ADDRESS = 5
export const MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 10
export const LOCKOUT_MS = 15 * 60 * 1000

const lockoutError = () => new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)

const unlocked = () => ({
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
})

/**
 * The wrong-code counters of one sign-in subject: an existing account
 * (User + SignInThrottle) or an address that has no account yet
 * (PendingSignIn + PendingSignInThrottle). Same rules for both.
 */
export interface SignInAttempts {
    isLocked(ipHash: string): Promise<boolean>
    // Counts this attempt atomically BEFORE the code is compared; throws the
    // lockout when no ticket is left.
    claim(ipHash: string): Promise<void>
    // The attempt was already counted by claim; this only starts the
    // lockouts when that was the last ticket.
    afterFailure(ipHash: string): Promise<void>
}

// Deciding from the row read at the top lets a burst of concurrent guesses all
// pass the lock check and each write "n + 1" — the whole burst would count
// once. Each conditional increment hands out a bounded number of tickets
// between locks; when none is left the address (or the account) gets locked.
// The address is claimed first: an address that is already out of tickets
// must not be able to push the account-wide counter towards its ceiling.
export class UserSignInAttempts implements SignInAttempts {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly user: { id: string; signInLockedUntil: Date | null },
    ) {}

    async isLocked(ipHash: string): Promise<boolean> {
        if (
            this.user.signInLockedUntil &&
            this.user.signInLockedUntil.getTime() > Date.now()
        ) {
            return true
        }
        const throttle = await this.prisma.signInThrottle.findUnique({
            where: { userId_ipHash: { userId: this.user.id, ipHash } },
            select: { lockedUntil: true },
        })
        return !!throttle?.lockedUntil && throttle.lockedUntil > new Date()
    }

    async claim(ipHash: string): Promise<void> {
        const userId = this.user.id
        await this.prisma.signInThrottle.createMany({
            data: [{ userId, ipHash }],
            skipDuplicates: true,
        })
        const byAddress = await this.prisma.signInThrottle.updateMany({
            where: {
                userId,
                ipHash,
                failedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ADDRESS },
                ...unlocked(),
            },
            data: { failedAttempts: { increment: 1 } },
        })
        if (byAddress.count === 0) {
            await this.lockAddressIfExhausted(ipHash)
            throw lockoutError()
        }

        const byAccount = await this.prisma.user.updateMany({
            where: {
                id: userId,
                signInFailedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                ],
            },
            data: { signInFailedAttempts: { increment: 1 } },
        })
        if (byAccount.count === 0) {
            await this.lockAccountIfExhausted()
            throw lockoutError()
        }
    }

    async afterFailure(ipHash: string): Promise<void> {
        await this.lockAddressIfExhausted(ipHash)
        await this.lockAccountIfExhausted()
    }

    private async lockAddressIfExhausted(ipHash: string): Promise<void> {
        await this.prisma.signInThrottle.updateMany({
            where: {
                userId: this.user.id,
                ipHash,
                failedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ADDRESS },
                ...unlocked(),
            },
            data: {
                failedAttempts: 0,
                lockedUntil: new Date(Date.now() + LOCKOUT_MS),
            },
        })
    }

    // Starts the lockout (and zeroes the counter, so the account is fresh when
    // the lock expires) once every ticket is spent. Idempotent under races.
    private async lockAccountIfExhausted(): Promise<void> {
        const locked = await this.prisma.user.updateMany({
            where: {
                id: this.user.id,
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
        // count is 1 only for the request that started this lockout, so a
        // burst of concurrent wrong codes records it once.
        if (locked.count > 0) {
            await this.audit.record({
                action: 'auth.lockout',
                targetType: 'member',
                targetId: this.user.id,
                actorId: this.user.id,
                workspaceId: null,
                metadata: { lockoutMinutes: LOCKOUT_MS / 60_000 },
            })
        }
    }
}

// Same rules for an address with no account yet. No audit entry on lockout:
// there is no member to attach it to.
export class PendingSignInAttempts implements SignInAttempts {
    constructor(
        private readonly prisma: PrismaService,
        private readonly pending: { email: string; lockedUntil: Date | null },
    ) {}

    async isLocked(ipHash: string): Promise<boolean> {
        if (
            this.pending.lockedUntil &&
            this.pending.lockedUntil.getTime() > Date.now()
        ) {
            return true
        }
        const throttle = await this.prisma.pendingSignInThrottle.findUnique({
            where: { email_ipHash: { email: this.pending.email, ipHash } },
            select: { lockedUntil: true },
        })
        return !!throttle?.lockedUntil && throttle.lockedUntil > new Date()
    }

    async claim(ipHash: string): Promise<void> {
        const email = this.pending.email
        await this.prisma.pendingSignInThrottle.createMany({
            data: [{ email, ipHash }],
            skipDuplicates: true,
        })
        const byAddress = await this.prisma.pendingSignInThrottle.updateMany({
            where: {
                email,
                ipHash,
                failedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ADDRESS },
                ...unlocked(),
            },
            data: { failedAttempts: { increment: 1 } },
        })
        if (byAddress.count === 0) {
            await this.lockAddressIfExhausted(ipHash)
            throw lockoutError()
        }

        const byAccount = await this.prisma.pendingSignIn.updateMany({
            where: {
                email,
                failedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                ...unlocked(),
            },
            data: { failedAttempts: { increment: 1 } },
        })
        if (byAccount.count === 0) {
            await this.lockAccountIfExhausted()
            throw lockoutError()
        }
    }

    async afterFailure(ipHash: string): Promise<void> {
        await this.lockAddressIfExhausted(ipHash)
        await this.lockAccountIfExhausted()
    }

    private async lockAddressIfExhausted(ipHash: string): Promise<void> {
        await this.prisma.pendingSignInThrottle.updateMany({
            where: {
                email: this.pending.email,
                ipHash,
                failedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ADDRESS },
                ...unlocked(),
            },
            data: {
                failedAttempts: 0,
                lockedUntil: new Date(Date.now() + LOCKOUT_MS),
            },
        })
    }

    private async lockAccountIfExhausted(): Promise<void> {
        await this.prisma.pendingSignIn.updateMany({
            where: {
                email: this.pending.email,
                failedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                ...unlocked(),
            },
            data: {
                failedAttempts: 0,
                lockedUntil: new Date(Date.now() + LOCKOUT_MS),
            },
        })
    }
}
