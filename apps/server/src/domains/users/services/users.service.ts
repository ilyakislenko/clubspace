import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { UserNotFoundError } from '../errors/users.errors'

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) {}

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
}
