import { Feature, IFeatureHandler } from '@shelfjs/features'
import { randomUUID } from 'crypto'

import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { orgLogoKeyPrefix } from '../../domains/organizations/org-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import {
    CreateOrganizationLogoUploadFeature,
    CreateOrganizationLogoUploadFeatureResponse,
} from './create-organization-logo-upload.feature'

@Feature(CreateOrganizationLogoUploadFeature)
export class CreateOrganizationLogoUploadHandler
    implements
        IFeatureHandler<
            CreateOrganizationLogoUploadFeature,
            CreateOrganizationLogoUploadFeatureResponse
        >
{
    constructor(
        private readonly orgRbac: OrgRbacService,
        private readonly files: FilesService,
    ) {}

    async execute({ payload, organizationId, invokerUserId, isSuperAdmin }: CreateOrganizationLogoUploadFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Профиль федерации меняет администратор федерации',
        )
        const key = `${orgLogoKeyPrefix(organizationId)}${randomUUID()}`
        const upload = await this.files.getPresignedPutUrl({
            bucket: this.files.getDefaultBucketName(),
            key,
            contentType: payload.contentType,
            contentLength: payload.contentLength,
        })
        return { key, upload }
    }
}
