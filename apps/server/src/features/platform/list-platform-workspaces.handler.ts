import { Feature, IFeatureHandler } from '@shelfjs/features'

import { activePromos } from '../../domains/billing/billing-promos'
import {
    modulePricing,
    tierFor,
} from '../../domains/billing/platform-pricing.config'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { parseMetaArgs } from '../../shared/utils/parse-meta-args.util'
import {
    serializeBillingPromo,
    serializeBillingSummary,
    serializePlatformTier,
} from '../workspace-billing/schemas'
import {
    ListPlatformWorkspacesFeature,
    ListPlatformWorkspacesFeatureResponse,
} from './list-platform-workspaces.feature'
import { serializePlatformWorkspace } from './schemas'

// The console's club list with search, filters (billing status, tier, a
// promo running) and sorting (newest, name, active members, tier). Tier and
// active members are computed, not stored, so the matching clubs are ranked
// in memory — one grouped count for all of them — and only the page is
// loaded in full. Fine for the hundreds of clubs a platform console holds.
@Feature(ListPlatformWorkspacesFeature)
export class ListPlatformWorkspacesHandler
    implements
        IFeatureHandler<
            ListPlatformWorkspacesFeature,
            ListPlatformWorkspacesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: ListPlatformWorkspacesFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { curPage, perPage, skip, take } = parseMetaArgs({
            curPage: f.payload.curPage,
            perPage: f.payload.perPage,
            defaults: { curPage: 1, perPage: 20 },
        })
        const now = new Date()
        const { pricing, graceDays } = environment.billing

        const matching = await this.prisma.workspace.findMany({
            where: await this.buildWhere(f.payload.search),
            select: { id: true, ownerId: true, name: true, createdAt: true },
        })
        const ids = matching.map((w) => w.id)
        const [billingById, activeById, comps] = await Promise.all([
            this.billing.getBillingMany(ids),
            this.billing.countActiveMembersMany(matching, now),
            ids.length
                ? this.prisma.workspaceModuleEntitlement.findMany({
                      where: {
                          workspaceId: { in: ids },
                          mode: 'COMP',
                          compUntil: { gt: now },
                      },
                      select: {
                          workspaceId: true,
                          module: true,
                          mode: true,
                          compUntil: true,
                      },
                  })
                : [],
        ])

        const rows = matching.map((w) => {
            const billing = billingById.get(w.id)!
            const activeMembers = activeById.get(w.id) ?? 0
            const { tier } = tierFor(pricing.tiers, activeMembers)
            return {
                ...w,
                billing,
                activeMembers,
                tier,
                tierIndex: pricing.tiers.indexOf(tier),
                promos: activePromos(
                    billing,
                    comps.filter((c) => c.workspaceId === w.id),
                    (code) => modulePricing(pricing, code).name,
                    now,
                ),
            }
        })

        const { status, tier, promo } = f.payload
        const filtered = rows.filter(
            (r) =>
                (!status || r.billing.status === status) &&
                (!tier || r.tier.code === tier) &&
                (promo === undefined || (r.promos.length > 0) === promo),
        )

        const sort = f.payload.sort ?? 'createdAt'
        const dir =
            (f.payload.order ?? (sort === 'name' ? 'asc' : 'desc')) === 'asc'
                ? 1
                : -1
        const newestFirst = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
            b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
        filtered.sort((a, b) => {
            const primary =
                sort === 'name'
                    ? a.name.localeCompare(b.name, 'ru')
                    : sort === 'activeMembers'
                      ? a.activeMembers - b.activeMembers
                      : sort === 'tier'
                        ? a.tierIndex - b.tierIndex ||
                          a.activeMembers - b.activeMembers
                        : a.createdAt.getTime() - b.createdAt.getTime()
            return primary * dir || newestFirst(a, b)
        })
        const page = filtered.slice(skip, skip + take)

        const [workspaces, owners] = await Promise.all([
            page.length
                ? this.prisma.workspace.findMany({
                      where: { id: { in: page.map((r) => r.id) } },
                      select: {
                          id: true,
                          key: true,
                          name: true,
                          type: true,
                          isActive: true,
                          timezone: true,
                          ownerId: true,
                          createdAt: true,
                          _count: { select: { members: true } },
                      },
                  })
                : [],
            // ownerId is a plain column, not a relation, so the owners come
            // back in one extra query instead of an include, tolerating an
            // ownerId with no surviving user row.
            page.length
                ? this.prisma.user.findMany({
                      where: { id: { in: [...new Set(page.map((r) => r.ownerId))] } },
                      select: {
                          id: true,
                          email: true,
                          firstname: true,
                          lastname: true,
                      },
                  })
                : [],
        ])
        const workspaceById = new Map(workspaces.map((w) => [w.id, w]))
        const ownerById = new Map(owners.map((owner) => [owner.id, owner]))

        return {
            data: page.flatMap((r) => {
                const workspace = workspaceById.get(r.id)
                if (!workspace) return []
                return [
                    {
                        ...serializePlatformWorkspace(
                            workspace,
                            ownerById.get(workspace.ownerId) ?? null,
                        ),
                        billing: serializeBillingSummary(
                            r.billing,
                            r.activeMembers,
                            r.tier,
                            graceDays,
                        ),
                        billingNotes: r.billing.notes,
                        promos: r.promos.map(serializeBillingPromo),
                    },
                ]
            }),
            meta: { curPage, perPage, total: filtered.length },
            tiers: pricing.tiers.map(serializePlatformTier),
        }
    }

    // Search spans name, key and owner email. Email lives on User, and there
    // is no relation to join through, so matching owners are resolved to ids
    // first and folded into the same OR.
    private async buildWhere(search?: string) {
        const term = search?.trim()
        if (!term) return {}

        const matchingOwners = await this.prisma.user.findMany({
            where: { email: { contains: term, mode: 'insensitive' as const } },
            select: { id: true },
        })

        return {
            OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { key: { contains: term, mode: 'insensitive' as const } },
                ...(matchingOwners.length
                    ? [{ ownerId: { in: matchingOwners.map((o) => o.id) } }]
                    : []),
            ],
        }
    }
}
