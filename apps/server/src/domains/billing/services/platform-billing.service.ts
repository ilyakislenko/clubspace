import { Injectable } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import {
    addDays,
    addMonths,
    type BillingStatus,
    monthStart,
    moduleConnectPrice,
    nextChargeAt,
    paidPeriodStart,
} from '../billing-rules'
import {
    type ModuleEntitlementSource,
    type ModuleMode,
    moduleEntitlement,
} from '../module-entitlement'
import { platformGatewayCredentials } from '../platform-payment-credentials'
import {
    PLATFORM_MODULE_CODES,
    type PlatformModuleCode,
    type PlatformModulePricing,
    type PlatformPricing,
    type PlatformTier,
    tierFor,
} from '../platform-pricing.config'
import {
    quoteWorkspaceBilling,
    type WorkspaceQuote,
} from '../quote-workspace-billing'

// A member counts as active for the tier when, within this many days, they
// attended in the club or opened it in the app.
export const ACTIVE_MEMBER_WINDOW_DAYS = 30

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

export type WorkspaceBillingRow = {
    workspaceId: string
    status: BillingStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    pastDueSince: Date | null
    billingPeriodMonths: number
    customMonthlyPrice: number | null
    discountPercent: number
    freeUntil: Date | null
    setupFeeWaived: boolean
    setupFeePaidAt: Date | null
    paidTierCode: string | null
    notes: string | null
    // Autopay (PlatformPaymentsService); optional so fixtures that predate
    // it stay valid — a row read from the database always has them.
    autopayEnabled?: boolean
    paymentMethodId?: string | null
    paymentMethodTitle?: string | null
    paymentMethodCardLast4?: string | null
    paymentMethodSavedAt?: Date | null
    autopayFailedAttempts?: number
    autopayNextAttemptAt?: Date | null
    autopayLastError?: string | null
}

export type ModuleRow = {
    module: PlatformModuleCode
    mode: ModuleMode
    compUntil: Date | null
    customPrice: number | null
    cancelAt: Date | null
}

export type BillingModuleState = {
    pricing: PlatformModulePricing
    mode: ModuleMode | null
    compUntil: Date | null
    customPrice: number | null
    cancelAt: Date | null
    entitled: boolean
    source: ModuleEntitlementSource
    // What connecting it now would charge (the rest of the paid period);
    // null = connected for free / on the next bill, or nothing to connect.
    connectPrice: number | null
}

// What one club's bill is computed from.
type BillingFacts = {
    row: WorkspaceBillingRow
    activeMembers: number
    modules: ModuleRow[]
    storageBytes: number
    viewedSecondsThisMonth: number
}

// Everything the club's billing page and the platform console show about one
// club, computed in one place so both read the same numbers.
export type WorkspaceBillingState = {
    row: WorkspaceBillingRow
    activeMembers: number
    tier: PlatformTier
    nextTier: PlatformTier | null
    paidTier: PlatformTier | null
    modules: BillingModuleState[]
    storageBytes: number
    viewedSecondsThisMonth: number
    nextChargeAt: Date | null
    quote: WorkspaceQuote
    // What paying by card now would charge, monthly and annually, for the
    // period starting at checkoutPeriodStart (paidPeriodStart).
    checkoutPeriodStart: Date
    checkoutQuotes: { monthly: WorkspaceQuote; annual: WorkspaceQuote }
    // The platform's shop is configured: card payments and autopay work.
    autopayAvailable: boolean
}

// Platform billing of clubs: the subscription row, active-member counting,
// module entitlements, video usage metering and the quote for the next
// charge. Collecting the money is PlatformPaymentsService (card payments and
// autopay), or the console's «отметить оплату».
@Injectable()
export class PlatformBillingService {
    constructor(private readonly prisma: PrismaService) {}

    get enabled(): boolean {
        return environment.billing.enabled
    }

    get pricing(): PlatformPricing {
        return environment.billing.pricing
    }

    // The club's billing row. A club that predates billing (or came from the
    // platform console) starts its trial on first read — there is no free
    // plan to park it on.
    async getBilling(workspaceId: string): Promise<WorkspaceBillingRow> {
        const existing = await this.prisma.workspaceBilling.findUnique({
            where: { workspaceId },
        })
        if (existing) return existing
        try {
            return await this.prisma.workspaceBilling.create({
                data: {
                    workspaceId,
                    status: 'TRIAL',
                    trialEndsAt: addDays(new Date(), environment.billing.trialDays),
                },
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            return this.prisma.workspaceBilling.findUniqueOrThrow({
                where: { workspaceId },
            })
        }
    }

    async getBillingMany(ids: string[]): Promise<Map<string, WorkspaceBillingRow>> {
        const rows = await this.prisma.workspaceBilling.findMany({
            where: { workspaceId: { in: ids } },
        })
        const byId = new Map<string, WorkspaceBillingRow>(
            rows.map((r) => [r.workspaceId, r]),
        )
        for (const id of ids) {
            if (!byId.has(id)) byId.set(id, await this.getBilling(id))
        }
        return byId
    }

    // A self-serve club starts on the trial. Runs inside the creating
    // transaction; trialOwnerId is unique, so a second trial for the same
    // account fails there with P2002 and nothing is left behind.
    async startTrial(
        tx: PrismaTransactionClientType,
        p: { workspaceId: string; ownerId: string; now?: Date },
    ) {
        return tx.workspaceBilling.create({
            data: {
                workspaceId: p.workspaceId,
                status: 'TRIAL',
                trialEndsAt: addDays(
                    p.now ?? new Date(),
                    environment.billing.trialDays,
                ),
                trialOwnerId: p.ownerId,
            },
        })
    }

    async hasUsedTrial(userId: string): Promise<boolean> {
        const row = await this.prisma.workspaceBilling.findUnique({
            where: { trialOwnerId: userId },
            select: { id: true },
        })
        return row !== null
    }

    // Active members per club in one grouped query: students (role `user`,
    // dependents included — they are students too; staff never count) who
    // attended or opened the club in the app within the window. Pending
    // applicants (INVITED) are not members yet; the owner never counts.
    // Served by the [workspaceId, status, lastAttendedAt|lastSeenAt] indexes.
    async countActiveMembersMany(
        workspaces: { id: string; ownerId: string }[],
        now: Date = new Date(),
    ): Promise<Map<string, number>> {
        const result = new Map<string, number>(workspaces.map((w) => [w.id, 0]))
        if (workspaces.length === 0) return result
        const since = addDays(now, -ACTIVE_MEMBER_WINDOW_DAYS)
        const rows = await this.prisma.workspaceMember.groupBy({
            by: ['workspaceId'],
            where: {
                workspaceId: { in: workspaces.map((w) => w.id) },
                status: { not: 'INVITED' },
                role: { name: 'user' },
                OR: [
                    { lastAttendedAt: { gte: since } },
                    { lastSeenAt: { gte: since } },
                ],
                NOT: {
                    OR: workspaces.map((w) => ({
                        workspaceId: w.id,
                        userId: w.ownerId,
                    })),
                },
            },
            _count: { _all: true },
        })
        for (const row of rows) result.set(row.workspaceId, row._count._all)
        return result
    }

    // Seconds watched in the club during the calendar month containing `at`.
    async viewedSeconds(workspaceId: string, at: Date): Promise<number> {
        const row = await this.prisma.videoViewingMonth.findUnique({
            where: {
                workspaceId_month: { workspaceId, month: monthStart(at) },
            },
            select: { seconds: true },
        })
        return row?.seconds ?? 0
    }

    // Adds metered viewing to the month of `at`. One atomic upsert: two
    // players saving progress at once must both count.
    async recordViewing(
        workspaceId: string,
        seconds: number,
        at: Date = new Date(),
    ): Promise<void> {
        if (seconds <= 0) return
        await this.prisma.$executeRaw`
            INSERT INTO "VideoViewingMonth" ("workspaceId", "month", "seconds")
            VALUES (${workspaceId}::uuid, ${monthStart(at)}::date, ${seconds})
            ON CONFLICT ("workspaceId", "month")
            DO UPDATE SET "seconds" = "VideoViewingMonth"."seconds" + EXCLUDED."seconds"
        `
    }

    private async storageBytes(workspaceId: string): Promise<number> {
        const agg = await this.prisma.video.aggregate({
            where: { workspaceId },
            _sum: { sizeBytes: true },
        })
        return Number(agg._sum.sizeBytes ?? 0)
    }

    // The facts behind one club's bill, loaded together.
    private async loadFacts(workspaceId: string, now: Date): Promise<BillingFacts> {
        const workspace = await this.prisma.workspace.findUniqueOrThrow({
            where: { id: workspaceId },
            select: { id: true, ownerId: true },
        })
        const [row, active, modules, storageBytes, viewedSecondsThisMonth] =
            await Promise.all([
                this.getBilling(workspaceId),
                this.countActiveMembersMany([workspace], now),
                this.prisma.workspaceModuleEntitlement.findMany({
                    where: { workspaceId },
                    select: {
                        module: true,
                        mode: true,
                        compUntil: true,
                        customPrice: true,
                        cancelAt: true,
                    },
                }),
                this.storageBytes(workspaceId),
                this.viewedSeconds(workspaceId, now),
            ])
        return {
            row,
            activeMembers: active.get(workspaceId) ?? 0,
            modules: modules as ModuleRow[],
            storageBytes,
            viewedSecondsThisMonth,
        }
    }

    // The quote for the period starting at `periodStart`. Viewing overage is
    // billed for the calendar month before the one the period starts in (the
    // month just finished when a charge runs on the 1st; month-to-date when
    // the charge is still ahead in a later month).
    private async quoteFor(
        facts: BillingFacts,
        workspaceId: string,
        periodStart: Date,
        now: Date,
        periodMonths: number = facts.row.billingPeriodMonths,
    ): Promise<WorkspaceQuote> {
        const billedMonth = addMonths(monthStart(periodStart), -1)
        const viewedSeconds =
            billedMonth.getTime() === monthStart(now).getTime()
                ? facts.viewedSecondsThisMonth
                : await this.viewedSeconds(workspaceId, billedMonth)
        return quoteWorkspaceBilling({
            pricing: this.pricing,
            activeMembers: facts.activeMembers,
            periodStart,
            periodMonths,
            subscription: {
                customMonthlyPrice: facts.row.customMonthlyPrice,
                discountPercent: facts.row.discountPercent,
                freeUntil: facts.row.freeUntil,
            },
            setupFee: {
                waived: facts.row.setupFeeWaived,
                paid: facts.row.setupFeePaidAt !== null,
            },
            modules: facts.modules.map((m) => ({
                code: m.module,
                mode: m.mode,
                compUntil: m.compUntil,
                customPrice: m.customPrice,
                cancelAt: m.cancelAt,
            })),
            usage: { storageBytes: facts.storageBytes, viewedSeconds },
        })
    }

    // What the club owes for the period starting at `periodStart` (default:
    // when its next charge falls due, or now), for `periodMonths` (default:
    // the club's billing period). PlatformPaymentsService charges exactly
    // its total.
    async quoteWorkspaceBilling(
        workspaceId: string,
        opts: { periodStart?: Date; periodMonths?: number; now?: Date } = {},
    ): Promise<WorkspaceQuote> {
        const now = opts.now ?? new Date()
        const facts = await this.loadFacts(workspaceId, now)
        const periodStart =
            opts.periodStart ?? nextChargeAt(facts.row, now) ?? now
        return this.quoteFor(
            facts,
            workspaceId,
            periodStart,
            now,
            opts.periodMonths,
        )
    }

    async getState(
        workspaceId: string,
        now: Date = new Date(),
    ): Promise<WorkspaceBillingState> {
        const facts = await this.loadFacts(workspaceId, now)
        const chargeAt = nextChargeAt(facts.row, now)
        const checkoutPeriodStart = paidPeriodStart(facts.row, now)
        const [quote, monthly, annual] = await Promise.all([
            this.quoteFor(facts, workspaceId, chargeAt ?? now, now),
            this.quoteFor(facts, workspaceId, checkoutPeriodStart, now, 1),
            this.quoteFor(facts, workspaceId, checkoutPeriodStart, now, 12),
        ])
        const { tiers } = this.pricing
        const { tier } = tierFor(tiers, facts.activeMembers)
        const index = tiers.indexOf(tier)
        const billing = { status: facts.row.status }
        return {
            row: facts.row,
            activeMembers: facts.activeMembers,
            tier,
            nextTier: tiers[index + 1] ?? null,
            paidTier:
                tiers.find((t) => t.code === facts.row.paidTierCode) ?? null,
            modules: PLATFORM_MODULE_CODES.map((code) => {
                const pricing = this.pricing.modules.find((m) => m.code === code)!
                const row = facts.modules.find((m) => m.module === code) ?? null
                const entitlement = moduleEntitlement(row, billing, now, this.enabled)
                // Not bought (or bought and gone): the club can connect it.
                const connectable =
                    entitlement.source === 'TRIAL' || entitlement.source === 'NONE'
                return {
                    pricing,
                    mode: row?.mode ?? null,
                    compUntil: row?.compUntil ?? null,
                    customPrice: row?.customPrice ?? null,
                    cancelAt: row?.cancelAt ?? null,
                    ...entitlement,
                    connectPrice: connectable
                        ? moduleConnectPrice(
                              facts.row,
                              row?.mode === 'PAID' && row.customPrice !== null
                                  ? row.customPrice
                                  : pricing.priceMonthly,
                              this.pricing.annualDiscountPercent,
                              now,
                          )
                        : null,
                }
            }),
            storageBytes: facts.storageBytes,
            viewedSecondsThisMonth: facts.viewedSecondsThisMonth,
            nextChargeAt: chargeAt,
            quote,
            checkoutPeriodStart,
            checkoutQuotes: { monthly, annual },
            autopayAvailable: platformGatewayCredentials() !== null,
        }
    }
}
