import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgAdmin,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { fullNameWithoutEmail } from '../../../shared/utils/person-name'
import {
    CreateOrgAnnouncementFeature,
    CreateOrgAnnouncementFeatureResponse,
} from './create-org-announcement.feature'
import { resolvePublishedAt, serializeOrgAnnouncement } from './schemas'

// The staff push is not sent here: the minute job (RemindersService) sends it
// per club once published and outside the club's quiet hours.
@Feature(CreateOrgAnnouncementFeature)
export class CreateOrgAnnouncementHandler
    implements
        IFeatureHandler<
            CreateOrgAnnouncementFeature,
            CreateOrgAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateOrgAnnouncementFeature) {
        await assertOrgAdmin(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const author = await this.prisma.user.findUnique({
            where: { id: f.invokerUserId },
            select: { firstname: true, lastname: true, email: true },
        })
        const row = await this.prisma.organizationAnnouncement.create({
            data: {
                organizationId: f.organizationId,
                authorId: f.invokerUserId,
                authorName: author ? fullNameWithoutEmail(author) : 'Федерация',
                title: f.payload.title,
                body: f.payload.body,
                audience: f.payload.audience ?? 'STAFF',
                publishedAt:
                    resolvePublishedAt(f.payload, null, new Date()) ?? null,
            },
        })
        await this.audit.record({
            action: 'org.announcementCreate',
            targetType: 'organizationAnnouncement',
            targetId: row.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            actorEmail: author?.email ?? null,
            metadata: { title: row.title, audience: row.audience },
        })
        return serializeOrgAnnouncement(row)
    }
}
