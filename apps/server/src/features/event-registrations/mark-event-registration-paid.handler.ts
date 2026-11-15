import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadPricedByNames } from '../../domains/discounts/priced-by'
import { priceSale, saleDiscount } from '../../domains/discounts/discount-rules'
import { priceStaffSale } from '../../domains/discounts/discounts'
import {
    MarkEventRegistrationPaidFeature,
    MarkEventRegistrationPaidFeatureResponse,
} from './mark-event-registration-paid.feature'
import { serializeRegistrant } from './schemas'

const userSelect = {
    user: { select: { firstname: true, lastname: true, email: true } },
} as const

// Staff mark a ticket paid at the club (cash / transfer) at the event's price,
// a club discount's price or a typed amount (recorded as a one-off discount
// with who set it — the abonement rule): it counts towards the club's revenue
// from now. Like events themselves, any coach may (never their own ticket); a
// direction manager only for their directions' events. Undoing it is
// admin-only (unmark).
@Feature(MarkEventRegistrationPaidFeature)
export class MarkEventRegistrationPaidHandler
    implements
        IFeatureHandler<
            MarkEventRegistrationPaidFeature,
            MarkEventRegistrationPaidFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly registrations: EventRegistrationService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: MarkEventRegistrationPaidFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const registration = await this.prisma.eventRegistration.findFirst({
            where: { id: f.registrationId, workspaceId: f.workspaceId },
            include: {
                event: {
                    select: {
                        id: true,
                        title: true,
                        price: true,
                        currency: true,
                        directionId: true,
                        workspace: { select: { timezone: true } },
                    },
                },
            },
        })
        if (!registration) {
            throw new NotFoundError({ message: 'Запись не найдена' })
        }
        if (
            !this.rbac.canWriteAllGroups(ctx) &&
            registration.userId === f.invokerUserId
        ) {
            throw new ForbiddenError({
                message: 'Нельзя отмечать оплату собственной записи',
            })
        }
        const managed = await this.rbac.managedDirectionIds(ctx)
        if (managed?.length) {
            await this.rbac.assertCanManageDirection(
                ctx,
                registration.event.directionId,
            )
        }
        const { event } = registration
        if (event.price === null) {
            throw new BadRequestError({
                message: 'Событие бесплатное — отмечать оплату не нужно',
            })
        }
        // Money is taken for a place: someone on the waitlist (or who
        // cancelled) has none — it would count as revenue for nothing.
        if (registration.status !== 'BOOKED') {
            throw new BadRequestError({
                message: 'Оплату отмечают только у тех, у кого есть место',
            })
        }

        // Under the event lock the payment webhook takes, and guarded on
        // isPaid: a double tap (or two staff at once) marks once, and a ticket
        // already paid online stays ONLINE; on BOOKED: a cancel landing in
        // between is not marked paid. An online payment still pending does
        // not block this: if it succeeds later, the webhook finds the ticket
        // paid and leaves that payment for staff to refund. A discount is
        // priced (and its uses counted) under its own lock in the same
        // transaction.
        const now = new Date()
        const price = event.price
        const { marked, priced, amount } = await this.registrations.withEventLock(
            event.id,
            async (tx) => {
                const priced = f.payload.discountId
                    ? await priceStaffSale(tx, {
                          workspaceId: f.workspaceId,
                          discountId: f.payload.discountId,
                          userId: registration.userId,
                          item: {
                              planId: null,
                              eventId: event.id,
                              listPrice: price,
                              currency: event.currency,
                          },
                          now,
                          timezone: event.workspace.timezone,
                      })
                    : priceSale({ listPrice: price, currency: event.currency, discount: null })
                const amount = f.payload.amount ?? priced.amount
                const marked = await tx.eventRegistration.updateMany({
                    where: { id: registration.id, isPaid: false, status: 'BOOKED' },
                    data: {
                        isPaid: true,
                        paidAt: now,
                        amountPaid: amount,
                        currency: event.currency,
                        paymentMethod: f.payload.method,
                        markedPaidById: f.invokerUserId,
                        listPrice: price,
                        discountId: priced.discountId,
                        discountName: priced.discountName,
                        discountAmount: priced.discountAmount,
                        pricedById: f.invokerUserId,
                    },
                })
                return { marked, priced, amount }
            },
        )
        const row = await this.prisma.eventRegistration.findUniqueOrThrow({
            where: { id: registration.id },
            include: userSelect,
        })
        const pricedBy = await loadPricedByNames(this.prisma, [row])
        if (marked.count === 1) {
            const { oneOff } = saleDiscount({
                listPrice: price,
                amountPaid: amount,
                discountAmount: priced.discountAmount,
            })
            await this.audit.record({
                action: 'event.markRegistrationPaid',
                targetType: 'event',
                targetId: event.id,
                workspaceId: f.workspaceId,
                actorId: f.invokerUserId,
                metadata: {
                    title: event.title,
                    userId: row.userId,
                    amount: row.amountPaid,
                    currency: row.currency,
                    method: row.paymentMethod,
                    listPrice: price,
                    discountId: priced.discountId,
                    discountName: priced.discountName,
                    discountAmount: priced.discountAmount,
                    ...(oneOff > 0 ? { oneOff } : {}),
                },
            })
            this.registrations.invalidate(f.workspaceId)
            // A new row in «Платежи».
            this.realtime.invalidate(f.workspaceId, ['payments'])
        }
        return serializeRegistrant(row, null, pricedBy)
    }
}
