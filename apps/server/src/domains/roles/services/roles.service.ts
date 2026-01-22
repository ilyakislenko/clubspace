import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { RoleNotFoundError } from '../errors/roles.errors'

@Injectable()
export class RolesService {
    constructor(private readonly prisma: PrismaService) {}

    async getRole(data: { userId: string }) {
        const role = await this.prisma.role.findFirst({
            where: {
                users: {
                    some: {
                        id: data.userId,
                    },
                },
            },
            include: {
                permissions: {
                    include: {
                        feature: true,
                    },
                },
            },
        })

        if (!role) {
            throw new RoleNotFoundError({ id: '' })
        }

        return {
            id: role.id,
            name: role.name,
            superuser: role.superuser,
            editable: role.editable,
            features: role.permissions.map((u) => {
                const allowed =
                    role.superuser === true
                        ? true
                        : u.feature.alwaysIn === null
                        ? u.allowed
                        : u.feature.alwaysIn

                return {
                    id: u.feature.id,
                    key: u.feature.key,
                    editable: u.feature.alwaysIn === null,
                    group: u.feature.group,
                    description: u.feature.description,
                    allowed,
                }
            }),
        }
    }
}
