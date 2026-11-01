import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadMemberDirectionIds } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import {
    type RoleName,
    STAFF_ROLES,
} from '../../shared/decorators/roles.decorator'
import {
    ListDirectionsFeature,
    ListDirectionsFeatureResponse,
} from './list-directions.feature'
import { serializeDirection } from './schemas'

// Any member reads the club's directions (the app's tabs and filter chips);
// `isMine` marks the ones the caller trains in or coaches. Archived
// directions are shown to the staff only.
@Feature(ListDirectionsFeature)
export class ListDirectionsHandler
    implements
        IFeatureHandler<ListDirectionsFeature, ListDirectionsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListDirectionsFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        const isStaff =
            f.isSuperAdmin ||
            workspace?.ownerId === f.invokerUserId ||
            STAFF_ROLES.includes((f.roleName ?? '') as RoleName)
        const [rows, mine] = await Promise.all([
            this.prisma.direction.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    ...(isStaff ? {} : { isActive: true }),
                },
                orderBy: [{ order: 'asc' }, { name: 'asc' }],
                include: { _count: { select: { groups: true } } },
            }),
            loadMemberDirectionIds(this.prisma, f.workspaceId, f.invokerUserId),
        ])
        return {
            data: rows.map((r) => serializeDirection(r, mine.has(r.id))),
        }
    }
}
