import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    loadJournalPage,
    loadJournalPeople,
    loadJournalTotals,
    loadUnappliedPayments,
} from '../../domains/payments/journal'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListPaymentJournalFeature,
    type ListPaymentJournalFeatureResponse,
    PAYMENT_JOURNAL_DEFAULT_PER_PAGE,
} from './list-payment-journal.feature'
import { resolvePaymentJournalFilter } from './payment-journal-filter'
import { serializePaymentJournalEntry, serializePaymentJournalUnapplied } from './schemas'

// «Платежи»: the club's sales (abonements and tickets) by payment date, with
// totals over the whole view. Money: owner and admins only.
@Feature(ListPaymentJournalFeature)
export class ListPaymentJournalHandler
    implements IFeatureHandler<ListPaymentJournalFeature, ListPaymentJournalFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListPaymentJournalFeature): Promise<ListPaymentJournalFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? PAYMENT_JOURNAL_DEFAULT_PER_PAGE
        const { filter } = await resolvePaymentJournalFilter(
            this.prisma,
            this.rbac,
            f,
            f.payload,
            new Date(),
        )
        const [page, totals, unapplied] = await Promise.all([
            loadJournalPage(this.prisma, filter, { curPage, perPage }),
            loadJournalTotals(this.prisma, filter),
            curPage === 1 ? loadUnappliedPayments(this.prisma, f.workspaceId) : null,
        ])
        // One membership lookup for the rows' holders and the strip's buyers.
        const people = await loadJournalPeople(
            this.prisma,
            f.workspaceId,
            page.rows,
            unapplied?.rows.map((p) => p.userId) ?? [],
        )
        return {
            data: page.rows.map((r) => serializePaymentJournalEntry(r, people)),
            total: page.total,
            curPage,
            perPage,
            totals,
            unapplied: unapplied
                ? {
                      total: unapplied.total,
                      data: unapplied.rows.map((p) => serializePaymentJournalUnapplied(p, people)),
                  }
                : null,
        }
    }
}
