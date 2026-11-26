import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../../domains/audit/services/audit.service'
import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { bookedCounts } from '../../../domains/organizations/org-events'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { claimUnchanged } from '../../../shared/utils/optimistic-concurrency'
import {
    assertEventTimes,
    assertHostClub,
    assertValidTimezone,
    resolveInstant,
} from './event-input'
import { ORG_EVENT_INCLUDE, serializeOrgEvent } from './schemas'
import {
    UpdateOrgEventFeature,
    UpdateOrgEventFeatureResponse,
} from './update-org-event.feature'

// Lowering the capacity under the bookings cancels nobody; it only stops new
// ones.
@Feature(UpdateOrgEventFeature)
export class UpdateOrgEventHandler
    implements IFeatureHandler<UpdateOrgEventFeature, UpdateOrgEventFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdateOrgEventFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const current = await this.prisma.organizationEvent.findFirst({
            where: { id: f.eventId, organizationId: f.organizationId },
            include: { tournament: { select: { id: true } } },
        })
        if (!current) throw new NotFoundError({ message: 'Событие не найдено' })
        const p = f.payload
        // A tournament lives on a COMPETITION event only.
        if (p.kind !== undefined && p.kind !== 'COMPETITION' && current.tournament) {
            throw new BadRequestError({
                message: 'На событии проводится турнир — тип «Соревнование» не изменить',
            })
        }
        const tz = p.timezone ?? current.timezone
        assertValidTimezone(tz)
        const startAt =
            resolveInstant(p.startAt, current.startAt, current.timezone, tz) ??
            current.startAt
        const endAt = resolveInstant(p.endAt, current.endAt, current.timezone, tz)
        const closesAt = resolveInstant(
            p.registrationClosesAt,
            current.registrationClosesAt,
            current.timezone,
            tz,
        )
        assertEventTimes(startAt, endAt === undefined ? current.endAt : endAt)
        await assertHostClub(this.prisma, f.organizationId, p.hostClubId)
        const publishedAt =
            p.publish === undefined
                ? undefined
                : p.publish
                  ? (current.publishedAt ?? new Date())
                  : null
        const row = await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(p.expectedUpdatedAt, (expected) =>
                tx.organizationEvent.updateMany({
                    where: { id: current.id, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            return tx.organizationEvent.update({
                where: { id: current.id },
                data: {
                    ...(p.kind !== undefined ? { kind: p.kind } : {}),
                    ...(p.title !== undefined ? { title: p.title } : {}),
                    ...(p.description !== undefined ? { description: p.description } : {}),
                    startAt,
                    ...(endAt !== undefined ? { endAt } : {}),
                    timezone: tz,
                    ...(p.place !== undefined ? { place: p.place } : {}),
                    ...(p.address !== undefined ? { address: p.address } : {}),
                    ...(p.hostClubId !== undefined ? { hostWorkspaceId: p.hostClubId } : {}),
                    ...(p.audience !== undefined ? { audience: p.audience } : {}),
                    ...(p.capacity !== undefined ? { capacity: p.capacity } : {}),
                    ...(p.registrationOpen !== undefined
                        ? { registrationOpen: p.registrationOpen }
                        : {}),
                    ...(closesAt !== undefined ? { registrationClosesAt: closesAt } : {}),
                    ...(p.feeNote !== undefined ? { feeNote: p.feeNote } : {}),
                    ...(publishedAt !== undefined ? { publishedAt } : {}),
                },
                include: ORG_EVENT_INCLUDE,
            })
        })
        await this.audit.record({
            action: 'org.eventUpdate',
            targetType: 'organizationEvent',
            targetId: row.id,
            organizationId: f.organizationId,
            actorId: f.invokerUserId,
            metadata: {
                title: row.title,
                fields: Object.keys(p).filter((k) => k !== 'expectedUpdatedAt'),
            },
        })
        const counts = await bookedCounts(this.prisma, [row.id])
        return serializeOrgEvent(row, counts.get(row.id) ?? 0)
    }
}
