import { Feature, IFeatureHandler } from '@shelfjs/features'

import { awaitingPaymentWhere } from '../../domains/subscriptions/renewal-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { nameOrPlaceholder } from '../../shared/utils/person-name'
import { localDateInTz } from '../attendance/attendance-utils'
import { memberGuardiansSelect } from '../dependents/schemas'
import {
    PreviewBankStatementFeature,
    type PreviewBankStatementFeatureResponse,
} from './bank-statements.feature'
import {
    holdBack,
    MATCH_DAYS_AFTER,
    MATCH_DAYS_BEFORE,
    matchStatement,
    type MatchCandidate,
    type TransactionMatch,
} from './statement-match'
import { fingerprintTransactions, parseStatement } from './statement-parse'

export const BANK_STATEMENT_REFUSAL = 'Сверять выписку может только владелец или администратор клуба'

// Unpaid abonements read per preview, newest first: far above any real club's
// debts in a statement's window, and a ceiling on the matcher's work.
export const STATEMENT_MAX_CANDIDATES = 5_000

const NO_MATCH: TransactionMatch = {
    status: 'UNMATCHED',
    suggestedSubscriptionId: null,
    candidates: [],
    flags: [],
}

@Feature(PreviewBankStatementFeature)
export class PreviewBankStatementHandler
    implements IFeatureHandler<PreviewBankStatementFeature, PreviewBankStatementFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: PreviewBankStatementFeature): Promise<PreviewBankStatementFeatureResponse> {
        await assertClubAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            BANK_STATEMENT_REFUSAL,
        )
        const p = f.payload
        const picked =
            p.dateColumn !== undefined || p.amountColumn !== undefined || p.payerColumn !== undefined
                ? {
                      date: p.dateColumn ?? null,
                      amount: p.amountColumn ?? null,
                      payer: p.payerColumn ?? null,
                      purpose: p.purposeColumn ?? null,
                  }
                : null
        const parsed = await parseStatement(f.file.bytes, picked)

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const tz = workspace.timezone

        const fingerprints = fingerprintTransactions(f.workspaceId, parsed.transactions)
        const days = [...new Set(parsed.transactions.map((t) => t.date))].sort()
        // Abonements whose matching window can reach the statement's days
        // (statement-match MATCH_DAYS_*, a day of slack for time zones).
        const from = new Date(`${days[0] ?? '2000-01-01'}T00:00:00Z`)
        from.setUTCDate(from.getUTCDate() - MATCH_DAYS_AFTER - 1)
        const to = new Date(`${days[days.length - 1] ?? '2000-01-01'}T00:00:00Z`)
        to.setUTCDate(to.getUTCDate() + MATCH_DAYS_BEFORE + 1)
        const [matched, soft, subs] = await Promise.all([
            fingerprints.length === 0
                ? []
                : this.prisma.bankStatementMatch.findMany({
                      where: { workspaceId: f.workspaceId, fingerprint: { in: fingerprints } },
                      select: {
                          fingerprint: true,
                          createdAt: true,
                          subscription: {
                              select: {
                                  id: true,
                                  userId: true,
                                  plan: { select: { name: true } },
                                  user: { select: { firstname: true, lastname: true } },
                              },
                          },
                      },
                  }),
            // Confirmed transfers of the same days: the soft key (day + amount).
            days.length === 0
                ? []
                : this.prisma.bankStatementMatch.findMany({
                      where: { workspaceId: f.workspaceId, transferDay: { in: days } },
                      select: { transferDay: true, amount: true, fingerprint: true },
                  }),
            // The «Ожидают оплаты» rows (renewal-rules), with who may pay them.
            parsed.transactions.length === 0
                ? []
                : this.prisma.subscription.findMany({
                      where: {
                          AND: [
                              awaitingPaymentWhere(f.workspaceId),
                              { OR: [{ createdAt: { gte: from } }, { startDate: { gte: from } }] },
                              { OR: [{ createdAt: { lte: to } }, { startDate: { lte: to } }] },
                          ],
                      },
                      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                      take: STATEMENT_MAX_CANDIDATES,
                      select: {
                          id: true,
                          amountPaid: true,
                          currency: true,
                          startDate: true,
                          createdAt: true,
                          plan: { select: { name: true } },
                          workspaceMember: {
                              select: {
                                  userId: true,
                                  user: {
                                      select: {
                                          firstname: true,
                                          lastname: true,
                                          phone: true,
                                          dependentOf: memberGuardiansSelect,
                                      },
                                  },
                              },
                          },
                      },
                  }),
        ])
        const matchedBy = new Map(matched.map((m) => [m.fingerprint, m]))
        // Rows confirmed from this very file are already shown as «уже сверены»;
        // only a confirmation from another export flags the rest.
        const uploaded = new Set(fingerprints)
        const softKeys = new Set(
            soft.filter((m) => !uploaded.has(m.fingerprint)).map((m) => `${m.transferDay}|${m.amount}`),
        )
        const held = subs.flatMap((s) => (s.workspaceMember ? [{ ...s, member: s.workspaceMember }] : []))
        const subById = new Map(held.map((s) => [s.id, s]))
        const candidates: MatchCandidate[] = held.map((s) => ({
            subscriptionId: s.id,
            amount: s.amountPaid,
            currency: s.currency,
            startDate: s.startDate ? localDateInTz(s.startDate, tz) : null,
            soldOn: localDateInTz(s.createdAt, tz),
            member: s.member.user,
            guardians: s.member.user.dependentOf.map((g) => g.guardian),
        }))

        // Transfers already confirmed are not matched again.
        const fresh = parsed.transactions
            .map((t, i) => ({ t, fingerprint: fingerprints[i] }))
            .filter(({ fingerprint }) => !matchedBy.has(fingerprint))
        const results = new Map(
            matchStatement(fresh.map(({ t }) => t), candidates).map((r, i) => {
                const t = fresh[i].t
                // Same day and amount confirmed before: maybe this very
                // transfer from another export — the admin decides.
                const checked = softKeys.has(`${t.date}|${Math.round(t.amountMinor / 100)}`)
                    ? holdBack(r, 'MAYBE_ALREADY_MATCHED')
                    : r
                return [fresh[i].fingerprint, parsed.directionKnown ? checked : holdBack(checked)]
            }),
        )

        const transactions = parsed.transactions.map((t, i) => {
            const fingerprint = fingerprints[i]
            const base = {
                fingerprint,
                date: t.date,
                time: t.time,
                amount: t.amountMinor / 100,
                receivedAmount: Math.round(t.amountMinor / 100),
                currency: t.currency,
                payer: t.payer,
                purpose: t.purpose,
                docNumber: t.docNumber,
            }
            const done = matchedBy.get(fingerprint)
            if (done) {
                return {
                    ...base,
                    status: 'ALREADY_MATCHED' as const,
                    suggestedSubscriptionId: null,
                    flags: [],
                    candidates: [],
                    matchedTo: {
                        subscriptionId: done.subscription.id,
                        userId: done.subscription.userId,
                        memberName: done.subscription.user
                            ? nameOrPlaceholder(done.subscription.user)
                            : 'бывший участник',
                        planName: done.subscription.plan.name,
                        matchedAt: done.createdAt.toISOString(),
                    },
                }
            }
            const r = results.get(fingerprint) ?? NO_MATCH
            return {
                ...base,
                status: r.status,
                suggestedSubscriptionId: r.suggestedSubscriptionId,
                flags: r.flags,
                candidates: r.candidates.flatMap((c) => {
                    const s = subById.get(c.subscriptionId)
                    if (!s) return []
                    const guardian =
                        c.guardianIndex === null ? null : s.member.user.dependentOf[c.guardianIndex]?.guardian
                    return [
                        {
                            subscriptionId: s.id,
                            userId: s.member.userId,
                            memberName: nameOrPlaceholder(s.member.user),
                            planName: s.plan.name,
                            amount: s.amountPaid,
                            currency: s.currency,
                            startDate: s.startDate ? localDateInTz(s.startDate, tz) : null,
                            soldOn: localDateInTz(s.createdAt, tz),
                            score: c.score,
                            reasons: c.reasons,
                            paidBy: guardian ? nameOrPlaceholder(guardian) : null,
                        },
                    ]
                }),
                matchedTo: null,
            }
        })

        const count = (status: (typeof transactions)[number]['status']) =>
            transactions.filter((t) => t.status === status).length
        return {
            format: parsed.format,
            skippedDebits: parsed.skippedDebits,
            directionKnown: parsed.directionKnown,
            columns: parsed.table
                ? {
                      complete: parsed.table.complete,
                      headers: parsed.table.headers,
                      sample: parsed.table.sample,
                      date: parsed.table.columns.date,
                      amount: parsed.table.columns.amount,
                      payer: parsed.table.columns.payer,
                      purpose: parsed.table.columns.purpose,
                  }
                : null,
            transactions,
            counts: {
                matched: count('MATCHED'),
                ambiguous: count('AMBIGUOUS'),
                unmatched: count('UNMATCHED'),
                alreadyMatched: count('ALREADY_MATCHED'),
            },
        }
    }
}
