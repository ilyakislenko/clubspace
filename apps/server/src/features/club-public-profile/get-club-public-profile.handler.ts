import { Feature, IFeatureHandler } from '@shelfjs/features'

import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { ensureJoinCode } from '../../domains/workspace/join-code.store'
import { ensurePublicSlug } from '../../domains/workspace/public-slug.store'
import { environment } from '../../environments/environment'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetClubPublicProfileFeature,
    GetClubPublicProfileFeatureResponse,
} from './get-club-public-profile.feature'
import {
    PUBLIC_PROFILE_WORKSPACE_SELECT,
    serializeClubPublicProfile,
} from './schemas'

@Feature(GetClubPublicProfileFeature)
export class GetClubPublicProfileHandler
    implements
        IFeatureHandler<
            GetClubPublicProfileFeature,
            GetClubPublicProfileFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly files: FilesService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: GetClubPublicProfileFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Публичную страницу клуба настраивает только администратор',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: PUBLIC_PROFILE_WORKSPACE_SELECT,
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        // Both are assigned on first need, so an existing club gets its
        // address and its preview link the first time an admin looks.
        const slug = await ensurePublicSlug(this.prisma, workspace)
        const joinCode = await ensureJoinCode(this.prisma, workspaceId)

        return serializeClubPublicProfile({
            slug,
            joinCode,
            appUrl: environment.appUrl,
            workspace,
            logoUrl: await signClubLogoUrl(this.files, workspace.logoKey),
        })
    }
}
