import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    LogAtRiskContactFeature,
    LogAtRiskContactFeatureResponse,
} from './log-at-risk-contact.feature'
import { serializeRetentionContact } from './schemas'

@Feature(LogAtRiskContactFeature)
export class LogAtRiskContactHandler
    implements
        IFeatureHandler<LogAtRiskContactFeature, LogAtRiskContactFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: LogAtRiskContactFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName,
            isSuperAdmin,
        })
        // A coach logs only for members of their own groups, even with read-all.
        await this.rbac.assertCanWriteMember(ctx, userId)

        const member = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId, userId, status: 'ACTIVE' },
            select: { id: true },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        // The server takes the snapshot of the signals, the client is not trusted.
        const [entry] = await loadWorkspaceRisk(this.prisma, {
            workspaceId,
            now: new Date(),
            userIds: [userId],
        })

        const row = await this.prisma.memberRetentionContact.create({
            data: {
                workspaceId,
                userId,
                contactedById: ctx.userId,
                reason: entry?.risk.reason ?? null,
                signals: entry?.risk.signals ?? [],
                note: payload.note || null,
            },
            include: {
                contactedBy: {
                    select: { firstname: true, lastname: true, email: true },
                },
            },
        })

        return serializeRetentionContact(row)
    }
}
