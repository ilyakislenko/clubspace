import {
    fullRefundCancelsRegistration,
    loadJournalEntry,
    loadJournalPeople,
    loadSaleRefunds,
} from '../../domains/payments/journal'
import type { PrismaService } from '../../infrastructure/prisma'
import type { GetPaymentJournalEntryFeatureResponse } from './get-payment-journal-entry.feature'
import { serializePaymentJournalEntry } from './schemas'

// One journal row as the side panel shows it (`?entry=<id>`): the row, a
// sale's refunds (newest first) and what a full refund would do. null when the
// id names nothing in this club's journal. Shared by the entry read and the
// refund's answer (CreateRefundOutput.sale).
export const loadPaymentJournalDetail = async (
    prisma: PrismaService,
    workspaceId: string,
    entryId: string,
    now: Date,
): Promise<GetPaymentJournalEntryFeatureResponse | null> => {
    const row = await loadJournalEntry(prisma, workspaceId, entryId)
    if (!row) return null
    const [refunds, cancels] = await Promise.all([
        loadSaleRefunds(prisma, workspaceId, row),
        fullRefundCancelsRegistration(prisma, row, now),
    ])
    const people = await loadJournalPeople(prisma, workspaceId, [row, ...refunds])
    const entry = serializePaymentJournalEntry(row, people)
    return {
        ...entry,
        refunds: refunds.map((r) => serializePaymentJournalEntry(r, people)),
        memberHasCard: entry.member.isMember,
        fullRefundCancelsRegistration: cancels,
    }
}
