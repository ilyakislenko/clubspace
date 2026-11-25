import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { type Prisma, PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import type { PlatformOrganization } from './create-organization.feature'
import {
    ListPlatformOrganizationsFeature,
    ListPlatformOrganizationsFeatureResponse,
} from './list-organizations.feature'

export const PLATFORM_ORG_SELECT = {
    id: true,
    key: true,
    name: true,
    type: true,
    city: true,
    timezone: true,
    isDemo: true,
    isActive: true,
    createdAt: true,
    clubs: {
        where: { status: { in: ['ACTIVE', 'INVITED'] } },
        select: { status: true },
    },
    _count: { select: { members: true } },
} satisfies Prisma.OrganizationSelect

export const serializePlatformOrganization = (o: {
    id: string
    key: string
    name: string
    type: PlatformOrganization['type']
    city: string | null
    timezone: string
    isDemo: boolean
    isActive: boolean
    createdAt: Date
    clubs: Array<{ status: string }>
    _count: { members: number }
}): PlatformOrganization => ({
    id: o.id,
    key: o.key,
    name: o.name,
    type: o.type,
    city: o.city,
    timezone: o.timezone,
    isDemo: o.isDemo,
    isActive: o.isActive,
    activeClubs: o.clubs.filter((c) => c.status === 'ACTIVE').length,
    invitedClubs: o.clubs.filter((c) => c.status === 'INVITED').length,
    members: o._count.members,
    createdAt: o.createdAt.toISOString(),
})

@Feature(ListPlatformOrganizationsFeature)
export class ListPlatformOrganizationsHandler
    implements
        IFeatureHandler<ListPlatformOrganizationsFeature, ListPlatformOrganizationsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListPlatformOrganizationsFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        assertOrganizationsEnabled()
        const rows = await this.prisma.organization.findMany({
            select: PLATFORM_ORG_SELECT,
            orderBy: { createdAt: 'desc' },
        })
        return { data: rows.map(serializePlatformOrganization) }
    }
}
