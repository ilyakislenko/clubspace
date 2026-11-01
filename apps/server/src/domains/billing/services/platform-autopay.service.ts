import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import { PrismaService } from '../../../infrastructure/prisma'
import { AUTOPAY_LEAD_MS } from '../billing-rules'
import {
    PlatformPaymentsService,
    type RenewalOutcome,
} from './platform-payments.service'

// The hourly renewal pass: every club whose period ends within
// AUTOPAY_LEAD_MS, or is overdue, and whose retry is due, goes through
// PlatformPaymentsService.renew — a saved card is charged, a bill of 0 extends
// for free. Clubs that can neither be charged (no card) nor be free are left
// to the daily lifecycle pass (past due → suspended). Runs with global
// concurrency 1 (one replica at a time); renew itself is idempotent per
// period and attempt, so an overlapping or repeated run charges nothing twice.
@Injectable()
export class PlatformAutopayService {
    private readonly logger = new Logger(PlatformAutopayService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async runRenewals(
        now: Date = new Date(),
    ): Promise<Partial<Record<RenewalOutcome, number>>> {
        if (!environment.billing.enabled) return {}
        const candidates = await this.prisma.workspaceBilling.findMany({
            where: {
                autopayEnabled: true,
                AND: [
                    {
                        OR: [
                            {
                                status: 'ACTIVE',
                                currentPeriodEnd: {
                                    lte: new Date(now.getTime() + AUTOPAY_LEAD_MS),
                                },
                            },
                            { status: 'PAST_DUE' },
                        ],
                    },
                    {
                        OR: [
                            { autopayNextAttemptAt: null },
                            { autopayNextAttemptAt: { lte: now } },
                        ],
                    },
                    // Something renew can act on: a card, or a bill that may
                    // well be 0.
                    {
                        OR: [
                            { paymentMethodId: { not: null } },
                            { customMonthlyPrice: 0 },
                            {
                                discountPercent: { gte: 100 },
                                OR: [
                                    { discountUntil: null },
                                    { discountUntil: { gt: now } },
                                ],
                            },
                            { freeUntil: { gt: now } },
                        ],
                    },
                ],
            },
            select: { workspaceId: true },
        })

        const counts: Partial<Record<RenewalOutcome, number>> = {}
        for (const { workspaceId } of candidates) {
            try {
                const { outcome } = await this.payments.renew(workspaceId, {
                    initiator: 'AUTOPAY',
                    now,
                })
                counts[outcome] = (counts[outcome] ?? 0) + 1
            } catch (err) {
                this.logger.error(
                    `Renewal of workspace ${workspaceId} failed`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
        }
        return counts
    }
}
