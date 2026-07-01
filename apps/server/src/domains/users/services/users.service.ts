import { Inject, Injectable } from '@nestjs/common'

import { genSalt, hash } from 'bcrypt'
import { randomInt } from 'crypto'
import { environment } from '../../../environments/environment'
import { LanguageEnum, PrismaService, UserStatus } from '../../../infrastructure/prisma'
import { BadRequestError } from '../../../shared/errors/shared.errors'
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
                email: payload.email,
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
            throw new UserNotFoundError({ id: payload.id })
        }

        return user
    }

    async getUserByEmail(payload: { email: string }) {
        return await this.prisma.user.findUnique({
            where: {
                email: payload.email,
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
    async deleteAccount(userId: string): Promise<void> {
        const [ownedWorkspaces, coachedGroups] = await Promise.all([
            this.prisma.workspace.count({ where: { ownerId: userId } }),
            this.prisma.group.count({ where: { coachId: userId } }),
        ])

        if (ownedWorkspaces > 0 || coachedGroups > 0) {
            throw new BadRequestError({
                message:
                    'Ваш аккаунт управляет клубом (владелец или тренер группы). Передайте эти роли в админ-панели, затем удалите аккаунт.',
            })
        }

        await this.prisma.$transaction(async (tx) => {
            // Purge personal data + sessions (the row is kept, so nothing
            // cascades — delete each explicitly).
            await Promise.all([
                tx.refreshToken.deleteMany({ where: { userId } }),
                tx.tfaMethod.deleteMany({ where: { userId } }),
                tx.firebaseDevice.deleteMany({ where: { userId } }),
                tx.notification.deleteMany({ where: { userId } }),
                tx.notificationPreferences.deleteMany({ where: { userId } }),
                tx.videoFavorite.deleteMany({ where: { userId } }),
                tx.videoWatched.deleteMany({ where: { userId } }),
                tx.file.deleteMany({ where: { userId } }),
                tx.workspaceMember.deleteMany({ where: { userId } }),
                tx.groupMember.deleteMany({ where: { userId } }),
                tx.groupCoach.deleteMany({ where: { userId } }),
            ])

            // Anonymize: free the real email/identifiers (stable, non-routable
            // pseudonym so the person can re-register) and null all other PII.
            await tx.user.update({
                where: { id: userId },
                data: {
                    email: `deleted+${userId}@deleted.invalid`,
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
                    status: UserStatus.DELETED,
                    deletedAt: new Date(),
                },
            })
        })
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

        if (!user) {
            throw new UserNotFoundError({ id: payload.userId })
        }

        if (
            user.completeCodeNextResendAt &&
            user.completeCodeNextResendAt > new Date()
        ) {
            throw new UserCompleteCodeTooEarlyError({ id: payload.userId })
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
}
