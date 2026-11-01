import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    UpdateMembershipNotificationsFeature,
    UpdateMembershipNotificationsFeatureResponse,
} from './update-membership-notifications.feature'

// The member mutes or unmutes one club's notifications for themselves. Only
// their own ACTIVE membership row; the owner (no row) has nothing to mute here.
@Feature(UpdateMembershipNotificationsFeature)
export class UpdateMembershipNotificationsHandler
    implements
        IFeatureHandler<
            UpdateMembershipNotificationsFeature,
            UpdateMembershipNotificationsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: UpdateMembershipNotificationsFeature): Promise<UpdateMembershipNotificationsFeatureResponse> {
        const { count } = await this.prisma.workspaceMember.updateMany({
            where: { userId: invokerUserId, workspaceId, status: 'ACTIVE' },
            data: { notificationsMuted: payload.muted },
        })
        if (count === 0) {
            throw new NotFoundError({ message: 'Вы не состоите в этом клубе' })
        }
        return { workspaceId, notificationsMuted: payload.muted }
    }
}
