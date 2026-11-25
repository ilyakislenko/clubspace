import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    grantOrgConsent,
    withdrawOrgConsent,
} from '../../../domains/organizations/consent'
import { RealtimeEmitter } from '../../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { ACTIVE_LINK_SELECT, loadMyClubOrganization } from './schemas'
import {
    SetMyOrganizationConsentFeature,
    SetMyOrganizationConsentFeatureResponse,
} from './set-my-organization-consent.feature'

// The person's ORGANIZATION_SHARING consent for one org of this club (the
// WorkspaceMemberGuard proved membership). Acting as a child the guardian
// consents for it: the record is the guardian's with `dependentId`. The
// evidence is the ConsentRecord itself; no audit row.
@Feature(SetMyOrganizationConsentFeature)
export class SetMyOrganizationConsentHandler
    implements
        IFeatureHandler<
            SetMyOrganizationConsentFeature,
            SetMyOrganizationConsentFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: SetMyOrganizationConsentFeature) {
        const link = await this.prisma.organizationClub.findFirst({
            where: {
                workspaceId: f.workspaceId,
                organizationId: f.organizationId,
                status: 'ACTIVE',
                organization: { isActive: true },
            },
            select: ACTIVE_LINK_SELECT,
        })
        if (!link) throw new NotFoundError({ message: 'Федерация не найдена' })
        if (f.payload.granted) {
            await grantOrgConsent(this.prisma, {
                organizationId: f.organizationId,
                personId: f.userId,
                guardianId: f.guardianId,
                ip: f.ip,
                userAgent: f.userAgent,
            })
        } else {
            await withdrawOrgConsent(this.prisma, {
                organizationId: f.organizationId,
                personId: f.userId,
                now: new Date(),
            })
        }
        this.realtime.invalidateUsers(
            [f.guardianId ?? f.userId],
            ['organizations'],
        )
        return loadMyClubOrganization(this.prisma, link, {
            workspaceId: f.workspaceId,
            userId: f.userId,
            forChild: f.guardianId !== null,
        })
    }
}
