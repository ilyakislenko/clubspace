import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { GRANTABLE_ROLE_NAMES } from '../../shared/decorators/roles.decorator'
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
            // Only the roles a club admin can actually grant; hides the
            // platform-superadmin role (privilege-escalation footgun) and
            // any legacy rows.
            where: { name: { in: GRANTABLE_ROLE_NAMES } },
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
