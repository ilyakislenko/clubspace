import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetMeFeature, GetMeFeatureResponse } from './get-me.feature'

@Feature(GetMeFeature)
export class GetMeHandler
    implements IFeatureHandler<GetMeFeature, GetMeFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId }: GetMeFeature) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                firstname: true,
                lastname: true,
                profilePhotoUrl: true,
                language: true,
                isSuperAdmin: true,
                createdAt: true,
            },
        })

        if (!user) {
            throw new NotFoundError({ message: 'Пользователь не найден' })
        }

        return {
            id: user.id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            profilePhotoUrl: user.profilePhotoUrl,
            language: user.language,
            isSuperAdmin: user.isSuperAdmin,
            createdAt: user.createdAt.toISOString(),
        }
    }
}
