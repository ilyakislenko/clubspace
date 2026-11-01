import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { UsersService } from '../../domains/users/services/users.service'
import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { loadMyDependentLink } from './dependent-access'
import {
    DeleteMyDependentFeature,
    DeleteMyDependentFeatureResponse,
} from './my-dependents.feature'

// A confirmed guardian deletes the child's profile: the same purge and
// anonymisation as a self-service account deletion (memberships, bookings,
// personal data, every guardian link), so clubs keep only de-identified
// history.
@Feature(DeleteMyDependentFeature)
export class DeleteMyDependentHandler
    implements
        IFeatureHandler<DeleteMyDependentFeature, DeleteMyDependentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly users: UsersService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        guardianId,
        dependentId,
    }: DeleteMyDependentFeature): Promise<DeleteMyDependentFeatureResponse> {
        const link = await loadMyDependentLink(
            this.prisma,
            guardianId,
            dependentId,
        )
        // A club's pending invitation gives no authority over the child yet:
        // decline it instead.
        if (!link.consentAt) {
            throw new ForbiddenError({
                message: 'Удалить можно только подтверждённый профиль ребёнка',
            })
        }

        await this.users.deleteAccount(dependentId)

        await this.audit.record({
            action: 'guardian.deleteDependent',
            targetType: 'member',
            targetId: dependentId,
            actorId: guardianId,
        })
        for (const club of link.dependent.workspaceMemberships) {
            this.realtime.invalidate(club.workspace.id, ['members'])
        }

        return { status: 'deleted' }
    }
}
