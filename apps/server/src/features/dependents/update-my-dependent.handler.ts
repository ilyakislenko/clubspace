import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { loadMyDependentLink } from './dependent-access'
import { dateOfBirthToDate } from './dependents-utils'
import {
    UpdateMyDependentFeature,
    UpdateMyDependentFeatureResponse,
} from './my-dependents.feature'
import { serializeMyDependent } from './schemas'

// The child's name and birth date, edited by a confirmed guardian.
@Feature(UpdateMyDependentFeature)
export class UpdateMyDependentHandler
    implements
        IFeatureHandler<UpdateMyDependentFeature, UpdateMyDependentFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        payload,
        guardianId,
        dependentId,
    }: UpdateMyDependentFeature): Promise<UpdateMyDependentFeatureResponse> {
        const link = await loadMyDependentLink(
            this.prisma,
            guardianId,
            dependentId,
        )
        if (!link.consentAt) {
            throw new ForbiddenError({
                message: 'Сначала подтвердите, что это ваш ребёнок',
            })
        }

        const updated = await this.prisma.user.update({
            where: { id: dependentId },
            data: {
                ...(payload.firstname !== undefined
                    ? { firstname: payload.firstname }
                    : {}),
                ...(payload.lastname !== undefined
                    ? { lastname: payload.lastname }
                    : {}),
                ...(payload.dateOfBirth !== undefined
                    ? { dateOfBirth: dateOfBirthToDate(payload.dateOfBirth) }
                    : {}),
            },
            select: { firstname: true, lastname: true, dateOfBirth: true },
        })

        return serializeMyDependent({
            ...link,
            dependent: { ...link.dependent, ...updated },
        })
    }
}
