import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    journalRefundSelect,
    loadJournalPeople,
    refundJournalRow,
} from '../../domains/payments/journal'
import { RefundService } from '../../domains/payments/services/refund.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { loadPaymentJournalDetail } from '../payment-journal/payment-journal-detail'
import { serializePaymentJournalEntry } from '../payment-journal/schemas'
import { CreateRefundFeature, type CreateRefundFeatureResponse } from './create-refund.feature'

// «Вернуть деньги» from a journal entry (or the «не зачислено» strip): money,
// owner and admins only. The rules live in RefundService.
@Feature(CreateRefundFeature)
export class CreateRefundHandler
    implements IFeatureHandler<CreateRefundFeature, CreateRefundFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly refunds: RefundService,
    ) {}

    async execute(f: CreateRefundFeature): Promise<CreateRefundFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const now = new Date()
        const result = await this.refunds.refund({
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            target: f.payload.target,
            targetId: f.payload.targetId,
            amount: f.payload.amount,
            method: f.payload.method,
            reason: f.payload.reason,
            now,
        })
        const sale = result.saleEntryId
            ? await loadPaymentJournalDetail(this.prisma, f.workspaceId, result.saleEntryId, now)
            : null
        const refund =
            sale?.refunds.find((r) => r.id === `ref:${result.refundId}`) ??
            (await this.unappliedRefundEntry(f.workspaceId, result.refundId))
        return { refund, sale }
    }

    // An unapplied payment's refund is not a journal row (not a sale's): it
    // is answered in the same shape, built from the Refund itself; its source
    // is what the payment was for.
    private async unappliedRefundEntry(workspaceId: string, refundId: string) {
        const r = await this.prisma.refund.findUniqueOrThrow({
            where: { id: refundId },
            select: journalRefundSelect,
        })
        const payment = r.payment
            ? await this.prisma.payment.findUnique({
                  where: { id: r.payment.id },
                  select: { eventRegistrationId: true },
              })
            : null
        const row = {
            ...refundJournalRow(r),
            source: payment?.eventRegistrationId ? ('ticket' as const) : ('abonement' as const),
        }
        const people = await loadJournalPeople(this.prisma, workspaceId, [row])
        return serializePaymentJournalEntry(row, people)
    }
}
