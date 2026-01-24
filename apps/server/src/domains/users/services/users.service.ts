import { Inject, Injectable } from '@nestjs/common'

import { genSalt, hash } from 'bcrypt'
import { randomInt } from 'crypto'
import { environment } from '../../../environments/environment'
import { LanguageEnum, PrismaService, UserStatus } from '../../../infrastructure/prisma'
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
