import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TrialLimitsService } from '../../domains/billing/services/trial-limits.service'
import { loadEmailTargets, planPush } from '../../domains/messages/deliver'
import { clubMessageKind } from '../../domains/messages/kinds'
import { limitsLeft, loadDayCounts } from '../../domains/messages/limits'
import { resolveSegmentUserIds } from '../../domains/messages/segments'
import { CallListCacheService } from '../../domains/retention/call-list-cache.service'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { prepareCompose } from './compose'
import {
    PreviewClubMessageFeature,
    type PreviewClubMessageFeatureResponse,
} from './preview-club-message.feature'

@Feature(PreviewClubMessageFeature)
export class PreviewClubMessageHandler
    implements IFeatureHandler<PreviewClubMessageFeature, PreviewClubMessageFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly callLists: CallListCacheService,
        private readonly trialLimits: TrialLimitsService,
    ) {}

    async execute(f: PreviewClubMessageFeature): Promise<PreviewClubMessageFeatureResponse> {
        const now = new Date()
        const c = await prepareCompose(this.prisma, this.rbac, f, now)
        const userIds = await resolveSegmentUserIds(this.prisma, {
            workspaceId: f.workspaceId,
            ownerId: c.workspace.ownerId,
            target: c.target,
            scope: c.scope,
            now,
            callList: () => this.callLists.get(f.workspaceId),
        })
        const kind = clubMessageKind(c)
        const [plan, counts, emailAllowance] = await Promise.all([
            planPush(this.prisma, {
                workspaceId: f.workspaceId,
                timezone: c.workspace.timezone,
                userIds,
                kind,
                now,
            }),
            // The limits of the day it goes out on.
            loadDayCounts(this.prisma, {
                workspaceId: f.workspaceId,
                senderId: f.invokerUserId,
                sendAt: c.sendAt,
                now,
                timezone: c.workspace.timezone,
            }),
            c.workspace.messagesEmailEnabled
                ? this.trialLimits.trialEmailsLeft(f.workspaceId, now)
                : null,
        ])
        const emailTargets = c.workspace.messagesEmailEnabled
            ? await loadEmailTargets(this.prisma, userIds, plan, kind)
            : new Map()
        const skips = [...plan.skip.values()]
        const count = (s: string | null) => skips.filter((v) => v === s).length
        return {
            recipients: userIds.length,
            children: userIds.filter((u) => plan.routes.has(u)).length,
            withPush: count(null),
            optedOut: count('opted_out'),
            muted: count('muted'),
            noDevice: count('no_device'),
            capped: count('cap'),
            withEmail: emailTargets.size,
            emailEnabled: c.workspace.messagesEmailEnabled,
            emailAllowance,
            sendAt: c.sendAt.toISOString(),
            deferredByQuietHours: c.deferredByQuietHours,
            timezone: c.workspace.timezone,
            limits: limitsLeft(counts, c.isLead),
        }
    }
}
