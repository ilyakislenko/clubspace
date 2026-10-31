import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadCourseAudience } from './schemas'
import {
    UpdateCourseAudienceFeature,
    UpdateCourseAudienceFeatureResponse,
} from './update-course-audience.feature'

@Feature(UpdateCourseAudienceFeature)
export class UpdateCourseAudienceHandler
    implements
        IFeatureHandler<
            UpdateCourseAudienceFeature,
            UpdateCourseAudienceFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UpdateCourseAudienceFeature) {
        await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        const course = await this.prisma.course.findFirst({
            where: { id: f.courseId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!course) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        const groupIds = [...new Set(f.payload.groupIds)]
        const rankLevelIds = [...new Set(f.payload.rankLevelIds)]
        const planIds = [...new Set(f.payload.planIds)]

        // Every target must belong to this club — ids from another club would
        // otherwise let a coach probe or bind foreign rows.
        const [groups, levels, plans] = await Promise.all([
            this.prisma.group.findMany({
                where: { id: { in: groupIds }, workspaceId: f.workspaceId },
                select: { id: true },
            }),
            this.prisma.rankLevel.findMany({
                where: {
                    id: { in: rankLevelIds },
                    ladder: { workspaceId: f.workspaceId },
                },
                select: { id: true, ladderId: true },
            }),
            this.prisma.plan.findMany({
                where: { id: { in: planIds }, workspaceId: f.workspaceId },
                select: { id: true },
            }),
        ])
        if (groups.length !== groupIds.length) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }
        if (levels.length !== rankLevelIds.length) {
            throw new NotFoundError({ message: 'Уровень не найден' })
        }
        if (plans.length !== planIds.length) {
            throw new NotFoundError({ message: 'Абонемент не найден' })
        }
        if (new Set(levels.map((l) => l.ladderId)).size !== levels.length) {
            throw new BadRequestError({
                message:
                    'Для одной системы рангов выберите только один минимальный уровень',
            })
        }

        await this.prisma.$transaction([
            this.prisma.courseAudience.deleteMany({
                where: { courseId: f.courseId },
            }),
            this.prisma.courseAudience.createMany({
                data: [
                    ...groupIds.map((groupId) => ({
                        courseId: f.courseId,
                        kind: 'GROUP' as const,
                        groupId,
                    })),
                    ...rankLevelIds.map((rankLevelId) => ({
                        courseId: f.courseId,
                        kind: 'RANK' as const,
                        rankLevelId,
                    })),
                    ...planIds.map((planId) => ({
                        courseId: f.courseId,
                        kind: 'PLAN' as const,
                        planId,
                    })),
                ],
            }),
        ])

        await this.audit.record({
            action: 'playlist.update',
            targetType: 'playlist',
            targetId: f.courseId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                fields: ['audience'],
                groupIds,
                rankLevelIds,
                planIds,
            },
        })

        // Who sees the course changed: every open course list refetches.
        this.realtime.invalidate(f.workspaceId, ['courses'])

        return loadCourseAudience(this.prisma, f.workspaceId, f.courseId)
    }
}
