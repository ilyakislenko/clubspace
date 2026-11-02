import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    UnmarkEventRegistrationPaidFeature,
    UnmarkEventRegistrationPaidFeatureResponse,
} from './unmark-event-registration-paid.feature'
import { serializeRegistrant } from './schemas'

// Takes back a «paid» mark (a mistake, or the money was returned): the ticket
// leaves the club's revenue. Club money — admins only, like unmarking an
// abonement's payment. A ticket paid online is unmarked only by refunding its
// payment (Платежи → «Вернуть»): taking the mark alone would leave the money
// with the club and out of the revenue.
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
    ) {}

    async execute(f: UnmarkEventRegistrationPaidFeature) {
        await assertWorkspaceAdmin(this.rbac, {
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
        if (registration.isPaid && registration.paymentMethod === 'ONLINE') {
            throw new BadRequestError({
                message:
                    'Билет оплачен онлайн — верните деньги в разделе «Платежи», отметка снимется сама',
            })
        }
        const unmarked = await this.prisma.eventRegistration.updateMany({
            where: {
                id: registration.id,
                isPaid: true,
                paymentMethod: { not: 'ONLINE' },
            },
            data: {
                isPaid: false,
                paidAt: null,
                amountPaid: null,
                currency: null,
                paymentMethod: null,
                markedPaidById: null,
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
        }
        return serializeRegistrant(row, null)
    }
}
