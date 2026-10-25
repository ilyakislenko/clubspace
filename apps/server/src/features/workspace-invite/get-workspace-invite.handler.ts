import { Feature, IFeatureHandler } from '@shelfjs/features'

import { buildJoinUrl } from '../../domains/workspace/invite-links'
import { buildJoinQrPngDataUrl } from '../../domains/workspace/join-qr'
import { ensureJoinCode } from '../../domains/workspace/join-code.store'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceInviteFeature,
    GetWorkspaceInviteFeatureResponse,
} from './get-workspace-invite.feature'
import { serializeWorkspaceInvite } from './schemas'

@Feature(GetWorkspaceInviteFeature)
export class GetWorkspaceInviteHandler
    implements
        IFeatureHandler<
            GetWorkspaceInviteFeature,
            GetWorkspaceInviteFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: GetWorkspaceInviteFeature) {
        // Staff and the owner pass, a plain member is refused. Coaches see the
        // code too — they show the QR on their phone at the gym.
        await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName,
            isSuperAdmin,
        })

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true, joinAutoApprove: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const code = await ensureJoinCode(this.prisma, workspaceId)
        // No public address configured: no link to encode, so no QR either.
        const joinUrl = buildJoinUrl(environment.appUrl, code)
        const qr = joinUrl ? await buildJoinQrPngDataUrl(joinUrl) : null

        return serializeWorkspaceInvite(workspace, code, qr, environment)
    }
}
