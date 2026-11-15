import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    UNMARK_ONLINE_MESSAGE,
    UNMARK_REFUNDED_MESSAGE,
} from '../../domains/payments/unmark-rules'
import {
    UnmarkEventRegistrationPaidFeature,
    UnmarkEventRegistrationPaidFeatureResponse,
} from './unmark-event-registration-paid.feature'
import { serializeRegistrant } from './schemas'

// Takes back a «paid» mark made by mistake: the ticket leaves the club's
// revenue. Club money — admins only, like unmarking an abonement's payment.
// Money handed back is a refund in «Платежи», not an unmark: a ticket with a
// refund, or one paid online, keeps its mark (domains/payments/unmark-rules).
@Feature(UnmarkEventRegistrationPaidFeature)
export class UnmarkEventRegistrationPaidHandler
    implements
        IFeatureHandler<
            UnmarkEventRegistrationPaidFeature,
            UnmarkEventRegistrationPaidFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly registrations: EventRegistrationService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UnmarkEventRegistrationPaidFeature) {
        await assertSportLead(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const registration = await this.prisma.eventRegistration.findFirst({
            where: { id: f.registrationId, workspaceId: f.workspaceId },
            include: { event: { select: { id: true, title: true } } },
        })
        if (!registration) {
            throw new NotFoundError({ message: 'Запись не найдена' })
        }
        if (registration.isPaid && registration.refundedAmount > 0) {
            throw new BadRequestError({ message: UNMARK_REFUNDED_MESSAGE })
        }
        if (registration.isPaid && registration.paymentMethod === 'ONLINE') {
            throw new BadRequestError({ message: UNMARK_ONLINE_MESSAGE })
        }
        const unmarked = await this.prisma.eventRegistration.updateMany({
            where: {
                id: registration.id,
                isPaid: true,
                refundedAmount: 0,
                paymentMethod: { not: 'ONLINE' },
            },
            data: {
                isPaid: false,
                paidAt: null,
                amountPaid: null,
                currency: null,
                paymentMethod: null,
                markedPaidById: null,
                // A ticket is priced when marked paid: the price facts go
                // with the mark (an unpaid ticket holds no discount use).
                listPrice: null,
                discountId: null,
                discountName: null,
                discountAmount: 0,
                pricedById: null,
            },
        })
        const row = await this.prisma.eventRegistration.findUniqueOrThrow({
            where: { id: registration.id },
            include: {
                user: { select: { firstname: true, lastname: true, email: true } },
            },
        })
        if (unmarked.count === 1) {
            await this.audit.record({
                action: 'event.unmarkRegistrationPaid',
                targetType: 'event',
                targetId: registration.event.id,
                workspaceId: f.workspaceId,
                actorId: f.invokerUserId,
                metadata: {
                    title: registration.event.title,
                    userId: registration.userId,
                    amount: registration.amountPaid,
                    currency: registration.currency,
                },
            })
            this.registrations.invalidate(f.workspaceId)
            // The row leaves «Платежи».
            this.realtime.invalidate(f.workspaceId, ['payments'])
        }
        return serializeRegistrant(row, null)
    }
}
