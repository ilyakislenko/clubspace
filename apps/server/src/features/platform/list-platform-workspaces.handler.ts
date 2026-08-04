import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { parseMetaArgs } from '../../shared/utils/parse-meta-args.util'
import {
    ListPlatformWorkspacesFeature,
    ListPlatformWorkspacesFeatureResponse,
} from './list-platform-workspaces.feature'
import { serializePlatformWorkspace } from './schemas'

@Feature(ListPlatformWorkspacesFeature)
export class ListPlatformWorkspacesHandler
    implements
        IFeatureHandler<
            ListPlatformWorkspacesFeature,
            ListPlatformWorkspacesFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListPlatformWorkspacesFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { curPage, perPage, skip, take } = parseMetaArgs({
            curPage: f.payload.curPage,
            perPage: f.payload.perPage,
            defaults: { curPage: 1, perPage: 20 },
        })

        const where = await this.buildWhere(f.payload.search)

        const [workspaces, total] = await Promise.all([
            this.prisma.workspace.findMany({
                where,
                select: {
                    id: true,
                    key: true,
                    name: true,
                    type: true,
                    isActive: true,
                    timezone: true,
                    ownerId: true,
                    createdAt: true,
                    _count: { select: { members: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            this.prisma.workspace.count({ where }),
        ])

        // ownerId is a plain column, not a relation, so the owners come back
        // in one extra query instead of an include. Keeps this O(2) rather
        // than O(n) and tolerates an ownerId with no surviving user row.
        const ownerIds = [...new Set(workspaces.map((w) => w.ownerId))]
        const owners = ownerIds.length
            ? await this.prisma.user.findMany({
                  where: { id: { in: ownerIds } },
                  select: {
                      id: true,
                      email: true,
                      firstname: true,
                      lastname: true,
                  },
              })
            : []
        const ownerById = new Map(owners.map((owner) => [owner.id, owner]))

        return {
            data: workspaces.map((workspace) =>
                serializePlatformWorkspace(
                    workspace,
                    ownerById.get(workspace.ownerId) ?? null,
                ),
            ),
            meta: { curPage, perPage, total },
        }
    }

    // Search spans name, key and owner email. Email lives on User, and there
    // is no relation to join through, so matching owners are resolved to ids
    // first and folded into the same OR.
    private async buildWhere(search?: string) {
        const term = search?.trim()
        if (!term) return {}

        const matchingOwners = await this.prisma.user.findMany({
            where: { email: { contains: term, mode: 'insensitive' as const } },
            select: { id: true },
        })

        return {
            OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { key: { contains: term, mode: 'insensitive' as const } },
                ...(matchingOwners.length
                    ? [{ ownerId: { in: matchingOwners.map((o) => o.id) } }]
                    : []),
            ],
        }
    }
}
