import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../../environments/environment'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { loadRegistry } from '../../../domains/organizations/registry'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    SearchOrganizationRegistryFeature,
    SearchOrganizationRegistryFeatureResponse,
} from './search-organization-registry.feature'

@Feature(SearchOrganizationRegistryFeature)
export class SearchOrganizationRegistryHandler
    implements
        IFeatureHandler<
            SearchOrganizationRegistryFeature,
            SearchOrganizationRegistryFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: SearchOrganizationRegistryFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const org = await this.prisma.organization.findUnique({
            where: { id: f.organizationId },
            select: { timezone: true },
        })
        if (!org) throw new NotFoundError({ message: 'Федерация не найдена' })
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 50
        const { data, total } = await loadRegistry(this.prisma, {
            organizationId: f.organizationId,
            timezone: org.timezone,
            secret: environment.encryptionKey,
            query: { ...f.payload, curPage, perPage },
        })
        return { data, total, curPage, perPage }
    }
}
