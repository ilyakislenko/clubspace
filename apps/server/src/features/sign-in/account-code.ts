import { compare } from 'bcrypt'

import { UserNoCompleteCodeError } from '../../domains/users/errors/users.errors'
import { PrismaService } from '../../infrastructure/prisma'
import { SignInAttempts } from './sign-in-attempts'
import { InvalidCredentialsError } from './sign-in.feature'

// OTP lifetime — long enough for a slow inbox / SMS, short enough that
// a leaked code can't be redeemed later. 15 minutes is the industry
// default (Google, GitHub, AWS).
const CODE_TTL_MS = 15 * 60 * 1000

// Compared against for a fixed code so it spends the same bcrypt time as a
// normal account (which compares against its emailed code's hash).
const DUMMY_HASH = '$2b$10$4ztxPTDvmLpKogYQGru0BOvy.ePGpMHLJgUIb6t8KWBwUhjJ2QVXW'

const isCodeStale = (issuedAt: Date | null): boolean =>
    !!issuedAt && Date.now() - issuedAt.getTime() > CODE_TTL_MS

/**
 * The one check of a code issued by send-auth-code, shared by sign-in and
 * account deletion. The caller checks `attempts.isLocked` first. Refuses
 * when no code was requested or it is stale, then counts the attempt
 * (`claim`) before comparing; a wrong code starts the lockouts and throws
 * InvalidCredentialsError. `fixedMatches` is set for a fixed-code account
 * (store review, demo): only the request stamp is needed then.
 */
export const verifyIssuedCode = async (p: {
    attempts: SignInAttempts
    ipHash: string
    code: string
    codeHash: string | null
    issuedAt: Date | null
    fixedMatches?: (code: string) => boolean
}): Promise<void> => {
    const { attempts, ipHash, code, codeHash, issuedAt, fixedMatches } = p
    if (fixedMatches ? !issuedAt : !codeHash) {
        throw new UserNoCompleteCodeError()
    }
    // Code TTL — reject without bcrypt work if it's stale.
    if (isCodeStale(issuedAt)) {
        throw new InvalidCredentialsError()
    }

    await attempts.claim(ipHash)

    let matches: boolean
    if (fixedMatches) {
        // Timing parity with a mailed code; the result is not used.
        await compare(code, DUMMY_HASH)
        matches = fixedMatches(code)
    } else {
        matches = codeHash !== null && (await compare(code, codeHash))
    }
    if (!matches) {
        await attempts.afterFailure(ipHash)
        throw new InvalidCredentialsError()
    }
}

/**
 * A proven code is burnt so it can't be replayed, and the brute-force state
 * reset. (A fixed-code account has no stored code; the write is a harmless
 * no-op on those fields.) The resend cooldown goes too: it guards the mailbox
 * while a code is pending, and kept afterwards it refused the next code on
 * this address («чуть позже») for the rest of the minute.
 */
export const consumeAccountCode = async (
    prisma: PrismaService,
    userId: string,
): Promise<void> => {
    await prisma.user.update({
        where: { id: userId },
        data: {
            completeCode: null,
            completeCodeIssuedAt: null,
            completeCodeNextResendAt: null,
            signInFailedAttempts: 0,
            signInLockedUntil: null,
        },
    })
    // Wrong-code counters of this account's addresses go too, except locks
    // still running: a success here must not unlock whoever was guessing
    // from elsewhere.
    await prisma.signInThrottle.deleteMany({
        where: {
            userId,
            OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
        },
    })
}
