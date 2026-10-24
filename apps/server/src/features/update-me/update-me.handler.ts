import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { ME_SELECT, serializeMe } from '../get-me/schemas'
import { UpdateMeFeature, UpdateMeFeatureResponse } from './update-me.feature'

// A member edits their own name. Students sign up with an email only, so
// without this they stayed anonymous emails in every list a coach sees until
// an admin typed their name in. Scoped to the caller by construction: the
// user id comes from the verified token, never from the request.
@Feature(UpdateMeFeature)
export class UpdateMeHandler
    implements IFeatureHandler<UpdateMeFeature, UpdateMeFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ payload, userId }: UpdateMeFeature) {
        // Only the fields that were sent: omitting one leaves it as is.
        const data: { firstname?: string | null; lastname?: string | null } = {}
        if (payload.firstname !== undefined) data.firstname = payload.firstname
        if (payload.lastname !== undefined) data.lastname = payload.lastname

        try {
            const user = await this.prisma.user.update({
                where: { id: userId },
                data,
                select: ME_SELECT,
            })
            return serializeMe(user)
        } catch (err) {
            if ((err as { code?: string }).code === 'P2025') {
                throw new NotFoundError({ message: 'Пользователь не найден' })
            }
            throw err
        }
    }
}
