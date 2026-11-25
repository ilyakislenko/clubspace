import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgAdmin,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { claimUnchanged } from '../../../shared/utils/optimistic-concurrency'
import { resolvePublishedAt, serializeOrgAnnouncement } from './schemas'
import {
    UpdateOrgAnnouncementFeature,
    UpdateOrgAnnouncementFeatureResponse,
} from './update-org-announcement.feature'

@Feature(UpdateOrgAnnouncementFeature)
export class UpdateOrgAnnouncementHandler
    implements
        IFeatureHandler<
            UpdateOrgAnnouncementFeature,
            UpdateOrgAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdateOrgAnnouncementFeature) {
        await assertOrgAdmin(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const current = await this.prisma.organizationAnnouncement.findFirst({
            where: { id: f.announcementId, organizationId: f.organizationId },
            select: { id: true, publishedAt: true },
        })
        if (!current) throw new NotFoundError({ message: 'Объявление не найдено' })
        const p = f.payload
        const publishedAt = resolvePublishedAt(p, current.publishedAt, new Date())
        const row = await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(p.expectedUpdatedAt, (expected) =>
                tx.organizationAnnouncement.updateMany({
                    where: { id: current.id, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            return tx.organizationAnnouncement.update({
                where: { id: current.id },
                data: {
                    ...(p.title !== undefined ? { title: p.title } : {}),
                    ...(p.body !== undefined ? { body: p.body } : {}),
                    ...(p.audience !== undefined ? { audience: p.audience } : {}),
                    ...(publishedAt !== undefined ? { publishedAt } : {}),
                },
            })
        })
        await this.audit.record({
            action: 'org.announcementUpdate',
            targetType: 'organizationAnnouncement',
            targetId: row.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { title: row.title, fields: Object.keys(p).filter((k) => k !== 'expectedUpdatedAt') },
        })
        return serializeOrgAnnouncement(row)
    }
}
