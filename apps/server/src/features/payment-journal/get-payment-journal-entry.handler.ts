import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetPaymentJournalEntryFeature,
    type GetPaymentJournalEntryFeatureResponse,
} from './get-payment-journal-entry.feature'
import { loadPaymentJournalDetail } from './payment-journal-detail'

// One journal row in the side panel (`?entry=sub:<id>`): the payment (or
// refund), its holder and a payment's refunds.
@Feature(GetPaymentJournalEntryFeature)
export class GetPaymentJournalEntryHandler
    implements
        IFeatureHandler<GetPaymentJournalEntryFeature, GetPaymentJournalEntryFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: GetPaymentJournalEntryFeature,
    ): Promise<GetPaymentJournalEntryFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const detail = await loadPaymentJournalDetail(
            this.prisma,
            f.workspaceId,
            f.entryId,
            new Date(),
        )
        if (!detail) throw new NotFoundError({ message: 'Платёж не найден' })
        return detail
    }
}
