import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadOrgClubLinks } from '../../domains/organizations/club-links'
import {
    loadOrgClubMetrics,
    type OrgClubMetrics,
    summarizeOrgMetrics,
} from '../../domains/organizations/club-metrics'
import { assertOrgStaff, OrgRbacService } from '../../domains/organizations/org-access'
import { OrgMetricsCacheService } from '../../domains/organizations/org-metrics-cache.service'
import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ListOrganizationClubsFeature,
    ListOrganizationClubsFeatureResponse,
} from './list-organization-clubs.feature'
import { serializeOrgClubRow } from './schemas'

// Numbers come only from the glossary readers (domains/organizations/
// club-metrics.ts), cached per org for 10 minutes; links are read live, so a
// club that left is gone at once even before the cache expires.
@Feature(ListOrganizationClubsFeature)
export class ListOrganizationClubsHandler
    implements IFeatureHandler<ListOrganizationClubsFeature, ListOrganizationClubsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly cache: OrgMetricsCacheService,
        private readonly files: FilesService,
    ) {}

    async execute(f: ListOrganizationClubsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const [links, snapshot] = await Promise.all([
            loadOrgClubLinks(this.prisma, f.organizationId),
            this.cache.getOrCompute(f.organizationId, () =>
                loadOrgClubMetrics(this.prisma, f.organizationId, new Date()),
            ),
        ])
        const metricsByClub = new Map(snapshot.clubs.map((m) => [m.workspaceId, m]))
        // Status and money are gated on the live link, not on what the cache
        // holds: a snapshot written by a slow compute after the club turned a
        // figure off (or a failed invalidation) must not show it again.
        const gated = (link: (typeof links)[number]): OrgClubMetrics | null => {
            const m = link.status === 'ACTIVE' ? metricsByClub.get(link.club.workspaceId) : undefined
            if (!m) return null
            return {
                ...m,
                mrr: link.shareMrr ? m.mrr : null,
                revenue30d: link.shareRevenue30d ? m.revenue30d : null,
            }
        }
        const rows = links.map((link) => ({ link, metrics: gated(link) }))
        return {
            data: await Promise.all(
                rows.map(async ({ link, metrics }) =>
                    serializeOrgClubRow(link, {
                        logoUrl: await signClubLogoUrl(this.files, link.club.logoKey),
                        metrics,
                    }),
                ),
            ),
            totals: summarizeOrgMetrics(rows.flatMap((r) => (r.metrics ? [r.metrics] : []))),
            computedAt: snapshot.computedAt,
        }
    }
}
