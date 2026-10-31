import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnModuleInit,
} from '@nestjs/common'

import { environment } from '../../../environments/environment'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import { STAFF_ROLES } from '../../../shared/decorators/roles.decorator'
import {
    type PlanLimit,
    PlanLimitReachedError,
    UnexpectedError,
} from '../../../shared/errors/shared.errors'
import {
    addDays,
    limitFor,
    remainingCapacity,
    type WorkspaceUsage,
} from '../platform-plans.config'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

const BILLING_INCLUDE = { plan: true } as const

const ZERO_USAGE: WorkspaceUsage = {
    members: 0,
    coaches: 0,
    storageBytes: 0,
    videos: 0,
}

// Platform billing of clubs: which plan a club is on, what it uses, and the
// limit checks every "add one more" write goes through. Payment collection is
// out of scope — the platform console records a paid period by hand.
//
// With PLATFORM_BILLING_ENABLED=false (a self-hosted install) every limit check
// passes without touching the database and nothing ever expires.
@Injectable()
export class PlatformBillingService
    implements OnModuleInit, OnApplicationBootstrap
{
    private readonly logger = new Logger(PlatformBillingService.name)

    constructor(private readonly prisma: PrismaService) {}

    get enabled(): boolean {
        return environment.billing.enabled
    }

    // Fail the boot on a plan code that names nothing: every club would
    // otherwise 500 on its first limit check.
    onModuleInit(): void {
        const codes = new Set(environment.billing.plans.map((p) => p.code))
        for (const [name, code] of [
            ['PLATFORM_DEFAULT_PLAN', environment.billing.defaultPlanCode],
            ['PLATFORM_TRIAL_PLAN', environment.billing.trialPlanCode],
        ] as const) {
            if (!codes.has(code)) {
                throw new Error(
                    `${name}="${code}" is not one of the configured platform plans (${[...codes].join(', ')})`,
                )
            }
        }
    }

    // Seeds/refreshes the plan rows on every boot. Never stops the boot: the
    // lookups below re-sync lazily when a row is missing.
    async onApplicationBootstrap(): Promise<void> {
        try {
            await this.syncPlans()
        } catch (error) {
            this.logger.error(
                `Platform plan sync failed: ${error instanceof Error ? error.message : String(error)}`,
            )
        }
    }

    // The configured plans are the source of truth: upsert them by code.
    // Idempotent; runs at boot and lazily when a plan row is missing.
    async syncPlans(): Promise<void> {
        for (const plan of environment.billing.plans) {
            const data = {
                name: plan.name,
                priceMonthly: plan.priceMonthly,
                currency: plan.currency,
                maxMembers: plan.maxMembers,
                maxCoaches: plan.maxCoaches,
                maxStorageGb: plan.maxStorageGb,
                maxVideos: plan.maxVideos,
                features: plan.features,
                sortOrder: plan.sortOrder,
            }
            try {
                await this.prisma.platformPlan.upsert({
                    where: { code: plan.code },
                    create: { code: plan.code, ...data },
                    update: data,
                })
            } catch (e) {
                // Two instances booting at once race on the insert; the row
                // exists either way.
                if (!isP2002(e)) throw e
            }
        }
    }

    async listPlans() {
        const plans = await this.prisma.platformPlan.findMany({
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        })
        if (plans.length > 0) return plans
        await this.syncPlans()
        return this.prisma.platformPlan.findMany({
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        })
    }

    async planIdByCode(code: string): Promise<string> {
        const found = await this.prisma.platformPlan.findUnique({
            where: { code },
            select: { id: true },
        })
        if (found) return found.id
        await this.syncPlans()
        const synced = await this.prisma.platformPlan.findUnique({
            where: { code },
            select: { id: true },
        })
        if (!synced) {
            throw new UnexpectedError({
                message: `Тариф платформы «${code}» не настроен`,
            })
        }
        return synced.id
    }

    // The club's billing row with its plan. A club that predates billing (or
    // came from the platform console) gets the default plan, ACTIVE with no
    // period end — nothing changes for it until an operator says so.
    async getBilling(workspaceId: string) {
        const existing = await this.prisma.workspaceBilling.findUnique({
            where: { workspaceId },
            include: BILLING_INCLUDE,
        })
        if (existing) return existing

        const planId = await this.planIdByCode(
            environment.billing.defaultPlanCode,
        )
        try {
            return await this.prisma.workspaceBilling.create({
                data: { workspaceId, planId, status: 'ACTIVE' },
                include: BILLING_INCLUDE,
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            return this.prisma.workspaceBilling.findUniqueOrThrow({
                where: { workspaceId },
                include: BILLING_INCLUDE,
            })
        }
    }

    // A self-serve club starts on the trial plan. Runs inside the creating
    // transaction; trialOwnerId is unique, so a second trial for the same
    // account fails there with P2002 and nothing is left behind.
    async startTrial(
        tx: PrismaTransactionClientType,
        p: { workspaceId: string; ownerId: string; now?: Date },
    ) {
        const planId = await this.planIdByCode(environment.billing.trialPlanCode)
        return tx.workspaceBilling.create({
            data: {
                workspaceId: p.workspaceId,
                planId,
                status: 'TRIAL',
                trialEndsAt: addDays(
                    p.now ?? new Date(),
                    environment.billing.trialDays,
                ),
                trialOwnerId: p.ownerId,
            },
            include: BILLING_INCLUDE,
        })
    }

    async hasUsedTrial(userId: string): Promise<boolean> {
        const row = await this.prisma.workspaceBilling.findUnique({
            where: { trialOwnerId: userId },
            select: { id: true },
        })
        return row !== null
    }

    // What the club uses right now. Members and coaches are ACTIVE rows other
    // than the owner's (the owner is always there and never counts); videos
    // exclude failed uploads; storage is the sum of measured source sizes.
    async getUsage(workspaceId: string): Promise<WorkspaceUsage> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, ownerId: true },
        })
        if (!workspace) return { ...ZERO_USAGE }
        const usage = await this.getUsageMany([workspace])
        return usage.get(workspace.id) ?? { ...ZERO_USAGE }
    }

    // getUsage for a page of clubs in a fixed number of queries (the platform
    // console list). Counts are grouped per club, then the owner's own row is
    // taken back out of whichever bucket it landed in.
    async getUsageMany(
        workspaces: { id: string; ownerId: string }[],
    ): Promise<Map<string, WorkspaceUsage>> {
        const result = new Map<string, WorkspaceUsage>(
            workspaces.map((w) => [w.id, { ...ZERO_USAGE }]),
        )
        if (workspaces.length === 0) return result
        const ids = workspaces.map((w) => w.id)

        const [members, coaches, ownerRows, storage, videos] =
            await Promise.all([
                this.prisma.workspaceMember.groupBy({
                    by: ['workspaceId'],
                    where: {
                        workspaceId: { in: ids },
                        status: 'ACTIVE',
                        role: { name: 'user' },
                    },
                    _count: { _all: true },
                }),
                this.prisma.workspaceMember.groupBy({
                    by: ['workspaceId'],
                    where: {
                        workspaceId: { in: ids },
                        status: 'ACTIVE',
                        role: { name: { in: STAFF_ROLES } },
                    },
                    _count: { _all: true },
                }),
                this.prisma.workspaceMember.findMany({
                    where: {
                        status: 'ACTIVE',
                        OR: workspaces.map((w) => ({
                            workspaceId: w.id,
                            userId: w.ownerId,
                        })),
                    },
                    select: {
                        workspaceId: true,
                        role: { select: { name: true } },
                    },
                }),
                this.prisma.video.groupBy({
                    by: ['workspaceId'],
                    where: { workspaceId: { in: ids } },
                    _sum: { sizeBytes: true },
                }),
                this.prisma.video.groupBy({
                    by: ['workspaceId'],
                    where: { workspaceId: { in: ids }, status: { not: 'failed' } },
                    _count: { _all: true },
                }),
            ])

        for (const row of members) {
            const u = result.get(row.workspaceId)
            if (u) u.members = row._count._all
        }
        for (const row of coaches) {
            const u = result.get(row.workspaceId)
            if (u) u.coaches = row._count._all
        }
        for (const row of ownerRows) {
            const u = result.get(row.workspaceId)
            if (!u) continue
            if (row.role.name === 'user') u.members = Math.max(0, u.members - 1)
            else if ((STAFF_ROLES as string[]).includes(row.role.name)) {
                u.coaches = Math.max(0, u.coaches - 1)
            }
        }
        for (const row of storage) {
            const u = result.get(row.workspaceId)
            if (u) u.storageBytes = Number(row._sum.sizeBytes ?? 0)
        }
        for (const row of videos) {
            const u = result.get(row.workspaceId)
            if (u) u.videos = row._count._all
        }
        return result
    }

    // Billing rows for a page of clubs; the ones that predate billing get the
    // default (see getBilling).
    async getBillingMany(ids: string[]) {
        const rows = await this.prisma.workspaceBilling.findMany({
            where: { workspaceId: { in: ids } },
            include: BILLING_INCLUDE,
        })
        const byId = new Map(rows.map((r) => [r.workspaceId, r]))
        for (const id of ids) {
            if (!byId.has(id)) byId.set(id, await this.getBilling(id))
        }
        return byId
    }

    // Throws PLAN_LIMIT_REACHED when adding `adding` more of `limit` would take
    // the club past its plan. Unlimited dimensions skip the usage queries.
    async assertWithinLimit(
        workspaceId: string,
        limit: PlanLimit,
        adding = 1,
    ): Promise<void> {
        if (!this.enabled || adding <= 0) return
        const { plan } = await this.getBilling(workspaceId)
        if (limitFor(plan, ZERO_USAGE, limit).max === null) return

        const usage = await this.getUsage(workspaceId)
        const { max, used } = limitFor(plan, usage, limit)
        if (max !== null && used + adding > max) {
            this.logger.log(
                `plan limit ${limit} reached in workspace ${workspaceId} (${used}/${max}, plan ${plan.code})`,
            )
            throw new PlanLimitReachedError({
                limit,
                max,
                used,
                planName: plan.name,
            })
        }
    }

    // How many more fit; null = unlimited (or billing disabled). For callers
    // that degrade instead of refusing (a bulk import, an auto-approve join).
    async remaining(
        workspaceId: string,
        limit: PlanLimit,
    ): Promise<{ remaining: number | null; planName: string; max: number | null; used: number }> {
        if (!this.enabled) {
            return { remaining: null, planName: '', max: null, used: 0 }
        }
        const { plan } = await this.getBilling(workspaceId)
        if (limitFor(plan, ZERO_USAGE, limit).max === null) {
            return { remaining: null, planName: plan.name, max: null, used: 0 }
        }
        const usage = await this.getUsage(workspaceId)
        const { max, used } = limitFor(plan, usage, limit)
        return {
            remaining: remainingCapacity(plan, usage, limit),
            planName: plan.name,
            max,
            used,
        }
    }
}
