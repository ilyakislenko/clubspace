import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    MarkRecordsFeature,
    MarkRecordsFeatureResponse,
} from './mark-records.feature'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'

@Feature(MarkRecordsFeature)
export class MarkRecordsHandler
    implements IFeatureHandler<MarkRecordsFeature, MarkRecordsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: MarkRecordsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )

        const ids = [...new Set(f.payload.userIds)]

        // (1) Validate ACTIVE membership; the owner is allowed with no member row.
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'ACTIVE',
                userId: { in: ids },
            },
            select: { userId: true },
        })
        const allowed = new Set(members.map((m) => m.userId))
        if (workspace?.ownerId) allowed.add(workspace.ownerId)
        const unknown = ids.filter((id) => !allowed.has(id))
        if (unknown.length) {
            throw new BadRequestError({
                message: `Not active workspace members: ${unknown.join(', ')}`,
            })
        }

        // (2) isGuest per user (group sessions only; null for events).
        let guestOf: (userId: string) => boolean | null = () => null
        if (session.groupId) {
            const gm = await this.prisma.groupMember.findMany({
                where: { groupId: session.groupId, userId: { in: ids } },
                select: { userId: true },
            })
            const inGroup = new Set(gm.map((g) => g.userId))
            guestOf = (userId: string) => !inGroup.has(userId)
        }

        // (3) Insert; a re-mark is a no-op (skipDuplicates).
        await this.prisma.attendanceRecord.createMany({
            data: ids.map((userId) => ({
                sessionId: session.id,
                workspaceId: f.workspaceId,
                userId,
                isGuest: guestOf(userId),
                markedById: f.invokerUserId,
            })),
            skipDuplicates: true,
        })

        return buildRoster(this.prisma, session)
    }
}
