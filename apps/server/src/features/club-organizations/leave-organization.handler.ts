import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { OrgMetricsCacheService } from '../../domains/organizations/org-metrics-cache.service'
import { OrgNotifierService } from '../../domains/organizations/org-notifier.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ClubOrganizationLinkResponse,
    LeaveOrganizationFeature,
} from './club-organizations.feature'
import {
    findClubOrganizationLink,
    presentClubOrganizationLink,
} from './club-organization-links'

// «Выйти из федерации»: any club admin, any time — leaving only reduces
// sharing (design §10). The registry and numbers read links live, so the org
// loses them at once.
@Feature(LeaveOrganizationFeature)
export class LeaveOrganizationHandler
    implements IFeatureHandler<LeaveOrganizationFeature, ClubOrganizationLinkResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly cache: OrgMetricsCacheService,
        private readonly notifier: OrgNotifierService,
        private readonly realtime: RealtimeEmitter,
        private readonly files: FilesService,
    ) {}

    async execute(f: LeaveOrganizationFeature) {
        assertOrganizationsEnabled()
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const link = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        const decidedAt = new Date()
        const { count } = await this.prisma.organizationClub.updateMany({
            where: { id: link.id, workspaceId: f.workspaceId, status: 'ACTIVE' },
            data: { status: 'LEFT', decidedById: f.invokerUserId, decidedAt },
        })
        if (count === 0) {
            throw new ConflictError({ message: 'Клуб не состоит в этой федерации' })
        }

        const club = await this.prisma.workspace.findUniqueOrThrow({
            where: { id: f.workspaceId },
            select: { name: true },
        })
        await this.cache.invalidate(link.organization.id)
        await this.audit.record({
            action: 'org.leave',
            targetType: 'organizationClub',
            targetId: link.id,
            workspaceId: f.workspaceId,
            organizationId: link.organization.id,
            actorId: f.invokerUserId,
            metadata: { organizationName: link.organization.name, clubName: club.name },
        })
        await this.notifier.notifyOrgAdmins({
            organizationId: link.organization.id,
            kind: 'org.club_left',
            refId: `${link.id}:${decidedAt.getTime()}`,
            topic: `Клуб «${club.name}» вышел из федерации`,
            message: `Клуб «${club.name}» вышел из федерации «${link.organization.name}». Его цифры и реестр больше не видны.`,
            workspaceId: f.workspaceId,
        })
        this.realtime.invalidate(f.workspaceId, ['organizations'])
        const updated = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        return presentClubOrganizationLink(
            this.files,
            updated,
            f.isSuperAdmin || ctx.workspaceOwnerId === f.invokerUserId,
        )
    }
}
