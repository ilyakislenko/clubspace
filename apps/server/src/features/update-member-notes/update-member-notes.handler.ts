import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    UpdateMemberNotesFeature,
    UpdateMemberNotesFeatureResponse,
} from './update-member-notes.feature'

@Feature(UpdateMemberNotesFeature)
export class UpdateMemberNotesHandler
    implements
        IFeatureHandler<
            UpdateMemberNotesFeature,
            UpdateMemberNotesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        workspaceId,
        userId,
        invokerUserId,
    }: UpdateMemberNotesFeature) {
        // RoleGuard already restricted this to workspace admins; here we just
        // confirm the target is a member of this workspace (the User table is
        // global) before writing.
        const membership = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId, userId },
            select: { id: true },
        })
        if (!membership) {
            throw new NotFoundError({ message: 'Участник не найден' })
        }

        // Normalise blank/whitespace to null so the column stays clean.
        const notes =
            payload.notes && payload.notes.trim() !== '' ? payload.notes : null

        await this.prisma.workspaceMember.update({
            where: { id: membership.id },
            data: { notes },
        })

        // Record the action only — never the note content (it's private).
        await this.audit.record({
            action: 'member.updateNotes',
            targetType: 'member',
            targetId: userId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { cleared: notes === null },
        })

        return { userId, notes }
    }
}
