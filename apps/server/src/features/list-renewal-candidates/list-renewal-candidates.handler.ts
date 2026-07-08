import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListRenewalCandidatesFeature,
    ListRenewalCandidatesFeatureResponse,
} from './list-renewal-candidates.feature'

// How far ahead an ending access window counts as "renew soon".
const EXPIRING_WINDOW_DAYS = 7

type Reason = 'out_of_classes' | 'low_classes' | 'access_expiring'

// out_of_classes first (most urgent — can't train), then low_classes, then
// expiring; ties broken by the soonest access expiry.
const REASON_RANK: Record<Reason, number> = {
    out_of_classes: 0,
    low_classes: 1,
    access_expiring: 2,
}

@Feature(ListRenewalCandidatesFeature)
export class ListRenewalCandidatesHandler
    implements
        IFeatureHandler<
            ListRenewalCandidatesFeature,
            ListRenewalCandidatesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListRenewalCandidatesFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Only workspace admins can view renewal candidates',
        )

        const now = new Date()
        const soon = new Date(
            now.getTime() + EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        )

        const members = await this.prisma.workspaceMember.findMany({
            where: { workspaceId: f.workspaceId, status: 'ACTIVE' },
            select: {
                userId: true,
                accessUntil: true,
                user: {
                    select: {
                        firstname: true,
                        lastname: true,
                        email: true,
                    },
                },
                subscription: {
                    select: { classesRemaining: true, classesTotal: true },
                },
            },
        })

        const candidates = members
            .map((m) => {
                const remaining = m.subscription?.classesRemaining ?? null
                const isClassPack = remaining != null
                const lowClasses = isClassPack && remaining <= 1
                const expiring =
                    m.accessUntil != null && m.accessUntil <= soon

                if (!lowClasses && !expiring) return null

                let reason: Reason
                if (isClassPack && remaining === 0) reason = 'out_of_classes'
                else if (lowClasses) reason = 'low_classes'
                else reason = 'access_expiring'

                return {
                    userId: m.userId,
                    firstname: m.user.firstname,
                    lastname: m.user.lastname,
                    email: m.user.email,
                    reason,
                    classesRemaining: remaining,
                    classesTotal: m.subscription?.classesTotal ?? null,
                    accessUntil: m.accessUntil
                        ? m.accessUntil.toISOString()
                        : null,
                }
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)

        candidates.sort((a, b) => {
            const byReason = REASON_RANK[a.reason] - REASON_RANK[b.reason]
            if (byReason !== 0) return byReason
            // Soonest access expiry first; nulls (no window) last.
            const ax = a.accessUntil ?? '9999'
            const bx = b.accessUntil ?? '9999'
            return ax.localeCompare(bx)
        })

        return { data: candidates }
    }
}
