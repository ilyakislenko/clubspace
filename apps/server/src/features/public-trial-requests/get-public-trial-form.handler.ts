import { Feature, IFeatureHandler } from '@shelfjs/features'

import { LEAD_CONSENT_VERSION } from '../../domains/leads/lead-consent'
import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { serializeClubAbout } from '../club-about/schemas'
import {
    GetPublicTrialFormFeature,
    type GetPublicTrialFormFeatureResponse,
} from './get-public-trial-form.feature'
import { findTrialClub } from './schemas'

@Feature(GetPublicTrialFormFeature)
export class GetPublicTrialFormHandler
    implements IFeatureHandler<GetPublicTrialFormFeature, GetPublicTrialFormFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(f: GetPublicTrialFormFeature): Promise<GetPublicTrialFormFeatureResponse> {
        const ws = await findTrialClub(this.prisma, f.slug)
        const directions = await this.prisma.direction.findMany({
            where: { workspaceId: ws.id, isActive: true },
            select: { id: true, name: true },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        })
        return {
            clubName: ws.name,
            logoUrl: await signClubLogoUrl(this.files, ws.logoKey),
            directions,
            operator: { name: ws.pdOperatorName, address: ws.pdOperatorAddress },
            consentVersion: LEAD_CONSENT_VERSION,
            contacts: serializeClubAbout(ws).contacts,
            isListed: ws.isListed,
        }
    }
}
