import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    SignOutEverywhereFeature,
    SignOutEverywhereFeatureResponse,
} from './sign-out-everywhere.feature'

// Ends every session of the caller, this device included: the version bump
// makes AuthGuard refuse every access token already issued, and revoking the
// refresh tokens (rather than deleting them) keeps a later replay of one
// recognisable as reuse.
@Feature(SignOutEverywhereFeature)
export class SignOutEverywhereHandler
    implements
        IFeatureHandler<
            SignOutEverywhereFeature,
            SignOutEverywhereFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        userId,
    }: SignOutEverywhereFeature): Promise<SignOutEverywhereFeatureResponse> {
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: userId },
                data: { sessionVersion: { increment: 1 } },
                select: { id: true },
            }),
            this.prisma.refreshToken.updateMany({
                where: { userId, isRevoked: false },
                data: { isRevoked: true },
            }),
        ])

        return { status: 'signed-out' as const }
    }
}
