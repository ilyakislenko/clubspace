import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { COACHING_ROLES } from '../../shared/decorators/roles.decorator'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListPersonalTrainingsFeature,
    ListPersonalTrainingsFeatureResponse,
} from './list-personal-trainings.feature'
import {
    loadOfferingCoaches,
    requestInclude,
} from './personal-training-access'
import { serializePersonalTraining } from './schemas'

const HISTORY_DAYS = 90
const MAX_ROWS = 200

@Feature(ListPersonalTrainingsFeature)
export class ListPersonalTrainingsHandler
    implements
        IFeatureHandler<
            ListPersonalTrainingsFeature,
            ListPersonalTrainingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListPersonalTrainingsFeature) {
        const now = new Date()
        const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000)

        let scope: Record<string, unknown>
        if (f.payload.view === 'workspace') {
            const ctx = await this.rbac.resolveCoachScope({
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            })
            if (!this.rbac.canWriteAllGroups(ctx)) {
                throw new ForbiddenError({
                    message: 'Нужны права администратора клуба',
                })
            }
            scope = {}
        } else {
            scope = {
                OR: [{ memberId: f.invokerUserId }, { coachId: f.invokerUserId }],
            }
        }

        const rows = await this.prisma.personalTrainingRequest.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...scope,
                updatedAt: { gte: since },
            },
            orderBy: { createdAt: 'desc' },
            take: MAX_ROWS,
            include: requestInclude,
        })
        const offer = await this.prisma.personalTrainingCoach.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: f.workspaceId,
                    userId: f.invokerUserId,
                },
            },
            select: { userId: true },
        })
        const coaches = await loadOfferingCoaches(this.prisma, f.workspaceId)

        return {
            data: rows.map((r) => serializePersonalTraining(r, now)),
            canOffer: COACHING_ROLES.includes((f.roleName ?? '') as never),
            offersPersonalTraining: offer !== null,
            coachesAvailable: coaches.filter((c) => c.userId !== f.invokerUserId)
                .length,
        }
    }
}
