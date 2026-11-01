import { Feature, IFeatureHandler } from '@shelfjs/features'

import { toVisitAbonement } from '../../domains/subscriptions/visit-abonement'
import { PrismaService } from '../../infrastructure/prisma'
import { loadUsedAbonements } from '../attendance/session-visits'
import { loadSelfCheckInSession } from './self-check-in-session'
import {
    SelfCheckInPreviewFeature,
    SelfCheckInPreviewFeatureResponse,
} from './self-check-in-preview.feature'

// Same guards and refusals as the check-in itself (code, membership, a freeze
// that leaves nothing to pay with), no writes.
@Feature(SelfCheckInPreviewFeature)
export class SelfCheckInPreviewHandler
    implements
        IFeatureHandler<
            SelfCheckInPreviewFeature,
            SelfCheckInPreviewFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ payload, workspaceId, userId }: SelfCheckInPreviewFeature) {
        const { session, ranked } = await loadSelfCheckInSession(this.prisma, {
            workspaceId,
            userId,
            code: payload.code,
            now: new Date(),
        })
        const record = await this.prisma.attendanceRecord.findUnique({
            where: { sessionId_userId: { sessionId: session.id, userId } },
            select: { usedSubscriptionId: true },
        })
        const usedId = record?.usedSubscriptionId ?? null
        const used = usedId
            ? ((await loadUsedAbonements(this.prisma, [usedId])).get(usedId) ??
              null)
            : null
        const options = ranked
            .filter((c) => c.id !== usedId)
            .map(toVisitAbonement)
        if (used) options.unshift(used)

        return {
            sessionId: session.id,
            sessionTitle: session.title,
            startAt: session.startAt.toISOString(),
            alreadyCheckedIn: record !== null,
            abonement: record ? used : (options[0] ?? null),
            abonementOptions: options,
        }
    }
}
