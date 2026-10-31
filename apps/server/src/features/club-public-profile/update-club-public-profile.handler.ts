import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import {
    isOwnClubLogoKey,
    signClubLogoUrl,
} from '../../domains/workspace/club-logo'
import { ensureJoinCode } from '../../domains/workspace/join-code.store'
import { ensurePublicSlug } from '../../domains/workspace/public-slug.store'
import { environment } from '../../environments/environment'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    PUBLIC_PROFILE_WORKSPACE_SELECT,
    serializeClubPublicProfile,
} from './schemas'
import {
    UpdateClubPublicProfileFeature,
    UpdateClubPublicProfileFeatureResponse,
} from './update-club-public-profile.feature'

const isUniqueClash = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002'

@Feature(UpdateClubPublicProfileFeature)
export class UpdateClubPublicProfileHandler
    implements
        IFeatureHandler<
            UpdateClubPublicProfileFeature,
            UpdateClubPublicProfileFeatureResponse
        >
{
    private readonly logger = new Logger(UpdateClubPublicProfileHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly files: FilesService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: UpdateClubPublicProfileFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Публичную страницу клуба настраивает только администратор',
        )

        const current = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: PUBLIC_PROFILE_WORKSPACE_SELECT,
        })
        if (!current) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        if (
            payload.logoKey !== null &&
            payload.logoKey !== current.logoKey &&
            !isOwnClubLogoKey(workspaceId, payload.logoKey)
        ) {
            throw new BadRequestError({
                message: 'Логотип не найден — загрузите его ещё раз',
            })
        }

        // The slug first: a clash must refuse the save before anything else
        // has changed.
        const previousSlug = await ensurePublicSlug(this.prisma, current)
        if (payload.slug !== previousSlug) {
            try {
                await this.prisma.workspacePublicSlug.update({
                    where: { workspaceId },
                    data: { slug: payload.slug },
                })
            } catch (e) {
                if (!isUniqueClash(e)) throw e
                throw new BadRequestError({
                    message: `Адрес «${payload.slug}» уже занят другим клубом`,
                })
            }
        }

        const workspace = await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: {
                city: payload.city,
                publicDescription: payload.description,
                logoKey: payload.logoKey,
                isListed: payload.isListed,
            },
            select: PUBLIC_PROFILE_WORKSPACE_SELECT,
        })

        if (current.logoKey && current.logoKey !== workspace.logoKey) {
            await this.deleteLogo(current.logoKey)
        }

        // A listed page offers «Вступить», which needs the club's code.
        const joinCode = await ensureJoinCode(this.prisma, workspaceId)

        await this.audit.record({
            action: 'workspace.updatePublicProfile',
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                slug: payload.slug,
                isListed: payload.isListed,
                hasLogo: Boolean(payload.logoKey),
            },
        })

        return serializeClubPublicProfile({
            slug: payload.slug,
            joinCode,
            appUrl: environment.appUrl,
            workspace,
            logoUrl: await signClubLogoUrl(this.files, workspace.logoKey),
        })
    }

    // The replaced logo is unreachable once the row moves on; removing it is
    // housekeeping, so a storage hiccup must not fail a save that already
    // happened.
    private async deleteLogo(key: string) {
        try {
            await this.files.deleteObject({
                bucket: this.files.getDefaultBucketName(),
                key,
            })
        } catch (error) {
            this.logger.warn(
                `Failed to delete the replaced club logo: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }
}
