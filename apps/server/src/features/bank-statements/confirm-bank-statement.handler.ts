import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { saleDiscount } from '../../domains/discounts/discount-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { wallClockToUtc } from '../attendance/attendance-utils'
import {
    ConfirmBankStatementFeature,
    type ConfirmBankStatementFeatureResponse,
} from './bank-statements.feature'
import { BANK_STATEMENT_REFUSAL } from './preview-bank-statement.handler'

const DAY_MS = 86_400_000
// How old a statement may be: a year of debts plus slack.
export const STATEMENT_MAX_AGE_DAYS = 400
// Times in Russian bank exports (Т-Банк, Сбер CSV/Excel) carry no zone and
// are Moscow time; a transfer without a time is dated the club's midnight.
export const BANK_TIMEZONE = 'Europe/Moscow'

type Result = ConfirmBankStatementFeatureResponse['results'][number]

// Confirms reviewed matches: each transfer marks its abonement paid by
// transfer, on the transfer's date, with the amount received — in one
// transaction with its fingerprint, so the same transfer can never mark twice
// (re-upload, double click, two admins). One failure doesn't stop the rest.
@Feature(ConfirmBankStatementFeature)
export class ConfirmBankStatementHandler
    implements IFeatureHandler<ConfirmBankStatementFeature, ConfirmBankStatementFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ConfirmBankStatementFeature): Promise<ConfirmBankStatementFeatureResponse> {
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
        const { matches } = f.payload
        if (new Set(matches.map((m) => m.subscriptionId)).size !== matches.length) {
            throw new BadRequestError({ message: 'Один абонемент выбран для двух переводов — оставьте один' })
        }
        if (new Set(matches.map((m) => m.fingerprint)).size !== matches.length) {
            throw new BadRequestError({ message: 'Один перевод выбран для двух абонементов — оставьте один' })
        }

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const tz = workspace.timezone
        const now = new Date()
        const oldest = new Date(now.getTime() - STATEMENT_MAX_AGE_DAYS * DAY_MS)

        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId: f.workspaceId, id: { in: matches.map((m) => m.subscriptionId) } },
            select: { id: true, workspaceMember: { select: { userId: true } } },
        })
        const holderOf = new Map(subs.map((s) => [s.id, s.workspaceMember?.userId ?? null]))

        const results: Result[] = []
        for (const m of matches) {
            const base = { fingerprint: m.fingerprint, subscriptionId: m.subscriptionId }
            const userId = holderOf.get(m.subscriptionId) ?? null
            if (!userId) {
                results.push({ ...base, status: 'FAILED', message: 'Абонемент не найден' })
                continue
            }
            const paidAt = m.paidTime
                ? wallClockToUtc(`${m.paidOn}T${m.paidTime}`, BANK_TIMEZONE)
                : wallClockToUtc(`${m.paidOn}T00:00`, tz)
            if (paidAt > now || paidAt < oldest) {
                results.push({
                    ...base,
                    status: 'FAILED',
                    message:
                        paidAt > now
                            ? 'Дата перевода ещё не наступила — проверьте выписку'
                            : `Перевод старше ${STATEMENT_MAX_AGE_DAYS} дней — отметьте оплату в карточке ученика`,
                })
                continue
            }
            try {
                const subscription = await this.prisma.$transaction(async (tx) => {
                    await tx.bankStatementMatch.create({
                        data: {
                            workspaceId: f.workspaceId,
                            fingerprint: m.fingerprint,
                            subscriptionId: m.subscriptionId,
                            amount: m.amount,
                            paidOn: paidAt,
                            transferDay: m.paidOn,
                            matchedById: f.invokerUserId,
                        },
                    })
                    return this.subscriptions.markPaidInTx(tx, {
                        workspaceId: f.workspaceId,
                        userId,
                        subscriptionId: m.subscriptionId,
                        amount: m.amount,
                        paymentMethod: 'TRANSFER',
                        markedById: f.invokerUserId,
                        paidAt,
                        now,
                    })
                })
                const { oneOff } = saleDiscount(subscription)
                await this.audit.record({
                    action: 'member.markSubscriptionPaid',
                    targetType: 'member',
                    targetId: userId,
                    workspaceId: f.workspaceId,
                    actorId: f.invokerUserId,
                    metadata: {
                        subscriptionId: subscription.id,
                        planName: subscription.plan.name,
                        amount: subscription.amountPaid,
                        currency: subscription.currency,
                        method: subscription.paymentMethod,
                        listPrice: subscription.listPrice,
                        discountId: subscription.discountId,
                        discountName: subscription.discountName,
                        discountAmount: subscription.discountAmount,
                        ...(oneOff > 0 ? { oneOff } : {}),
                        paidOn: m.paidOn,
                        bankStatement: true,
                    },
                })
                results.push({ ...base, status: 'CONFIRMED', message: null })
            } catch (e) {
                if ((e as { code?: string }).code === 'P2002') {
                    results.push({ ...base, status: 'ALREADY_MATCHED', message: null })
                } else if (e instanceof BadRequestError || e instanceof NotFoundError) {
                    results.push({ ...base, status: 'FAILED', message: e.message })
                } else {
                    throw e
                }
            }
        }

        const confirmed = results.filter((r) => r.status === 'CONFIRMED').length
        // New rows in «Платежи», fewer in «Ожидают оплаты».
        if (confirmed > 0) {
            this.realtime.invalidate(f.workspaceId, ['members', 'subscription', 'payments'])
        }
        return { confirmed, results }
    }
}
