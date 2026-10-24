import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { ME_SELECT, serializeMe } from '../get-me/schemas'
import { UpdateMeFeature, UpdateMeFeatureResponse } from './update-me.feature'

// A member edits their own name. Students sign up with an email only, so
// without this they stayed anonymous emails in every list a coach sees until
// an admin typed their name in. Scoped to the caller by construction: the
// user id comes from the verified token, never from the request.
//
// The name lives on the account, not the membership, so it changes in every
// club the user belongs to — each of those gets the audit entry and the live
// refresh the admin rename path (update-member-profile) produces.
@Feature(UpdateMeFeature)
export class UpdateMeHandler
    implements IFeatureHandler<UpdateMeFeature, UpdateMeFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({ payload, userId }: UpdateMeFeature) {
        // Only the fields that were sent: omitting one leaves it as is.
        const data: { firstname?: string | null; lastname?: string | null } = {}
        if (payload.firstname !== undefined) data.firstname = payload.firstname
        if (payload.lastname !== undefined) data.lastname = payload.lastname

        let user
        try {
            user = await this.prisma.user.update({
                where: { id: userId },
                data,
                select: ME_SELECT,
            })
        } catch (err) {
            if ((err as { code?: string }).code === 'P2025') {
                throw new NotFoundError({ message: 'Пользователь не найден' })
            }
            throw err
        }

        if (Object.keys(data).length > 0) {
            const [memberships, owned] = await Promise.all([
                this.prisma.workspaceMember.findMany({
                    where: { userId },
                    select: { workspaceId: true },
                }),
                // The owner has no member row.
                this.prisma.workspace.findMany({
                    where: { ownerId: userId },
                    select: { id: true },
                }),
            ])
            const workspaceIds = new Set([
                ...memberships.map((m) => m.workspaceId),
                ...owned.map((w) => w.id),
            ])
            for (const workspaceId of workspaceIds) {
                await this.audit.record({
                    action: 'member.updateOwnProfile',
                    targetType: 'member',
                    targetId: userId,
                    workspaceId,
                    actorId: userId,
                    metadata: { changes: data },
                })
                this.realtime.invalidate(workspaceId, ['members', 'leaderboard'])
            }
        }

        return serializeMe(user)
    }
}
