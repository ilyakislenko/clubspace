import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetMyCheckInCardFeature,
    GetMyCheckInCardFeatureResponse,
} from './get-my-check-in-card.feature'
import { CARD_HOLDER_SELECT, serializeCheckInCard } from './schemas'

// The card is for the club's members (the owner has no member row): a super
// admin passing the guard without one gets no card.
@Feature(GetMyCheckInCardFeature)
export class GetMyCheckInCardHandler
    implements
        IFeatureHandler<GetMyCheckInCardFeature, GetMyCheckInCardFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, userId }: GetMyCheckInCardFeature) {
        const [workspace, membership] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId, userId },
                select: { id: true },
            }),
        ])
        if (!membership && workspace?.ownerId !== userId) {
            throw new NotFoundError({ message: 'Вы не участник этого клуба' })
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: CARD_HOLDER_SELECT,
        })
        if (!user) {
            throw new NotFoundError({ message: 'Пользователь не найден' })
        }
        return serializeCheckInCard(user)
    }
}
