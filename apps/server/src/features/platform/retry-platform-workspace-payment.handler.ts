import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { serializePlatformPayment } from '../workspace-billing/schemas'
import {
    RetryPlatformWorkspacePaymentFeature,
    RetryPlatformWorkspacePaymentFeatureResponse,
} from './platform-workspace-payments.feature'

// «Повторить списание сейчас»: the renewal of a due, overdue or suspended
// club, without waiting for the next scheduled try. Same idempotent path as
// the hourly job, so it never charges a period twice.
@Feature(RetryPlatformWorkspacePaymentFeature)
export class RetryPlatformWorkspacePaymentHandler
    implements IFeatureHandler<RetryPlatformWorkspacePaymentFeature, RetryPlatformWorkspacePaymentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: RetryPlatformWorkspacePaymentFeature): Promise<RetryPlatformWorkspacePaymentFeatureResponse> {
        assertPlatformAdmin(f.isSuperAdmin)
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const res = await this.payments.renew(f.workspaceId, { initiator: 'PLATFORM' })
        return {
            outcome: res.outcome,
            reason: res.reason,
            payment: res.payment ? serializePlatformPayment(res.payment) : null,
        }
    }
}
