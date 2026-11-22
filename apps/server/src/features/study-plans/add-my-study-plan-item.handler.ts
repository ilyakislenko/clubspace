import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    AddMyStudyPlanItemFeature,
    AddMyStudyPlanItemFeatureResponse,
} from './add-my-study-plan-item.feature'
import { loadOwnPlan, loadPlanDetail, touchPlan } from './schemas'
import { isValidItemRange, MAX_STUDY_PLAN_ITEMS } from './study-plans-utils'

@Feature(AddMyStudyPlanItemFeature)
export class AddMyStudyPlanItemHandler
    implements
        IFeatureHandler<AddMyStudyPlanItemFeature, AddMyStudyPlanItemFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(
        f: AddMyStudyPlanItemFeature,
    ): Promise<AddMyStudyPlanItemFeatureResponse> {
        const { payload } = f
        if (!isValidItemRange(payload.startSec, payload.endSec)) {
            throw new BadRequestError({
                message: 'Конец отрезка должен быть позже начала',
            })
        }
        const plan = await loadOwnPlan(this.prisma, f)

        // Only a lesson of the plan's club the member may watch right now
        // (same gate as playback: 404 hides it, 403 says why it's locked).
        const video = await this.prisma.video.findUnique({
            where: { id: payload.videoId },
            select: { id: true, workspaceId: true },
        })
        if (!video || video.workspaceId !== plan.workspaceId) {
            throw new NotFoundError({ message: 'Видео не найдено' })
        }
        await this.courseAccess.assertCanWatchVideo(video, f.userId)

        // Under the plan's row lock (SELECT … FOR UPDATE), so concurrent adds
        // queue up: each reads the count and the last position after the
        // previous one committed — never past the limit, never a repeated
        // position.
        await this.prisma.$transaction(async (tx) => {
            const [locked] = await tx.$queryRaw<
                Array<{ id: string }>
            >`SELECT "id" FROM "StudyPlan" WHERE "id" = ${plan.id}::uuid FOR UPDATE`
            if (!locked) throw new NotFoundError({ message: 'План не найден' })
            const [count, last] = await Promise.all([
                tx.studyPlanItem.count({ where: { planId: plan.id } }),
                tx.studyPlanItem.findFirst({
                    where: { planId: plan.id },
                    orderBy: { position: 'desc' },
                    select: { position: true },
                }),
            ])
            if (count >= MAX_STUDY_PLAN_ITEMS) {
                throw new BadRequestError({
                    message: `В плане может быть не больше ${MAX_STUDY_PLAN_ITEMS} фрагментов`,
                })
            }
            await tx.studyPlanItem.create({
                data: {
                    planId: plan.id,
                    position: (last?.position ?? -1) + 1,
                    videoId: video.id,
                    startSec: payload.startSec,
                    endSec: payload.endSec,
                    title: payload.title,
                    note: payload.note || null,
                },
            })
        })
        const touched = await touchPlan(this.prisma, plan.id)
        return await loadPlanDetail(this.prisma, this.courseAccess, touched)
    }
}
