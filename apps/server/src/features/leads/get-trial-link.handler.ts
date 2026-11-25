import { Feature, IFeatureHandler } from '@shelfjs/features'

import { buildJoinQrPngDataUrl } from '../../domains/workspace/join-qr'
import { ensurePublicSlug } from '../../domains/workspace/public-slug.store'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetTrialLinkFeature, type GetTrialLinkFeatureResponse } from './get-trial-link.feature'
import { LEAD_SPORT_LEAD_ONLY, leadCaller } from './leads-utils'

// The poster's link: the form page with ?src=qr, so requests from it count
// under «QR-плакат».
export const trialFormUrl = (appUrl: string | null, slug: string, qr: boolean): string | null =>
    appUrl ? `${appUrl.replace(/\/+$/, '')}/c/${slug}/trial${qr ? '?src=qr' : ''}` : null

@Feature(GetTrialLinkFeature)
export class GetTrialLinkHandler
    implements IFeatureHandler<GetTrialLinkFeature, GetTrialLinkFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetTrialLinkFeature): Promise<GetTrialLinkFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const ws = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: {
                id: true,
                name: true,
                trialRequestsEnabled: true,
                pdOperatorName: true,
                pdOperatorAddress: true,
            },
        })
        if (!ws) throw new NotFoundError({ message: 'Клуб не найден' })
        const slug = await ensurePublicSlug(this.prisma, ws)
        const url = trialFormUrl(environment.appUrl, slug, true)
        const missing =
            !ws.pdOperatorName || !ws.pdOperatorAddress
                ? ('operator' as const)
                : !ws.trialRequestsEnabled
                  ? ('disabled' as const)
                  : !url
                    ? ('slug' as const)
                    : null
        return {
            url,
            qrPngDataUrl: missing || !url ? null : await buildJoinQrPngDataUrl(url),
            missing,
        }
    }
}
