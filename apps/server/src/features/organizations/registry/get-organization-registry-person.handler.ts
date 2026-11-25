import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../../environments/environment'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { loadRegistryPerson } from '../../../domains/organizations/registry'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    GetOrganizationRegistryPersonFeature,
    GetOrganizationRegistryPersonFeatureResponse,
} from './get-organization-registry-person.feature'

@Feature(GetOrganizationRegistryPersonFeature)
export class GetOrganizationRegistryPersonHandler
    implements
        IFeatureHandler<
            GetOrganizationRegistryPersonFeature,
            GetOrganizationRegistryPersonFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: GetOrganizationRegistryPersonFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        return loadRegistryPerson(this.prisma, {
            organizationId: f.organizationId,
            secret: environment.encryptionKey,
            personKey: f.personKey,
        })
    }
}
