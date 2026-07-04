import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { AUTHOR_SELECT } from './create-announcement.handler'
import { serializeAnnouncement } from './schemas'
import {
    UpdateAnnouncementFeature,
    UpdateAnnouncementFeatureResponse,
} from './update-announcement.feature'

@Feature(UpdateAnnouncementFeature)
export class UpdateAnnouncementHandler
    implements
        IFeatureHandler<
            UpdateAnnouncementFeature,
            UpdateAnnouncementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdateAnnouncementFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.announcement.findFirst({
            where: { id: f.announcementId, workspaceId: f.workspaceId },
            select: { id: true, publishedAt: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Announcement not found' })
        }

        const p = f.payload
        const publishedAt =
            p.publish === undefined
                ? undefined
                : p.publish
                  ? (existing.publishedAt ?? new Date())
                  : null

        const updated = await this.prisma.announcement.update({
            where: { id: f.announcementId },
            data: {
                ...(p.title !== undefined ? { title: p.title } : {}),
                ...(p.body !== undefined ? { body: p.body } : {}),
                ...(p.pinned !== undefined ? { pinned: p.pinned } : {}),
                ...(publishedAt !== undefined ? { publishedAt } : {}),
            },
            include: { author: AUTHOR_SELECT },
        })
        return serializeAnnouncement(updated)
    }
}
