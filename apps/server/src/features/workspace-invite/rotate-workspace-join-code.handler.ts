import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { buildJoinUrl } from '../../domains/workspace/invite-links'
import { assignNewJoinCode } from '../../domains/workspace/join-code.store'
import { buildJoinQrPngDataUrl } from '../../domains/workspace/join-qr'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RotateWorkspaceJoinCodeFeature,
    RotateWorkspaceJoinCodeFeatureResponse,
} from './rotate-workspace-join-code.feature'
import { serializeWorkspaceInvite } from './schemas'

@Feature(RotateWorkspaceJoinCodeFeature)
export class RotateWorkspaceJoinCodeHandler
    implements
        IFeatureHandler<
            RotateWorkspaceJoinCodeFeature,
            RotateWorkspaceJoinCodeFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: RotateWorkspaceJoinCodeFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Сменить код клуба может только администратор клуба',
        )

        // The old code stops working the moment this write lands.
        const code = await assignNewJoinCode(this.prisma, workspaceId)

        // Codes stay out of the audit metadata: the journal is readable by
        // more people than the code should be.
        await this.audit.record({
            action: 'workspace.rotateJoinCode',
            targetType: 'workspace',
            targetId: workspaceId,
            workspaceId,
            actorId: invokerUserId,
        })

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true, joinAutoApprove: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const qr = await buildJoinQrPngDataUrl(
            buildJoinUrl(environment.appUrl, code),
        )

        return serializeWorkspaceInvite(workspace, code, qr, environment)
    }
}
