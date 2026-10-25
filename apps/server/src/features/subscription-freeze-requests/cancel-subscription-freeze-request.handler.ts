import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    CancelSubscriptionFreezeRequestFeature,
    CancelSubscriptionFreezeRequestFeatureResponse,
} from './cancel-subscription-freeze-request.feature'
import { closeRequestData } from './freeze-request-utils'
import { serializeFreezeRequest } from './schemas'

const DECIDED_MESSAGE = 'Заявку уже рассмотрели — отменить её нельзя'

@Feature(CancelSubscriptionFreezeRequestFeature)
export class CancelSubscriptionFreezeRequestHandler
    implements
        IFeatureHandler<
            CancelSubscriptionFreezeRequestFeature,
            CancelSubscriptionFreezeRequestFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CancelSubscriptionFreezeRequestFeature) {
        const where = {
            id: f.requestId,
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        }
        // Scoped to the caller, so another member's request reads as missing.
        const row = await this.prisma.subscriptionFreezeRequest.findFirst({
            where,
            include: { decidedBy: { select: { firstname: true, lastname: true } } },
        })
        if (!row) {
            throw new NotFoundError({ message: 'Заявка на заморозку не найдена' })
        }
        if (row.status === 'CANCELLED') return serializeFreezeRequest(row)
        if (row.status !== 'PENDING') {
            throw new ConflictError({ message: DECIDED_MESSAGE })
        }

        const moved = await this.prisma.subscriptionFreezeRequest.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: closeRequestData('CANCELLED'),
        })
        const fresh = await this.prisma.subscriptionFreezeRequest.findFirstOrThrow(
            {
                where,
                include: {
                    decidedBy: { select: { firstname: true, lastname: true } },
                },
            },
        )
        if (moved.count === 0) {
            // Lost a race: it is either already cancelled or was decided.
            if (fresh.status === 'CANCELLED') return serializeFreezeRequest(fresh)
            throw new ConflictError({ message: DECIDED_MESSAGE })
        }

        this.realtime.invalidate(f.workspaceId, [
            'subscription',
            'freeze-requests',
        ])
        return serializeFreezeRequest(fresh)
    }
}
