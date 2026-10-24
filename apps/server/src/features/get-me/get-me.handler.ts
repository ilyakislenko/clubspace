import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetMeFeature, GetMeFeatureResponse } from './get-me.feature'
import { ME_SELECT, serializeMe } from './schemas'

@Feature(GetMeFeature)
export class GetMeHandler
    implements IFeatureHandler<GetMeFeature, GetMeFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId }: GetMeFeature) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: ME_SELECT,
        })

        if (!user) {
            throw new NotFoundError({ message: 'Пользователь не найден' })
        }

        return serializeMe(user)
    }
}
