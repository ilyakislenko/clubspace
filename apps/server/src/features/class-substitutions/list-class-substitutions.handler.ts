import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    ownGroupsWhere,
    RbacService,
} from '../../shared/services/rbac.service'
import { loadDecider } from './class-substitution-access'
import {
    ListClassSubstitutionsFeature,
    ListClassSubstitutionsFeatureResponse,
} from './list-class-substitutions.feature'
import {
    classSubstitutionInclude,
    serializeClassSubstitution,
} from './schemas'

const MAX_RANGE_DAYS = 92

@Feature(ListClassSubstitutionsFeature)
export class ListClassSubstitutionsHandler
    implements
        IFeatureHandler<
            ListClassSubstitutionsFeature,
            ListClassSubstitutionsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListClassSubstitutionsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const from = new Date(`${f.payload.from}T00:00:00Z`)
        const to = new Date(`${f.payload.to}T00:00:00Z`)
        const days = (to.getTime() - from.getTime()) / 86_400_000
        if (days < 0 || days > MAX_RANGE_DAYS) {
            throw new BadRequestError({
                message: `Период — от одного дня до ${MAX_RANGE_DAYS} дней`,
            })
        }
        const decides = await loadDecider(this.rbac, ctx)
        const rows = await this.prisma.classSubstitution.findMany({
            where: {
                workspaceId: f.workspaceId,
                sessionDate: { gte: from, lte: to },
                ...(this.rbac.canWriteAllGroups(ctx)
                    ? {}
                    : {
                          OR: [
                              { substituteId: ctx.userId },
                              { requestedById: ctx.userId },
                              { group: ownGroupsWhere(ctx.userId) },
                          ],
                      }),
            },
            include: classSubstitutionInclude,
            orderBy: [{ sessionDate: 'asc' }, { slot: { startTime: 'asc' } }],
        })
        return {
            data: rows.map((row) =>
                serializeClassSubstitution(row, {
                    userId: ctx.userId,
                    canDecide: decides(row.group),
                }),
            ),
        }
    }
}
