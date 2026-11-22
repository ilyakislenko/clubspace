import { Feature, IFeatureHandler } from '@shelfjs/features'

import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    CancelMyAutopayFeature,
    CancelMyAutopayFeatureResponse,
} from './cancel-my-autopay.feature'
import { AUTOPAY_NOT_FOUND, loadAutopayViews } from './member-autopay-view'
import { serializeMyAutopay } from './schemas'

// The member's own refusal (376-ФЗ): the service wipes the token in the same
// write, records it and sends the written confirmation (push + e-mail).
@Feature(CancelMyAutopayFeature)
export class CancelMyAutopayHandler
    implements IFeatureHandler<CancelMyAutopayFeature, CancelMyAutopayFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async execute(f: CancelMyAutopayFeature): Promise<CancelMyAutopayFeatureResponse> {
        // Scoped to the caller: another member's agreement reads as missing.
        const row = await this.prisma.memberAutopay.findFirst({
            where: { id: f.autopayId, workspaceId: f.workspaceId, userId: f.invokerUserId },
            select: { id: true, status: true },
        })
        if (!row) throw new NotFoundError({ message: AUTOPAY_NOT_FOUND })
        if (row.status !== 'CANCELLED') {
            await this.autopay.cancel({ id: row.id, source: 'MEMBER', actorId: f.invokerUserId })
        }
        const [view] = await loadAutopayViews(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            now: new Date(),
            id: row.id,
        })
        return serializeMyAutopay(view)
    }
}
