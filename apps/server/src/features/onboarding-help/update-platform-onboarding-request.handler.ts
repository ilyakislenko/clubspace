import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    UpdatePlatformOnboardingRequestFeature,
    UpdatePlatformOnboardingRequestFeatureResponse,
} from './onboarding-help.feature'
import { serializeOnboardingHelpRequest, setupFeeState } from './schemas'

// The operator closes a request (done / cancelled, with a note) or reopens it.
@Feature(UpdatePlatformOnboardingRequestFeature)
export class UpdatePlatformOnboardingRequestHandler
    implements
        IFeatureHandler<
            UpdatePlatformOnboardingRequestFeature,
            UpdatePlatformOnboardingRequestFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: UpdatePlatformOnboardingRequestFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        const current = await this.prisma.onboardingHelpRequest.findUnique({
            where: { id: f.requestId },
            select: { id: true, workspaceId: true, status: true },
        })
        if (!current) throw new NotFoundError({ message: 'Запрос не найден' })
        const closed = f.payload.status !== 'OPEN'
        const row = await this.prisma.onboardingHelpRequest.update({
            where: { id: current.id },
            data: {
                status: f.payload.status,
                ...(f.payload.resolution !== undefined
                    ? { resolution: f.payload.resolution || null }
                    : {}),
                resolvedAt: closed ? new Date() : null,
                resolvedById: closed ? f.invokerUserId : null,
            },
            include: {
                workspace: {
                    select: {
                        name: true,
                        billing: { select: { setupFeeWaived: true, setupFeePaidAt: true } },
                    },
                },
            },
        })
        await this.audit.record({
            action: 'workspace.onboardingHelpUpdate',
            targetType: 'workspace',
            targetId: current.workspaceId,
            workspaceId: current.workspaceId,
            actorId: f.invokerUserId,
            metadata: { requestId: current.id, from: current.status, to: f.payload.status },
        })
        return serializeOnboardingHelpRequest(
            row,
            setupFeeState(row.workspace.billing, environment.billing.pricing.setupFee),
        )
    }
}
