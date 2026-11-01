import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { isDemoModeOn } from '../../shared/utils/demo-mode.util'
import { AnalyticsSnapshotService } from '../analytics/analytics-snapshot.service'
import { AuditService } from '../audit/services/audit.service'
import { SubscriptionFreezeService } from '../subscriptions/services/subscription-freeze.service'
import { DEMO_CLUB_KEY } from './demo-accounts'
import { buildDemoClubPlan, type DemoClubPlan } from './demo-club.plan'
import { deleteDemoOnlyUsers, wipeDemoWorkspace } from './demo-club.wipe'
import { writeDemoClubPlan } from './demo-club.writer'

export const DEMO_TIMEZONE = 'Asia/Tomsk'

export type DemoResetResult = {
    workspaceId: string
    durationMs: number
    counts: {
        members: number
        groups: number
        sessions: number
        visits: number
        subscriptions: number
    }
}

const countsOf = (plan: DemoClubPlan): DemoResetResult['counts'] => ({
    members: plan.members.length,
    groups: plan.groups.length,
    sessions: plan.sessions.length,
    visits: plan.records.length,
    subscriptions: plan.subscriptions.length,
})

// The in-person demo club (docs/demo.md): wipes ONLY the club that holds the
// demo key and was generated as a demo, with its generated people, and builds
// it again with every date relative to today. One transaction: a failure
// leaves the previous demo as it was. Used by the platform console, the
// `npm run demo:reset` CLI and SEED_DEMO_WORKSPACE at boot.
@Injectable()
export class DemoClubService {
    private readonly logger = new Logger(DemoClubService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly freezes: SubscriptionFreezeService,
        private readonly audit: AuditService,
        private readonly analytics: AnalyticsSnapshotService,
    ) {}

    async reset(p: { actorId: string | null; now?: Date }): Promise<DemoResetResult> {
        if (!isDemoModeOn()) {
            throw new ForbiddenError({
                message:
                    'Демо-режим выключен: задайте DEMO_MODE=true, DEMO_WORKSPACE_KEY и DEMO_LOGIN_CODE',
            })
        }
        const result = await this.regenerate(p.now ?? new Date())
        await this.audit.record({
            action: 'workspace.demoReset',
            targetType: 'workspace',
            targetId: result.workspaceId,
            workspaceId: null,
            actorId: p.actorId,
            metadata: { ...result.counts, durationMs: result.durationMs },
        })
        return result
    }

    // SEED_DEMO_WORKSPACE: create the demo club when it is missing. Never
    // touches an existing one and never a real club holding the key.
    async ensureSeeded(now: Date = new Date()): Promise<'created' | 'present' | 'blocked'> {
        const holder = await this.prisma.workspace.findUnique({
            where: { key: DEMO_CLUB_KEY },
            select: { isDemo: true },
        })
        if (holder?.isDemo) return 'present'
        if (holder) {
            this.logger.warn(`Key "${DEMO_CLUB_KEY}" belongs to a real club — demo not seeded`)
            return 'blocked'
        }
        const result = await this.regenerate(now)
        this.logger.log(`Demo club generated in ${result.durationMs} ms`)
        return 'created'
    }

    private async regenerate(now: Date): Promise<DemoResetResult> {
        const started = Date.now()
        const plan = buildDemoClubPlan({
            now,
            timezone: DEMO_TIMEZONE,
            personalDataConsentVersion: environment.consent.personalDataVersion,
            legal: {
                offerVersion: environment.billing.legal.offerVersion,
                dpaVersion: environment.billing.legal.dpaVersion,
            },
            pseudonymSecret: environment.encryptionKey,
        })
        await this.prisma.$transaction(
            async (tx) => {
                const holder = await tx.workspace.findUnique({
                    where: { key: DEMO_CLUB_KEY },
                    select: { id: true, isDemo: true },
                })
                if (holder && !holder.isDemo) {
                    throw new BadRequestError({
                        message: `Ключ «${DEMO_CLUB_KEY}» занят настоящим клубом — демо его не тронет`,
                    })
                }
                if (holder) await wipeDemoWorkspace(tx, holder.id)
                await deleteDemoOnlyUsers(tx)
                await writeDemoClubPlan(tx, plan, { freezes: this.freezes, now })
            },
            { maxWait: 15_000, timeout: 120_000 },
        )
        // «Аналитика» reads snapshots: rebuild them so the screens and the
        // digest show the fresh club at once, not after the next hourly pass.
        await this.analytics.refresh(plan.workspaceId, now)
        return {
            workspaceId: plan.workspaceId,
            durationMs: Date.now() - started,
            counts: countsOf(plan),
        }
    }
}
