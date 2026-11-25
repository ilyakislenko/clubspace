import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgAdmin,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    DeleteOrgAnnouncementFeature,
    DeleteOrgAnnouncementFeatureResponse,
} from './delete-org-announcement.feature'

@Feature(DeleteOrgAnnouncementFeature)
export class DeleteOrgAnnouncementHandler
    implements
        IFeatureHandler<
            DeleteOrgAnnouncementFeature,
            DeleteOrgAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: DeleteOrgAnnouncementFeature) {
        await assertOrgAdmin(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const { count } = await this.prisma.organizationAnnouncement.deleteMany({
            where: { id: f.announcementId, organizationId: f.organizationId },
        })
        if (count === 0) throw new NotFoundError({ message: 'Объявление не найдено' })
        await this.audit.record({
            action: 'org.announcementDelete',
            targetType: 'organizationAnnouncement',
            targetId: f.announcementId,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
        })
        return { status: 'deleted' as const }
    }
}
