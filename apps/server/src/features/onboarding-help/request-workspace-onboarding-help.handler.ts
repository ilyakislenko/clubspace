import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RequestWorkspaceOnboardingHelpFeature,
    RequestWorkspaceOnboardingHelpFeatureResponse,
} from './onboarding-help.feature'
import { loadWorkspaceOnboardingHelp, ONBOARDING_HELP_ADMIN_ONLY } from './onboarding-help-view'

// Files the request for the platform console (or updates the open one). It
// costs the platform nothing until it acts: the console decides, and the
// setup fee pays for it with the first paid period unless waived.
@Feature(RequestWorkspaceOnboardingHelpFeature)
export class RequestWorkspaceOnboardingHelpHandler
    implements
        IFeatureHandler<
            RequestWorkspaceOnboardingHelpFeature,
            RequestWorkspaceOnboardingHelpFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly billing: PlatformBillingService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: RequestWorkspaceOnboardingHelpFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            ONBOARDING_HELP_ADMIN_ONLY,
        )
        const user = await this.prisma.user.findUnique({
            where: { id: f.invokerUserId },
            select: { email: true, firstname: true, lastname: true },
        })
        if (!user) throw new NotFoundError({ message: 'Пользователь не найден' })
        const name =
            [user.firstname, user.lastname].filter(Boolean).join(' ').trim() ||
            user.email ||
            'Администратор клуба'
        const details = {
            phone: f.payload.phone || null,
            message: f.payload.message || null,
        }
        const open = await this.prisma.onboardingHelpRequest.findFirst({
            where: { workspaceId: f.workspaceId, status: 'OPEN' },
            select: { id: true },
        })
        const saved = open
            ? await this.prisma.onboardingHelpRequest.update({
                  where: { id: open.id },
                  data: details,
              })
            : await this.prisma.onboardingHelpRequest.create({
                  data: {
                      workspaceId: f.workspaceId,
                      requestedById: f.invokerUserId,
                      requesterName: name.slice(0, 255),
                      requesterEmail: user.email,
                      ...details,
                  },
              })
        await this.audit.record({
            action: 'workspace.onboardingHelpRequest',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { requestId: saved.id, updated: open !== null },
        })
        return loadWorkspaceOnboardingHelp(this.prisma, this.billing, f.workspaceId)
    }
}
