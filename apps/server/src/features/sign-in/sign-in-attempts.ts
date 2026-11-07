import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { TooManySignInAttemptsError } from './sign-in.feature'

// Wrong codes are counted twice. Per (account, client address): the address
// that keeps guessing is locked for LOCKOUT_MS after MAX_FAILED_ATTEMPTS_PER_ADDRESS,
// while the owner signing in from their own device is unaffected. Per account,
// two ceilings over all addresses:
//  - MAX_FAILED_ATTEMPTS_PER_ACCOUNT starts an account lock that only applies to
//    addresses that took part in the guessing (failed within the window before
//    the lock). A stranger spreading guesses can't lock the owner out of an
//    address that never failed.
//  - MAX_FAILED_ATTEMPTS_PER_ACCOUNT_HARD locks every address: guessing spread
//    over very many addresses still stops at a bounded number per window.
// A hard lock is recorded as an active lock with the counter zeroed; a soft
// lock keeps the counter (≥ the soft ceiling). Issuing a new code resets
// nothing (issuance is unauthenticated).
export const MAX_FAILED_ATTEMPTS_PER_ADDRESS = 5
export const MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 10
export const MAX_FAILED_ATTEMPTS_PER_ACCOUNT_HARD = 50
export const LOCKOUT_MS = 15 * 60 * 1000

const lockoutError = () => new TooManySignInAttemptsError(LOCKOUT_MS / 60_000)

const unlocked = () => ({
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
})

const isActive = (until: Date | null): until is Date =>
    !!until && until.getTime() > Date.now()

/**
 * Whether an active account-wide lock applies to this address. A hard lock
 * (counter zeroed) applies to all; a soft one only to an address whose
 * throttle row was touched by a failure from one window before the lock
 * started onwards.
 */
const accountLockApplies = (
    account: { lockedUntil: Date | null; failedAttempts: number },
    address: { updatedAt: Date } | null,
): boolean => {
    if (!isActive(account.lockedUntil)) return false
    if (account.failedAttempts === 0) return true
    if (!address) return false
    const lockStart = account.lockedUntil.getTime() - LOCKOUT_MS
    return address.updatedAt.getTime() >= lockStart - LOCKOUT_MS
}

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
        private readonly user: {
            id: string
            signInLockedUntil: Date | null
            signInFailedAttempts: number
        },
    ) {}

    async isLocked(ipHash: string): Promise<boolean> {
        const throttle = await this.prisma.signInThrottle.findUnique({
            where: { userId_ipHash: { userId: this.user.id, ipHash } },
            select: { lockedUntil: true, updatedAt: true },
        })
        if (
            accountLockApplies(
                {
                    lockedUntil: this.user.signInLockedUntil,
                    failedAttempts: this.user.signInFailedAttempts,
                },
                throttle,
            )
        ) {
            return true
        }
        return isActive(throttle?.lockedUntil ?? null)
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

        // Counts during a soft lock too (addresses outside it may still try);
        // only a hard lock (active, counter zeroed) stops counting.
        const byAccount = await this.prisma.user.updateMany({
            where: {
                id: userId,
                signInFailedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ACCOUNT_HARD },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                    { signInFailedAttempts: { gt: 0 } },
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

    // Gives back the ticket claim took, for an attempt that turned out not to
    // be a guess: the e-mailed code was right and the client only still has
    // to send the authenticator code. Never below zero; a lock that started
    // meanwhile (counter zeroed) is left alone.
    async release(ipHash: string): Promise<void> {
        const userId = this.user.id
        await this.prisma.signInThrottle.updateMany({
            where: {
                userId,
                ipHash,
                failedAttempts: { gt: 0 },
                ...unlocked(),
            },
            data: { failedAttempts: { decrement: 1 } },
        })
        await this.prisma.user.updateMany({
            where: { id: userId, signInFailedAttempts: { gt: 0 } },
            data: { signInFailedAttempts: { decrement: 1 } },
        })
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

    // Starts the lockouts once their tickets are spent. Idempotent under
    // races: count is 1 only for the request that started a lock, so a burst
    // of concurrent wrong codes audits it once.
    private async lockAccountIfExhausted(): Promise<void> {
        const until = () => new Date(Date.now() + LOCKOUT_MS)
        // Hard: zero the counter (marks the lock as hard; the account is fresh
        // when it expires). Allowed over an active soft lock.
        const hard = await this.prisma.user.updateMany({
            where: {
                id: this.user.id,
                signInFailedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ACCOUNT_HARD },
            },
            data: { signInFailedAttempts: 0, signInLockedUntil: until() },
        })
        if (hard.count > 0) {
            await this.recordLockout('account')
            return
        }
        // Soft: keep the counter so later failures still climb to the hard one.
        const soft = await this.prisma.user.updateMany({
            where: {
                id: this.user.id,
                signInFailedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                OR: [
                    { signInLockedUntil: null },
                    { signInLockedUntil: { lt: new Date() } },
                ],
            },
            data: { signInLockedUntil: until() },
        })
        if (soft.count > 0) await this.recordLockout('guessingAddresses')
    }

    private async recordLockout(scope: 'account' | 'guessingAddresses'): Promise<void> {
        await this.audit.record({
            action: 'auth.lockout',
            targetType: 'member',
            targetId: this.user.id,
            actorId: this.user.id,
            workspaceId: null,
            metadata: { lockoutMinutes: LOCKOUT_MS / 60_000, scope },
        })
    }
}

// Same rules for an address with no account yet. No audit entry on lockout:
// there is no member to attach it to.
export class PendingSignInAttempts implements SignInAttempts {
    constructor(
        private readonly prisma: PrismaService,
        private readonly pending: {
            email: string
            lockedUntil: Date | null
            failedAttempts: number
        },
    ) {}

    async isLocked(ipHash: string): Promise<boolean> {
        const throttle = await this.prisma.pendingSignInThrottle.findUnique({
            where: { email_ipHash: { email: this.pending.email, ipHash } },
            select: { lockedUntil: true, updatedAt: true },
        })
        if (accountLockApplies(this.pending, throttle)) return true
        return isActive(throttle?.lockedUntil ?? null)
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
                failedAttempts: { lt: MAX_FAILED_ATTEMPTS_PER_ACCOUNT_HARD },
                OR: [
                    { lockedUntil: null },
                    { lockedUntil: { lt: new Date() } },
                    { failedAttempts: { gt: 0 } },
                ],
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
        const until = () => new Date(Date.now() + LOCKOUT_MS)
        const hard = await this.prisma.pendingSignIn.updateMany({
            where: {
                email: this.pending.email,
                failedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ACCOUNT_HARD },
            },
            data: { failedAttempts: 0, lockedUntil: until() },
        })
        if (hard.count > 0) return
        await this.prisma.pendingSignIn.updateMany({
            where: {
                email: this.pending.email,
                failedAttempts: { gte: MAX_FAILED_ATTEMPTS_PER_ACCOUNT },
                ...unlocked(),
            },
            data: { lockedUntil: until() },
        })
    }
}
