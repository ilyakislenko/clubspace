import { Inject, Injectable } from '@nestjs/common'

import { genSalt, hash } from 'bcrypt'
import { randomInt } from 'crypto'
import { environment } from '../../../environments/environment'
import { LanguageEnum, Prisma, PrismaService, UserStatus } from '../../../infrastructure/prisma'
import { isDemoAccountEmail } from '../../../shared/utils/demo-mode.util'
import { isStoreReviewEmail } from '../../../shared/utils/store-review.util'
import { BadRequestError } from '../../../shared/errors/shared.errors'
import { vocabularyForWorkspaceType } from '../../../shared/utils/club-vocabulary'
import { purgePersonalTraining } from '../../../features/personal-trainings/purge-personal-training'
import { USERS_PUBLISHER, UsersEventPattern, type UsersEventsPublisher } from '../configs/users-events.config'
import { UserCompleteCodeTooEarlyError, UserNotFoundError } from '../errors/users.errors'

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService, 
        @Inject(USERS_PUBLISHER)
        private readonly events: UsersEventsPublisher) {
        
    }

    async createUser(payload: {
        email: string
        language?: LanguageEnum
        googleId?: string
        appleId?: string
    }) {
        const user = await this.prisma.user.create({
            data: {
                email: payload.email.trim().toLowerCase(),
                status: UserStatus.ACTIVE,
                language: payload.language,
                googleId: payload.googleId,
                appleId: payload.appleId,
            },
            select: {
                id: true,
            },
        })

        return {
            id: user.id,
        }
    }

    async getUserById(payload: { id: string }) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: payload.id,
            },
        })

        if (!user) {
            throw new UserNotFoundError()
        }

        return user
    }

    async getUserByEmail(payload: { email: string }) {
        // The single e-mail resolver. Exact match on the normalised value on
        // purpose: a case-insensitive Prisma filter compiles to ILIKE, where
        // `_` and `%` in an address would act as wildcards. Legacy mixed-case
        // rows are lowercased once at boot (BootstrapSeedService).
        return await this.prisma.user.findUnique({
            where: {
                email: payload.email.trim().toLowerCase(),
            },
        })
    }

    // Self-service account deletion (App Store requirement 5.1.1(v)).
    //
    // We SOFT-delete: the User row is kept but anonymized (PII scrubbed,
    // status=DELETED). Hard-deleting would leave gaps wherever a historical
    // record references the user — e.g. future leaderboards / competition
    // results — so we keep a stable, de-identified anchor and purge everything
    // personal/session instead. Owners/coaches hold active management roles
    // that can't point at a deleted account, so they must hand those off first.
    //
    // Families: deleting a guardian also deletes every dependent left with no
    // other guardian (a child profile has no login, so nobody could ever reach
    // or delete it again); deleting a dependent is the same purge.
    async deleteAccount(userId: string): Promise<void> {
        const orphans = await this.prisma.user.findMany({
            where: {
                dependentOf: {
                    some: { guardianId: userId },
                    every: { guardianId: userId },
                },
                status: { not: UserStatus.DELETED },
            },
            select: { id: true },
        })
        const ids = [userId, ...orphans.map((o) => o.id)]

        const [ownedWorkspaces, coachedGroups, targets] = await Promise.all([
            this.prisma.workspace.count({ where: { ownerId: { in: ids } } }),
            this.prisma.group.count({ where: { coachId: { in: ids } } }),
            this.prisma.user.findMany({
                where: { id: { in: ids } },
                select: { id: true, email: true },
            }),
        ])

        if (ownedWorkspaces > 0 || coachedGroups > 0) {
            // The words of the club whose group they lead (an account spans
            // clubs; read only on refusal).
            const coached =
                coachedGroups > 0
                    ? await this.prisma.group.findFirst({
                          where: { coachId: { in: ids } },
                          select: { workspace: { select: { type: true } } },
                      })
                    : null
            const v = vocabularyForWorkspaceType(coached?.workspace.type)
            throw new BadRequestError({
                message: `Ваш аккаунт управляет клубом (владелец или ${v.coach.nom} группы). Передайте эти роли в админ-панели, затем удалите аккаунт.`,
            })
        }

        const now = new Date()
        await this.prisma.$transaction(async (tx) => {
            for (const target of targets) {
                await this.purgeAccount(tx, target.id, target.email !== null, now)
            }
            await tx.guardianship.deleteMany({
                where: {
                    OR: [
                        { guardianId: { in: ids } },
                        { dependentId: { in: ids } },
                    ],
                },
            })
        })
    }

    private async purgeAccount(
        tx: Prisma.TransactionClient,
        userId: string,
        hasEmail: boolean,
        now: Date,
    ): Promise<void> {
        // Personal-training offers, requests (open ones cancelled, comments
        // scrubbed) and unattended sessions, in every club.
        await purgePersonalTraining(tx, { userId, now })

        // Purge personal data + sessions (the row is kept, so nothing
        // cascades — delete each explicitly).
        await Promise.all([
            tx.refreshToken.deleteMany({ where: { userId } }),
            tx.tfaMethod.deleteMany({ where: { userId } }),
            tx.firebaseDevice.deleteMany({ where: { userId } }),
            tx.webPushSubscription.deleteMany({ where: { userId } }),
            tx.notification.deleteMany({ where: { userId } }),
            tx.notificationPreferences.deleteMany({ where: { userId } }),
            tx.videoFavorite.deleteMany({ where: { userId } }),
            tx.videoWatched.deleteMany({ where: { userId } }),
            tx.file.deleteMany({ where: { userId } }),
            tx.workspaceMember.deleteMany({ where: { userId } }),
            tx.groupMember.deleteMany({ where: { userId } }),
            tx.groupCoach.deleteMany({ where: { userId } }),
            tx.dropInBooking.deleteMany({ where: { userId } }),
            // Open grading slots go; PASSED/FAILED stay as club history.
            tx.rankGradingCandidate.deleteMany({
                where: { userId, result: 'PENDING' },
            }),
            // Free-text training notes (the row is kept, so the FK
            // cascade never fires).
            tx.trainingJournalEntry.deleteMany({ where: { userId } }),
            // Audit rows about this member stay (de-identified by id) but
            // their metadata carries the person's email / names. Nothing
            // ever writes AuditEvent.actorEmail, so it needs no scrub.
            tx.auditEvent.updateMany({
                where: { targetType: 'member', targetId: userId },
                data: { metadata: Prisma.DbNull },
            }),
            // Coach-written free text about this person.
            tx.rankPromotion.updateMany({
                where: { userId },
                data: { note: null },
            }),
            // Staff notes about this member are personal data; notes this
            // user wrote as staff lose their text but stay as records.
            tx.memberRetentionContact.deleteMany({ where: { userId } }),
            tx.memberRetentionContact.updateMany({
                where: { contactedById: userId },
                data: { note: null },
            }),
            // Freeze requests this user made go; ones they decided as staff
            // lose the comment but stay as records.
            tx.subscriptionFreezeRequest.deleteMany({ where: { userId } }),
            tx.subscriptionFreezeRequest.updateMany({
                where: { decidedById: userId },
                data: { decisionComment: null },
            }),
            // Deleting the account withdraws the personal-data consent, and
            // deleting a dependent withdraws its guardians' consent for it.
            // The acceptances stay as evidence of what was agreed and when,
            // minus where it was given from (ip / device are PII).
            tx.consentRecord.updateMany({
                where: {
                    OR: [{ userId }, { dependentId: userId }],
                    withdrawnAt: null,
                },
                data: { withdrawnAt: now, ip: null, userAgent: null },
            }),
        ])

        // Anonymize: free the real email/identifiers (stable, non-routable
        // pseudonym so the person can re-register) and null all other PII.
        // A dependent never had an e-mail and keeps none.
        await tx.user.update({
            where: { id: userId },
            data: {
                email: hasEmail ? `deleted+${userId}@deleted.invalid` : null,
                phone: null,
                password: null,
                googleId: null,
                appleId: null,
                firstname: null,
                lastname: null,
                dateOfBirth: null,
                description: null,
                profilePhotoUrl: null,
                completeCode: null,
                completeCodeNextResendAt: null,
                completeCodeIssuedAt: null,
                personalDataConsentVersion: null,
                status: UserStatus.DELETED,
                deletedAt: now,
                // Ends every outstanding access token at once.
                sessionVersion: { increment: 1 },
            },
        })
    }

    // True when `guardianId` holds a confirmed Guardianship over a live
    // dependent. The single check behind X-Act-As (AuthGuard).
    async isActiveGuardian(p: {
        guardianId: string
        dependentId: string
    }): Promise<boolean> {
        const link = await this.prisma.guardianship.findUnique({
            where: {
                guardianId_dependentId: {
                    guardianId: p.guardianId,
                    dependentId: p.dependentId,
                },
            },
            select: {
                consentAt: true,
                dependent: { select: { status: true } },
            },
        })
        return (
            link !== null &&
            link.consentAt !== null &&
            link.dependent.status === UserStatus.ACTIVE
        )
    }

    async createCompleteCode(payload: { userId: string; timeout?: number }) {
        let { timeout } = payload
         
        timeout = timeout || environment.completeCodeTimeout

        const user = await this.prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                completeCode: true,
                completeCodeNextResendAt: true,
                email: true,
            },
        })

        // A dependent (no e-mail) cannot sign in, so there is nobody to mail
        // a code to: treat it like an unknown account.
        if (!user || !user.email) {
            throw new UserNotFoundError()
        }

        // Fixed-code accounts (store review; demo accounts in DEMO_MODE) sign
        // in with a fixed code; never issue or mail an OTP for them
        // (resend-code reaches this by userId).
        if (isStoreReviewEmail(user.email) || isDemoAccountEmail(user.email)) return

        if (
            user.completeCodeNextResendAt &&
            user.completeCodeNextResendAt > new Date()
        ) {
            throw new UserCompleteCodeTooEarlyError(user.completeCodeNextResendAt)
        }

        const salt = await genSalt()

        const completeCode = randomInt(100000, 999999).toString()
        const hashedCompleteCode = await hash(completeCode, salt)

        await this.prisma.user.update({
            where: { id: payload.userId },
            data: {
                completeCode: hashedCompleteCode,
                completeCodeNextResendAt: new Date(Date.now() + timeout),
                completeCodeIssuedAt: new Date(),
                // NB: do NOT reset signInFailedAttempts / signInLockedUntil
                // here. Issuing a code is unauthenticated (send-auth-code by
                // email, resend-code by userId), so clearing the lockout on
                // issuance lets an attacker defeat the OTP brute-force lock by
                // simply requesting a new code each cooldown window. The
                // lockout is owned entirely by the sign-in handler, which
                // resets the counter on a successful sign-in and lets the lock
                // expire on its own.
            },
        })

        await this.events.send({
            pattern: UsersEventPattern.USER_COMPLETE_CODE_CREATED,
            data: {
                userId: user.id,
                email: user.email,
                completeCode: completeCode,
            },
        })
    }

    // Issues a code for an address that has no account yet. Nothing is
    // created in User: sign-in creates the account once the code is proven.
    // Same cooldown and code shape as createCompleteCode.
    async createPendingSignInCode(payload: {
        email: string
        language?: LanguageEnum
        joinWorkspaceKey: string | null
    }) {
        const email = payload.email.trim().toLowerCase()
        const timeout = environment.completeCodeTimeout

        const pending = await this.prisma.pendingSignIn.findUnique({
            where: { email },
            select: { codeNextResendAt: true },
        })
        if (pending?.codeNextResendAt && pending.codeNextResendAt > new Date()) {
            throw new UserCompleteCodeTooEarlyError(pending.codeNextResendAt)
        }

        const completeCode = randomInt(100000, 999999).toString()
        const codeHash = await hash(completeCode, await genSalt())
        const now = new Date()
        const data = {
            codeHash,
            codeIssuedAt: now,
            codeNextResendAt: new Date(now.getTime() + timeout),
            language: payload.language ?? null,
            joinWorkspaceKey: payload.joinWorkspaceKey,
            // The wrong-code counters are NOT reset here, for the reason
            // given in createCompleteCode.
        }
        await this.prisma.pendingSignIn.upsert({
            where: { email },
            create: { email, ...data },
            update: data,
        })

        await this.events.send({
            pattern: UsersEventPattern.PENDING_SIGN_IN_CODE_CREATED,
            data: { email, completeCode },
        })
    }
}
