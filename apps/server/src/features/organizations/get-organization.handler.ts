import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrgStaff, OrgRbacService } from '../../domains/organizations/org-access'
import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetOrganizationFeature,
    GetOrganizationFeatureResponse,
} from './get-organization.feature'
import { ORGANIZATION_SELECT, serializeOrganization } from './schemas'

// The console's header and OrgGate: the org and the caller's role in it.
@Feature(GetOrganizationFeature)
export class GetOrganizationHandler
    implements IFeatureHandler<GetOrganizationFeature, GetOrganizationFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly files: FilesService,
    ) {}

    async execute(f: GetOrganizationFeature) {
        const scope = await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const org = await this.prisma.organization.findUnique({
            where: { id: f.organizationId },
            select: ORGANIZATION_SELECT,
        })
        if (!org) throw new NotFoundError({ message: 'Федерация не найдена' })
        return serializeOrganization(org, {
            myRole: scope.role,
            logoUrl: await signClubLogoUrl(this.files, org.logoKey),
        })
    }
}
