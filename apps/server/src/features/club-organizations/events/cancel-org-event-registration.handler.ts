import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    bookedCounts,
    cancelOrgEventBooking,
} from '../../../domains/organizations/org-events'
import { RealtimeEmitter } from '../../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import {
    CancelOrgEventRegistrationFeature,
    CancelOrgEventRegistrationFeatureResponse,
} from './cancel-org-event-registration.feature'

// The person themself (a guardian for the child) or the coach who booked
// them through this club gives the place back, until the event starts.
@Feature(CancelOrgEventRegistrationFeature)
export class CancelOrgEventRegistrationHandler
    implements
        IFeatureHandler<
            CancelOrgEventRegistrationFeature,
            CancelOrgEventRegistrationFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CancelOrgEventRegistrationFeature) {
        const reg = await this.prisma.organizationEventRegistration.findUnique({
            where: { id: f.registrationId },
            select: {
                id: true,
                userId: true,
                workspaceId: true,
                bookedById: true,
                event: { select: { id: true, startAt: true } },
            },
        })
        const own = reg?.userId === f.invokerUserId
        const bookedHere =
            reg?.workspaceId === f.workspaceId && reg.bookedById === f.invokerUserId
        if (!reg || !(own || bookedHere)) {
            throw new NotFoundError({ message: 'Запись не найдена' })
        }
        const now = new Date()
        if (reg.event.startAt <= now) {
            throw new BadRequestError({ message: 'Событие уже началось — запись не отменить' })
        }
        const updated = await cancelOrgEventBooking(this.prisma, {
            registrationId: reg.id,
            now,
        })
        this.realtime.invalidate(reg.workspaceId, ['organizations'])
        const counts = await bookedCounts(this.prisma, [reg.event.id])
        return {
            id: updated.id,
            eventId: reg.event.id,
            status: updated.status,
            bookedCount: counts.get(reg.event.id) ?? 0,
        }
    }
}
