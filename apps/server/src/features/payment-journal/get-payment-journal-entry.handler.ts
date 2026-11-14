import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadJournalEntry, loadJournalPeople } from '../../domains/payments/journal'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetPaymentJournalEntryFeature,
    type GetPaymentJournalEntryFeatureResponse,
} from './get-payment-journal-entry.feature'
import { serializePaymentJournalEntry } from './schemas'

// One journal row in the side panel (`?entry=sub:<id>`): the payment, its
// holder and, from phase B, its refunds.
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
        const row = await loadJournalEntry(this.prisma, f.workspaceId, f.entryId)
        if (!row) throw new NotFoundError({ message: 'Платёж не найден' })
        const people = await loadJournalPeople(this.prisma, f.workspaceId, [row])
        const entry = serializePaymentJournalEntry(row, people)
        return { ...entry, refunds: [], memberHasCard: entry.member.isMember }
    }
}
