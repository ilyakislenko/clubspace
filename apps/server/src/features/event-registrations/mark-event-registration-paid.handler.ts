import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    MarkEventRegistrationPaidFeature,
    MarkEventRegistrationPaidFeatureResponse,
} from './mark-event-registration-paid.feature'
import { serializeRegistrant } from './schemas'

const userSelect = {
    user: { select: { firstname: true, lastname: true, email: true } },
} as const

// Staff mark a ticket paid at the club (cash / transfer) at the event's price:
// it counts towards the club's revenue from now. Like events themselves, any
// coach may (never their own ticket); a direction manager only for their
// directions' events. Undoing it is admin-only (unmark).
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

        // Guarded on isPaid: a double tap (or two staff at once) marks once.
        const marked = await this.prisma.eventRegistration.updateMany({
            where: { id: registration.id, isPaid: false },
            data: {
                isPaid: true,
                paidAt: new Date(),
                amountPaid: event.price,
                currency: event.currency,
                paymentMethod: f.payload.method,
                markedPaidById: f.invokerUserId,
            },
        })
        const row = await this.prisma.eventRegistration.findUniqueOrThrow({
            where: { id: registration.id },
            include: userSelect,
        })
        if (marked.count === 1) {
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
                },
            })
            this.registrations.invalidate(f.workspaceId)
        }
        return serializeRegistrant(row, null)
    }
}
