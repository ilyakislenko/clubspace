import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { loadDropInEligibility } from './drop-in-eligibility'
import { dropInBlockMessage } from './drop-in-utils'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import {
    GetMyDropInsFeature,
    GetMyDropInsFeatureResponse,
} from './get-my-drop-ins.feature'
import { serializeDropInBooking } from './schemas'

@Feature(GetMyDropInsFeature)
export class GetMyDropInsHandler
    implements IFeatureHandler<GetMyDropInsFeature, GetMyDropInsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, invokerUserId }: GetMyDropInsFeature) {
        const now = new Date()
        const eligibility = await loadDropInEligibility(
            this.prisma,
            workspaceId,
            invokerUserId,
            now,
        )

        return {
            canBook: eligibility.reason === null,
            blockedReason: eligibility.reason
                ? dropInBlockMessage(
                      eligibility.reason,
                      await loadClubVocabulary(this.prisma, workspaceId),
                  )
                : null,
            bookings: eligibility.upcoming.map(({ b, occ }) =>
                serializeDropInBooking(b, occ),
            ),
        }
    }
}
