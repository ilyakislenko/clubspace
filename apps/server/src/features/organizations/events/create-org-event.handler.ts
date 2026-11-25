import { Feature, IFeatureHandler } from '@shelfjs/features'

import { wallClockToUtc } from '../../../features/attendance/attendance-utils'
import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import {
    CreateOrgEventFeature,
    CreateOrgEventFeatureResponse,
} from './create-org-event.feature'
import { assertEventTimes, assertHostClub, assertValidTimezone } from './event-input'
import { ORG_EVENT_INCLUDE, serializeOrgEvent } from './schemas'

@Feature(CreateOrgEventFeature)
export class CreateOrgEventHandler
    implements IFeatureHandler<CreateOrgEventFeature, CreateOrgEventFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: CreateOrgEventFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const org = await this.prisma.organization.findUnique({
            where: { id: f.organizationId },
            select: { timezone: true },
        })
        if (!org) throw new NotFoundError({ message: 'Федерация не найдена' })
        const p = f.payload
        const tz = p.timezone ?? org.timezone
        assertValidTimezone(tz)
        const startAt = wallClockToUtc(p.startAt, tz)
        const endAt = p.endAt ? wallClockToUtc(p.endAt, tz) : null
        assertEventTimes(startAt, endAt)
        await assertHostClub(this.prisma, f.organizationId, p.hostClubId)
        const row = await this.prisma.organizationEvent.create({
            data: {
                organizationId: f.organizationId,
                kind: p.kind ?? 'OTHER',
                title: p.title,
                description: p.description ?? null,
                startAt,
                endAt,
                timezone: tz,
                place: p.place ?? null,
                address: p.address ?? null,
                hostWorkspaceId: p.hostClubId ?? null,
                audience: p.audience ?? 'STAFF_AND_MEMBERS',
                capacity: p.capacity ?? null,
                registrationOpen: p.registrationOpen ?? true,
                registrationClosesAt: p.registrationClosesAt
                    ? wallClockToUtc(p.registrationClosesAt, tz)
                    : null,
                feeNote: p.feeNote ?? null,
                publishedAt: p.publish === false ? null : new Date(),
                createdById: f.invokerUserId,
            },
            include: ORG_EVENT_INCLUDE,
        })
        await this.audit.record({
            action: 'org.eventCreate',
            targetType: 'organizationEvent',
            targetId: row.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: { title: row.title, kind: row.kind, startAt: row.startAt.toISOString() },
        })
        return serializeOrgEvent(row, 0)
    }
}
