import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListRolesFeature,
    ListRolesFeatureResponse,
} from './list-roles.feature'

@Feature(ListRolesFeature)
export class ListRolesHandler
    implements IFeatureHandler<ListRolesFeature, ListRolesFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute() {
        const roles = await this.prisma.role.findMany({
            // Hide the platform-superadmin role from the workspace UI; that
            // role is reserved for our staff and granting it via the admin
            // panel would be a privilege-escalation footgun.
            where: { superuser: false },
            orderBy: { name: 'asc' },
        })

        return {
            data: roles.map((r) => ({
                id: r.id,
                name: r.name,
                superuser: r.superuser,
                editable: r.editable,
            })),
        }
    }
}
