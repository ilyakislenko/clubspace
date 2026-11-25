import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { isOwnOrgLogoKey } from '../../domains/organizations/org-logo'
import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { claimUnchanged } from '../../shared/utils/optimistic-concurrency'
import {
    UpdateOrganizationFeature,
    UpdateOrganizationFeatureResponse,
} from './update-organization.feature'
import { ORGANIZATION_SELECT, serializeOrganization } from './schemas'

@Feature(UpdateOrganizationFeature)
export class UpdateOrganizationHandler
    implements IFeatureHandler<UpdateOrganizationFeature, UpdateOrganizationFeatureResponse>
{
    private readonly logger = new Logger(UpdateOrganizationHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
        private readonly files: FilesService,
    ) {}

    async execute({ payload, organizationId, invokerUserId, isSuperAdmin }: UpdateOrganizationFeature) {
        const scope = await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Профиль федерации меняет администратор федерации',
        )
        const current = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { logoKey: true },
        })
        if (!current) throw new NotFoundError({ message: 'Федерация не найдена' })
        if (
            payload.logoKey !== null &&
            payload.logoKey !== current.logoKey &&
            !isOwnOrgLogoKey(organizationId, payload.logoKey)
        ) {
            throw new BadRequestError({ message: 'Логотип не найден — загрузите его ещё раз' })
        }

        const org = await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(payload.expectedUpdatedAt, (expected) =>
                tx.organization.updateMany({
                    where: { id: organizationId, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            return tx.organization.update({
                where: { id: organizationId },
                data: {
                    name: payload.name,
                    city: payload.city || null,
                    description: payload.description || null,
                    logoKey: payload.logoKey,
                    timezone: payload.timezone,
                },
                select: ORGANIZATION_SELECT,
            })
        })

        if (current.logoKey && current.logoKey !== org.logoKey) {
            try {
                await this.files.deleteObject({
                    bucket: this.files.getDefaultBucketName(),
                    key: current.logoKey,
                })
            } catch (error) {
                this.logger.warn(
                    `Failed to delete the replaced org logo: ${error instanceof Error ? error.message : String(error)}`,
                )
            }
        }

        await this.audit.record({
            action: 'org.update',
            targetType: 'organization',
            targetId: organizationId,
            organizationId,
            workspaceId: null,
            actorId: invokerUserId,
            metadata: {
                fields: ['name', 'city', 'description', 'timezone'],
                hasLogo: Boolean(org.logoKey),
            },
        })

        return serializeOrganization(org, {
            myRole: scope.role,
            logoUrl: await signClubLogoUrl(this.files, org.logoKey),
        })
    }
}
