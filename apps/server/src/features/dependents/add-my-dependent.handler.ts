import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { recordDependentConsent } from './dependent-access'
import {
    GUARDIAN_CONSENT_VERSION,
    MAX_DEPENDENTS_PER_GUARDIAN,
    dateOfBirthToDate,
} from './dependents-utils'
import {
    AddMyDependentFeature,
    AddMyDependentFeatureResponse,
} from './my-dependents.feature'
import { myDependentSelect, serializeMyDependent } from './schemas'

// A guardian adds a child profile themselves: a User without an e-mail plus a
// confirmed Guardianship carrying the guardian's consent. The child joins a
// club afterwards by code, with the guardian acting for it (X-Act-As).
@Feature(AddMyDependentFeature)
export class AddMyDependentHandler
    implements
        IFeatureHandler<AddMyDependentFeature, AddMyDependentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        payload,
        guardianId,
        ip,
        userAgent,
    }: AddMyDependentFeature): Promise<AddMyDependentFeatureResponse> {
        const guardian = await this.prisma.user.findUnique({
            where: { id: guardianId },
            select: { email: true, language: true },
        })
        // Only a person with a login of their own can be a guardian.
        if (!guardian) {
            throw new NotFoundError({ message: 'Аккаунт не найден' })
        }
        if (guardian.email === null) {
            throw new BadRequestError({
                message: 'Профиль ребёнка не может добавлять детей',
            })
        }

        const count = await this.prisma.guardianship.count({
            where: { guardianId, dependent: { status: 'ACTIVE' } },
        })
        if (count >= MAX_DEPENDENTS_PER_GUARDIAN) {
            throw new BadRequestError({
                message: `Можно добавить не больше ${MAX_DEPENDENTS_PER_GUARDIAN} детей`,
            })
        }

        const row = await this.prisma.$transaction(async (tx) => {
            const child = await tx.user.create({
                data: {
                    email: null,
                    status: 'ACTIVE',
                    language: guardian.language,
                    firstname: payload.firstname,
                    lastname: payload.lastname ?? null,
                    dateOfBirth: dateOfBirthToDate(payload.dateOfBirth),
                },
                select: { id: true },
            })
            const link = await tx.guardianship.create({
                data: {
                    guardianId,
                    dependentId: child.id,
                    relation: payload.relation,
                    consentAt: new Date(),
                    consentVersion: GUARDIAN_CONSENT_VERSION,
                },
                select: myDependentSelect,
            })
            await recordDependentConsent(tx, {
                guardianId,
                dependentId: child.id,
                version: GUARDIAN_CONSENT_VERSION,
                ip,
                userAgent,
            })
            return link
        })

        await this.audit.record({
            action: 'guardian.addDependent',
            targetType: 'member',
            targetId: row.dependent.id,
            actorId: guardianId,
            metadata: { consentVersion: GUARDIAN_CONSENT_VERSION },
        })

        return serializeMyDependent(row)
    }
}
