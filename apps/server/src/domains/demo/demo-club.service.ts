import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { isDemoModeOn } from '../../shared/utils/demo-mode.util'
import { AnalyticsSnapshotService } from '../analytics/analytics-snapshot.service'
import { AuditService } from '../audit/services/audit.service'
import { SubscriptionFreezeService } from '../subscriptions/services/subscription-freeze.service'
import { DEMO_CLUB_IDS, DEMO_CLUBS, type DemoClubId } from './demo-clubs'
import { buildDemoClubPlan, type DemoClubPlan, type DemoPlanInput } from './demo-club.plan'
import { deleteDemoOnlyUsers, wipeDemoWorkspace } from './demo-club.wipe'
import { writeDemoClubPlan } from './demo-club.writer'
import { buildRitmDemoPlan } from './ritm-demo.plan'

const BUILDERS: Readonly<Record<DemoClubId, (input: DemoPlanInput) => DemoClubPlan>> = {
    academy: buildDemoClubPlan,
    ritm: buildRitmDemoPlan,
}

export type DemoSeedStatus = 'created' | 'present' | 'blocked'

export type DemoResetResult = {
    club: DemoClubId
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

// The in-person demo clubs (docs/demo.md, demo-clubs.ts): wipes ONLY the club
// that holds that demo club's key and was generated as a demo, with its
// generated people, and builds it again with every date relative to today. The
// other demo club is never touched. One transaction: a failure leaves the
// previous demo as it was. Used by the platform console, the `npm run
// demo:reset` CLI and SEED_DEMO_WORKSPACE at boot.
@Injectable()
export class DemoClubService {
    private readonly logger = new Logger(DemoClubService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly freezes: SubscriptionFreezeService,
        private readonly audit: AuditService,
        private readonly analytics: AnalyticsSnapshotService,
    ) {}

    async reset(p: { club: DemoClubId; actorId: string | null; now?: Date }): Promise<DemoResetResult> {
        if (!isDemoModeOn()) {
            throw new ForbiddenError({
                message:
                    'Демо-режим выключен: задайте DEMO_MODE=true, DEMO_WORKSPACE_KEY и DEMO_LOGIN_CODE',
            })
        }
        const result = await this.regenerate(p.club, p.now ?? new Date())
        await this.audit.record({
            action: 'workspace.demoReset',
            targetType: 'workspace',
            targetId: result.workspaceId,
            workspaceId: null,
            actorId: p.actorId,
            metadata: { club: result.club, ...result.counts, durationMs: result.durationMs },
        })
        return result
    }

    // SEED_DEMO_WORKSPACE: create every demo club that is missing. Never
    // touches an existing one and never a real club holding a demo key.
    async ensureSeeded(now: Date = new Date()): Promise<Record<DemoClubId, DemoSeedStatus>> {
        const statuses = {} as Record<DemoClubId, DemoSeedStatus>
        for (const club of DEMO_CLUB_IDS) {
            statuses[club] = await this.ensureClubSeeded(club, now)
        }
        return statuses
    }

    private async ensureClubSeeded(club: DemoClubId, now: Date): Promise<DemoSeedStatus> {
        const { key, name } = DEMO_CLUBS[club]
        const holder = await this.prisma.workspace.findUnique({
            where: { key },
            select: { isDemo: true },
        })
        if (holder?.isDemo) return 'present'
        if (holder) {
            this.logger.warn(`Key "${key}" belongs to a real club — demo not seeded`)
            return 'blocked'
        }
        const result = await this.regenerate(club, now)
        this.logger.log(`Demo club ${name} generated in ${result.durationMs} ms`)
        return 'created'
    }

    private async regenerate(club: DemoClubId, now: Date): Promise<DemoResetResult> {
        const started = Date.now()
        const { key, timezone } = DEMO_CLUBS[club]
        const plan = BUILDERS[club]({
            now,
            timezone,
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
                    where: { key },
                    select: { id: true, isDemo: true },
                })
                if (holder && !holder.isDemo) {
                    throw new BadRequestError({
                        message: `Ключ «${key}» занят настоящим клубом — демо его не тронет`,
                    })
                }
                if (holder) await wipeDemoWorkspace(tx, holder.id)
                await deleteDemoOnlyUsers(tx, DEMO_CLUBS[club])
                await writeDemoClubPlan(tx, plan, { freezes: this.freezes, now })
            },
            { maxWait: 15_000, timeout: 120_000 },
        )
        // «Аналитика» reads snapshots: rebuild them so the screens and the
        // digest show the fresh club at once, not after the next hourly pass.
        await this.analytics.refresh(plan.workspaceId, now)
        return {
            club,
            workspaceId: plan.workspaceId,
            durationMs: Date.now() - started,
            counts: countsOf(plan),
        }
    }
}
