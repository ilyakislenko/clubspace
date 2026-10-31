import { Feature, IFeatureHandler } from '@shelfjs/features'
import { randomUUID } from 'crypto'

import { clubLogoKeyPrefix } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateClubLogoUploadFeature,
    CreateClubLogoUploadFeatureResponse,
} from './create-club-logo-upload.feature'

@Feature(CreateClubLogoUploadFeature)
export class CreateClubLogoUploadHandler
    implements
        IFeatureHandler<
            CreateClubLogoUploadFeature,
            CreateClubLogoUploadFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly files: FilesService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: CreateClubLogoUploadFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Публичную страницу клуба настраивает только администратор',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const key = `${clubLogoKeyPrefix(workspaceId)}${randomUUID()}`
        const upload = await this.files.getPresignedPutUrl({
            bucket: this.files.getDefaultBucketName(),
            key,
            contentType: payload.contentType,
            contentLength: payload.contentLength,
        })
        return { key, upload }
    }
}
